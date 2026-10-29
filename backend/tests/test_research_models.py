import copy
import json
import unittest
from unittest.mock import patch

import httpx

from backend.research_agent import ResearchAgentRequest, ResearchWorkspace, run_research_agent
from backend.research_models import RESEARCH_MODELS, ResearchModelInput, compact, model_physics
from backend.scene_physics import calculate
from backend.settings import Settings


def method(global_question=False):
    return {'question':'研究相位如何影响两束光的叠加强度','method':'固定振幅，扫描相位并比较实际计算的平均相对光强',
            'questionRequires':['ideal-coherent-interference']+(['coherent-path-interference'] if global_question else []),
            'calculationUses':['ideal-coherent-interference'],'calculationQuestion':'理想同频同向同偏振光波的局部叠加强度',
            'remainingQuestion':'任意三维光路和完整空间的能量去向仍未验证' if global_question else ''}


def workspace(inputs=None, global_question=False):
    w=ResearchWorkspace(require_method=True, model_experiments=inputs)
    w.execute('read_research',{})
    w.execute('assess_research_method',method(global_question))
    return w


def microscope_workspace():
    w=ResearchWorkspace()
    w.execute('read_research',{})
    return w


def microscope_reply():
    w=microscope_workspace()
    for study in (1,3):
        w.execute('run_model_experiment',{'sceneId':'instruments-0','parameters':{'study':study,'wavelength':550,'medium':1},'scan':{'field':'NA','values':[.25,.5]}})
    w.execute('run_model_experiment',{'sceneId':'instruments-0','parameters':{'study':3,'mode':1,'defocus':2},'scan':{'field':'defocus','values':[-2,2]}})
    return w.reply('microscope-fixture','分辨率提高、景深减小。',[])


def instruments_reply():
    w=microscope_workspace()
    w.execute('run_model_experiment',{'sceneId':'instruments-2','parameters':{'study':2},'scan':{'field':'aperture','values':[12.5,6.25]}})
    w.execute('run_model_experiment',{'sceneId':'instruments-1','parameters':{'study':2,'wavelength':550},'scan':{'field':'aperture','values':[20,40]}})
    return w.reply('instruments-fixture','缩小相机光圈，几何景深增大；增大望远镜物镜口径，理想可分辨角间距减小。',[])


def agent_reply():
    """Real production orchestration and real physics, with deterministic model messages."""
    number=0
    def call(name,args,id):
        return {'id':id,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}
    def handle(request):
        nonlocal number
        number+=1
        payload=json.loads(request.content)
        if number==1:
            calls=[call('read_research',{},'read'),call('assess_research_method',method(),'method'),call('set_research_plan',{'steps':['比较相位改变时的光强']},'plan')]
        elif number==2:
            calls=[call('run_model_experiment',{'sceneId':'wave-fields-1','parameters':{'amplitude1':1,'amplitude2':1,'phaseDeg':180},'scan':{'field':'phaseDeg','values':[0,90,180,270,360]}},'calculate')]
        elif number==3:
            result=json.loads(next(m['content'] for m in payload['messages'] if m.get('tool_call_id')=='calculate'))['data']
            calls=[call('update_research_step',{'stepNumber':1,'status':'completed','basis':'calculation','note':'已计算五个相位取值的平均相对光强','evidence':[result['recordReference']]},'record')]
        else:
            calls=[]
        message={'role':'assistant','content':None if calls else '等振幅时，已算点中相位差180°的相对光强为0，0°为4。这里只验证理想局部光场，不是全局能量去向。',**({'tool_calls':calls} if calls else {})}
        return httpx.Response(200,json={'choices':[{'finish_reason':'tool_calls' if calls else 'stop','message':message}]})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        return run_research_agent(ResearchAgentRequest(requestId='model-fixture',message='两束光怎么相消？做个实验看看。'),Settings('test','test','https://example.test'),client=client)


class ResearchModelsTests(unittest.TestCase):
    def test_computed_records_survive_failure_of_the_final_ai_explanation(self):
        def call(name, args, id):
            return {'id':id,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}
        calls = iter([
            [call('assess_research_method',method(),'method')],
            [call('run_model_experiment',{'sceneId':'wave-fields-1','parameters':{'phaseDeg':180},'scan':{'field':'phaseDeg','values':[0,180]}},'calculate')],
            None])
        def provider(request):
            actions = next(calls)
            if actions is None:
                return httpx.Response(502)
            return httpx.Response(200,json={'choices':[{'finish_reason':'tool_calls','message':{'role':'assistant','content':None,'tool_calls':actions}}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            reply=run_research_agent(ResearchAgentRequest(requestId='keep-model-data',message='计算模型'),Settings('test','test','https://example.test'),client=client)
        self.assertEqual(len(reply['modelResults']),1)
        self.assertEqual(len(reply['modelResults'][0]['scans'][0]['rows']),2)
        self.assertIn('AI说明未完成',reply['answer'])
        self.assertNotIn('新装置',reply['answer'])

    def test_all_registered_models_reuse_existing_calculators_exactly(self):
        for scene_id in RESEARCH_MODELS:
            with self.subTest(scene=scene_id):
                w=workspace() if model_physics(scene_id)=='ideal-coherent-interference' else microscope_workspace()
                result,_=w.execute('run_model_experiment',{'sceneId':scene_id})
                expected=calculate(result['state'])
                self.assertEqual(result['evidence'],compact(expected))
                self.assertEqual(w.models.records[result['id']]['evidence'],expected)
                self.assertNotIn('curve',result['evidence'])
                if w.method:
                    self.assertEqual(w.reply('r','模型结果',[])['methodAssessment']['coverage'],'supported')
                self.assertIsNone(w.reply('r','模型结果',[])['inputSnapshot'])
                self.assertEqual(w.objects,[])

    def test_microscope_pages_and_na_scans_match_scene_calculator(self):
        for mode in (0, 1):
            for study in (0, 1, 2, 3):
                with self.subTest(mode=mode, study=study):
                    w=microscope_workspace()
                    args={'sceneId':'instruments-0','parameters':{'mode':mode,'study':study,'wavelength':550,'medium':1,'depthCriterion':mode}}
                    if study in (1,3):args['scan']={'field':'NA','values':[.25,.5,.75]}
                    result,_=w.execute('run_model_experiment',args)
                    self.assertEqual(result['evidence'],compact(calculate(result['state'])))
                    for scan in result['scans']:
                        for row in scan['rows']:
                            self.assertEqual(row['result'],compact(calculate(row['result']['input'])))
                        key='resolution' if study==1 else 'depth'
                        values=[next(m['value'] for m in row['result']['metrics'] if m['key']==key) for row in scan['rows']]
                        self.assertTrue(all(a>b for a,b in zip(values,values[1:])))
                    self.assertEqual(w.used_physics,{'ideal-microscope'})
                    self.assertIn('全景深',result['limits'])
                    self.assertFalse(w.objects)

    def test_microscope_uses_scene_defocus_link_and_rejects_invalid_na(self):
        from backend.scene_microscope_focus import patch_scene_parameters
        w=microscope_workspace()
        result,_=w.execute('run_model_experiment',{'sceneId':'instruments-0','parameters':{'study':3,'mode':1,'defocus':2},'scan':{'field':'defocus','values':[-2,2]}})
        self.assertAlmostEqual(result['state']['parameters']['defocus'],2)
        for row in result['scans'][0]['rows']:
            self.assertEqual(row['result'],compact(calculate(patch_scene_parameters(result['state'],{'defocus':row['value']}))))
        w=microscope_workspace()
        with self.assertRaises(ValueError):w.execute('run_model_experiment',{'sceneId':'instruments-0','parameters':{'medium':1},'scan':{'field':'NA','values':[.5,1.2]}})
        self.assertEqual(w.models.records,{})

    def test_camera_and_telescope_scans_match_scenes_across_studies(self):
        for scene_id, values, key, physics in [('instruments-2',[12.5,6.25],'depth','ideal-camera'),('instruments-1',[20,40],'resolution','ideal-telescope')]:
            for study in range(4):
                with self.subTest(scene=scene_id,study=study):
                    w=microscope_workspace()
                    result,_=w.execute('run_model_experiment',{'sceneId':scene_id,'parameters':{'study':study},'scan':{'field':'aperture','values':values}})
                    self.assertEqual(w.models.records[result['id']]['evidence'],calculate(result['state']))
                    rows=result['scans'][0]['rows']
                    for row in rows:self.assertEqual(row['result'],compact(calculate(row['result']['input'])))
                    readings=[next(m['value'] for m in row['result']['metrics'] if m['key']==key) for row in rows]
                    if key=='depth':self.assertGreater(readings[1],readings[0])
                    else:self.assertAlmostEqual(readings[1],readings[0]/2)
                    self.assertEqual(w.used_physics,{physics})
                    self.assertFalse(w.objects)
                    previous=copy.deepcopy(result)
                    next_w=ResearchWorkspace(model_experiments=[ResearchModelInput(id=result['id'],state=result['state'])])
                    next_w.execute('read_research',{})
                    changed,_=next_w.execute('run_model_experiment',{'sceneId':scene_id,'baseModelId':result['id'],'parameters':{'aperture':values[1]}})
                    self.assertEqual(changed['evidence'],rows[1]['result'])
                    self.assertEqual(result,previous)

    def test_phase_sweep_and_unequal_amplitudes_are_actual_readings(self):
        w=workspace()
        result,_=w.execute('run_model_experiment',{'sceneId':'wave-fields-1','parameters':{'amplitude1':1,'amplitude2':1,'phaseDeg':180},'scan':{'field':'phaseDeg','values':[0,90,180,360]}})
        intensities=[next(m['value'] for m in row['result']['metrics'] if m['key']=='intensity') for row in result['scans'][0]['rows']]
        for actual,expected in zip(intensities,[4,2,0,4]):self.assertAlmostEqual(actual,expected)
        before=copy.deepcopy(result)
        following=workspace([ResearchModelInput(id=result['id'],state=result['state'])])
        changed,_=following.execute('run_model_experiment',{'sceneId':'wave-fields-1','baseModelId':result['id'],'parameters':{'amplitude2':.5}})
        self.assertNotEqual(changed['id'],result['id'])
        self.assertEqual(next(m['value'] for m in changed['evidence']['metrics'] if m['key']=='intensity'),.25)
        self.assertEqual(following.models.inputs[result['id']],result['state'])
        self.assertEqual(result,before)

    def test_invalid_scan_cannot_leave_partial_evidence_and_preflight_is_required(self):
        w=ResearchWorkspace(require_method=True)
        with self.assertRaises(ValueError):w.execute('run_model_experiment',{'sceneId':'wave-fields-1'})
        w=workspace()
        for scan in [{'field':'phaseDeg','values':[0,900]}, {'field':'amplitude1','values':[1,True]}, {'field':'not-a-field','values':[0,1]}]:
            with self.assertRaises(ValueError):w.execute('run_model_experiment',{'sceneId':'wave-fields-1','scan':scan})
        self.assertEqual(w.models.records,{})
        self.assertEqual(w.available_evidence(),[])
        self.assertNotIn('实验完成',w.reply('r','实验完成',[])['answer'])

    def test_local_interference_never_upgrades_to_arbitrary_path_or_global_energy_validation(self):
        w=workspace(global_question=True)
        result,_=w.execute('run_model_experiment',{'sceneId':'wave-fields-1','parameters':{'phaseDeg':180,'amplitude1':1,'amplitude2':1}})
        self.assertEqual(result['questionScope']['coverage'],'partial')
        self.assertIn('完整空间',result['limits'])
        self.assertEqual(w.reply('r','局部相消',[])['methodAssessment']['coverage'],'partial')
        self.assertNotIn('coherent-path-interference',w.used_physics)

    def test_production_agent_returns_model_records_and_valid_plan_evidence_without_builder(self):
        with patch('backend.research_agent.build_research_apparatus') as builder:
            reply=agent_reply()
            builder.assert_not_called()
        self.assertEqual(len(reply['modelResults']),1)
        self.assertEqual(reply['apparatusBuilds'],[])
        self.assertIsNone(reply['evidence'])
        record=reply['modelResults'][0]
        self.assertEqual(reply['planProgress'][0]['evidence'][0],{'requestId':'model-fixture','objectId':record['id'],'kind':'model','recordId':record['id']})
        self.assertEqual(reply['methodAssessment']['coverage'],'supported')


if __name__=='__main__':unittest.main()

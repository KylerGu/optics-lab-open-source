import copy
import unittest
from unittest.mock import patch
from backend.scene_agent import SceneWorkspace, SceneAgentRequest, SceneChange, scene_change_context, editing_intent, run_scene_agent, scene_context
from backend.scene_physics import DEFINITIONS, FORMULAS
from backend.scene_agent_context import model_tool_result
from backend.settings import Settings
from backend.tests.test_scene_physics import state


class SceneAgentTests(unittest.TestCase):
    def test_recent_change_recalculates_both_sides_on_all_microscope_pages(self):
        for study,field,value,metric in [(0,'f2',25,'v'),(1,'NA',.8,'resolution'),(2,'fieldNumber',24,'fieldDiameter'),(3,'NA',.8,'depth')]:
            with self.subTest(study=study):
                before=state('instruments-0',study=study).model_dump()
                after=copy.deepcopy(before);after['parameters'][field]=value
                request=SceneAgentRequest(requestId='change',state=after,message='刚才为什么变了？',recentChange={'before':before,'after':after,'source':'user'})
                context=scene_change_context(request.recentChange)
                self.assertEqual([p['key'] for p in context['parameters']],[field,'defocus'] if study==0 else [field])
                values=[next(m['value'] for m in context[side]['metrics'] if m['key']==metric) for side in ('before','after')]
                self.assertNotEqual(values[0],values[1])
                with patch('backend.scene_agent.completion',return_value={'role':'assistant','content':'这是本次调节前后的计算结果。'}) as call:
                    result=run_scene_agent(request,Settings('test','test','https://example.com'),client=object())
                self.assertFalse(result['changed'])
                self.assertIn('最近一次操作及程序核对的前后结果',call.call_args.args[2][0]['content'])

    def test_recent_change_rejects_foreign_or_stale_snapshots(self):
        before=state('instruments-0',study=3)
        after=state('instruments-0',study=3,NA=.8)
        for old,new in [(before,before),(state('paraxial-0'),after)]:
            with self.assertRaises(ValueError):
                SceneAgentRequest(requestId='invalid',state=after,message='变化了什么',recentChange={'before':old,'after':new,'source':'user'})
        change=SceneChange(before=before,after=after,source='comparison')
        self.assertEqual(scene_change_context(change)['source'],'查看比较组')

    def test_eye_magnification_sign_and_magnitude_use_actual_results(self):
        for changes in ({},{'d':125},{'d':150},{'u':5},{'u':10}):
            with self.subTest(parameters=changes):
                workspace=SceneWorkspace(state('instruments-0',**changes),allow_edit=False)
                before=copy.deepcopy(workspace.state)
                result=workspace.execute('calculate_scene',{})
                metrics={m['key']:m['value'] for m in result['metrics']}
                values={m['metricKey']:m for m in result['calculation']['magnifications']}
                for key in ('objectiveM','angularM'):
                    self.assertEqual(values[key]['signed']['value'],metrics[key])
                    self.assertEqual(values[key]['magnitude']['value'],abs(metrics[key]) if metrics[key] is not None else None)
                if not changes:
                    self.assertAlmostEqual(values['objectiveM']['signed']['value'],-10)
                    self.assertAlmostEqual(values['angularM']['signed']['value'],-125)
                    self.assertAlmostEqual(values['angularM']['magnitude']['value'],125)
                original=copy.deepcopy(result)
                compact=model_tool_result(result)
                self.assertEqual(result,original)
                self.assertIn('有符号',next(m['label'] for m in compact['metrics'] if m['key']=='angularM'))
                self.assertEqual(workspace.state,before)

    def test_eye_formula_distinguishes_signed_rate_from_magnitude(self):
        workspace=SceneWorkspace(state('instruments-0'))
        for args in ({},{'formula_ids':['microscope-angular']}):
            formula=next(f for f in workspace.execute('read_scene',args)['formulas'] if f['id']=='microscope-angular')
            self.assertIn('有符号',formula['notation'])
            self.assertIn('|M|=|m_o|',formula['magnitudeLatex'])
            self.assertIn('infinity',formula['magnitudeLatex'])
        for changes in ({'mode':1},{'study':1},{'study':3}):
            result=SceneWorkspace(state('instruments-0',**changes)).execute('calculate_scene',{})
            self.assertNotIn('magnifications',result['calculation'])

    def test_microscope_background_is_page_scoped_and_retrievable(self):
        workspace=SceneWorkspace(state('instruments-0',study=1),allow_edit=False)
        before=copy.deepcopy(workspace.state)
        background=workspace.execute('read_scene',{})
        self.assertEqual([f['id'] for f in background['formulas']],['microscope-resolution'])
        self.assertNotIn('tubeF',background['state']['parameters'])
        self.assertNotIn('presets',background['capabilities'])
        self.assertTrue(any(f['id']=='microscope-depth' for f in background['capabilities']['formulaCatalog']))
        eye=workspace.execute('read_scene',{'study':0})
        self.assertIn('f2',eye['state']['parameters'])
        self.assertNotIn('pixel',eye['state']['parameters'])
        camera=workspace.execute('read_scene',{'study':2,'mode':1})
        self.assertIn('tubeF',camera['state']['parameters'])
        self.assertNotIn('f2',camera['state']['parameters'])
        depth=workspace.execute('read_scene',{'study':3})
        self.assertNotIn('pixel',depth['state']['parameters'])
        self.assertNotIn('e',[f['key'] for f in depth['formulas'][0]['fields']])
        full=workspace.execute('read_scene',{'formula_ids':['microscope-depth'],'include_presets':True})
        self.assertIn('e',[f['key'] for f in full['formulas'][0]['fields']])
        self.assertEqual(full['capabilities']['presets'],workspace.definition['presets'])
        with self.assertRaises(ValueError):workspace.execute('read_scene',{'formula_ids':['not-a-scene-formula']})
        self.assertEqual(workspace.state,before)

    def test_sampling_depth_retains_its_dependencies(self):
        workspace=SceneWorkspace(state('instruments-0',study=3,mode=1,depthCriterion=1))
        background=workspace.execute('read_scene',{})
        self.assertTrue({'pixel','f1','tubeF','adapter'} <= set(background['state']['parameters']))
        self.assertIn('e',[f['key'] for f in background['formulas'][0]['fields']])
        result=workspace.execute('calculate_scene',{})
        self.assertIn('pixel',result['calculation']['dependsOn'])
        self.assertGreater(next(m['value'] for m in result['metrics'] if m['key']=='geometricDepth'),0)

    def test_focus_edits_and_comparisons_share_sample_position(self):
        workspace=SceneWorkspace(state('instruments-0',study=3))
        original=copy.deepcopy(workspace.state)
        scan=workspace.execute('compare_parameter',{'field':'defocus','values':[-10,10]})
        self.assertEqual(workspace.state,original)
        for row in scan['rows']:
            p=row['result']['input']['parameters']
            self.assertAlmostEqual(p['u'],11+row['value']/1000)
            self.assertAlmostEqual(p['defocus'],row['value'])
        workspace.execute('set_parameters',{'parameters':{'defocus':20}})
        self.assertAlmostEqual(workspace.state['parameters']['u'],11.02)
        ray=workspace.execute('calculate_scene',{'study':0})
        self.assertIsNotNone(next(m['value'] for m in ray['metrics'] if m['key']=='v'))
        workspace.execute('set_parameters',{'parameters':{'u':11,'depthCriterion':1}})
        self.assertEqual(workspace.state['parameters']['defocus'],0)
        self.assertEqual(workspace.state['parameters']['depthCriterion'],0)

    def test_resolution_comparison_does_not_claim_to_verify_magnification(self):
        workspace=SceneWorkspace(state('instruments-0',study=1),allow_edit=False)
        before=copy.deepcopy(workspace.state)
        scan=workspace.execute('compare_parameter',{'field':'f1','values':[20,10,5]})
        self.assertIn('未参与',scan['calculationNote'])
        for row in scan['rows']:
            self.assertIn('成像倍率',row['result']['calculation']['notEvaluated'])
            self.assertEqual({m['key'] for m in row['result']['metrics']},{'resolution','separation'})
        imaging=workspace.execute('calculate_scene',{'study':0})
        self.assertAlmostEqual(next(m['value'] for m in imaging['metrics'] if m['key']=='angularM'),-125)
        scan=workspace.execute('compare_parameter',{'study':0,'field':'f1','values':[20,10,5]})
        self.assertNotIn('calculationNote',scan)
        self.assertTrue(all(any(m['key']=='angularM' for m in r['result']['metrics']) for r in scan['rows']))
        self.assertEqual(workspace.state,before)
        with self.assertRaises(ValueError):workspace.execute('calculate_scene',{'study':9})

    def test_off_page_read_preserves_applied_evidence_and_full_ui_inputs(self):
        workspace=SceneWorkspace(state('instruments-0',study=1))
        current=workspace.execute('set_parameters',{'parameters':{'NA':.5}})
        workspace.execute('calculate_scene',{'study':0})
        self.assertIs(workspace.evidence,current)
        compact=model_tool_result(current)
        self.assertNotIn('tubeF',compact['input']['parameters'])
        self.assertIn('tubeF',current['input']['parameters'])
        self.assertEqual(current['input'],workspace.state)

    def test_compact_context_preserves_physics_without_catalog_examples(self):
        originals=copy.deepcopy(DEFINITIONS)
        formulas=copy.deepcopy(FORMULAS)
        for scene_id,definition in DEFINITIONS.items():
            with self.subTest(scene=scene_id):
                capabilities,knowledge=scene_context(definition)
                self.assertEqual(capabilities['scope'],definition['scope'])
                self.assertNotIn('presets',capabilities)
                for actual,source in zip(capabilities['parameters'],definition['parameters']):
                    for key in ('key','label','unit','min','max','options'):
                        if key in source:self.assertEqual(actual[key],source[key])
                    self.assertNotIn('default',actual)
                sources=[f for f in FORMULAS if f['id'] in definition['formulas']]
                self.assertEqual(len(knowledge),len(sources))
                for actual,source in zip(knowledge,sources):
                    for key in ('id','latex','meaning','conditions'):
                        if key in source:self.assertEqual(actual[key],source[key])
                    self.assertNotIn('application',actual)
                    for field in actual['fields']:self.assertNotIn('default',field)
        self.assertEqual(DEFINITIONS,originals)
        self.assertEqual(FORMULAS,formulas)

    def test_concept_questions_use_no_calculation_or_edits(self):
        request=SceneAgentRequest(requestId='concept',state=state('reflection-refraction-1'),message='临界角是什么？')
        with patch('backend.scene_agent.completion',return_value={'role':'assistant','content':'临界角处折射光沿界面传播。'}) as call:
            reply=run_scene_agent(request,Settings('test','test','https://example.com'),client=object())
        self.assertFalse(reply['changed']);self.assertIsNone(reply['evidence']);self.assertEqual(reply['trace'],[])
        self.assertEqual(call.call_count,1)
        self.assertNotIn('set_parameters',[t['function']['name'] for t in call.call_args.args[-1]])

    def test_intent_and_direct_mutation_are_checked(self):
        for message in ['临界角是什么？','如何调整入射角？','比较30、45、60度','计算当前折射角']:
            self.assertFalse(editing_intent(message))
        for message in ['调到临界角','把像距调到300 mm','设置入射角为60度','调节感光面使当前物体对焦']:
            self.assertTrue(editing_intent(message))
        workspace=SceneWorkspace(state('reflection-refraction-1'),allow_edit=False)
        before=copy.deepcopy(workspace.state)
        with self.assertRaises(ValueError):workspace.execute('set_parameters',{'parameters':{'angle':60}})
        with self.assertRaises(ValueError):workspace.execute('solve_target',{'target':'critical_angle','apply':True})
        self.assertEqual(workspace.state,before)

    def test_compare_is_readonly_and_target_applies_verified_state(self):
        workspace=SceneWorkspace(state('reflection-refraction-1'))
        before=copy.deepcopy(workspace.state)
        scan=workspace.execute('compare_parameter',{'field':'angle','values':[30,45,60]})
        self.assertEqual(workspace.state,before)
        self.assertEqual(len(scan['rows']),3)
        self.assertEqual(scan['rows'][-1]['result']['metrics'][-1]['value'],0)
        candidate=workspace.execute('solve_target',{'target':'critical_angle','apply':True})
        self.assertTrue(candidate['applied']);self.assertEqual(workspace.evidence['input'],workspace.state)
        lens=SceneWorkspace(state('paraxial-0'))
        lens.execute('solve_target',{'target':'image_distance','value':300,'apply':True})
        self.assertAlmostEqual(lens.state['parameters']['u'],150)
        before=copy.deepcopy(lens.state)
        with self.assertRaises(ValueError):lens.execute('set_parameters',{'parameters':{'u':0}})
        self.assertEqual(lens.state,before)

    def test_geometrical_targets_are_scene_specific_and_verified(self):
        for scene_id,target,value,expected_key,expected_value in [('paraxial-1','image_distance',300,'u',150),('paraxial-2','image_distance',200,'u',300),('instruments-0','relaxed_eye',None,'d',130),('instruments-1','afocal',None,'d',230),('instruments-2','focus_sensor',None,'sensor',400/7)]:
            workspace=SceneWorkspace(state(scene_id))
            if scene_id=='instruments-0':workspace.execute('set_parameters',{'parameters':{'d':125}})
            result=workspace.execute('solve_target',{'target':target,'value':value,'apply':True})
            self.assertAlmostEqual(workspace.state['parameters'][expected_key],expected_value)
            self.assertEqual(result['evidence']['input'],workspace.state)
            self.assertEqual(workspace.evidence['input'],workspace.state)
        workspace=SceneWorkspace(state('instruments-2',u=20,f=50))
        before=copy.deepcopy(workspace.state)
        with self.assertRaises(ValueError):workspace.execute('solve_target',{'target':'focus_sensor','apply':True})
        self.assertEqual(workspace.state,before)

    def test_each_instrument_comparison_uses_physics_without_applying(self):
        cases=[('paraxial-1','u',[150,200],'v',[300,200]),('paraxial-2','u',[200,300],'v',[300,200]),('instruments-0','d',[125,130],'v',[-60,None]),('instruments-1','d',[230,250],'angularSpread',[0,200/3]),('instruments-2','aperture',[4,12.5],'blurDiameter',[.55,1.71875])]
        for scene_id,field,values,metric,expected in cases:
            workspace=SceneWorkspace(state(scene_id,**({'sensor':65} if scene_id=='instruments-2' else {})))
            before=copy.deepcopy(workspace.state)
            scan=workspace.execute('compare_parameter',{'field':field,'values':values})
            self.assertEqual(workspace.state,before)
            for row,value in zip(scan['rows'],expected):
                actual=next(m['value'] for m in row['result']['metrics'] if m['key']==metric)
                if value is None:self.assertIsNone(actual)
                else:self.assertAlmostEqual(actual,value)

import copy
import json
import time
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError
from backend.app import app
from backend.research_agent import ResearchAgentRequest, ResearchObject, ResearchWorkspace, run_research_agent
from backend.research_builder import build_research_apparatus
from backend.settings import Settings
from backend.spatial import SpatialExperiment
from backend.spatial_agent import SpatialAgentRequest, SpatialWorkspace, run_spatial_agent


SETTINGS = Settings('test', 'test', 'https://example.test')


def apparatus():
    return SpatialExperiment.model_validate({'schemaVersion': 2, 'name': '研究生成装置', 'elements': [
        {'id': 'source', 'name': '光源', 'kind': 'laser', 'position': [0, 60, 0], 'beamModel': 'gaussian', 'beamRadiusMm': 1},
        {'id': 'lens', 'name': '透镜', 'kind': 'lens', 'position': [100, 60, 0], 'focalLengthMm': 100},
        {'id': 'screen', 'name': '屏', 'kind': 'screen', 'position': [200, 60, 0]},
    ]})


def call(name, args, id):
    return {'id': id, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}


def message(calls=None, text='按实际结果说明。'):
    return {'role': 'assistant', 'content': None if calls else text, **({'tool_calls': calls} if calls else {})}


def response(result):
    return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if result.get('tool_calls') else 'stop', 'message': result}]})


def verified_proposal(seed=None):
    candidate = apparatus()
    seed = seed or SpatialExperiment(schemaVersion=2, name='待设计研究装置', elements=[])
    workspace = SpatialWorkspace(candidate)
    workspace.execute('set_goal', {'criteria': [{'label': '光线到屏', 'elementId': 'screen', 'metric': 'screen_hits', 'operator': 'ge', 'value': 1}]})
    checks = workspace.calculate()['checks']
    return {'requestId': 'builder-test', 'inputSnapshot': seed.model_dump(), 'experiment': candidate.model_dump(),
            'changed': seed != candidate, 'applyAllowed': True, 'checks': checks, 'evidence': workspace.evidence,
            'comparisons': [], 'trace': [], 'answer': '已在模型内核对光线到屏。'}


def run_handoff(original=None, failure=False, candidate=None, scan=None, fail_after_build=False, settings=None, payloads=None, preloaded=False, builder_settings=None, assessed=True):
    counters, progress = {'research': 0, 'builder': 0}, []
    candidate = candidate or apparatus()
    scan = scan or {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5}
    def handler(request):
        payload = json.loads(request.content)
        if payloads is not None:
            payloads.append(payload)
        research = any(t['function']['name'] == 'build_research_apparatus' for t in payload['tools'])
        role = 'research' if research else 'builder'
        counters[role] += 1
        number = counters[role]
        if research and number == 1:
            build_args = {'goal': '设计一个高斯光束经薄透镜到屏的装置，然后比较焦距80至120mm的5点结果。'}
            if original:
                build_args['baseObjectId'] = 'original'
            result = message([call('read_research', {}, 'read'), call('assess_research_method', {'question': '设计装置并比较参数对读数的影响', 'method': '建立装置并比较屏上实际读数', 'questionRequires': ['ray-geometry'], 'calculationUses': ['ray-geometry'], 'calculationQuestion': '当前模型下的参数与屏上读数', 'remainingQuestion': ''}, 'method'), call('build_research_apparatus', build_args, 'build')])
        elif not research and number == 1:
            if failure:
                return httpx.Response(502)
            result = message([
                call('list_apparatus', {}, 'catalog'), call('read_workspace', {}, 'context'),
                call('set_goal', {'criteria': [{'label': '光线到屏', 'elementId': 'screen', 'metric': 'screen_hits', 'operator': 'ge', 'value': 10000 if failure else 1}]}, 'goal'),
                call('set_apparatus', {'experiment': candidate.model_dump()}, 'apparatus'), call('trace_light', {}, 'trace'),
            ])
        elif not research:
            result = message(text='核对完成。')
        elif number == 2:
            if fail_after_build:
                return httpx.Response(502)
            data = json.loads(next(m['content'] for m in payload['messages'] if m.get('tool_call_id') == 'build'))
            if failure:
                assert not data['ok']
                result = message([call('simulate_apparatus', {}, 'cannot-assume'), call('build_research_apparatus', {'goal': '再试一次'}, 'cannot-rebuild')])
            else:
                assert data['ok']
                object_id = data['data']['objectId']
                result = message([call('simulate_apparatus', {'objectId': object_id}, 'calculate'), call('compare_parameter', {'objectId': object_id, **scan}, 'scan')])
        else:
            result = message(text='已经完成研究。')
        if preloaded and result.get('tool_calls'):
            result['tool_calls'] = [c for c in result['tool_calls'] if c['function']['name'] not in {'read_research', 'read_workspace', 'list_apparatus', 'trace_light'}]
        if not assessed and result.get('tool_calls'):
            result['tool_calls'] = [c for c in result['tool_calls'] if c['function']['name'] != 'assess_research_method']
        return response(result)
    objects = [ResearchObject(id='original', source='saved', label='原装置', experiment=original)] if original else []
    request = ResearchAgentRequest(requestId='handoff', message='请设计所需装置并继续研究焦距影响。', objects=objects, activeObjectId='original' if original else None, experiment=original)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = run_research_agent(request, settings or SETTINGS, client=client, progress=progress.append, builder_settings=builder_settings)
    return result, counters, progress


class ResearchBuilderTests(unittest.TestCase):
    def test_delegated_materials_keep_all_kinds_and_actual_parameters_without_duplicate_catalog(self):
        original = apparatus()
        payloads = []
        def provider(request):
            payloads.append(json.loads(request.content))
            raise httpx.ReadTimeout('test timeout')
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            with self.assertRaises(AgentError) as caught:
                build_research_apparatus('调整现有装置，保留光源与透镜', original,
                                         Settings('test', 'deepseek-flash', reasoning_effort='high'),
                                         client, None, None)
        self.assertEqual(caught.exception.status, 504)
        self.assertIn('响应超时', caught.exception.message)
        self.assertEqual(len(payloads), 1)
        content = payloads[0]['messages'][0]['content']
        catalog = json.loads(content.split('\n器材：', 1)[1].split('\n装置：', 1)[0])
        context = json.loads(content.split('\n装置：', 1)[1])
        full_catalog, _ = SpatialWorkspace(original).execute('list_apparatus', {})
        self.assertEqual(catalog['kinds'], full_catalog['kinds'])
        self.assertEqual(catalog['unsupported'], full_catalog['unsupported'])
        self.assertEqual(catalog['supportedModels'], full_catalog['supportedModels'])
        self.assertNotIn('elementSchema', catalog)
        self.assertNotIn('teachingLensPresets', catalog)
        self.assertLess(len(json.dumps(catalog)), len(json.dumps(full_catalog)) / 2)
        self.assertEqual([e['position'] for e in context['elements']], [list(e.position) for e in original.elements])
        self.assertEqual(context['elements'][0]['wavelengthNm'], original.elements[0].wavelengthNm)
        self.assertEqual(context['elements'][1]['focalLengthMm'], original.elements[1].focalLengthMm)
        self.assertNotIn('focalLengthMm', context['elements'][0])
        self.assertEqual(payloads[0]['reasoning_effort'], 'high')

    def test_timeout_with_unverified_draft_stays_timeout_and_preserves_original_object(self):
        original = apparatus()
        requests = []
        def provider(request):
            requests.append(json.loads(request.content))
            if len(requests) > 1:
                raise httpx.ReadTimeout('test timeout')
            candidate = apparatus().model_dump()
            candidate['name'] = '未完成副本'
            return response(message([
                call('set_goal', {'criteria': [{'label': '所需功率', 'elementId': 'screen', 'metric': 'screen_power_mw', 'operator': 'ge', 'value': 1000}]}, 'goal'),
                call('set_apparatus', {'experiment': candidate}, 'layout'),
            ]))
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            def build(goal, base):
                return build_research_apparatus(goal, base, Settings('test', 'deepseek-flash', reasoning_effort='high'),
                                                client, None, None)
            w = ResearchWorkspace(objects=[ResearchObject(id='original', source='saved', experiment=original)],
                                  active_object_id='original', builder=build)
            w.execute('read_research', {})
            with self.assertRaisesRegex(ValueError, '响应超时'):
                w.execute('build_research_apparatus', {'goal': '调整装置', 'baseObjectId': 'original'})
        result = w.reply('timeout', '完成', [])
        self.assertIn('响应超时', result['answer'])
        self.assertNotIn('缺少有效目标', result['answer'])
        self.assertEqual(result['apparatusBuilds'], [])
        self.assertEqual(result['objectSnapshots'][0]['experiment'], original.model_dump())
        self.assertEqual(result['activeObjectId'], 'original')

    def test_autonomous_build_and_calculation_need_no_forced_method_or_plan(self):
        payloads = []
        result, counts, _ = run_handoff(settings=Settings('test', 'deepseek-flash', reasoning_effort='max'),
                                        builder_settings=Settings('test', 'deepseek-flash', reasoning_effort='high'),
                                        preloaded=True, assessed=False, payloads=payloads)
        self.assertEqual(counts, {'research': 3, 'builder': 2})
        self.assertEqual(len(result['apparatusBuilds']), 1)
        self.assertEqual(len(result['comparisons'][0]['rows']), 5)
        self.assertIsNone(result['methodAssessment'])
        self.assertEqual(result['plan'], [])
        self.assertTrue(all(c['passed'] for c in result['apparatusBuilds'][0]['reply']['checks']))
        context = json.loads(payloads[0]['messages'][0]['content'].split('无需为了回复而读取：', 1)[1])
        self.assertTrue(context['builderAvailable'])
        self.assertEqual([p['reasoning_effort'] for p in payloads], ['max', 'high', 'high', 'max', 'max'])

    def test_delegated_repair_keeps_goal_and_fixes_actual_layout(self):
        candidate = apparatus().model_dump()
        candidate['elements'][-1]['position'] = [200, 150, 0]
        goal = {'criteria': [{'label': '光线到屏', 'elementId': 'screen', 'metric': 'screen_hits', 'operator': 'ge', 'value': 1}]}
        replies = iter([
            message([call('set_goal', goal, 'goal'), call('set_apparatus', {'experiment': candidate}, 'layout')]),
            message([call('set_goal', {'criteria': [goal['criteria'][0] | {'value': 0}]}, 'weaken'),
                     call('update_apparatus', {'elementId': 'screen', 'patch': {'position': [200, 60, 0]}}, 'repair')]),
            message(text='完成。'),
        ])
        payloads = []
        def provider(request):
            payloads.append(json.loads(request.content))
            return response(next(replies))
        seed = SpatialExperiment(schemaVersion=2, name='新装置', elements=[])
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_spatial_agent(SpatialAgentRequest(requestId='repair', experiment=seed, message='搭建光源经透镜到屏的装置'),
                                       Settings('test', 'deepseek-flash', reasoning_effort='none'), client=client, delegated=True)
        self.assertEqual(len(payloads), 3)
        self.assertTrue(all('tool_choice' not in p for p in payloads))
        repair_tools = {t['function']['name'] for t in payloads[1]['tools']}
        self.assertIn('set_goal', repair_tools)
        self.assertTrue({'trace_light', 'read_workspace', 'list_apparatus'} <= repair_tools)
        self.assertTrue(result['applyAllowed'])
        self.assertTrue(all(c['passed'] for c in result['checks']))
        self.assertEqual(result['checks'][0]['criterion']['value'], 0)
        self.assertFalse(any(s['name'] == 'set_goal' and s['status'] == 'error' for s in result['trace']))
        self.assertEqual(seed.elements, [])

    def test_delegated_scan_reference_can_be_corrected_without_rebuilding_or_rescanning(self):
        candidate = SpatialExperiment.model_validate({'schemaVersion': 2, 'name': '衰减测量', 'elements': [
            {'id': 'source', 'name': '光源', 'kind': 'laser', 'position': [0, 60, 0], 'powerMw': 10, 'beamModel': 'parallel'},
            {'id': 'filter', 'name': '滤光片', 'kind': 'filter', 'position': [100, 60, 0], 'transmission': .5},
            {'id': 'screen', 'name': '屏', 'kind': 'screen', 'position': [200, 60, 0]},
        ]})
        goal = {'criteria': [{'label': '功率变化幅度', 'elementId': 'screen', 'metric': 'comparison_span',
                              'operator': 'ge', 'value': 5, 'comparisonId': 'screen'}]}
        corrected = copy.deepcopy(goal)
        corrected['criteria'][0]['comparisonId'] = 'comparison-1'
        scan = {'elementId': 'filter', 'field': 'transmission', 'start': .1, 'stop': .9, 'count': 5}
        replies = iter([
            message([call('set_goal', goal, 'goal'), call('set_apparatus', {'experiment': candidate.model_dump()}, 'layout')]),
            message([call('compare_parameter', scan, 'scan'), call('compare_parameter', scan, 'duplicate')]),
            message([call('set_goal', corrected, 'correct-reference')]),
            message(text='比较完成。'),
        ])
        payloads = []
        def provider(request):
            payloads.append(json.loads(request.content))
            return response(next(replies))
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = build_research_apparatus('搭建衰减测量装置并比较透射率', None,
                                             Settings('test', 'deepseek-flash', reasoning_effort='high'),
                                             client, None, None)
        self.assertEqual(len(payloads), 4)
        self.assertIn('扫描记录编号不存在；已有记录：comparison-1', json.dumps(payloads[-1]['messages'], ensure_ascii=False))
        self.assertEqual(len(result['comparisons']), 1)
        self.assertEqual(len(result['comparisons'][0]['rows']), 5)
        self.assertEqual(result['experiment'], candidate.model_dump())
        self.assertTrue(result['applyAllowed'])
        self.assertTrue(all(c['passed'] for c in result['checks']))
        self.assertAlmostEqual(result['checks'][0]['actual'], 8)
        self.assertEqual(result['checks'][0]['criterion']['value'], 5)

    def test_research_max_and_existing_builder_configuration_are_independent(self):
        payloads=[]
        result, calls, _ = run_handoff(settings=Settings('test','deepseek-flash',reasoning_effort='max'), builder_settings=Settings('test','deepseek-flash',reasoning_effort='high'), payloads=payloads,preloaded=True)
        for payload in payloads:
            research=any(t['function']['name']=='build_research_apparatus' for t in payload.get('tools',[]))
            self.assertEqual(payload['reasoning_effort'], 'max' if research else 'high')
        self.assertEqual(calls,{'research':3,'builder':2})
        self.assertEqual(len(result['comparisons'][0]['rows']),5)

    def test_preloaded_context_builds_and_computes_without_metadata_or_trace_rounds(self):
        folded = SpatialExperiment.model_validate({'schemaVersion':2,'name':'折转装置','elements':[
            {'id':'source','name':'光源','kind':'laser','position':[0,60,0]},
            {'id':'mirror','name':'反射镜','kind':'mirror','position':[150,60,0],'yawDeg':-45},
            {'id':'screen','name':'观察屏','kind':'screen','position':[150,60,200],'yawDeg':90}]})
        for candidate, scan in [(apparatus(), None), (folded, {'elementId':'source','field':'powerMw','start':1,'stop':10,'count':5})]:
            result, counts, progress = run_handoff(candidate=candidate, scan=scan, preloaded=True)
            self.assertEqual(counts, {'research':3,'builder':2})
            self.assertEqual(len(result['apparatusBuilds']),1)
            self.assertTrue(all(c['passed'] for c in result['apparatusBuilds'][0]['reply']['checks']))
            self.assertEqual(len(result['comparisons'][0]['rows']),5)
            self.assertFalse(any(s['name'] in {'read_research','builder_read_workspace','builder_list_apparatus','builder_trace_light'} for s in progress))

    def test_max_is_retained_when_research_delegates_to_builder_and_continues(self):
        payloads = []
        result, calls, _ = run_handoff(settings=Settings('test-key', 'deepseek-flash', reasoning_effort='max'), payloads=payloads)
        self.assertEqual(calls, {'research': 3, 'builder': 2})
        self.assertTrue(all(payload['reasoning_effort'] == 'max' and payload['thinking'] == {'type': 'enabled'} for payload in payloads))
        self.assertEqual(result['methodAssessment']['coverage'], 'supported')
        self.assertEqual(len(result['comparisons'][0]['rows']), 5)

    def test_existing_builder_generates_and_research_continues_in_same_turn(self):
        result, calls, progress = run_handoff()
        self.assertEqual(calls, {'research': 3, 'builder': 2})
        self.assertEqual(len(result['apparatusBuilds']), 1)
        id = result['apparatusBuilds'][0]['objectId']
        self.assertEqual(result['activeObjectId'], id)
        self.assertEqual(result['objectSnapshots'][0]['source'], 'generated')
        self.assertTrue(all(c['passed'] for c in result['apparatusBuilds'][0]['reply']['checks']))
        self.assertEqual(len(result['comparisons'][0]['rows']), 5)
        self.assertEqual(result['objectResults'][0]['objectId'], id)
        self.assertEqual(result['evidence']['inputSnapshot'], result['inputSnapshot'])
        self.assertTrue(any(s['name'].startswith('builder_') for s in progress))
        self.assertEqual(result['trace'][2]['name'], 'build_research_apparatus')
        self.assertEqual(result['trace'][2]['status'], 'ok')
        followup = ResearchWorkspace(objects=[ResearchObject.model_validate(o) for o in result['objectSnapshots']], active_object_id=id)
        data, _ = followup.execute('simulate_apparatus', {})
        self.assertEqual(data['objectId'], id)

    def test_design_based_on_existing_object_adds_copy_and_preserves_original(self):
        original = apparatus()
        original.name = '保留的原装置'
        before = original.model_dump()
        result, _, _ = run_handoff(original)
        self.assertEqual(original.model_dump(), before)
        self.assertEqual(result['objectSnapshots'][0]['experiment'], before)
        self.assertEqual(len(result['objectSnapshots']), 2)
        self.assertNotEqual(result['activeObjectId'], 'original')
        self.assertEqual(result['apparatusBuilds'][0]['baseObjectId'], 'original')
        self.assertEqual(result['apparatusBuilds'][0]['reply']['inputSnapshot'], before)
        self.assertEqual(result['objectResults'][0]['comparisons'], [])
        self.assertEqual(len(result['objectResults'][1]['comparisons']), 1)

    def test_generated_folded_structure_uses_same_handoff_and_general_research_tools(self):
        folded = SpatialExperiment.model_validate({'schemaVersion': 2, 'name': '折转研究装置', 'elements': [
            {'id': 'source', 'name': '光源', 'kind': 'laser', 'position': [0, 60, 0]},
            {'id': 'mirror', 'name': '反射镜', 'kind': 'mirror', 'position': [150, 60, 0], 'yawDeg': -45},
            {'id': 'screen', 'name': '屏', 'kind': 'screen', 'position': [150, 60, 200], 'yawDeg': 90},
        ]})
        result, _, _ = run_handoff(candidate=folded, scan={'elementId': 'source', 'field': 'powerMw', 'start': 1, 'stop': 10, 'count': 5})
        self.assertTrue(result['apparatusBuilds'][0]['reply']['checks'][0]['passed'])
        self.assertEqual(len(result['comparisons'][0]['rows']), 5)
        self.assertTrue(all(r['screens'][0]['hits'] > 0 for r in result['comparisons'][0]['rows']))
        generated = ResearchWorkspace(objects=[ResearchObject.model_validate(o) for o in result['objectSnapshots']], active_object_id=result['activeObjectId'])
        self.assertIsNone(generated.legacy)

    def test_verified_object_is_retained_if_model_fails_during_followup(self):
        result, _, _ = run_handoff(fail_after_build=True)
        self.assertEqual(len(result['apparatusBuilds']), 1)
        self.assertEqual(result['activeObjectId'], result['objectSnapshots'][0]['id'])
        self.assertIsNotNone(result['evidence'])
        self.assertEqual(result['comparisons'], [])
        self.assertIn('AI说明未完成', result['answer'])

    def test_generated_object_can_be_sent_back_through_the_research_endpoint(self):
        prior, _, _ = run_handoff()
        def continue_research(document, settings, progress, cancelled, **kwargs):
            w = ResearchWorkspace(objects=document.objects, active_object_id=document.activeObjectId, request_id=document.requestId)
            w.execute('simulate_apparatus', {})
            return w.reply(document.requestId, '对生成装置继续计算。', [])
        with patch('backend.app.get_settings', return_value=SETTINGS), patch('backend.app.run_research_agent', side_effect=continue_research), TestClient(app) as client:
            response = client.post('/api/research/agent/chat', json={'requestId': 'next', 'message': '继续计算', 'objects': prior['objectSnapshots'], 'activeObjectId': prior['activeObjectId'], 'experiment': prior['inputSnapshot']})
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.text.splitlines()[-1])['reply']
        self.assertEqual(result['activeObjectId'], prior['activeObjectId'])
        self.assertIsNotNone(result['evidence'])
        self.assertEqual(result['apparatusBuilds'], [])

    def test_failed_generation_does_not_add_object_or_assume_success(self):
        original = apparatus()
        result, counts, _ = run_handoff(original, failure=True)
        self.assertEqual(counts['builder'], 1)
        self.assertEqual(len(result['objectSnapshots']), 1)
        self.assertEqual(result['activeObjectId'], 'original')
        self.assertEqual(result['apparatusBuilds'], [])
        self.assertIsNone(result['evidence'])
        self.assertIn('没有新增探究对象', result['answer'])
        self.assertNotIn('已经完成研究', result['answer'])
        self.assertEqual([s['status'] for s in result['trace'][2:]], ['error'])

    def test_unchanged_research_does_not_invoke_builder(self):
        with patch('backend.research_agent.build_research_apparatus') as build:
            responses = iter([message([call('read_research', {}, 'read'), call('assess_research_method', {'question': '计算已有装置', 'method': '读取当前参数的屏上读数', 'questionRequires': ['gaussian-envelope'], 'calculationUses': ['gaussian-envelope'], 'calculationQuestion': '当前装置的高斯半径', 'remainingQuestion': ''}, 'method'), call('simulate_apparatus', {}, 'calc')]), message()])
            with httpx.Client(transport=httpx.MockTransport(lambda req: response(next(responses)))) as client:
                result = run_research_agent(ResearchAgentRequest(requestId='r', experiment=apparatus(), message='只计算已有装置'), SETTINGS, client=client)
            build.assert_not_called()
        self.assertEqual(result['apparatusBuilds'], [])

    def test_context_capacity_and_one_attempt_bounds(self):
        invoked = []
        workspace = ResearchWorkspace(builder=lambda goal, base: invoked.append(goal) or verified_proposal())
        with self.assertRaises(ValueError):
            workspace.execute('build_research_apparatus', {'goal': '设计装置'})
        workspace.execute('read_research', {})
        workspace.execute('build_research_apparatus', {'goal': '设计装置'})
        with self.assertRaises(ValueError):
            workspace.execute('build_research_apparatus', {'goal': '再设计'})
        self.assertEqual(len(invoked), 1)
        objects = [ResearchObject(id=str(i), source='saved', experiment=apparatus()) for i in range(6)]
        full = ResearchWorkspace(objects=objects, active_object_id='0', builder=lambda *args: self.fail('容量满不能调用搭建'))
        full.execute('read_research', {})
        with self.assertRaises(ValueError):
            full.execute('build_research_apparatus', {'goal': '设计装置'})
        self.assertEqual(len(objects), 6)

    def test_handoff_recalculates_readings_without_turning_missed_goals_into_rejection(self):
        proposal = verified_proposal()
        proposal['experiment']['elements'][-1]['position'] = [200, 150, 0]
        with patch('backend.research_builder.run_spatial_agent', return_value=proposal):
            result = build_research_apparatus('设计装置', None, SETTINGS, None, None, None)
        self.assertFalse(result['checks'][0]['passed'])
        self.assertEqual(result['evidence']['screens'][0]['hits'], 0)
        for invalid in [proposal | {'evidence': None}, proposal | {'applyAllowed': False}]:
            with patch('backend.research_builder.run_spatial_agent', return_value=invalid):
                with self.assertRaises(ValueError):
                    build_research_apparatus('设计装置', None, SETTINGS, None, None, None)

    def test_builder_errors_and_cancellation_leave_no_partial_object(self):
        for error in [AgentError('连接失败', 502), ValueError('未通过核验')]:
            w = ResearchWorkspace(builder=lambda goal, base: (_ for _ in ()).throw(error))
            w.execute('read_research', {})
            with self.assertRaises(ValueError):
                w.execute('build_research_apparatus', {'goal': '设计装置'})
            self.assertEqual(w.objects, [])
            self.assertEqual(w.apparatus_builds, [])
            self.assertIn('没有新增探究对象', w.reply('r', '成功', [])['answer'])
        with patch('backend.research_builder.run_spatial_agent', return_value=verified_proposal()):
            with self.assertRaises(AgentError) as caught:
                build_research_apparatus('设计装置', None, SETTINGS, None, None, lambda: True)
            self.assertEqual(caught.exception.status, 499)

    def test_handoff_accepts_calculated_design_without_mandatory_goals(self):
        proposal = verified_proposal() | {'checks': []}
        with patch('backend.research_builder.run_spatial_agent', return_value=proposal) as run:
            result = build_research_apparatus('设计装置', None, SETTINGS, None, None, None)
        self.assertTrue(result['applyAllowed'])
        self.assertEqual(result['checks'], [])
        self.assertTrue(result['evidence']['screens'])
        self.assertNotIn('deadline', run.call_args.kwargs)



if __name__ == '__main__':
    unittest.main()

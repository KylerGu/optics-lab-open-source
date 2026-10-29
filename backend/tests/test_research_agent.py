import json
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError
from backend.app import app
from backend.research_agent import ResearchAgentRequest, ResearchObject, ResearchPlanStep, ResearchWorkspace, TOOLS, legacy_experiment, run_research_agent
from pydantic import ValidationError
from backend.settings import Settings
from backend.spatial import SpatialExperiment


def apparatus():
    return SpatialExperiment.model_validate({"schemaVersion": 2, "name": "研究装置", "elements": [
        {"id": "source", "name": "激光", "kind": "laser", "position": [0, 60, 0], "beamModel": "gaussian", "beamRadiusMm": 1},
        {"id": "lens", "name": "透镜", "kind": "lens", "position": [100, 60, 0], "focalLengthMm": 100},
        {"id": "screen", "name": "观察屏", "kind": "screen", "position": [200, 60, 0]},
    ]})


def call(name, args, id):
    return {"id": id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


class ResearchAgentTests(unittest.TestCase):
    def test_ordinary_answers_finish_in_one_max_request_without_rewriting(self):
        for question, answer in [('你好', '你好！想聊什么光学问题？'), ('瑞利长度是什么意思？', '瑞利长度描述高斯光束的传播尺度。'), ('实验该如何开始？', '先明确想区分的解释，再选择可观察的量。')]:
            with self.subTest(question=question):
                requests = []
                def provider(request):
                    requests.append(json.loads(request.content))
                    self.assertEqual(len(requests), 1)
                    return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': answer, 'reasoning_content': 'private'}}]})
                with httpx.Client(transport=httpx.MockTransport(provider)) as client:
                    result = run_research_agent(ResearchAgentRequest(requestId='conversation', message=question), Settings('test', 'deepseek-flash', reasoning_effort='max'), client=client)
                self.assertEqual(result['answer'], answer)
                self.assertEqual(result['trace'], [])
                self.assertEqual(result['plan'], [])
                self.assertEqual(requests[0]['reasoning_effort'], 'max')
                tools = {t['function']['name'] for t in requests[0]['tools']}
                self.assertTrue({'simulate_apparatus', 'compare_parameter', 'run_model_experiment', 'build_research_apparatus'} <= tools)
                self.assertNotIn('private', json.dumps(result))

    def test_direct_computation_needs_no_method_or_plan_registration(self):
        requests = []
        replies = iter([
            {'role': 'assistant', 'content': None, 'tool_calls': [call('simulate_apparatus', {}, 'calculate')]},
            {'role': 'assistant', 'content': '当前参数下的计算结果已得到。'},
        ])
        def provider(request):
            requests.append(json.loads(request.content))
            message = next(replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if message.get('tool_calls') else 'stop', 'message': message}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_research_agent(ResearchAgentRequest(requestId='calculate', experiment=apparatus(), message='计算当前装置'), Settings('test', 'test', 'https://example.test'), client=client)
        self.assertEqual(len(requests), 2)
        self.assertIsNotNone(result['evidence'])
        self.assertIsNone(result['methodAssessment'])
        self.assertEqual(result['plan'], [])
        self.assertEqual([step['name'] for step in result['trace']], ['simulate_apparatus'])
        self.assertNotIn('elementSchema', requests[0]['messages'][0]['content'])
        data = json.loads(requests[1]['messages'][-1]['content'])['data']
        self.assertGreater(data['screens'][0]['sampledPowerMw'], 0)

    def test_failed_calculation_can_be_corrected_without_a_forced_phase(self):
        replies = iter([
            {'role': 'assistant', 'content': None, 'tool_calls': [call('compare_parameter', {'elementId': 'missing', 'field': 'powerMw', 'start': 1, 'stop': 10, 'count': 5}, 'invalid')]},
            {'role': 'assistant', 'content': None, 'tool_calls': [call('simulate_apparatus', {}, 'correct')]},
            {'role': 'assistant', 'content': '已按当前装置完成计算。'},
        ])
        requests = []
        def provider(request):
            requests.append(json.loads(request.content))
            message = next(replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if message.get('tool_calls') else 'stop', 'message': message}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_research_agent(ResearchAgentRequest(requestId='correct', experiment=apparatus(), message='研究当前装置'), Settings('test', 'test', 'https://example.test'), client=client)
        self.assertEqual(len(requests), 3)
        self.assertFalse(json.loads(requests[1]['messages'][-1]['content'])['ok'])
        self.assertEqual([s['status'] for s in result['trace']], ['error', 'ok'])
        self.assertIsNotNone(result['evidence'])
        self.assertEqual(result['answer'], '已按当前装置完成计算。')
        self.assertEqual(result['plan'], [])

    def test_uncompleted_calculation_still_cannot_be_reported_as_success(self):
        workspace = ResearchWorkspace(apparatus())
        with self.assertRaises(ValueError):
            workspace.execute('compare_parameter', {'elementId': 'missing', 'field': 'powerMw', 'start': 1, 'stop': 10, 'count': 5})
        result = workspace.reply('failed', '实验已经成功，原问题得到验证。', [])
        self.assertNotIn('实验已经成功', result['answer'])
        self.assertIsNone(result['evidence'])

    def test_plan_completion_requires_real_current_calculation_and_does_not_complete_other_steps(self):
        w = ResearchWorkspace(apparatus(), request_id='current')
        w.execute('set_research_plan', {'steps': ['核对装置', '计算参数比较', '解释理论', '用实验进一步验证']})
        mark = {'stepNumber': 2, 'status': 'completed', 'basis': 'calculation', 'note': '完成五点计算'}
        with self.assertRaises(ValidationError):
            w.execute('update_research_step', mark)
        with self.assertRaises(ValueError):
            w.execute('update_research_step', mark | {'evidence': [{'objectId': 'legacy-device', 'kind': 'comparison', 'recordId': 'comparison-1'}]})
        scan, _ = w.execute('compare_parameter', {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5})
        w.execute('update_research_step', mark | {'evidence': [scan['recordReference']]})
        w.execute('read_research', {})
        w.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'context', 'note': '核对源、透镜和屏的参数'})
        w.execute('update_research_step', {'stepNumber': 3, 'status': 'completed', 'basis': 'analysis', 'note': '给出理想模型公式的解释，未实测'})
        w.execute('update_research_step', {'stepNumber': 4, 'status': 'needs_validation', 'basis': 'analysis', 'note': '仍需测量数据'})
        progress = w.reply('current', '说明', [])['planProgress']
        self.assertEqual([s['status'] for s in progress], ['completed', 'completed', 'completed', 'needs_validation'])
        self.assertEqual(progress[1]['evidence'][0]['requestId'], 'current')
        self.assertEqual(progress[2]['evidence'], [])
        w.execute('set_research_plan', {'steps': ['计算参数比较', '新增验证任务', '解释理论']})
        self.assertEqual([s.status for s in w.plan_progress], ['completed', 'pending', 'completed'])
        self.assertEqual(w.plan_progress[0].evidence[0].requestId, 'current')
        w.execute('set_research_plan', {'steps': ['新的研究问题']})
        self.assertEqual(w.plan_progress[0].status, 'pending')

    def test_plan_progress_survives_followup_without_recomputation_and_keeps_original_reference(self):
        w = ResearchWorkspace(apparatus(), request_id='old')
        w.execute('set_research_plan', {'steps': ['计算装置']})
        data, _ = w.execute('simulate_apparatus', {})
        w.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'calculation', 'note': '完成原参数仿真', 'evidence': [data['recordReference']]})
        prior = w.reply('old', '说明', [])['planProgress']
        followup = ResearchWorkspace(apparatus(), current_plan=[ResearchPlanStep.model_validate(s) for s in prior], request_id='next')
        self.assertEqual(followup.reply('next', '知识回答', [])['planProgress'], prior)
        self.assertIsNone(followup.reply('next', '知识回答', [])['evidence'])
        with self.assertRaises(ValueError):
            followup.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'calculation', 'note': '冒充再次完成', 'evidence': [data['recordReference']]})
        followup.execute('set_research_plan', {'steps': ['原参数的仿真读数']})
        followup.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'calculation', 'note': '沿用历史计算，条件不变', 'evidence': prior[0]['evidence']})
        self.assertEqual(followup.plan_progress[0].evidence[0].requestId, 'old')
        with self.assertRaises(ValueError):
            followup.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'calculation', 'note': '不存在的历史记录', 'evidence': [{**prior[0]['evidence'][0], 'requestId': 'invented'}]})

    def test_no_device_or_failed_scan_cannot_complete_calculation(self):
        w = ResearchWorkspace()
        w.execute('set_research_plan', {'steps': ['核对装置', '计算装置']})
        with self.assertRaises(ValueError):
            w.execute('update_research_step', {'stepNumber': 1, 'status': 'completed', 'basis': 'context', 'note': '已确认装置'})
        w = ResearchWorkspace(apparatus())
        w.execute('set_research_plan', {'steps': ['计算装置']})
        with self.assertRaises(ValueError):
            w.execute('compare_parameter', {'elementId': 'missing', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5})
        self.assertEqual(w.available_evidence(), [])
        self.assertEqual(w.plan_progress[0].status, 'pending')

    def test_research_title_requires_permission_and_a_question_beyond_small_talk(self):
        for needed, questions in [(False, ['研究束腰与光斑']), (True, ['你好', '谢谢！', '你能做什么？'])]:
            w = ResearchWorkspace(title_needed=needed, user_questions=questions)
            with self.assertRaises(ValueError):
                w.execute('set_research_title', {'title': '束腰与光斑研究'})
            self.assertIsNone(w.reply('r', '回复', [])['researchTitle'])
        w = ResearchWorkspace(title_needed=True, user_questions=['你好', '研究束腰半径与光斑的关系'])
        for title in ['你好', '', '题目\n下一行', '<标题>', '长' * 37]:
            with self.assertRaises(ValueError):
                w.execute('set_research_title', {'title': title})
        w.execute('set_research_title', {'title': '束腰半径与光斑变化'})
        self.assertEqual(w.reply('r', '回复', [])['researchTitle'], '束腰半径与光斑变化')

    def test_calculation_guidance_distinguishes_analytic_radius_from_sampled_metrics(self):
        w = ResearchWorkspace(apparatus())
        context, _ = w.execute('read_research', {})
        self.assertNotIn('干涉衍射', context['notComputed'])
        for name, args, scope in [('simulate_apparatus', {}, 'current-parameters'), ('compare_parameter', {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5}, 'finite-parameter-samples'), ('analyze_tolerance', {'tolerance': {'lensId': 'lens', 'screenId': 'screen', 'positionErrorMm': 1, 'focalErrorPercent': 0}}, 'finite-error-samples')]:
            data, _ = w.execute(name, args)
            self.assertEqual(data['conclusionScope']['kind'], scope)
            self.assertFalse(data['conclusionScope']['continuousOptimumVerified'])
            self.assertIn('公式', data['measurementDefinitions'].get('gaussianRadiusMm', data['measurementDefinitions'].get('radiusMm'))['method'])
        scan, _ = w.execute('compare_parameter', {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5})
        self.assertIn('有限', scan['measurementDefinitions']['sampledPowerMw']['limits'])
        self.assertTrue(all('scope' in fact for fact in scan['computedSummary']))

    def test_object_selection_and_request_snapshot_must_be_consistent(self):
        objects = [ResearchObject(id='a', source='saved', experiment=apparatus())]
        for fields in [{'objects': objects, 'activeObjectId': 'missing'}, {'objects': objects * 2, 'activeObjectId': 'a'}, {'objects': objects, 'activeObjectId': 'a', 'experiment': apparatus().model_copy(update={'name': 'different'})}, {'activeObjectId': 'a'}]:
            with self.assertRaises(ValidationError):
                ResearchAgentRequest(requestId='r', message='研究', **fields)

    def test_object_comparison_runs_each_snapshot_and_keeps_attribution_after_same_element_ids(self):
        a, b = apparatus(), apparatus()
        a.name, b.name = '方案A', '方案B'
        b.elements[1].focalLengthMm = 120
        originals = [a.model_dump(), b.model_dump()]
        objects = [ResearchObject(id=id, source='file', experiment=e) for id, e in zip(['a', 'b'], [a, b])]
        w = ResearchWorkspace(objects=objects, active_object_id='a')
        data, _ = w.execute('compare_objects', {'objectIds': ['a', 'b']})
        self.assertEqual([r['objectId'] for r in data['rows']], ['a', 'b'])
        r = w.reply('r', '已比较', [])
        self.assertEqual(len(r['objectResults']), 2)
        self.assertNotEqual(r['objectResults'][0]['evidence']['screens'][0]['gaussianRadiusMm'], r['objectResults'][1]['evidence']['screens'][0]['gaussianRadiusMm'])
        self.assertEqual([o.model_dump()['experiment'] for o in objects], originals)
        self.assertEqual(r['objectComparisons'][0]['objectIds'], ['a', 'b'])
        w.execute('compare_parameter', {'objectId': 'b', 'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 3})
        r = w.reply('r', '已比较', [])
        self.assertEqual(len(r['comparisons']), 0)
        self.assertEqual(len(r['objectResults'][1]['comparisons']), 1)
        self.assertEqual(r['objectResults'][1]['comparisons'][0]['inputSnapshot']['name'], '方案B')
        with self.assertRaises(ValueError):
            w.execute('simulate_apparatus', {'objectId': 'unknown'})
        with self.assertRaises(ValueError):
            w.execute('compare_objects', {'objectIds': ['a', 'a']})

    def test_parameter_scan_budget_is_shared_across_objects(self):
        objects = [ResearchObject(id=id, source='scene', experiment=apparatus()) for id in ['a', 'b']]
        w = ResearchWorkspace(objects=objects, active_object_id='a')
        for id, start in [('a', 80), ('b', 80), ('a', 85)]:
            w.execute('compare_parameter', {'objectId': id, 'elementId': 'lens', 'field': 'focalLengthMm', 'start': start, 'stop': 120, 'count': 3})
        with self.assertRaises(ValueError):
            w.execute('compare_parameter', {'objectId': 'b', 'elementId': 'lens', 'field': 'focalLengthMm', 'start': 85, 'stop': 120, 'count': 3})

    def test_apparatus_edits_are_unavailable_and_rejected(self):
        original = apparatus()
        w = ResearchWorkspace(original)
        names = {t["function"]["name"] for t in TOOLS}
        self.assertNotIn("set_apparatus", names)
        self.assertNotIn("apply_focus_design", names)
        for name in ["update_apparatus", "remove_apparatus", "set_experiment", "apply_robust_focus"]:
            with self.assertRaises(ValueError):
                w.execute(name, {})
        self.assertEqual(w.spatial.experiment, original)

    def test_plan_without_device_is_allowed_but_cannot_fabricate_computation(self):
        w = ResearchWorkspace(None)
        plan, _ = w.execute("set_research_plan", {"steps": ["明确研究指标", "准备可验证的实验条件"]})
        self.assertEqual(plan["status"], "planned")
        with self.assertRaises(ValueError):
            w.execute("simulate_apparatus", {})
        r = w.reply("r", "需要选择装置后计算。", [])
        self.assertIsNone(r["inputSnapshot"])
        self.assertIsNone(r["evidence"])
        self.assertEqual(r["comparisons"], [])

    def test_generic_comparison_computes_values_and_preserves_apparatus(self):
        original = apparatus()
        w = ResearchWorkspace(original)
        c, _ = w.execute("compare_parameter", {"elementId": "lens", "field": "focalLengthMm", "start": 80, "stop": 120, "count": 5})
        radii = [r["screens"][0]["gaussianRadiusMm"] for r in c["rows"]]
        self.assertEqual(radii.index(min(radii)), 2)
        facts = next(f for f in c["computedSummary"] if f["metric"] == "理想高斯半径")
        self.assertGreater(facts["minimumSample"]["value"], 0)
        self.assertEqual(facts["minimumSample"]["parameterValue"], 100)
        self.assertEqual(facts["sampledTrend"], "先减小后增大")
        self.assertEqual(w.spatial.experiment, original)
        self.assertEqual(w.original, original)
        self.assertEqual(len(w.reply("r", "已比较。", [])["comparisons"]), 1)

    def test_folded_or_parallel_apparatus_is_not_misrepresented_as_legacy_gaussian(self):
        doc = apparatus().model_dump()
        doc["elements"][1]["kind"] = "mirror"
        w = ResearchWorkspace(SpatialExperiment.model_validate(doc))
        self.assertIsNone(w.legacy)
        with self.assertRaises(ValueError):
            w.execute("search_focus_design", {"goal": {}})
        doc = apparatus().model_dump()
        doc["elements"][0]["beamModel"] = "parallel"
        self.assertIsNone(legacy_experiment(SpatialExperiment.model_validate(doc)))

    def test_existing_focus_and_error_tools_use_compatible_snapshot_without_edits(self):
        original = apparatus()
        w = ResearchWorkspace(original)
        w.execute("analyze_tolerance", {"tolerance": {"lensId": "lens", "screenId": "screen", "positionErrorMm": 1, "focalErrorPercent": 0}})
        r = w.reply("r", "已分析。", [])
        self.assertEqual(len(r["studies"]), 1)
        self.assertEqual(r["studies"][0]["baseline"]["counts"]["total"], 9)
        self.assertEqual(w.spatial.experiment, original)
        self.assertEqual(w.legacy.experiment, legacy_experiment(original))

    def test_model_uses_real_tools_then_returns_evidence_and_progress(self):
        requests, progress = [], []
        answers = [
            {"role": "assistant", "content": None, "tool_calls": [call("set_research_title", {"title": "当前装置的光斑研究"}, "title"), call("read_research", {}, "read"), call('assess_research_method', {'question': '计算当前装置', 'method': '读取当前屏上半径', 'questionRequires': ['gaussian-envelope'], 'calculationUses': ['gaussian-envelope'], 'calculationQuestion': '当前参数下的高斯半径', 'remainingQuestion': ''}, 'method'), call("simulate_apparatus", {}, "calc")]},
            {"role": "assistant", "content": "已计算，请查看实验记录。"},
        ]
        def handler(request):
            requests.append(json.loads(request.content))
            message = answers.pop(0)
            return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls" if message.get("tool_calls") else "stop", "message": message}]})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            r = run_research_agent(ResearchAgentRequest(requestId="r", experiment=apparatus(), message="计算当前装置", titleNeeded=True), Settings("test", "test", "https://example.test"), client=client, progress=progress.append)
        self.assertIsNotNone(r["evidence"])
        self.assertEqual(len([s for s in progress if not s['name'].startswith('phase_')]), 4)
        self.assertEqual(r['researchTitle'], '当前装置的光斑研究')
        self.assertFalse("changed" in r)
        self.assertEqual(requests[1]["messages"][-1]["role"], "tool")
        self.assertIn("gaussianRadiusMm", requests[1]["messages"][-1]["content"])

    def test_cancellation_does_not_return_partial_results(self):
        with self.assertRaises(AgentError) as context:
            run_research_agent(ResearchAgentRequest(requestId="r", message="研究问题"), Settings("test", "test", "https://example.test"), cancelled=lambda: True)
        self.assertEqual(context.exception.status, 499)

    def test_new_endpoint_streams_research_without_changing_old_routes(self):
        client = TestClient(app)
        payload = {"requestId": "r", "message": "讨论研究方法"}
        result = ResearchWorkspace(None).reply("r", "请先明确研究目标。", [])
        def fake(document, settings, progress, cancelled, **kwargs):
            progress({"name": "read_research", "status": "ok", "summary": "读取研究上下文"})
            return result
        with patch('backend.app.get_settings', return_value=Settings("test", "test", "https://example.test")), patch('backend.app.run_research_agent', side_effect=fake):
            response = client.post('/api/research/agent/chat', json=payload)
        events = [json.loads(line) for line in response.text.splitlines()]
        self.assertEqual([e["type"] for e in events], ["progress", "reply"])
        self.assertEqual(client.get('/api/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()

"""Check meaningful conflicts and the bounded repair path without API charges."""
import json
import unittest
from unittest.mock import patch

import httpx

from backend.agent import AgentRequest, Workspace, run_agent
from backend.gaussian_verification import check_gaussian_answer, gaussian_facts
from backend.settings import Settings
from backend.optics import simulate
from backend.tests.test_agent import answer, call
from backend.tests.test_gaussian_agent import scene


def screenshot_scene():
    experiment = scene()
    experiment.elements[0].wavelengthNm = 729
    experiment.elements[1].positionMm = 245.4
    return experiment


SCAN = {'elementId': 'source', 'field': 'waistMm', 'start': .03, 'stop': .6, 'count': 13}
WRONG = '当前两种极限下屏都处于远场或过渡区，发散角的增大占了主导。'
RIGHT = '光斑随束腰先减小再增大。束腰0.03 mm时属于远场；束腰0.60 mm时属于近场，瑞利长度约1.55 m。'


class GaussianVerificationTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Workspace(screenshot_scene(), 'gaussian', edit_intent=False)
        self.scan, _ = self.workspace.execute('scan_parameter', SCAN)

    def check(self, text):
        return check_gaussian_answer(text, None, [self.scan])

    def execute(self, responses, message='我觉得束腰越小，观察处的光斑就越小，帮我验证一下。'):
        observed = []
        queue = iter(responses)
        def handle(request):
            observed.append(json.loads(request.content))
            response = next(queue)
            return response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            result = run_agent(AgentRequest(requestId='check-turn', scene='gaussian', experiment=screenshot_scene(), message=message),
                               Settings('test-private', 'test-model'), client)
        return result, observed

    def test_screenshot_conflict_is_detected_from_real_rows(self):
        self.assertIn('传播区域', self.check(WRONG)[0])
        self.assertTrue(self.check('全部比较点都处于远场。'))
        self.assertTrue(self.check('束腰0.60 mm时，观察屏处于远场。'))
        self.assertTrue(self.check('两端分别处于近场和远场。'))
        facts = gaussian_facts(None, [self.scan])['本轮比较'][0]
        self.assertEqual(facts['起点']['传播区域'], '远场')
        self.assertEqual(facts['终点']['传播区域'], '近场')
        self.assertEqual(facts['光斑趋势'], '非单调')

    def test_correct_rounding_units_and_region_mapping_pass(self):
        for text in [RIGHT, '两端分别处于远场和近场。',
                     '束腰0.03 mm时，光斑半径约1.666 mm。',
                     r'束腰$0.60\,\mathrm{mm}$时，瑞利长度约$1.55\,\mathrm{m}$，观察屏处于近场。',
                     '束腰600 μm时，光斑半径约605.76 μm。',
                     '最小光斑半径约0.316 mm。']:
            with self.subTest(text=text):
                self.assertEqual(self.check(text), [])

    def test_numbers_are_checked_against_corresponding_case(self):
        self.assertTrue(self.check('束腰0.60 mm时，瑞利长度约3.88 mm。'))
        self.assertTrue(self.check('观察距离为245.4 mm。'))
        self.assertTrue(self.check('光斑半径为99 mm。'))
        self.assertTrue(self.check('最小光斑半径约0.606 mm。'))
        self.assertTrue(self.check('发散半角为1 mm。'))
        self.assertTrue(self.check('光斑半径为1e999 mm。'))
        self.assertTrue(self.check(r'束腰$w_0=0.60\,\mathrm{mm}$时，瑞利长度$z_R\approx3.88\,\mathrm{mm}$。'))

    def test_monotonic_claim_does_not_pass_a_u_shaped_comparison(self):
        for text in ['光斑半径单调减小。', '这组比较中束腰越小，光斑越小。', '光斑半径一直增大。']:
            with self.subTest(text=text):
                self.assertTrue(self.check(text))

    def test_applicability_and_out_of_range_promises_are_checked(self):
        question = '我觉得束腰越小，观察处的光斑就越小，帮我验证一下。'
        self.assertTrue(check_gaussian_answer('你的直觉只在远场成立，在这个距离上并不成立。', None, [self.scan], question))
        self.assertTrue(check_gaussian_answer('你的判断在远场成立，但在这个装置里并不一直成立。', None, [self.scan], question))
        self.assertEqual(check_gaussian_answer('你的直觉只在近场成立，在这个距离上并不成立。', None, [self.scan], question), [])
        self.assertEqual(check_gaussian_answer('你的判断并非在远场成立。', None, [self.scan], question), [])
        self.assertTrue(self.check('在远场条件下，束腰越小，光斑越小。'))
        self.assertTrue(self.check('可以把观察平面右移到更远处，各组进入远场，你会看到单调关系出现。'))
        self.assertEqual(self.check('把观察平面右移，各组更接近远场，但不是所有光束都能在轨道内进入远场。'), [])

    def test_quotes_conditions_questions_and_partial_trends_are_not_claims(self):
        for text in ['“束腰越小，光斑越小”不成立。', '在远场条件下，束腰越小，光斑越大。',
                     '如果两端都处于远场，可以使用远场近似。', '全部点都处于远场吗？',
                     '比较范围中一段光斑半径单调减小，另一段增大。',
                     '目标光斑半径为0.4 mm。']:
            with self.subTest(text=text):
                self.assertEqual(self.check(text), [])

    def test_correct_answer_costs_no_extra_model_request_or_simulation(self):
        with patch('backend.agent.simulate', wraps=simulate) as physics:
            result, observed = self.execute([answer(calls=[call('scan_parameter', SCAN)]), answer(RIGHT)])
        self.assertEqual(len(observed), 2)
        self.assertEqual(physics.call_count, 13)
        self.assertEqual(result['answer'], RIGHT)
        self.assertFalse(result['changed'])

    def test_concept_answer_has_no_check_or_extra_request(self):
        with patch('backend.agent.simulate') as physics:
            result, observed = self.execute([answer('瑞利长度描述光束保持接近束腰粗细的传播尺度。')], message='瑞利长度是什么？')
        physics.assert_not_called()
        self.assertEqual(len(observed), 1)
        self.assertEqual(result['trace'], [])

    def test_conflict_gets_one_tool_free_rewrite(self):
        result, observed = self.execute([answer(calls=[call('scan_parameter', SCAN)]), answer(WRONG), answer(RIGHT)])
        self.assertEqual(len(observed), 3)
        self.assertNotIn('tools', observed[-1])
        self.assertIn('终点', observed[-1]['messages'][-1]['content'])
        self.assertEqual(result['answer'], RIGHT)
        self.assertEqual(len(result['scans'][0]['rows']), 13)
        self.assertFalse(result['changed'])

    def test_second_conflict_or_provider_failure_returns_existing_facts(self):
        for last in [answer(WRONG), answer('你的判断在远场成立，但在这个装置里并不一直成立。'),
                     httpx.Response(500), answer(calls=[call('update_element', {'elementId': 'source', 'patch': {'waistMm': .1}})])]:
            with self.subTest(last=last):
                result, observed = self.execute([answer(calls=[call('scan_parameter', SCAN)]), answer(WRONG), last])
                self.assertEqual(len(observed), 3)
                self.assertNotEqual(result['answer'], WRONG)
                self.assertEqual(check_gaussian_answer(result['answer'], None, result['scans']), [])
                self.assertIn('属于近场', result['answer'])
                self.assertFalse(result['changed'])

    def test_edit_explanation_checked_without_reapplying_edit(self):
        edit = call('update_element', {'elementId': 'source', 'patch': {'waistMm': .6}})
        result, observed = self.execute([answer(calls=[edit]), answer('已调整。'),
                                        answer('当前观察屏处于远场，瑞利长度约3.88 mm。'),
                                        answer('当前观察屏处于近场，瑞利长度约1551.4 mm。')], message='帮我调整束腰')
        self.assertEqual(len(observed), 4)
        self.assertEqual(result['experiment']['elements'][0]['waistMm'], .6)
        self.assertEqual(result['inputSnapshot']['elements'][0]['waistMm'], .2)
        self.assertEqual(sum(item['name'] == 'update_element' for item in result['trace']), 1)
        self.assertTrue(result['changed'])


if __name__ == '__main__':
    unittest.main()

import copy
import json
import unittest
from unittest.mock import patch

from backend.scene_agent import SceneWorkspace, SceneAgentRequest, run_scene_agent
from backend.scene_physics import calculate
from backend.settings import Settings
from backend.tests.test_scene_physics import state


def metric(result, key):
    return next(m['value'] for m in result['metrics'] if m['key'] == key)


def tool_call(name, args):
    return {'role': 'assistant', 'content': None, 'tool_calls': [
        {'id': 'focus-test', 'type': 'function', 'function': {
            'name': name, 'arguments': json.dumps(args)}}]}


class GaussianFocusAssistantTests(unittest.TestCase):
    def test_default_and_virtual_readings(self):
        result = calculate(state('gaussian-focus'))
        self.assertAlmostEqual(metric(result, 'outputWaistPositionMm'), 300.4567256725329)
        self.assertAlmostEqual(metric(result, 'outputWaistMm'), .03379074105923441)
        self.assertAlmostEqual(metric(result, 'observationRadiusMm'), .10360556916974696)
        virtual = calculate(state('gaussian-focus', waistMm=.05, focalLengthMm=400))
        self.assertLess(metric(virtual, 'outputWaistPositionMm'), 200)
        self.assertEqual(metric(virtual, 'minimumForwardMm'), metric(virtual, 'lensRadiusMm'))
        self.assertIn('延拓', virtual['status'])

    def test_comparison_preserves_scene_and_changes_real_results(self):
        workspace = SceneWorkspace(state('gaussian-focus'), allow_edit=False)
        before = copy.deepcopy(workspace.state)
        scan = workspace.execute('compare_parameter', {'field': 'focalLengthMm', 'values': [80, 100, 150]})
        self.assertEqual(workspace.state, before)
        self.assertEqual(len(scan['rows']), 3)
        readings = [metric(row['result'], 'outputWaistPositionMm') for row in scan['rows']]
        self.assertEqual(len(set(readings)), 3)
        self.assertEqual([row['result']['input']['parameters']['focalLengthMm'] for row in scan['rows']], [80, 100, 150])
        self.assertNotIn('solve_target', [t['function']['name'] for t in workspace.tools])

    def test_agent_changes_only_requested_parameter_with_calculation_evidence(self):
        request = SceneAgentRequest(requestId='focus-edit', state=state('gaussian-focus'),
                                    message='把透镜焦距改为150 mm，其他参数不变')
        replies = [tool_call('set_parameters', {'parameters': {'focalLengthMm': 150}}),
                   {'role': 'assistant', 'content': '已将焦距改为150 mm。'}]
        with patch('backend.scene_agent.completion', side_effect=replies):
            reply = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
        self.assertTrue(reply['changed'])
        expected = state('gaussian-focus', focalLengthMm=150).model_dump()
        self.assertEqual(reply['state'], expected)
        self.assertEqual(reply['evidence']['input'], expected)
        self.assertEqual(reply['evidence']['metrics'], calculate(expected)['metrics'])

    def test_questions_and_negations_cannot_apply_parameters(self):
        for message in ['如果把焦距改为150 mm，会怎样？', '不要改参数，只解释把焦距改为150 mm的影响']:
            request = SceneAgentRequest(requestId='focus-readonly', state=state('gaussian-focus'), message=message)
            replies = [tool_call('set_parameters', {'parameters': {'focalLengthMm': 150}}),
                       {'role': 'assistant', 'content': '仅解释，参数保持原值。'}]
            with patch('backend.scene_agent.completion', side_effect=replies) as call:
                reply = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
            self.assertFalse(reply['changed'])
            self.assertEqual(reply['state'], request.state.model_dump())
            self.assertEqual(reply['trace'][0]['status'], 'error')
            self.assertNotIn('set_parameters', [t['function']['name'] for t in call.call_args_list[0].args[-1]])

    def test_invalid_edit_leaves_scene_unchanged(self):
        workspace = SceneWorkspace(state('gaussian-focus'))
        before = copy.deepcopy(workspace.state)
        with self.assertRaises(ValueError):
            workspace.execute('set_parameters', {'parameters': {'focalLengthMm': 0}})
        self.assertEqual(workspace.state, before)

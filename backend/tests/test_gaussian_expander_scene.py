import copy
import json
import unittest
from unittest.mock import patch
from backend.scene_agent import SceneWorkspace, SceneAgentRequest, run_scene_agent
from backend.scene_gaussian_expander import collimated_position
from backend.scene_physics import calculate
from backend.settings import Settings
from backend.tests.test_scene_physics import state


def metric(r, k):
    return next(m['value'] for m in r['metrics'] if m['key'] == k)


class GaussianExpanderSceneTests(unittest.TestCase):
    def test_defaults_and_collimation(self):
        s = state('beam-transformation-1')
        r = calculate(s)
        self.assertAlmostEqual(metric(r, 'expansion'), 4.003744824818382)
        self.assertAlmostEqual(metric(r, 'observationRadiusMm'), 2.008853263666)
        w = SceneWorkspace(s)
        result = w.execute('solve_target', {'target': 'collimate', 'apply': True})
        self.assertTrue(result['applied'])
        self.assertAlmostEqual(metric(result['evidence'], 'curvaturePerMm'), 0)
        self.assertGreater(metric(result['evidence'], 'divergenceMrad'), 0)
        self.assertEqual({k: v for k, v in w.state['parameters'].items() if k != 'secondPositionMm'}, {k: v for k, v in s.parameters.items() if k != 'secondPositionMm'})

    def test_comparison_and_solver_preview_are_readonly(self):
        w = SceneWorkspace(state('beam-transformation-1'), allow_edit=False)
        before = copy.deepcopy(w.state)
        scan = w.execute('compare_parameter', {'field': 'secondPositionMm', 'values': [170, 175, 180]})
        self.assertEqual(len(scan['rows']), 3)
        self.assertEqual(w.state, before)
        w.execute('solve_target', {'target': 'collimate', 'apply': False})
        self.assertEqual(w.state, before)
        with self.assertRaises(ValueError):
            w.execute('solve_target', {'target': 'collimate', 'apply': True})
        self.assertEqual(w.state, before)

    def test_invalid_order_or_unsolvable_collimation_preserves_state(self):
        w = SceneWorkspace(state('beam-transformation-1'))
        before = copy.deepcopy(w.state)
        with self.assertRaises(ValueError):
            w.execute('set_parameters', {'parameters': {'firstPositionMm': 200}})
        self.assertEqual(w.state, before)
        with self.assertRaises(ValueError):
            collimated_position(state('beam-transformation-1', firstKind=1, waistMm=.01, waistPositionMm=75).parameters)

    def test_agent_collimation_has_real_evidence(self):
        request = SceneAgentRequest(requestId='expander', state=state('beam-transformation-1'), message='调到准直，其他参数不变')
        calls = [{'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'collimate', 'type': 'function', 'function': {'name': 'solve_target', 'arguments': json.dumps({'target': 'collimate', 'apply': True})}}]}, {'role': 'assistant', 'content': '已移动第二镜，使其出射波前平直，仍有衍射发散。'}]
        with patch('backend.scene_agent.completion', side_effect=calls):
            reply = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
        self.assertTrue(reply['changed'])
        self.assertEqual(reply['evidence']['input'], reply['state'])
        self.assertEqual(reply['evidence']['metrics'], calculate(reply['state'])['metrics'])

    def test_negated_question_cannot_change_scene(self):
        request = SceneAgentRequest(requestId='readonly', state=state('beam-transformation-1'), message='不要调到准直，只解释会怎样')
        calls = [{'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'denied', 'type': 'function', 'function': {'name': 'solve_target', 'arguments': json.dumps({'target': 'collimate', 'apply': True})}}]}, {'role': 'assistant', 'content': '参数保持原值。'}]
        with patch('backend.scene_agent.completion', side_effect=calls):
            reply = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
        self.assertFalse(reply['changed'])
        self.assertEqual(reply['trace'][0]['status'], 'error')

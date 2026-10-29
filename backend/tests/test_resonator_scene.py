import copy
import json
import math
import unittest
from unittest.mock import patch
from backend.scene_agent import SceneWorkspace, SceneAgentRequest, run_scene_agent
from backend.scene_resonator import stable_length
from backend.scene_physics import calculate
from backend.settings import Settings
from backend.tests.test_scene_physics import state


def metric(result, key):
    return next(m['value'] for m in result['metrics'] if m['key'] == key)


class ResonatorSceneTests(unittest.TestCase):
    def test_known_modes_and_boundaries_are_serializable(self):
        r = calculate(state('resonators-0'))
        self.assertEqual(r['status'], '稳定')
        self.assertAlmostEqual(metric(r, 'stabilityProduct'), .16)
        self.assertAlmostEqual(metric(r, 'waistMm') ** 2, .000532 * math.sqrt(150 * 350) / math.pi)
        confocal = calculate(state('resonators-0', lengthMm=500))
        self.assertEqual(confocal['status'], '共焦（简并）')
        self.assertAlmostEqual(metric(confocal, 'rayleighMm'), 250)
        for params, expected in [({'lengthMm': 1000}, '临界'), ({'lengthMm': 1200}, '不稳定'), ({'firstKind': 0, 'secondKind': 0}, '临界'), ({'firstKind': -1, 'secondKind': -1}, '不稳定')]:
            r = calculate(state('resonators-0', **params))
            self.assertEqual(r['status'], expected)
            self.assertIsNone(metric(r, 'waistMm'))
            self.assertIsNone(metric(r, 'observationRadiusMm'))
            json.dumps(r, allow_nan=False)
        self.assertIsNone(metric(calculate(state('resonators-0', observationMm=301)), 'observationRadiusMm'))

    def test_solver_changes_only_distance_and_returns_verified_evidence(self):
        s = state('resonators-0', lengthMm=1200)
        w = SceneWorkspace(s)
        result = w.execute('solve_target', {'target': 'stable_length', 'apply': True})
        self.assertEqual(w.state['parameters']['lengthMm'], 750)
        self.assertEqual({k: v for k, v in w.state['parameters'].items() if k != 'lengthMm'}, {k: v for k, v in s.parameters.items() if k != 'lengthMm'})
        self.assertEqual(result['evidence']['status'], '稳定')
        self.assertEqual(result['evidence']['metrics'], calculate(w.state)['metrics'])
        self.assertEqual(result['evidence']['input'], w.state)
        with self.assertRaises(ValueError):
            stable_length(state('resonators-0', firstKind=-1, secondKind=-1).parameters)

    def test_readonly_comparison_and_unsolvable_target_preserve_state(self):
        w = SceneWorkspace(state('resonators-0'), allow_edit=False)
        before = copy.deepcopy(w.state)
        scan = w.execute('compare_parameter', {'field': 'lengthMm', 'values': [300, 500, 1000]})
        self.assertEqual([r['result']['status'] for r in scan['rows']], ['稳定', '共焦（简并）', '临界'])
        self.assertEqual(w.state, before)
        w.execute('solve_target', {'target': 'stable_length', 'apply': False})
        self.assertEqual(w.state, before)
        with self.assertRaises(ValueError):
            w.execute('solve_target', {'target': 'stable_length', 'apply': True})
        self.assertEqual(w.state, before)
        w = SceneWorkspace(state('resonators-0', firstKind=-1, secondKind=-1))
        before = copy.deepcopy(w.state)
        with self.assertRaises(ValueError):
            w.execute('solve_target', {'target': 'stable_length', 'apply': True})
        self.assertEqual(w.state, before)

    def test_agent_authorized_and_negated_requests(self):
        for message, changed in [('只调整镜距，调到稳定', True), ('不要调到稳定，只解释', False)]:
            request = SceneAgentRequest(requestId='cavity', state=state('resonators-0', lengthMm=1200), message=message)
            calls = [{'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'stable', 'type': 'function', 'function': {'name': 'solve_target', 'arguments': json.dumps({'target': 'stable_length', 'apply': True})}}]}, {'role': 'assistant', 'content': '镜距已调整。' if changed else '参数保持原值。'}]
            with patch('backend.scene_agent.completion', side_effect=calls):
                reply = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
            self.assertEqual(reply['changed'], changed)
            if changed:
                self.assertEqual(reply['evidence']['metrics'], calculate(reply['state'])['metrics'])
            else:
                self.assertEqual(reply['trace'][0]['status'], 'error')
                self.assertEqual(reply['state']['parameters'], request.state.parameters)

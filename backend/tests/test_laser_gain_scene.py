import copy
import json
import math
import unittest
from unittest.mock import patch
from backend.scene_agent import SceneWorkspace, SceneAgentRequest, run_scene_agent
from backend.scene_physics import calculate
from backend.scene_laser_gain import target_gain
from backend.settings import Settings
from backend.tests.test_scene_physics import state


def metric(result, key):
    return next(m['value'] for m in result['metrics'] if m['key'] == key)


class LaserGainSceneTests(unittest.TestCase):
    def test_known_threshold_saturation_and_limits(self):
        s = state('laser-gain-0')
        result = calculate(s)
        threshold = .2 + math.log(1 / .891) / .2
        self.assertAlmostEqual(metric(result, 'thresholdGain'), threshold)
        self.assertAlmostEqual(metric(result, 'roundTrip'), .891 * math.exp(.36))
        self.assertAlmostEqual(metric(result, 'steadyGain'), threshold)
        self.assertAlmostEqual(metric(result, 'outputIntensity'), .1 * (2 / threshold - 1))
        for gain, expected in [(0, '阈值以下'), (threshold, '达到阈值'), (threshold * 1.2, '阈值以上')]:
            self.assertEqual(calculate(state('laser-gain-0', smallSignalGain=gain))['status'], expected)
        closed = calculate(state('laser-gain-0', secondReflectivityPct=100))
        self.assertEqual(metric(closed, 'outputIntensity'), 0)
        self.assertGreater(metric(closed, 'steadyIntensity'), 0)
        for gain in [0, 2, 50]:
            result = calculate(state('laser-gain-0', firstReflectivityPct=100, secondReflectivityPct=100, lossPerM=0, smallSignalGain=gain))
            self.assertIsNone(metric(result, 'steadyIntensity'))
            self.assertIsNone(metric(result, 'outputIntensity'))
            self.assertTrue(all(p['y'] is None for p in result['curve']))
            json.dumps(result, allow_nan=False)
        json.dumps(calculate(state('laser-gain-0', lengthMm=1000, smallSignalGain=50, lossPerM=0)), allow_nan=False)

    def test_target_changes_gain_only_and_has_verifiable_balance(self):
        s = state('laser-gain-0', smallSignalGain=.1)
        w = SceneWorkspace(s)
        before = copy.deepcopy(w.state)
        at = w.execute('solve_target', {'target': 'threshold_gain', 'apply': True})
        self.assertEqual(at['evidence']['status'], '达到阈值')
        self.assertAlmostEqual(metric(at['evidence'], 'roundTrip'), 1)
        above = w.execute('solve_target', {'target': 'above_threshold', 'apply': True})
        self.assertEqual(above['evidence']['status'], '阈值以上')
        self.assertEqual(above['evidence']['metrics'], calculate(w.state)['metrics'])
        self.assertEqual({k: v for k, v in w.state['parameters'].items() if k != 'smallSignalGain'}, {k: v for k, v in before['parameters'].items() if k != 'smallSignalGain'})
        for changes in [dict(firstReflectivityPct=100, secondReflectivityPct=100, lossPerM=0), dict(lengthMm=10, firstReflectivityPct=1, secondReflectivityPct=1)]:
            with self.assertRaises(ValueError):
                target_gain(state('laser-gain-0', **changes).parameters)

    def test_comparison_preview_denied_mutations_and_invalid_ranges(self):
        w = SceneWorkspace(state('laser-gain-0'), allow_edit=False)
        before = copy.deepcopy(w.state)
        scan = w.execute('compare_parameter', {'field': 'secondReflectivityPct', 'values': [80, 90, 99]})
        self.assertEqual(w.state, before)
        self.assertEqual(len(scan['rows']), 3)
        self.assertGreater(metric(scan['rows'][0]['result'], 'thresholdGain'), metric(scan['rows'][-1]['result'], 'thresholdGain'))
        w.execute('solve_target', {'target': 'above_threshold', 'apply': False})
        self.assertEqual(w.state, before)
        with self.assertRaises(ValueError):
            w.execute('solve_target', {'target': 'above_threshold', 'apply': True})
        with self.assertRaises(ValueError):
            w.execute('set_parameters', {'parameters': {'firstReflectivityPct': 0}})
        self.assertEqual(w.state, before)

    def test_agent_authorization_and_negative_instruction(self):
        for message, changed in [('只调整增益，调到阈值以上', True), ('不要调到阈值，只解释', False)]:
            request = SceneAgentRequest(requestId='gain', state=state('laser-gain-0', smallSignalGain=.1), message=message)
            replies = [{'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'above', 'type': 'function', 'function': {'name': 'solve_target', 'arguments': json.dumps({'target': 'above_threshold', 'apply': True})}}]}, {'role': 'assistant', 'content': '已调到阈值以上。' if changed else '参数不变。'}]
            with patch('backend.scene_agent.completion', side_effect=replies):
                result = run_scene_agent(request, Settings('test', 'test', 'https://example.com'), client=object())
            self.assertEqual(result['changed'], changed)
            if changed:
                self.assertEqual(result['evidence']['input'], result['state'])
                self.assertEqual(result['evidence']['metrics'], calculate(result['state'])['metrics'])
            else:
                self.assertEqual(result['trace'][0]['status'], 'error')
                self.assertEqual(result['state']['parameters'], request.state.parameters)

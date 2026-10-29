import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_agent import SceneWorkspace, editing_intent
from backend.scene_physics import DEFINITIONS, calculate, solve_formula
from backend.scene_illumination import illuminance_at, illumination_target, map_values


def state(**patch):
    return dict(version=1, sceneId='photometric-quantities-0', parameters={
        **{f['key']: f['default'] for f in DEFINITIONS['photometric-quantities-0']['parameters']}, **patch})


class IlluminationTests(unittest.TestCase):
    def test_known_axis_and_half_power_angle_with_receiver_cosine(self):
        p = state(intensityCd=100, tiltDeg=0, observationXM=0)['parameters']
        self.assertEqual(illuminance_at(p)['value'], 25)
        for beta in [10, 30, 60]:
            angle = math.radians(beta)
            q = {**p, 'halfAngleDeg': beta, 'observationXM': p['heightM']*math.tan(angle)}
            b = illuminance_at(q)
            self.assertAlmostEqual(b['alphaDeg'], beta)
            self.assertAlmostEqual(b['value'], 25*.5*math.cos(angle)**3)
        for factor in [0, .25, 2]:
            self.assertAlmostEqual(illuminance_at({**p, 'intensityCd': 100*factor})['value'], 25*factor)

    def test_symmetry_spatial_scaling_and_back_hemisphere(self):
        p = state(sourceXM=1, heightM=1, tiltDeg=30, observationXM=1.5, observationYM=.5)['parameters']
        base = illuminance_at(p)['value']
        self.assertAlmostEqual(illuminance_at({**p, 'sourceXM': -1, 'tiltDeg': -30, 'observationXM': -1.5})['value'], base)
        self.assertAlmostEqual(illuminance_at({**p, 'observationYM': -.5})['value'], base)
        self.assertAlmostEqual(illuminance_at({**p, 'sourceXM': 2, 'heightM': 2, 'observationXM': 3, 'observationYM': 1})['value'], base/4)
        back = state(sourceXM=3, heightM=.5, tiltDeg=70, observationXM=-4)['parameters']
        self.assertEqual(illuminance_at(back)['value'], 0)
        with self.assertRaises(ValueError): illumination_target(back, 'illuminance', 1)

    def test_area_zero_light_and_direction_changes_real_distribution(self):
        p = state(tiltDeg=0)['parameters']
        a = map_values(p)
        self.assertAlmostEqual(a['peak']['x'], 0)
        self.assertAlmostEqual(a['peak']['y'], 0)
        self.assertGreater(a['average'], 0)
        self.assertTrue(0 < a['uniformity'] <= 1)
        self.assertGreater(map_values({**p, 'tiltDeg': 30})['peak']['x'], 0)
        off = map_values({**p, 'intensityCd': 0})
        self.assertEqual(off['average'], 0)
        self.assertEqual(off['maximum'], 0)
        self.assertIsNone(off['uniformity'])
        self.assertIsNone(off['peak'])

    def test_direction_target_maximizes_observed_reading_and_preserves_other_parameters(self):
        self.assertTrue(editing_intent('只调整方向，让观察点尽可能亮'))
        for prompt in ['为什么转动射灯，亮区会移动？', '如何只调整方向让观察点更亮？', '比较倾角0、20、40度']:
            self.assertFalse(editing_intent(prompt))
        original = state(observationXM=3, observationYM=2, heightM=1)
        p = original['parameters']
        patch = illumination_target(p, 'best_direction')
        e = illuminance_at({**p, **patch})['value']
        for tilt in range(-70, 71):
            self.assertGreaterEqual(e+1e-10, illuminance_at({**p, 'tiltDeg': tilt})['value'])
        w = SceneWorkspace(original)
        w.execute('solve_target', dict(target='best_direction', apply=False))
        self.assertEqual(w.state, original)
        outcome = w.execute('solve_target', dict(target='best_direction', apply=True))
        self.assertEqual(outcome['candidate']['parameters'], {**p, **patch})
        readonly = SceneWorkspace(original, allow_edit=False)
        with self.assertRaises(ValueError): readonly.execute('solve_target', dict(target='best_direction', apply=True))
        self.assertEqual(readonly.state, original)

    def test_illuminance_target_limits_and_formula_agree_with_geometry(self):
        p = state()['parameters']
        patch = illumination_target(p, 'illuminance', 50)
        self.assertAlmostEqual(illuminance_at({**p, **patch})['value'], 50)
        self.assertEqual(illumination_target(p, 'illuminance', 0), {'intensityCd': 0})
        for value in [-1, True, float('nan'), 1e9]:
            with self.assertRaises(ValueError): illumination_target(p, 'illuminance', value)
        b = illuminance_at(p)
        known = dict(I0=p['intensityCd'], r=b['distance'], alpha=b['alphaDeg'], gamma=b['incidenceDeg'], beta=p['halfAngleDeg'])
        self.assertAlmostEqual(solve_formula('directional-illuminance', 'E', known)['values'][0], b['value'])
        known.pop('I0')
        self.assertAlmostEqual(solve_formula('directional-illuminance', 'I0', {**known, 'E': b['value']})['values'][0], p['intensityCd'])
        with self.assertRaises(ValueError): solve_formula('directional-illuminance', 'I0', {**known, 'alpha': 100, 'E': 1})

    def test_api_invalid_parameters_and_read_only_comparison(self):
        client = TestClient(app)
        s = state()
        reply = client.post('/api/scenes/calculate', json=dict(state=s, revision='illumination-check'))
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()['input'], s)
        self.assertEqual(reply.json()['revision'], 'illumination-check')
        for patch in [dict(heightM=0), dict(halfAngleDeg=90), dict(tiltDeg=71), dict(observationYM=True)]:
            self.assertEqual(client.post('/api/scenes/calculate', json=dict(state=state(**patch))).status_code, 422)
        w = SceneWorkspace(s)
        scan = w.execute('compare_parameter', dict(field='tiltDeg', values=[0, 20, 40]))
        self.assertEqual(w.state, s)
        self.assertEqual(len(scan['rows']), 3)
        self.assertNotEqual(scan['rows'][0]['result']['metrics'][0]['value'], scan['rows'][2]['result']['metrics'][0]['value'])


if __name__ == '__main__': unittest.main()

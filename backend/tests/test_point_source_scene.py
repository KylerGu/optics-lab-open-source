import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS, calculate, solve_formula
from backend.scene_agent import SceneWorkspace


def state(**patch):
    return dict(version=1, sceneId='radiometric-quantities-0', parameters={
        **{f['key']: f['default'] for f in DEFINITIONS['radiometric-quantities-0']['parameters']}, **patch})


class PointSourceTests(unittest.TestCase):
    def reading(self, s):
        return calculate(s)['metrics'][0]['value']

    def test_photometric_units_and_inverse_square_scaling(self):
        self.assertEqual(self.reading(state(intensityCd=1, distanceM=1)), 1)
        self.assertEqual(self.reading(state()), 25)
        for intensity in [0, .01, 1, 100, 2000]:
            for r in [.2, .5, 1, 3, 5]:
                baseline = self.reading(state(intensityCd=intensity, distanceM=r))
                self.assertAlmostEqual(self.reading(state(intensityCd=intensity, distanceM=2*r)), baseline/4)
                self.assertAlmostEqual(self.reading(state(intensityCd=intensity/2, distanceM=r)), baseline/2)
        self.assertAlmostEqual(self.reading(state(intensityCd=2000, distanceM=.2)), 50000)
        result = calculate(state(intensityCd=0))
        self.assertEqual(result['status'], '光源关闭')
        self.assertTrue(all(row['y'] == 0 for row in result['curve']))
        self.assertEqual(result['chart']['currentY'], 0)

    def test_goal_solver_preserves_light_and_requires_edit_authorization(self):
        original = state()
        w = SceneWorkspace(original)
        outcome = w.execute('solve_target', dict(target='illuminance', value=100, apply=False))
        self.assertEqual(w.state, original)
        self.assertEqual(outcome['candidate']['parameters'], dict(intensityCd=100, distanceM=1))
        w.execute('solve_target', dict(target='illuminance', value=100, apply=True))
        self.assertEqual(self.reading(w.state), 100)
        self.assertEqual(original, state())
        readonly = SceneWorkspace(original, allow_edit=False)
        with self.assertRaises(ValueError): readonly.execute('solve_target', dict(target='illuminance', value=100, apply=True))
        self.assertEqual(readonly.state, original)
        for value in [0, -1, True, float('nan'), .1, 5000]:
            with self.assertRaises(ValueError): w.execute('solve_target', dict(target='illuminance', value=value, apply=True))
        self.assertEqual(self.reading(w.state), 100)
        off = SceneWorkspace(state(intensityCd=0))
        with self.assertRaises(ValueError): off.execute('solve_target', dict(target='illuminance', value=100, apply=True))

    def test_api_validation_and_comparison_identity(self):
        client = TestClient(app)
        s = state(distanceM=2.3456789)
        reply = client.post('/api/scenes/calculate', json=dict(state=s, revision='point-test'))
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()['input'], s)
        self.assertEqual(reply.json()['revision'], 'point-test')
        for bad in [0, -.1, 11, True]:
            self.assertEqual(client.post('/api/scenes/calculate', json=dict(state=state(distanceM=bad))).status_code, 422)
        w = SceneWorkspace(s)
        scan = w.execute('compare_parameter', dict(field='distanceM', values=[1, 2, 4]))
        self.assertEqual(w.state, s)
        self.assertEqual([row['result']['metrics'][0]['value'] for row in scan['rows']], [100, 25, 6.25])

    def test_formula_forward_inverse_and_degenerate_case(self):
        for target, values, expected in [('E', dict(I=100, r=2), 25), ('I', dict(E=25, r=2), 100), ('r', dict(I=100, E=25), 2)]:
            self.assertEqual(solve_formula('point-source-illuminance', target, values)['values'], [expected])
        for values in [dict(I=0, E=0), dict(I=100, E=0), dict(I=0, E=100)]:
            with self.assertRaises(ValueError): solve_formula('point-source-illuminance', 'r', values)


if __name__ == '__main__': unittest.main()

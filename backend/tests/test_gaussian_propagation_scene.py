"""Free-propagation Gaussian is served by the scene assistant."""
import math
import unittest

from pydantic import ValidationError

from backend.scene_agent import SceneAgentRequest, run_scene_agent
from backend.scene_physics import SceneState, calculate
from backend.settings import Settings


def state(**overrides):
    parameters = {'wavelengthNm': 532, 'waistMm': 0.2, 'waistPositionMm': 30, 'observationMm': 350, **overrides}
    return SceneState(version=1, sceneId='gaussian-propagation', parameters=parameters)


class GaussianPropagationSceneTests(unittest.TestCase):
    def test_readings_match_the_free_space_formula(self):
        result = calculate(state())
        wavelength = 532e-6
        distance = 320
        rayleigh = math.pi * 0.2 ** 2 / wavelength
        radius = 0.2 * math.hypot(1, distance / rayleigh)
        values = {metric['key']: metric['value'] for metric in result['metrics']}
        self.assertAlmostEqual(values['radiusMm'], radius, places=9)
        self.assertAlmostEqual(values['rayleighMm'], rayleigh, places=9)
        self.assertEqual(result['status'], '过渡区')

    def test_observation_must_stay_to_the_right_of_the_waist(self):
        with self.assertRaises(ValidationError):
            state(waistPositionMm=350, observationMm=350)

    def test_explicit_spot_command_changes_only_the_waist(self):
        result = run_scene_agent(SceneAgentRequest(
            requestId='spot', state=state(),
            message='保持波长、束腰位置和观察位置不变，帮我把观察处的光斑半径调到 0.4 mm。',
        ), Settings('test-key', 'deepseek-flash'))
        self.assertTrue(result['changed'])
        self.assertEqual(result['state']['parameters']['observationMm'], 350)
        self.assertEqual(result['state']['parameters']['wavelengthNm'], 532)
        self.assertNotEqual(result['state']['parameters']['waistMm'], 0.2)
        radius = next(metric['value'] for metric in result['evidence']['metrics'] if metric['key'] == 'radiusMm')
        self.assertAlmostEqual(radius, 0.4, places=6)
        self.assertIn('solve_gaussian_target', [step['name'] for step in result['trace']])
        self.assertNotIn('test-key', result['answer'])


if __name__ == '__main__':
    unittest.main()

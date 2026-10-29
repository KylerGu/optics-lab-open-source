import unittest
from backend.scene_physics import calculate, solve_formula, DEFINITIONS


def state(**patch):
    return dict(version=1,sceneId='instruments-2',parameters={**{f['key']:f['default'] for f in DEFINITIONS['instruments-2']['parameters']},**patch})


class CameraTests(unittest.TestCase):
    def test_depth_boundaries_are_actual_ray_bundle_limits(self):
        s=state(study=2)
        metrics={m['key']:m['value'] for m in calculate(s)['metrics']}
        for key in ['nearDepth','farDepth']:
            result=calculate(state(u=metrics[key]))
            ends=[ray['end'][1] for ray in result['segments'] if ray['role']=='transmitted']
            self.assertAlmostEqual(max(ends)-min(ends),s['parameters']['coc'])

    def test_infinite_depth_and_invalid_focus_have_different_meanings(self):
        known=dict(f=50,s=50.001,a=1,c0=.03)
        self.assertTrue(solve_formula('camera-depth','uf',known)['infinite'])
        self.assertGreater(solve_formula('camera-depth','un',known)['values'][0],0)
        with self.assertRaises(ValueError):solve_formula('camera-depth','un',{**known,'s':50})

    def test_focal_estimate_and_sampling_do_not_require_unused_inputs(self):
        self.assertAlmostEqual(solve_formula('camera-field','f',dict(S=8.8,u=400,W=61.6))['values'][0],50)
        self.assertAlmostEqual(solve_formula('camera-sampling','nu',dict(p=3.45))['values'][0],500/3.45)
        self.assertAlmostEqual(solve_formula('camera-sampling','e',dict(p=3.45,u=400,s=400/7))['values'][0],24.15)

    def test_aperture_does_not_change_focus_or_field_but_changes_depth_and_diffraction(self):
        a={m['key']:m['value'] for m in calculate(state())['metrics']}
        b={m['key']:m['value'] for m in calculate(state(aperture=6.25))['metrics']}
        self.assertEqual(a['v'],b['v']);self.assertEqual(a['fieldWidth'],b['fieldWidth'])
        self.assertAlmostEqual(b['airyDiameter'],2*a['airyDiameter'])
        self.assertLess(b['nearDepth'],a['nearDepth']);self.assertGreater(b['farDepth'],a['farDepth'])

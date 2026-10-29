import math
import unittest
from backend.scene_physics import calculate, solve_formula
from backend.scene_telescope import optics, throughput, field
from backend.tests.test_scene_physics import state


class TelescopeStudyTests(unittest.TestCase):
    def test_actual_stop_and_real_virtual_infinite_pupils(self):
        p=state('instruments-1').parameters
        self.assertAlmostEqual(optics(p)['pupilPosition'],34.5)
        self.assertAlmostEqual(optics(p)['pupilDiameter'],3)
        self.assertAlmostEqual(optics({**p,'k2':-1,'d':170})['pupilPosition'],-25.5)
        self.assertEqual(optics({**p,'eyepieceDiameter':2})['pupilPosition'],0)
        self.assertIsNone(optics({**p,'d':30,'eyepieceDiameter':40})['pupilPosition'])
        self.assertAlmostEqual(throughput(p,0),1)
        self.assertAlmostEqual(throughput({**p,'eyeDiameter':1},0),1/9)
        self.assertEqual(throughput({**p,'eyeOffset':10},0),0)

    def test_visible_field_and_pupil_symmetry(self):
        p=state('instruments-1').parameters
        interval=field(p)
        self.assertAlmostEqual(interval[0],-interval[1])
        for theta in [0,.01,.02,.03,.05]:
            self.assertAlmostEqual(throughput(p,theta),throughput(p,-theta),places=10)
        self.assertEqual(throughput(p,math.radians(interval[1]+.001)),0)
        gal={**p,'k2':-1,'d':170}
        self.assertGreater(field({**gal,'eyeDistance':0})[1],field({**gal,'eyeDistance':80})[1])
        self.assertIsNone(field({**p,'d':250}))

    def test_resolution_is_an_objective_limit_and_formulas_handle_infinity(self):
        a=calculate(state('instruments-1',study=2,d=250))
        self.assertFalse(a['warnings'])
        self.assertAlmostEqual(next(m['value'] for m in a['metrics'] if m['key']=='resolution'),6.920184249590084)
        self.assertTrue(solve_formula('telescope-pupil-position','q',{'fe':30,'d':30})['infinite'])
        with self.assertRaises(ValueError):solve_formula('telescope-pupil-position','q',{'fe':0,'d':230})

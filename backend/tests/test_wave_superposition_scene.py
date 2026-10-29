import math
import random
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_agent import SceneWorkspace
from backend.scene_physics import calculate, solve_formula
from backend.scene_wave_superposition import wave_values, target_phase
from backend.tests.test_scene_physics import state


class WaveSuperpositionTests(unittest.TestCase):
    def test_limits_and_undefined_phase(self):
        for phase, amplitude, intensity in [(0,2,4),(90,math.sqrt(2),2),(180,0,0),(270,math.sqrt(2),2),(360,2,4)]:
            b=wave_values(state('wave-fields-1',phaseDeg=phase).parameters)
            self.assertAlmostEqual(b['amplitude'],amplitude)
            self.assertAlmostEqual(b['intensity'],intensity)
        b=wave_values(state('wave-fields-1',phaseDeg=180).parameters)
        self.assertIsNone(b['resultantPhaseDeg']);self.assertEqual(b['sum'],0)
        self.assertAlmostEqual(wave_values(state('wave-fields-1',phaseDeg=180,amplitude2=.5).parameters)['intensity'],.25)
        self.assertEqual(wave_values(state('wave-fields-1',amplitude1=1e-13,amplitude2=0).parameters)['amplitude'],1e-13)

    def test_numerical_period_average_and_position_invariance(self):
        rng=random.Random(831)
        for _ in range(60):
            p=state('wave-fields-1',amplitude1=rng.random()*2,amplitude2=rng.random()*2,phaseDeg=rng.random()*360,wavelengthNm=rng.uniform(380,780),observationUm=rng.random()*10).parameters
            b=wave_values(p)
            mean=sum(wave_values({**p,'observationUm':p['observationUm']+p['wavelengthNm']/1000*j/512})['sum']**2 for j in range(512))/512
            self.assertAlmostEqual(2*mean,b['intensity'],places=10)
            self.assertEqual(wave_values({**p,'observationUm':7.77})['intensity'],b['intensity'])

    def test_inverse_phase_reachable_ranges_and_no_unintended_edit(self):
        original=state('wave-fields-1',amplitude2=.5,phaseDeg=270).model_dump()
        p=original['parameters'];q=target_phase(p,'relative_intensity',1.25)
        self.assertAlmostEqual(q,270)
        self.assertAlmostEqual(wave_values({**p,'phaseDeg':target_phase(p,'relative_intensity',.25)})['intensity'],.25)
        for value in [-1,0,3,float('nan'),True]:
            with self.assertRaises(ValueError):target_phase(p,'relative_intensity',value)
        w=SceneWorkspace(original)
        outcome=w.execute('solve_target',{'target':'destructive','apply':True})
        self.assertEqual(outcome['candidate']['parameters'],{**p,'phaseDeg':180})
        self.assertAlmostEqual(wave_values(w.state['parameters'])['amplitude'],.5)
        read_only=SceneWorkspace(original,allow_edit=False)
        with self.assertRaises(ValueError):read_only.execute('solve_target',{'target':'constructive','apply':True})
        self.assertEqual(read_only.state,original)
        self.assertEqual(original['parameters']['phaseDeg'],270)

    def test_formula_forward_inverse_and_degenerate_targets(self):
        for formula,key,expected in [('wave-resultant-amplitude','A',math.sqrt(2)),('wave-average-intensity','I',2)]:
            self.assertAlmostEqual(solve_formula(formula,key,dict(A1=1,A2=1,phi=90))['values'][0],expected)
            angles=solve_formula(formula,'phi',dict(A1=1,A2=1,**{key:expected}))['values']
            self.assertAlmostEqual(angles[0],90);self.assertAlmostEqual(angles[1],270)
            with self.assertRaises(ValueError):solve_formula(formula,'phi',dict(A1=1,A2=0,**{key:1}))
        self.assertAlmostEqual(solve_formula('wave-field-sum','E',dict(A1=1,A2=.5,phi=180,**{'lambda':600,'z':.6}))['values'][0],.5)
        with self.assertRaises(ValueError):solve_formula('wave-average-intensity','phi',dict(A1=1,A2=.5,I=4))

    def test_api_identity_and_input_validation(self):
        client=TestClient(app);s=state('wave-fields-1',observationUm=1.234567890123,phaseDeg=123.4567890123).model_dump()
        reply=client.post('/api/scenes/calculate',json={'state':s,'revision':'wave-validation'})
        self.assertEqual(reply.status_code,200);self.assertEqual(reply.json()['input'],s);self.assertEqual(reply.json()['revision'],'wave-validation')
        self.assertEqual(len(reply.json()['metrics']),8)
        self.assertEqual(client.post('/api/scenes/formula',json={'formulaId':'wave-average-intensity','target':'I','values':{'A1':1,'A2':1,'phi':180}}).json()['values'],[0])
        s['parameters']['amplitude1']=True
        self.assertEqual(client.post('/api/scenes/calculate',json={'state':s}).status_code,422)

    def test_comparisons_do_not_change_parameters(self):
        original=state('wave-fields-1').model_dump();w=SceneWorkspace(original)
        scan=w.execute('compare_parameter',{'field':'phaseDeg','values':[0,90,180]})
        self.assertEqual(w.state,original)
        values=[next(m['value'] for m in row['result']['metrics'] if m['key']=='intensity') for row in scan['rows']]
        for a,b in zip(values,[4,2,0]):self.assertAlmostEqual(a,b)
        self.assertEqual(calculate(original)['input'],original)


if __name__=='__main__':unittest.main()

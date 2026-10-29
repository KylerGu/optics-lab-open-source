import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate,solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_michelson import michelson_at,michelson_target
from backend.tests.test_scene_physics import state


class MichelsonTests(unittest.TestCase):
    def test_both_mirrors_change_difference_and_targets_keep_first_mirror(self):
        p=state('interference-2',mirror1MoveUm=.37,mirrorMoveUm=.52).parameters
        self.assertAlmostEqual(michelson_at(p,0)['deltaUm'],240.3)
        self.assertEqual(michelson_at(p,0)['intensity'],0)
        self.assertEqual(michelson_at({**p,'mirror1MoveUm':.52},0)['intensity'],1)
        for first in [-1,.123456789,1]:
            for radius in [0,12]:
                q={**p,'mirror1MoveUm':first,'observationRadiusMm':radius}
                for target,expected in [('bright',1),('dark',0)]:
                    self.assertEqual(michelson_at({**q,'mirrorMoveUm':michelson_target(q,target)})['intensity'],expected)
        w=SceneWorkspace(state('interference-2',mirror1MoveUm=.37).model_dump())
        w.execute('solve_target',dict(target='dark',apply=True))
        self.assertEqual(w.state['parameters']['mirror1MoveUm'],.37)
        self.assertEqual(michelson_at(w.state['parameters'])['intensity'],0)

    def test_equal_arms_and_time_average(self):
        for radius in [0,5,12]:self.assertEqual(michelson_at(state('interference-2',baseDifferenceUm=0).parameters,radius)['intensity'],1)
        for i in range(30):
            p=state('interference-2',baseDifferenceUm=i*31-480,mirrorMoveUm=(i%5)/2-1,observationRadiusMm=(i%13),focalLengthMm=75+i*4).parameters;b=michelson_at(p)
            theta=math.atan(p['observationRadiusMm']/p['focalLengthMm']);self.assertAlmostEqual(b['deltaUm'],2*(p['baseDifferenceUm']+p['mirrorMoveUm'])*math.cos(theta),places=10)
            mean=sum((math.cos(j*math.tau/256)+math.cos(j*math.tau/256+math.tau*b['cycles']))**2 for j in range(256))/512
            self.assertAlmostEqual(mean,b['intensity'],places=10)
            self.assertAlmostEqual(michelson_at(p,-p['observationRadiusMm'])['intensity'],b['intensity'])

    def test_half_and_quarter_wave_steps(self):
        for wavelength in [380,600,780]:
            p=state('interference-2',wavelengthNm=wavelength,observationRadiusMm=0).parameters;b=michelson_at(p)
            self.assertAlmostEqual(michelson_at({**p,'mirrorMoveUm':wavelength/4000})['intensity'],1-b['intensity'],places=10)
            self.assertAlmostEqual(michelson_at({**p,'mirrorMoveUm':wavelength/2000})['intensity'],b['intensity'],places=10)
            self.assertAlmostEqual(michelson_at({**p,'mirrorMoveUm':wavelength/2000})['deltaUm']-b['deltaUm'],wavelength/1000,places=10)

    def test_exact_target_corners(self):
        for initial in [-500,-120,0,120,500]:
            for move in [-1,0,1]:
                for radius in [0,5,12]:
                    p=state('interference-2',baseDifferenceUm=initial,mirrorMoveUm=move,observationRadiusMm=radius).parameters
                    for target,expected in [('bright',1),('dark',0)]:
                        solved=michelson_target(p,target);self.assertTrue(-1<=solved<=1);self.assertEqual(michelson_at({**p,'mirrorMoveUm':solved})['intensity'],expected)
        with self.assertRaises(ValueError):michelson_target(p,'first_dark')

    def test_formula_units_and_degenerate_inverse(self):
        self.assertEqual(solve_formula('michelson-path','delta',dict(D=120,s=.15,f=100,r=0))['values'],[240.3])
        for target,values,expected in [('N',{'lambda':600,'s':.3},1),('s',{'lambda':600,'N':1},.3),('lambda',{'s':.3,'N':1},600)]:
            self.assertAlmostEqual(solve_formula('michelson-displacement',target,values)['values'][0],expected)
        self.assertEqual(solve_formula('michelson-intensity','J',{'lambda':600,'delta':240.3})['values'],[0])
        for values in [dict(s=0,N=0),dict(s=.3,N=-1)]:
            with self.assertRaises(ValueError):solve_formula('michelson-displacement','lambda',values)

    def test_assistant_only_mirror_and_read_only_comparison(self):
        source=state('interference-2').model_dump();w=SceneWorkspace(source)
        candidate=w.execute('solve_target',dict(target='dark',apply=False))['candidate'];self.assertEqual(w.state,source)
        response=w.execute('solve_target',dict(target='dark',apply=True));self.assertEqual(w.state,candidate);self.assertEqual(response['evidence']['status'],'暗环 · 相消干涉')
        for key,value in source['parameters'].items():
            if key!='mirrorMoveUm':self.assertEqual(w.state['parameters'][key],value)
        read_only=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError):read_only.execute('solve_target',dict(target='dark',apply=True))
        read_only.execute('compare_parameter',dict(field='mirrorMoveUm',values=[0,.15,.3]));self.assertEqual(read_only.state,source)

    def test_api_identity_and_curve(self):
        client=TestClient(app);s=state('interference-2',mirrorMoveUm=.1234567890123).model_dump();r=client.post('/api/scenes/calculate',json=dict(state=s,revision='michelson-verify'))
        self.assertEqual(r.status_code,200);data=r.json();self.assertEqual(data['input'],s);self.assertEqual(data['revision'],'michelson-verify');self.assertEqual(len(data['curve']),1201);self.assertEqual(len(data['metrics']),10)
        self.assertTrue(all(0<=q['y']<=1 for q in data['curve']))
        self.assertEqual(client.post('/api/scenes/formula',json=dict(formulaId='michelson-displacement',target='s',values={'lambda':600,'N':1})).json()['values'],[.3])
        s['parameters']['mirrorMoveUm']=True;self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)

if __name__=='__main__':unittest.main()

import math
import random
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate, solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_young_double_slit import young_at, young_position
from backend.tests.test_scene_physics import state


class YoungDoubleSlitTests(unittest.TestCase):
    def test_geometry_and_independent_time_average(self):
        rng=random.Random(907)
        for _ in range(50):
            p=state('interference-0',wavelengthNm=rng.uniform(380,780),slitDistanceMm=rng.uniform(.1,1),screenDistanceM=rng.uniform(.5,2),observationMm=rng.uniform(-20,20)).parameters
            b=young_at(p);L=p['screenDistanceM']*1000;d=p['slitDistanceMm'];y=p['observationMm']
            self.assertAlmostEqual(b['deltaMm'],math.sqrt(L*L+(y+d/2)**2)-math.sqrt(L*L+(y-d/2)**2),places=10)
            mean=sum((math.cos(j*math.tau/256)+math.cos(j*math.tau/256+math.tau*b['cycles']))**2 for j in range(256))/512
            self.assertAlmostEqual(mean,b['intensity'],places=10)
            self.assertAlmostEqual(young_at(p,-y)['intensity'],b['intensity'],places=12)

    def test_exact_targets_and_parameter_corners(self):
        for wavelength in [380,600,780]:
            for distance in [.5,1,2]:
                for separation in [.1,.5,1]:
                    p=state('interference-0',wavelengthNm=wavelength,screenDistanceM=distance,slitDistanceMm=separation).parameters
                    self.assertEqual(young_at(p,0)['intensity'],1)
                    for order,expected in [(1,1),(.5,0),(-1,1),(-.5,0)]:
                        y=young_position(p,order);b=young_at(p,y)
                        self.assertLess(abs(y),20);self.assertAlmostEqual(b['cycles'],order,places=12);self.assertEqual(b['intensity'],expected)
                    with self.assertRaises(ValueError):young_position(p,1.01*separation/(wavelength*1e-6))

    def test_formula_units_and_inverse_spacing(self):
        for target,values,expected in [('s',dict(d=.5,L=1,**{'lambda':600}),1.2),('lambda',dict(d=.5,L=1,s=1.2),600),('d',dict(L=1,s=1.2,**{'lambda':600}),.5),('L',dict(d=.5,s=1.2,**{'lambda':600}),1)]:
            self.assertAlmostEqual(solve_formula('young-fringe-spacing',target,values)['values'][0],expected)
        p=state('interference-0').parameters;y=young_position(p,.5)
        delta=solve_formula('young-path-difference','delta',dict(d=.5,L=1,y=y))['values'][0]
        self.assertAlmostEqual(delta,.3,places=12)
        for difference,expected in [(0,1),(.3,0),(.6,1),(-.3,0)]:
            self.assertEqual(solve_formula('young-intensity','J',dict(delta=difference,**{'lambda':600}))['values'][0],expected)
        with self.assertRaises(ValueError):solve_formula('young-fringe-spacing','L',dict(d=.5,s=1.2,**{'lambda':True}))

    def test_assistant_targets_preserve_apparatus_and_read_only_turns(self):
        source=state('interference-0',observationMm=-1.7).model_dump();w=SceneWorkspace(source)
        candidate=w.execute('solve_target',dict(target='first_dark',apply=False))['candidate']
        self.assertEqual(w.state,source)
        result=w.execute('solve_target',dict(target='first_dark',apply=True))
        self.assertEqual(w.state,candidate);self.assertEqual(result['evidence']['status'],'暗纹 · 相消干涉')
        for key in ['wavelengthNm','slitDistanceMm','screenDistanceM']:self.assertEqual(w.state['parameters'][key],source['parameters'][key])
        read_only=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError):read_only.execute('solve_target',dict(target='first_dark',apply=True))
        self.assertEqual(read_only.state,source)
        with self.assertRaises(ValueError):w.execute('solve_target',dict(target='destructive',apply=True))

    def test_comparison_monotonic_spacing_and_no_mutation(self):
        source=state('interference-0').model_dump();w=SceneWorkspace(source)
        for field,values,expected in [('screenDistanceM',[.5,1,2],[.6,1.2,2.4]),('slitDistanceMm',[.1,.5,1],[6,1.2,.6])]:
            scan=w.execute('compare_parameter',dict(field=field,values=values))
            for row,want in zip(scan['rows'],expected):self.assertAlmostEqual(next(m['value'] for m in row['result']['metrics'] if m['key']=='spacingApproxMm'),want)
        self.assertEqual(w.state,source)

    def test_api_snapshot_curve_and_validation(self):
        client=TestClient(app);s=state('interference-0',observationMm=.1234567890123).model_dump()
        response=client.post('/api/scenes/calculate',json=dict(state=s,revision='young-verification'))
        self.assertEqual(response.status_code,200);r=response.json();self.assertEqual(r['input'],s);self.assertEqual(r['revision'],'young-verification')
        self.assertEqual(len(r['metrics']),8);self.assertEqual(len(r['curve']),1601);self.assertEqual(r['curve'][800],dict(x=0,y=1))
        self.assertTrue(all(0<=q['y']<=1 for q in r['curve']))
        self.assertEqual(client.post('/api/scenes/formula',json=dict(formulaId='young-intensity',target='J',values={'lambda':600,'delta':.3})).json()['values'],[0])
        s['parameters']['observationMm']=True
        self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)

if __name__=='__main__':unittest.main()

import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS,calculate,solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_polarization_refraction import brewster_values,crystal_values,refraction_target

def state(**patch):return dict(version=1,sceneId='polarization-2',parameters={**{f['key']:f['default'] for f in DEFINITIONS['polarization-2']['parameters']},**patch})

class PolarizationRefractionTests(unittest.TestCase):
    def test_independent_physics_edges(self):
        b=brewster_values(state(angleDeg=math.degrees(math.atan(1.5)))['parameters']);self.assertEqual(b['rp'],0);self.assertGreater(b['rs'],0);self.assertAlmostEqual(b['transmissionDeg']+b['brewsterDeg'],90)
        for polarization in [0,1,2]:
            v=brewster_values(state(polarization=polarization)['parameters']);self.assertAlmostEqual(v['reflectancePct']+v['transmissionPct'],100)
        self.assertEqual(brewster_values(state(n1=1.5,n2=1,angleDeg=50)['parameters'])['status'],'全反射')
        self.assertIsNone(brewster_values(state(n1=1.5,n2=1.5)['parameters'])['brewsterDeg'])
        for gamma in [0,90]:self.assertEqual(crystal_values(state(axisAngleDeg=gamma)['parameters'])['separationMm'],0)
        c=crystal_values(state()['parameters']);g=math.radians(45);eps_o=1.658**2;eps_e=1.486**2
        self.assertAlmostEqual(c['tangent'],(1/eps_o-1/eps_e)/(1/eps_o+1/eps_e));self.assertLess(c['walkoffDeg'],0)
        self.assertEqual(crystal_values(state(extraordinaryIndex=1.658)['parameters'])['status'],'无双折射')

    def test_api_formula_domains_and_models(self):
        client=TestClient(app)
        for mode in [0,1]:
            s=state(mode=mode);r=client.post('/api/scenes/calculate',json=dict(state=s,revision='pr-check'));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['input'],s);self.assertEqual(r.json()['revision'],'pr-check')
            if mode==1:self.assertEqual(r.json()['curve'],[])
        for patch in [dict(mode=.5),dict(n1=0),dict(axisAngleDeg=91),dict(polarization=True),dict(thicknessMm=0)]:self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=state(**patch))).status_code,422)
        self.assertAlmostEqual(solve_formula('brewster-angle','thetaB',dict(n1=1,n2=1.5))['values'][0],math.degrees(math.atan(1.5)))
        for gamma in [0,17,45,90]:self.assertAlmostEqual(solve_formula('crystal-separation','d',dict(no=1.658,ne=1.486,gamma=gamma,L=10))['values'][0],crystal_values(state(axisAngleDeg=gamma)['parameters'])['separationMm'])
        with self.assertRaises(ValueError):solve_formula('brewster-angle','thetaB',dict(n1=1,n2=1))

    def test_ai_targets_keep_mode_and_indices_and_readonly(self):
        for mode,target,field in [(0,'brewster','angleDeg'),(1,'max_separation','axisAngleDeg'),(1,'no_walkoff','axisAngleDeg')]:
            s=state(mode=mode);w=SceneWorkspace(s);w.execute('compare_parameter',dict(field=field,values=[0,30,60]));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,apply=False));self.assertEqual(w.state,s);w.execute('solve_target',dict(target=target,apply=True))
            for k,v in s['parameters'].items():
                if k!=field:self.assertEqual(w.state['parameters'][k],v)
            if target=='brewster':self.assertEqual(brewster_values(w.state['parameters'])['rp'],0)
            elif target=='no_walkoff':self.assertEqual(crystal_values(w.state['parameters'])['separationMm'],0)
            else:
                best=crystal_values(w.state['parameters'])['separationMm']
                for gamma in range(91):self.assertGreaterEqual(best+1e-12,crystal_values(state(axisAngleDeg=gamma)['parameters'])['separationMm'])
            with self.assertRaises(ValueError):SceneWorkspace(s,allow_edit=False).execute('solve_target',dict(target=target,apply=True))
        for p,target in [(state(mode=1)['parameters'],'brewster'),(state()['parameters'],'max_separation'),(state(n1=1.5,n2=1.5)['parameters'],'brewster'),(state(mode=1,extraordinaryIndex=1.658)['parameters'],'max_separation')]:
            with self.assertRaises(ValueError):refraction_target(p,target)

if __name__=='__main__':unittest.main()

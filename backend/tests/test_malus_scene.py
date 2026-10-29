import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS, calculate, solve_formula
from backend.scene_malus import malus_values, malus_target
from backend.scene_agent import SceneWorkspace

def state(**patch):
    return dict(version=1,sceneId='polarization-0',parameters={**{f['key']:f['default'] for f in DEFINITIONS['polarization-0']['parameters']},**patch})

class MalusTests(unittest.TestCase):
    def test_projection_boundaries_and_curve(self):
        for a in [0,15,45,90,180]:
            for b in [0,30,90,180]:
                p=state(inputAngleDeg=a,axisAngleDeg=b)['parameters'];s=malus_values(p)
                dot=math.cos(math.radians(a))*math.cos(math.radians(b))+math.sin(math.radians(a))*math.sin(math.radians(b))
                self.assertAlmostEqual(s['outputPowerMw'],10*dot*dot)
                self.assertTrue(0<=s['relativeAngleDeg']<=90)
        self.assertEqual(malus_values(state(axisAngleDeg=90)['parameters'])['outputPowerMw'],0)
        r=calculate(state(powerMw=0));self.assertEqual(r['status'],'光源关闭');self.assertTrue(all(p['y']==0 for p in r['curve']));self.assertAlmostEqual(r['metrics'][1]['value'],50)
        r=calculate(state());self.assertEqual(r['curve'][0]['y'],10);self.assertEqual(r['curve'][-1]['y'],0);self.assertAlmostEqual(r['chart']['currentY'],5)

    def test_api_formula_roundtrips_and_degenerate_cases(self):
        client=TestClient(app);s=state();r=client.post('/api/scenes/calculate',json=dict(state=s,revision='malus-check'));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['input'],s)
        for patch in [dict(powerMw=-1),dict(inputAngleDeg=181),dict(axisAngleDeg=True)]:self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=state(**patch))).status_code,422)
        values=dict(Pin=10,theta=45,Pout=5)
        for key in values:self.assertAlmostEqual(solve_formula('malus-power',key,{k:v for k,v in values.items() if k!=key})['values'][0],values[key])
        self.assertEqual(solve_formula('malus-power','Pout',dict(Pin=10,theta=90))['values'],[0])
        self.assertEqual(solve_formula('malus-power','theta',dict(Pin=10,Pout=0))['values'],[90])
        for target,values in [('Pin',dict(Pout=0,theta=90)),('theta',dict(Pin=0,Pout=0)),('theta',dict(Pin=10,Pout=11))]:
            with self.assertRaises(ValueError):solve_formula('malus-power',target,values)

    def test_ai_preserves_source_and_comparison_is_readonly(self):
        s=state(powerMw=12,inputAngleDeg=150);workspace=SceneWorkspace(s)
        workspace.execute('compare_parameter',dict(field='axisAngleDeg',values=[0,45,90]));self.assertEqual(workspace.state,s)
        for target,value,expected in [('maximum',None,12),('minimum',None,0),('half_power',None,6),('power',3,3)]:
            w=SceneWorkspace(s);w.execute('solve_target',dict(target=target,value=value,apply=False));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,value=value,apply=True));self.assertAlmostEqual(malus_values(w.state['parameters'])['outputPowerMw'],expected)
            for field in ['powerMw','inputAngleDeg']:self.assertEqual(w.state['parameters'][field],s['parameters'][field])
        with self.assertRaises(ValueError):SceneWorkspace(s,allow_edit=False).execute('solve_target',dict(target='maximum',apply=True))
        for value in [13,-1,True]:
            with self.assertRaises(ValueError):malus_target(s['parameters'],'power',value)
        with self.assertRaises(ValueError):malus_target(state(powerMw=0)['parameters'],'power',0)

if __name__=='__main__':unittest.main()

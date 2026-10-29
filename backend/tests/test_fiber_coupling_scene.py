import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS,calculate,solve_formula
from backend.scene_fiber_coupling import coupling_values
from backend.scene_agent import SceneWorkspace

def state(**patch):
    return dict(version=1,sceneId='fiber-modes-1',parameters={**{f['key']:f['default'] for f in DEFINITIONS['fiber-modes-1']['parameters']},**patch})

class CouplingTests(unittest.TestCase):
    def test_reference_factors_and_units(self):
        p=state(beamRadiusUm=5,modeRadiusUm=5,offsetUm=0,tiltDeg=0)['parameters']
        self.assertEqual(coupling_values(p)['efficiency'],1)
        self.assertAlmostEqual(coupling_values({**p,'offsetUm':5})['efficiency'],math.exp(-1))
        self.assertAlmostEqual(coupling_values({**p,'beamRadiusUm':10})['efficiency'],.64)
        self.assertAlmostEqual(coupling_values({**p,'tiltDeg':2})['efficiency'],math.exp(-(math.pi*5*math.sin(math.radians(2))/1.55)**2))
        b=coupling_values(state()['parameters']);self.assertAlmostEqual(b['efficiency'],b['sizePct']*b['positionPct']*b['anglePct']/1e6)
        self.assertAlmostEqual(b['lossDb'],-10*math.log10(b['efficiency']))
    def test_api_and_formula_units(self):
        s=state();client=TestClient(app);r=client.post('/api/scenes/calculate',json=dict(state=s,revision='coupling-check'))
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['revision'],'coupling-check');self.assertEqual(r.json()['input'],s)
        for p in [dict(tiltDeg=6),dict(offsetUm=16),dict(modeRadiusUm=0),dict(powerMw=True)]:self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=state(**p))).status_code,422)
        p=s['parameters'];eta=coupling_values(p)['efficiencyPct']
        v=dict(w=p['beamRadiusUm'],wf=p['modeRadiusUm'],d=p['offsetUm'],theta=p['tiltDeg'],**{'lambda':p['wavelengthNm']})
        self.assertAlmostEqual(solve_formula('fiber-coupling-efficiency','eta',v)['values'][0],eta)
        values=dict(Pin=2,eta=50,Pout=1)
        for k in values:self.assertAlmostEqual(solve_formula('fiber-coupled-power',k,{key:value for key,value in values.items() if key!=k})['values'][0],values[k])
        with self.assertRaises(ValueError):solve_formula('fiber-coupled-power','eta',dict(Pin=1,Pout=2))
        with self.assertRaises(ValueError):solve_formula('fiber-coupled-power','Pin',dict(eta=0,Pout=0))
    def test_ai_targets_and_readonly_compare(self):
        s=state();w=SceneWorkspace(s);rows=w.execute('compare_parameter',dict(field='offsetUm',values=[0,2,5]))['rows']
        self.assertEqual(w.state,s);self.assertGreater(rows[0]['result']['metrics'][0]['value'],rows[2]['result']['metrics'][0]['value'])
        for target,keys in [('align',{'offsetUm','tiltDeg'}),('match_size',{'beamRadiusUm'}),('best_coupling',{'offsetUm','tiltDeg','beamRadiusUm'})]:
            w=SceneWorkspace(s);w.execute('solve_target',dict(target=target,apply=False));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,apply=True))
            for k,value in s['parameters'].items():
                if k not in keys:self.assertEqual(w.state['parameters'][k],value)
            if target=='best_coupling':self.assertAlmostEqual(coupling_values(w.state['parameters'])['efficiency'],1)
        w=SceneWorkspace(s,allow_edit=False)
        with self.assertRaises(ValueError):w.execute('solve_target',dict(target='align',apply=True))

if __name__=='__main__':unittest.main()

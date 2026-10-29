import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS, calculate, solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_fiber_modes import fiber_values, CUTOFF


def state(**patch):
    return dict(version=1,sceneId='fiber-modes-0',parameters={**{f['key']:f['default'] for f in DEFINITIONS['fiber-modes-0']['parameters']},**patch})


class FiberModesTests(unittest.TestCase):
    def test_reference_values_and_physical_boundaries(self):
        p=state(coreIndex=1.45,claddingIndex=1.44,radiusUm=5,wavelengthNm=1000)['parameters'];b=fiber_values(p)
        na=math.sqrt(1.45**2-1.44**2)
        self.assertAlmostEqual(b['na'],na)
        self.assertAlmostEqual(b['v'],10*math.pi*na)
        self.assertAlmostEqual(math.sin(math.radians(b['internalDeg']))*1.45,math.sin(math.radians(5)))
        for offset,expected in [(-1e-6,'guided'),(0,'critical'),(1e-6,'escaping')]:
            self.assertEqual(fiber_values({**p,'angleDeg':b['acceptanceDeg']+offset})['rayStatus'],expected)
        for factor,expected in [(.99,'多模'),(1,'截止边界'),(1.01,'单模')]:
            self.assertEqual(fiber_values({**p,'wavelengthNm':b['cutoffNm']*factor})['mode'],expected)
        for n2 in [1.45,1.47]:
            result=calculate(state(coreIndex=1.45,claddingIndex=n2));self.assertIsNone(result['metrics'][0]['value']);self.assertTrue(all(r['y'] is None for r in result['curve']))

    def test_api_units_invalid_parameters_and_formula_inverses(self):
        client=TestClient(app);s=state();r=client.post('/api/scenes/calculate',json=dict(state=s,revision='fiber-reference'))
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['input'],s);self.assertEqual(r.json()['revision'],'fiber-reference')
        for patch in [dict(radiusUm=0),dict(wavelengthNm=0),dict(coreIndex=True),dict(angleDeg=31)]:self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=state(**patch))).status_code,422)
        b=fiber_values(s['parameters']);values=dict(n1=1.46,n2=1.455,NA=b['na'])
        for target in values:self.assertAlmostEqual(solve_formula('fiber-na',target,{k:v for k,v in values.items() if k!=target})['values'][0],values[target])
        values=dict(a=4.1,NA=b['na'],V=b['v'],**{'lambda':1550})
        for target in values:self.assertAlmostEqual(solve_formula('fiber-v',target,{k:v for k,v in values.items() if k!=target})['values'][0],values[target])
        values=dict(a=4.1,NA=b['na'],lambdaC=b['cutoffNm'])
        for target in values:self.assertAlmostEqual(solve_formula('fiber-cutoff',target,{k:v for k,v in values.items() if k!=target})['values'][0],values[target])
        with self.assertRaises(ValueError):solve_formula('fiber-na','NA',dict(n1=1.44,n2=1.45))

    def test_ai_comparisons_are_readonly_and_targets_modify_only_requested_field(self):
        s=state();w=SceneWorkspace(s);scan=w.execute('compare_parameter',dict(field='angleDeg',values=[0,5,15]))
        self.assertEqual(w.state,s);self.assertEqual(len(scan['rows']),3)
        self.assertEqual([r['result']['metrics'][5]['value'] for r in scan['rows']],[fiber_values(s['parameters'])['v']]*3)
        for target,key in [('accepted_ray','angleDeg'),('single_mode','radiusUm')]:
            w=SceneWorkspace(s);w.execute('solve_target',dict(target=target,apply=False));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,apply=True))
            for k,value in s['parameters'].items():
                if k!=key:self.assertEqual(w.state['parameters'][k],value)
            b=fiber_values(w.state['parameters']);self.assertEqual(b['rayStatus'],'guided') if key=='angleDeg' else self.assertAlmostEqual(b['v'],2)
        readonly=SceneWorkspace(s,allow_edit=False)
        with self.assertRaises(ValueError):readonly.execute('solve_target',dict(target='single_mode',apply=True))
        no_guide=SceneWorkspace(state(claddingIndex=1.46))
        with self.assertRaises(ValueError):no_guide.execute('solve_target',dict(target='accepted_ray',apply=True))
        self.assertEqual(no_guide.state,state(claddingIndex=1.46))
        self.assertGreater(CUTOFF,2.4)


if __name__=='__main__':unittest.main()

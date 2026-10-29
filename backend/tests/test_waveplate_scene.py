import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import DEFINITIONS, calculate, solve_formula
from backend.scene_waveplate import waveplate_values, waveplate_target
from backend.scene_agent import SceneWorkspace

def state(**patch):return dict(version=1,sceneId='polarization-1',parameters={**{f['key']:f['default'] for f in DEFINITIONS['polarization-1']['parameters']},**patch})

class WaveplateTests(unittest.TestCase):
    def test_independent_rotation_ellipse_power_and_degeneracy(self):
        for alpha in [0,15,45,90,180]:
            for beta in [0,22.5,45,90,135,180]:
                p=state(inputAngleDeg=alpha,axisAngleDeg=beta)['parameters'];h=waveplate_values({**p,'plateType':1});q=waveplate_values(p)
                expected=math.radians(2*(2*beta-alpha));self.assertAlmostEqual(h['s1'],math.cos(expected));self.assertAlmostEqual(h['s2'],math.sin(expected));self.assertEqual(h['axisRatio'],0)
                theta=math.radians(alpha-beta);self.assertAlmostEqual(q['s3'],-math.sin(2*theta));self.assertAlmostEqual(q['s1']**2+q['s2']**2+q['s3']**2,1)
                self.assertEqual(q['outputPowerMw'],10)
        q=waveplate_values(state()['parameters']);self.assertEqual(q['polarization'],'圆偏振');self.assertIsNone(q['majorAngleDeg']);self.assertEqual(q['rotation'],'顺时针')
        self.assertEqual(waveplate_values(state(axisAngleDeg=135)['parameters'])['rotation'],'逆时针')
        off=calculate(state(powerMw=0));self.assertEqual(off['status'],'光源关闭');self.assertTrue(all(point['y'] is None for point in off['curve']))
        self.assertAlmostEqual(calculate(state())['chart']['currentY'],1)

    def test_api_formula_and_input_domains(self):
        client=TestClient(app);s=state();r=client.post('/api/scenes/calculate',json=dict(state=s,revision='waveplate-check'));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['input'],s)
        for patch in [dict(powerMw=-1),dict(axisAngleDeg=181),dict(inputAngleDeg=True),dict(plateType=.5)]:self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=state(**patch))).status_code,422)
        for alpha in [0,17,90,180]:
            for beta in [0,22.5,45,135,180]:
                for kind,delta in [(0,90),(1,180)]:
                    b=waveplate_values(state(inputAngleDeg=alpha,axisAngleDeg=beta,plateType=kind)['parameters']);r=solve_formula('waveplate-s3','S3',dict(alpha=alpha,beta=beta,delta=delta));self.assertAlmostEqual(r['values'][0],b['s3'])
        with self.assertRaises(ValueError):solve_formula('waveplate-s3','alpha',dict(beta=45,delta=90,S3=1))

    def test_ai_targets_do_not_change_source_or_plate(self):
        for kind,target,value in [(0,'circular',None),(0,'linear',None),(1,'direction',100),(1,'linear',None)]:
            s=state(plateType=kind,inputAngleDeg=17,powerMw=12);w=SceneWorkspace(s)
            w.execute('compare_parameter',dict(field='axisAngleDeg',values=[0,22.5,45]));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,value=value,apply=False));self.assertEqual(w.state,s)
            w.execute('solve_target',dict(target=target,value=value,apply=True));b=waveplate_values(w.state['parameters'])
            self.assertEqual(b['polarization'],'圆偏振' if target=='circular' else '线偏振')
            if target=='direction':self.assertAlmostEqual(b['majorAngleDeg'],value)
            for key in ['plateType','inputAngleDeg','powerMw']:self.assertEqual(w.state['parameters'][key],s['parameters'][key])
        for p,target,value in [(state(plateType=1)['parameters'],'circular',None),(state()['parameters'],'direction',45),(state(powerMw=0)['parameters'],'circular',None),(state(plateType=1)['parameters'],'direction',True)]:
            with self.assertRaises(ValueError):waveplate_target(p,target,value)
        with self.assertRaises(ValueError):SceneWorkspace(state(),allow_edit=False).execute('solve_target',dict(target='circular',apply=True))

if __name__=='__main__':unittest.main()

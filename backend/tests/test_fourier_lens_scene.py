import unittest
import math
import random
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate,solve_formula
from backend.scene_fourier_lens import fourier_values,fourier_at
from backend.scene_agent import SceneWorkspace
from backend.tests.test_scene_physics import state


class FourierLensTests(unittest.TestCase):
    def test_independent_input_field_quadrature(self):
        rng=random.Random(904)
        for _ in range(18):
            p=state('spatial-spectrum-0',waistMm=rng.uniform(.5,2),periodMm=rng.uniform(.08,.4),modulation=rng.uniform(0,1),wavelengthNm=rng.uniform(380,780),focalLengthMm=rng.uniform(80,250)).parameters
            b=fourier_values(p);x=rng.choice([0,b['orderPositionUm'],b['orderPositionUm']+b['spotRadiusUm']*.7,b['spotRadiusUm']*.3])
            nu=x*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
            n=8192;left=-6*p['waistMm'];step=12*p['waistMm']/n
            def integral(freq):
                def fun(t):return math.exp(-(t/p['waistMm'])**2)*(1+p['modulation']*math.cos(2*math.pi*t/p['periodMm']))*math.cos(2*math.pi*freq*t)
                return step/3*(fun(left)+fun(-left)+sum((4 if i%2 else 2)*fun(left+i*step) for i in range(1,n)))
            self.assertAlmostEqual((integral(nu)/integral(0))**2,fourier_at(p,x)['intensity'],places=11)
            self.assertEqual(fourier_at(p,x,23)['intensity'],fourier_at(p,-x,-23)['intensity'])

    def test_units_inverse_formula_and_unmodulated_limit(self):
        p=state('spatial-spectrum-0').parameters;b=fourier_values(p)
        for formula,values in [('fourier-position',{'lambda':532,'f':120,'d':.16,'x1':b['orderPositionUm']}),('fourier-width',{'lambda':532,'f':120,'w':.8,'wF':b['spotRadiusUm']})]:
            for target in values:self.assertAlmostEqual(solve_formula(formula,target,{k:v for k,v in values.items() if k!=target})['values'][0],values[target],places=10)
        v=dict(d=.16,w=.8,m=1,f=120,xF=b['orderPositionUm'],**{'lambda':532})
        self.assertAlmostEqual(solve_formula('fourier-intensity','J',v)['values'][0],.25,places=10)
        p['modulation']=0
        self.assertAlmostEqual(fourier_at(p,b['spotRadiusUm'])['intensity'],math.exp(-2),places=13)
        old=fourier_at(p,21);p['periodMm']=.4;self.assertEqual(old,fourier_at(p,21))

    def test_assistant_targets_comparison_and_read_only(self):
        source=state('spatial-spectrum-0').model_dump();w=SceneWorkspace(source);x=fourier_values(source['parameters'])['orderPositionUm']
        candidate=w.execute('solve_target',dict(target='positive_order',apply=False))['candidate'];self.assertEqual(w.state,source)
        w.execute('solve_target',dict(target='positive_order',apply=True));self.assertEqual(w.state,candidate);self.assertEqual(w.state['parameters']['observationUm'],x)
        for key in source['parameters']:
            if key!='observationUm':self.assertEqual(w.state['parameters'][key],source['parameters'][key])
        readonly=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError):readonly.execute('solve_target',dict(target='positive_order',apply=True))
        scan=readonly.execute('compare_parameter',dict(field='periodMm',values=[.1,.2,.4]));self.assertEqual(readonly.state,source)
        positions=[next(m['value'] for m in row['result']['metrics'] if m['key']=='orderPositionUm') for row in scan['rows']];self.assertAlmostEqual(positions[0],2*positions[1]);self.assertAlmostEqual(positions[1],2*positions[2])
        no_stripes=SceneWorkspace(state('spatial-spectrum-0',modulation=0).model_dump())
        with self.assertRaises(ValueError):no_stripes.execute('solve_target',dict(target='positive_order',apply=True))

    def test_api_identity_and_validation(self):
        client=TestClient(app);s=state('spatial-spectrum-0',observationUm=27.123456789).model_dump()
        r=client.post('/api/scenes/calculate',json=dict(state=s,revision='fourier-check'));self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['input'],s);self.assertEqual(r.json()['revision'],'fourier-check');self.assertEqual(r.json()['model'],'fourier-lens')
        self.assertEqual(calculate(state('spatial-spectrum-0'))['chart']['currentY'],1)
        s['parameters']['modulation']=True;self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)

    def test_gaussian_builder_copy_matches_focal_spectrum_radius(self):
        from backend.spatial import SpatialElement,SpatialExperiment,trace
        for f,w in [(80,.5),(250,2)]:
            p=state('spatial-spectrum-0',focalLengthMm=f,waistMm=w,modulation=0).parameters
            doc=SpatialExperiment(schemaVersion=2,name='Fourier Gaussian',elements=[SpatialElement(kind='laser',id='source',name='source',position=[40,60,0],beamModel='gaussian',beamRadiusMm=w,wavelengthNm=532,rayCount=101),SpatialElement(kind='lens',id='lens',name='lens',position=[40+f,60,0],focalLengthMm=f,diameterMm=60),SpatialElement(kind='screen',id='screen',name='screen',position=[40+2*f,60,0],diameterMm=40)])
            result=trace(doc);self.assertEqual(len(result['screens']),1)
            self.assertAlmostEqual(result['screens'][0]['gaussianRadiusMm']*1000,fourier_values(p)['spotRadiusUm'],places=9)

if __name__=='__main__':unittest.main()

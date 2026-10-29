import math
import random
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate,solve_formula
from backend.scene_four_f import FourF
from backend.scene_agent import SceneWorkspace
from backend.tests.test_scene_physics import state


class FourFTests(unittest.TestCase):
    def test_independent_spatial_convolution(self):
        # Independent route: integrate the INPUT field against the mask's sinc kernel.
        rng=random.Random(4104)
        for _ in range(12):
            p=state('spatial-spectrum-1',waistMm=rng.uniform(.5,2),periodMm=rng.uniform(.08,.4),modulation=rng.uniform(0,1),focalLengthMm=rng.uniform(80,130),wavelengthNm=rng.uniform(380,780),filterWidthUm=rng.uniform(10,800),filterOffsetUm=rng.uniform(-600,600),filterMode=rng.choice([0,1])).parameters
            x=rng.uniform(-2,2);b=FourF(p)
            bandwidth=p['filterWidthUm']*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
            center=p['filterOffsetUm']*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
            n=16384;left=-6*p['waistMm'];h=-2*left/n;total=0j
            for i in range(n+1):
                t=left+i*h;z=t+x
                kernel=bandwidth if abs(z)<1e-12 else math.sin(math.pi*bandwidth*z)/(math.pi*z)
                phase=-2*math.pi*center*z
                u=math.exp(-(t/p['waistMm'])**2)*(1+p['modulation']*math.cos(2*math.pi*t/p['periodMm']))/(1+p['modulation'])
                total+=(1 if i in (0,n) else 4 if i%2 else 2)*u*kernel*complex(math.cos(phase),math.sin(phase))
            total*=h/3
            if p['filterMode']==1:total=b.input(-x)-total
            self.assertLess(abs(b.amplitude(x)-total),3e-7)

    def test_power_complement_all_pass_and_common_intensity_scale(self):
        for m,w,width,c in [(1,.8,200,0),(0,2,10,0),(.6,.5,5000,0),(.3,1,150,300)]:
            p=state('spatial-spectrum-1',modulation=m,waistMm=w,filterWidthUm=width,filterOffsetUm=c).parameters
            passed=FourF(p);blocked=FourF({**p,'filterMode':1});full=FourF({**p,'filterMode':2})
            self.assertAlmostEqual(passed.transmission+blocked.transmission,1,places=14)
            for x in [0,.04,.29,1.5,3]:
                self.assertAlmostEqual(abs(passed.amplitude(x)+blocked.amplitude(x)-full.input(-x)),0,places=14)
                self.assertAlmostEqual(full.at(x),full.input(-x)**2,places=14)
                self.assertAlmostEqual(passed.at(x,.3),passed.at(x)*math.exp(-2*(.3/w)**2),places=14)
        p=state('spatial-spectrum-1').parameters
        self.assertAlmostEqual(FourF(p).transmission,2/3,places=12)
        self.assertAlmostEqual(FourF(p).at(0),.25,places=6)
        self.assertAlmostEqual(FourF({**p,'filterMode':1}).transmission,1/3,places=12)
        self.assertEqual(FourF({**p,'filterMode':2}).at(0),1)

    def test_independent_power_integral_and_no_stripe_invariance(self):
        for width,c in [(10,0),(120,390),(800,0),(5000,2200)]:
            p=state('spatial-spectrum-1',filterWidthUm=width,filterOffsetUm=c).parameters;b=FourF(p)
            scale=p['wavelengthNm']*1e-6*p['focalLengthMm'];alpha=math.pi*p['waistMm']
            def spectral(nu):return (math.exp(-(alpha*nu)**2)+.5*math.exp(-(alpha*(nu-1/p['periodMm']))**2)+.5*math.exp(-(alpha*(nu+1/p['periodMm']))**2))**2
            def integrate(a,z):
                n=32768;h=(z-a)/n
                return h/3*(spectral(a)+spectral(z)+sum((4 if i%2 else 2)*spectral(a+i*h) for i in range(1,n)))
            self.assertAlmostEqual(b.transmission,integrate(b.lo,b.hi)/integrate(-45,45),places=9)
        p=state('spatial-spectrum-1',modulation=0).parameters
        self.assertEqual(FourF(p).at(.4),FourF({**p,'periodMm':.4}).at(.4))

    def test_formula_inverse_api_and_assistant(self):
        p=state('spatial-spectrum-1').parameters;b=FourF(p)
        for fid,values in [('four-f-length',{'f':120,'L':480}),('four-f-bandwidth',{'lambda':532,'f':120,'a':200,'nu':200*.001/(2*b.scale)})]:
            for key,value in values.items():self.assertAlmostEqual(solve_formula(fid,key,{k:v for k,v in values.items() if k!=key})['values'][0],value,places=10)
        values=dict(d=.16,w=.8,m=1,f=120,a=200,c=0,mode=0,x=0,**{'lambda':532})
        self.assertAlmostEqual(solve_formula('four-f-output','J',values)['values'][0],b.at(0),places=12)
        with self.assertRaises(ValueError):solve_formula('four-f-output','J',{**values,'mode':.5})
        source=state('spatial-spectrum-1').model_dump()
        for target in ['low_pass','high_pass','all_pass','positive_order']:
            w=SceneWorkspace(source);w.execute('solve_target',dict(target=target,apply=True))
            for key in p:
                if key not in ['filterMode','filterWidthUm','filterOffsetUm']:self.assertEqual(w.state['parameters'][key],p[key])
        w=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError):w.execute('solve_target',dict(target='high_pass',apply=True))
        w.execute('compare_parameter',dict(field='filterWidthUm',values=[100,400,1000]));self.assertEqual(w.state,source)
        with self.assertRaises(ValueError):SceneWorkspace(state('spatial-spectrum-1',modulation=0)).execute('solve_target',dict(target='positive_order',apply=True))
        client=TestClient(app);r=client.post('/api/scenes/calculate',json=dict(state=source,revision='4f-check'));self.assertEqual(r.status_code,200);self.assertEqual(r.json()['input'],source);self.assertEqual(r.json()['revision'],'4f-check')
        bad={**source,'parameters':{**p,'filterMode':.5}};self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=bad)).status_code,422)

    def test_existing_gaussian_builder_matches_equal_size_output(self):
        from backend.spatial import SpatialElement,SpatialExperiment,trace
        for f,w in [(80,.5),(130,2)]:
            doc=SpatialExperiment(schemaVersion=2,name='4f full pass',elements=[SpatialElement(kind='laser',id='s',name='s',position=[40,60,0],beamModel='gaussian',beamRadiusMm=w,wavelengthNm=532,rayCount=101),SpatialElement(kind='lens',id='l1',name='l1',position=[40+f,60,0],focalLengthMm=f,diameterMm=60),SpatialElement(kind='lens',id='l2',name='l2',position=[40+3*f,60,0],focalLengthMm=f,diameterMm=60),SpatialElement(kind='screen',id='o',name='o',position=[40+4*f,60,0],diameterMm=40)])
            r=trace(doc);self.assertEqual(len(r['screens']),1);self.assertAlmostEqual(r['screens'][0]['gaussianRadiusMm'],w,places=11)


if __name__=='__main__':unittest.main()

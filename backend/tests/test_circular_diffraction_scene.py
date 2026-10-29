import itertools
import math
import random
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate,solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_circular_diffraction import circular_at,circular_radius,bessel_j1
from backend.tests.test_scene_physics import state

class CircularDiffractionTests(unittest.TestCase):
    def test_independent_disk_area_integration(self):
        # Integrate the projected circular pupil area instead of the Bessel angular identity.
        rng=random.Random(81)
        for _ in range(24):
            p=state('diffraction-1',wavelengthNm=rng.uniform(380,780),apertureDiameterMm=rng.uniform(1,8),focalLengthMm=rng.uniform(80,250),observationRadiusUm=rng.uniform(0,500)).parameters
            u=math.pi*p['apertureDiameterMm']*p['observationRadiusUm']*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
            n=8192;h=math.pi/2/n
            def integrand(t):return math.cos(t)**2*math.cos(u*math.sin(t))
            amplitude=4/math.pi*h/3*(integrand(0)+integrand(math.pi/2)+sum((4 if j%2 else 2)*integrand(j*h) for j in range(1,n)))
            self.assertAlmostEqual(amplitude**2,circular_at(p)['intensity'],places=11)
            self.assertEqual(circular_at(p,-p['observationRadiusUm'])['intensity'],circular_at(p)['intensity'])
        self.assertAlmostEqual(bessel_j1(1),.4400505857449335,places=13)
        self.assertAlmostEqual(bessel_j1(2),.5767248077568734,places=13)
    def test_parameter_corners_and_targets(self):
        for wavelength,D,f in itertools.product([380,532,780],[1,2,8],[80,120,250]):
            s=state('diffraction-1',wavelengthNm=wavelength,apertureDiameterMm=D,focalLengthMm=f)
            b=calculate(s);r=circular_radius(s.parameters)
            self.assertEqual(circular_at(s.parameters,0)['intensity'],1);self.assertEqual(circular_at(s.parameters,r)['intensity'],0)
            self.assertLess(r,500);self.assertTrue(all(0<=point['y']<=1 for point in b['curve']))
            metrics={m['key']:m['value'] for m in b['metrics']};self.assertEqual(metrics['airyDiameterUm'],2*r)
    def test_formula_units_inverse_and_limits(self):
        p=state('diffraction-1').parameters;v=dict(D=2,f=120,dA=2*circular_radius(p),**{'lambda':532})
        for target in ['dA','D','f','lambda']:
            self.assertAlmostEqual(solve_formula('circular-diameter',target,{k:val for k,val in v.items() if k!=target})['values'][0],v[target],places=10)
        r=circular_radius(p)
        self.assertEqual(solve_formula('circular-intensity','J',dict(D=2,f=120,r=r,**{'lambda':532}))['values'][0],0)
        self.assertAlmostEqual(solve_formula('circular-angle','theta',dict(f=120,r=r))['values'][0],math.degrees(math.atan(r*.001/120)))
        with self.assertRaises(ValueError):solve_formula('circular-intensity','J',dict(D=True,f=120,r=0,**{'lambda':532}))
    def test_assistant_target_read_only_and_comparison(self):
        source=state('diffraction-1').model_dump();w=SceneWorkspace(source)
        candidate=w.execute('solve_target',dict(target='first_dark',apply=False))['candidate'];self.assertEqual(w.state,source)
        w.execute('solve_target',dict(target='first_dark',apply=True));self.assertEqual(w.state,candidate)
        self.assertEqual(circular_at(w.state['parameters'])['intensity'],0)
        for key in ['wavelengthNm','apertureDiameterMm','focalLengthMm']:self.assertEqual(w.state['parameters'][key],source['parameters'][key])
        readonly=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError):readonly.execute('solve_target',dict(target='first_dark',apply=True))
        scan=readonly.execute('compare_parameter',dict(field='apertureDiameterMm',values=[1,2,4]));self.assertEqual(readonly.state,source)
        ds=[next(m['value'] for m in row['result']['metrics'] if m['key']=='airyDiameterUm') for row in scan['rows']]
        self.assertAlmostEqual(ds[0],2*ds[1]);self.assertAlmostEqual(ds[1],2*ds[2])
    def test_api_identity_and_validation(self):
        client=TestClient(app);s=state('diffraction-1',observationRadiusUm=39.123456789123).model_dump()
        r=client.post('/api/scenes/calculate',json=dict(state=s,revision='circular-check'));self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['input'],s);self.assertEqual(r.json()['revision'],'circular-check');self.assertEqual(r.json()['curve'][0],dict(x=0,y=1))
        s['parameters']['apertureDiameterMm']=0;self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)
    def test_existing_builder_geometric_focus(self):
        from backend.spatial import SpatialElement,SpatialExperiment,trace
        def e(kind,id,x,**kw):return SpatialElement(kind=kind,id=id,name=id,position=[x,60,0],**kw)
        for D,f in itertools.product([1,8],[80,250]):
            doc=SpatialExperiment(schemaVersion=2,name='圆孔焦平面',elements=[e('laser','source',20,beamRadiusMm=6,beamModel='parallel',divergenceMrad=0,rayCount=201),e('aperture','aperture',100,diameterMm=D),e('lens','lens',120,focalLengthMm=f,diameterMm=40),e('screen','screen',120+f,diameterMm=40)])
            result=trace(doc);self.assertEqual(result.get('diffraction',[]),[])
            self.assertEqual(len(result['screens']),1)
            self.assertGreater(result['screens'][0]['hits'],0)

if __name__=='__main__':unittest.main()

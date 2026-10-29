import cmath
import itertools
import math
import random
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate, solve_formula
from backend.scene_agent import SceneWorkspace
from backend.scene_single_slit import slit_at, slit_minimum
from backend.tests.test_scene_physics import state


class SingleSlitTests(unittest.TestCase):
    def test_independent_aperture_integration(self):
        # Independently sum the complex field emitted across a uniformly lit slit.
        rng = random.Random(14)
        for _ in range(24):
            p = state('diffraction-0',wavelengthNm=rng.uniform(380,780),slitWidthMm=rng.uniform(.02,.08),screenDistanceM=rng.uniform(.3,.8),observationMm=rng.uniform(-40,40)).parameters
            y=p['observationMm']; direction=y/math.hypot(p['screenDistanceM']*1000,y)
            n=6000
            amplitude=sum(cmath.exp(1j*math.tau*((j+.5)/n-.5)*p['slitWidthMm']*direction/(p['wavelengthNm']*1e-6)) for j in range(n))/n
            self.assertAlmostEqual(abs(amplitude)**2,slit_at(p)['intensity'],places=7)
            self.assertAlmostEqual(slit_at(p,-y)['intensity'],slit_at(p,y)['intensity'],places=13)

    def test_parameter_corners_and_dark_targets(self):
        for wavelength,a,L in itertools.product([380,532,780],[.02,.05,.08],[.3,.5,.8]):
            s=state('diffraction-0',wavelengthNm=wavelength,slitWidthMm=a,screenDistanceM=L)
            result=calculate(s); values={m['key']:m['value'] for m in result['metrics']}
            self.assertLessEqual(values['fresnelNumber'],.1)
            self.assertEqual(slit_at(s.parameters,0)['intensity'],1)
            for sign in [-1,1]:
                point=sign*slit_minimum(s.parameters)
                self.assertLess(abs(point),40)
                self.assertEqual(slit_at(s.parameters,point)['intensity'],0)
                self.assertAlmostEqual(slit_at(s.parameters,point)['cycles'],sign,places=12)
            self.assertAlmostEqual(values['centralWidthMm'],2*slit_minimum(s.parameters),places=13)
        self.assertAlmostEqual(slit_at(state('diffraction-0').parameters,0)['thetaDeg'],0)

    def test_formula_units_and_inverse(self):
        p=state('diffraction-0').parameters; w=2*slit_minimum(p)
        vals=dict(a=.05,L=.5,w=w,**{'lambda':532})
        for target in ['w','a','L','lambda']:
            self.assertAlmostEqual(solve_formula('single-slit-width',target,{k:v for k,v in vals.items() if k!=target})['values'][0],vals[target],places=10)
        y=slit_minimum(p)
        self.assertEqual(solve_formula('single-slit-intensity','J',dict(a=.05,L=.5,y=y,**{'lambda':532}))['values'][0],0)
        self.assertAlmostEqual(solve_formula('single-slit-angle','theta',dict(L=.5,y=y))['values'][0],math.degrees(math.asin(532e-6/.05)))
        with self.assertRaises(ValueError): solve_formula('single-slit-intensity','J',dict(a=True,L=.5,y=0,**{'lambda':532}))

    def test_assistant_edits_comparisons_and_read_only(self):
        source=state('diffraction-0').model_dump(); w=SceneWorkspace(source)
        candidate=w.execute('solve_target',dict(target='first_dark',apply=False))['candidate']
        self.assertEqual(w.state,source)
        w.execute('solve_target',dict(target='first_dark',apply=True))
        self.assertEqual(w.state,candidate)
        self.assertEqual(slit_at(w.state['parameters'])['intensity'],0)
        for key in ['wavelengthNm','slitWidthMm','screenDistanceM']: self.assertEqual(w.state['parameters'][key],source['parameters'][key])
        read=SceneWorkspace(source,allow_edit=False)
        with self.assertRaises(ValueError): read.execute('solve_target',dict(target='first_dark',apply=True))
        scan=read.execute('compare_parameter',dict(field='slitWidthMm',values=[.025,.05,.075]))
        widths=[next(m['value'] for m in row['result']['metrics'] if m['key']=='centralWidthMm') for row in scan['rows']]
        self.assertTrue(widths[0]>widths[1]>widths[2]); self.assertEqual(read.state,source)

    def test_api_preserves_precision_and_rejects_invalid(self):
        c=TestClient(app); s=state('diffraction-0',observationMm=1.2345678912345).model_dump()
        r=c.post('/api/scenes/calculate',json=dict(state=s,revision='slit-check'))
        self.assertEqual(r.status_code,200); self.assertEqual(r.json()['input'],s)
        self.assertEqual(r.json()['revision'],'slit-check')
        curve=r.json()['curve']; self.assertEqual(curve[800],dict(x=0,y=1)); self.assertTrue(all(0<=p['y']<=1 for p in curve))
        s['parameters']['slitWidthMm']=.2
        self.assertEqual(c.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)

    def test_builder_copy_has_same_diffraction_profile(self):
        from backend.spatial import SpatialElement, SpatialExperiment, trace
        for wavelength,a,L in itertools.product([380,780],[.02,.08],[.3,.8]):
            p=state('diffraction-0',wavelengthNm=wavelength,slitWidthMm=a,screenDistanceM=L).parameters
            def e(kind,id,position,**kw): return SpatialElement(kind=kind,id=id,name=id,position=position,**kw)
            doc=SpatialExperiment(schemaVersion=2,name='单缝衍射',elements=[
                e('laser','slit-source',[20,60,0],wavelengthNm=wavelength,beamRadiusMm=.8,beamModel='parallel',divergenceMrad=0,rayCount=201),
                e('slit','single-slit',[100,60,0],slitWidthMm=a,slitHeightMm=20,rollDeg=90),
                e('screen','slit-screen',[100+L*1000,60,0],diameterMm=100)])
            result=trace(doc);self.assertEqual(len(result['diffraction']),1)
            profile=result['diffraction'][0]
            self.assertAlmostEqual(profile['centralMaximumWidthMm'],2*slit_minimum(p),places=12)
            for point in profile['points']:self.assertAlmostEqual(point['intensity'],slit_at(p,point['xMm'])['intensity'],places=12)


if __name__=='__main__': unittest.main()

import copy
import json
import math
import random
import unittest
from backend.scene_physics import DEFINITIONS,calculate,solve_formula
from backend.scene_aperture import aperture_geometry,circle_overlap,trace_biconvex,lens_dimensions,cauchy_index,thick_lens,spherical_spots,best_geometric_screen
from backend.scene_agent import SceneWorkspace
from backend.tests.test_scene_physics import state


class ApertureSceneTests(unittest.TestCase):
    def metric(self,result,key):return next(m['value'] for m in result['metrics'] if m['key']==key)

    def test_actual_stop_and_real_virtual_infinite_pupils(self):
        result=calculate(state('aberrations-0'))
        for key,value in [('entrancePosition',100),('entranceDiameter',24),('exitPosition',50),('exitDiameter',12),('throughput',16)]:self.assertAlmostEqual(self.metric(result,key),value)
        result=calculate(state('aberrations-0',z=-50))
        self.assertEqual(self.metric(result,'entrancePosition'),-50)
        self.assertEqual(self.metric(result,'exitPosition'),-100)
        self.assertEqual(self.metric(result,'exitDiameter'),24)
        result=calculate(state('aberrations-0',z=-120,stopD=6))
        self.assertAlmostEqual(self.metric(result,'exitPosition'),600)
        result=calculate(state('aberrations-0',z=100,stopD=6))
        self.assertIsNone(self.metric(result,'entrancePosition'));self.assertIsNone(self.metric(result,'entranceDiameter'))
        self.assertEqual(self.metric(result,'exitPosition'),100)
        result=calculate(state('aberrations-0',z=200))
        self.assertEqual(self.metric(result,'apertureStop'),0)
        self.assertEqual(self.metric(result,'throughput'),100)
        self.assertEqual(self.metric(result,'entranceDiameter'),40)
        self.assertEqual(self.metric(result,'exitPosition'),0)
        self.assertEqual(self.metric(result,'v'),200)

    def test_circular_overlap_agrees_with_independent_area_integration(self):
        for r,q,d in [(20,8,0),(20,8,20),(5,5,5),(20,40,45)]:
            # Integrate the vertical intersections of circles along x; separate from closed form.
            steps=20000;lo=max(-r,d-q);hi=min(r,d+q);dx=(hi-lo)/steps
            numerical=sum(2*min(math.sqrt(max(0,r*r-x*x)),math.sqrt(max(0,q*q-(x-d)**2)))*dx for x in (lo+(j+.5)*dx for j in range(steps)))
            self.assertAlmostEqual(circle_overlap(r,q,d),numerical,delta=max(1e-4,numerical*2e-5))
        result=calculate(state('aberrations-0',h=60))
        self.assertGreater(self.metric(result,'throughput'),0);self.assertLess(self.metric(result,'throughput'),16)
        self.assertEqual(self.metric(calculate(state('aberrations-0',z=200,h=80)),'throughput'),0)

    def test_blocked_rays_stop_and_transmitted_rays_obey_both_apertures(self):
        for patch in ({},{'z':-50,'h':40},{'h':60},{'stopD':2,'h':17},{'z':200,'h':80}):
            result=calculate(state('aberrations-0',**patch));p=result['input']['parameters']
            passed=[s for s in result['segments'] if s['role']=='transmitted']
            if self.metric(result,'throughput')>0:self.assertTrue(passed)
            for ray in passed:
                x,y=ray['start'];x1,y1=ray['end'];slope=(y1-y)/(x1-x)
                ys=y+(p['z']-x)*slope if p['z']>=0 else None
                if ys is not None:self.assertLessEqual(abs(ys),p['stopD']/2+1e-8)
            for ray in [s for s in result['segments'] if s['role']=='blocked']:
                self.assertLessEqual(ray['end'][0],max(0,p['z'])+1e-8)

    def test_exact_surface_intersections_snell_and_paraxial_limit(self):
        p=state('aberrations-1').parameters;r,ap,t=lens_dimensions(p)
        n=cauchy_index(p['A'],p['B'],550)
        _,bfl=thick_lens(n,r,t)
        for height in (1e-4,ap/2,ap):
            ray=trace_biconvex(p,height,550);front,back=ray['front'],ray['back']
            self.assertAlmostEqual((front[0]-r)**2+front[1]**2,r*r)
            self.assertAlmostEqual((back[0]-(t-r))**2+back[1]**2,r*r)
            normal=((front[0]-r)/r,front[1]/r)
            sin_in=abs(normal[1]);sin_out=abs(ray['inside'][0]*normal[1]-ray['inside'][1]*normal[0])
            self.assertAlmostEqual(sin_in,n*sin_out)
            normal=((back[0]-(t-r))/r,back[1]/r)
            sin_in=abs(ray['inside'][0]*normal[1]-ray['inside'][1]*normal[0]);sin_out=abs(ray['outgoing'][0]*normal[1]-ray['outgoing'][1]*normal[0])
            self.assertAlmostEqual(n*sin_in,sin_out)
            self.assertAlmostEqual(sum(x*x for x in ray['outgoing']),1)
            opposite=trace_biconvex(p,-height,550)
            self.assertAlmostEqual(ray['focus'],opposite['focus'])
        self.assertAlmostEqual(trace_biconvex(p,1e-4,550)['focus'],bfl,places=7)
        self.assertLess(trace_biconvex(p,ap,550)['focus'],bfl)

    def test_spherical_chromatic_trends_and_rms_sampling_convergence(self):
        result=calculate(state('aberrations-1'));small=calculate(state('aberrations-1',diameter=10))
        self.assertGreater(self.metric(result,'longitudinalSA'),self.metric(small,'longitudinalSA'))
        self.assertGreater(self.metric(result,'chromaticShift'),0)
        self.assertEqual(self.metric(calculate(state('aberrations-1',B=0,mode=1)),'chromaticShift'),0)
        p=result['input']['parameters'];best=best_geometric_screen(p);_,minimum=spherical_spots({**p,'screen':best})
        for ds in (-1,.1,1):self.assertGreater(spherical_spots({**p,'screen':best+ds})[1],minimum)
        high=spherical_spots({**p,'screen':best},rings=1024)[1]
        self.assertAlmostEqual(minimum,high,delta=high*.002)
        for point in result['imagePreview']['points']:self.assertTrue(abs(point['x'])<=result['imagePreview']['extent'] and abs(point['y'])<=result['imagePreview']['extent'])

    def test_assistant_targets_and_comparison_preserve_snapshot(self):
        ws=SceneWorkspace(state('aberrations-0'));before=copy.deepcopy(ws.state)
        scan=ws.execute('compare_parameter',{'field':'stopD','values':[6,12,24]})
        self.assertEqual(ws.state,before)
        readings=[next(m['value'] for m in row['result']['metrics'] if m['key']=='throughput') for row in scan['rows']]
        self.assertEqual(readings,[4,16,64])
        ws.execute('solve_target',{'target':'entrance_pupil_position','value':150,'apply':True})
        self.assertEqual(ws.state['parameters']['z'],60)
        self.assertAlmostEqual(next(m['value'] for m in ws.evidence['metrics'] if m['key']=='entrancePosition'),150)
        before=copy.deepcopy(ws.state)
        with self.assertRaises(ValueError):ws.execute('solve_target',{'target':'entrance_pupil_position','value':-200,'apply':True})
        self.assertEqual(ws.state,before)
        ws=SceneWorkspace(state('aberrations-1'));before=copy.deepcopy(ws.state)
        ws.execute('compare_parameter',{'field':'B','values':[0,.004,.008]});self.assertEqual(ws.state,before)
        result=ws.execute('solve_target',{'target':'minimum_rms_screen','apply':True})
        self.assertEqual(result['evidence']['input'],ws.state)
        minimum=next(m['value'] for m in result['evidence']['metrics'] if m['key']=='rmsRadius')
        self.assertLess(minimum,self.metric(calculate(before),'rmsRadius'))
        self.assertEqual({k:v for k,v in before['parameters'].items() if k!='screen'},{k:v for k,v in ws.state['parameters'].items() if k!='screen'})

    def test_valid_ranges_presets_random_drawings_and_inverse_boundaries(self):
        rng=random.Random(20261004)
        for scene_id in ('aberrations-0','aberrations-1'):
            for _ in range(80):
                patch={p['key']:rng.choice(p['options'])['value'] if p.get('options') else rng.uniform(p['min'],p['max']) for p in DEFINITIONS[scene_id]['parameters']}
                result=calculate(state(scene_id,**patch));json.dumps(result,allow_nan=False)
                if scene_id=='aberrations-0':self.assertTrue(0<=self.metric(result,'throughput')<=100)
                else:self.assertIsNotNone(self.metric(result,'rmsRadius'))
        self.assertTrue(solve_formula('pupil-imaging','Dp',{'f':100,'up':100,'Ds':12})['infinite'])
        self.assertEqual(solve_formula('pupil-imaging','up',{'f':100,'Ds':12,'Dp':24})['values'],[50,150])
        self.assertTrue(solve_formula('aperture-effective','Dl',{'f':100,'u':200,'z':200,'Ds':12})['infinite'])
        for formula,target,values in [('cauchy-index','wavelength',{'A':1.5,'B':0,'n':1.5}),('lensmaker-thick','F',{'n':1.5,'R':10,'t':20}),('back-focal','bfl',{'F':20,'n':1.5,'R':10,'t':40})]:
            with self.assertRaises(ValueError):solve_formula(formula,target,values)

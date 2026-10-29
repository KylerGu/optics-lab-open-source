import json
import math
import random
import unittest
from backend.scene_physics import calculate, solve_formula
from backend.scene_geometrical import double_matrix, double_image
from backend.tests.test_scene_physics import state


class GeometricalSceneTests(unittest.TestCase):
    def metric(self,result,key):return next(m['value'] for m in result['metrics'] if m['key']==key)

    def test_microscope_performance_formula_reverses_and_defined_depth(self):
        for NA in [.1,.4,.95,1.3]:
            n=1 if NA<=1 else 1.515
            for wavelength in [380,550,780]:
                result=calculate(state('instruments-0',study=1,NA=NA,medium=n,wavelength=wavelength))
                self.assertAlmostEqual(self.metric(result,'resolution'),.61*wavelength/1000/NA)
                eye=calculate(state('instruments-0',study=3,mode=0,NA=NA,medium=n,wavelength=wavelength,depthCriterion=1))
                self.assertAlmostEqual(self.metric(eye,'depth'),n*wavelength/1000/NA**2)
                self.assertEqual(self.metric(eye,'geometricDepth'),0)
                result=calculate(state('instruments-0',study=3,mode=1,NA=NA,medium=n,wavelength=wavelength,depthCriterion=1))
                expected=n*wavelength/1000/NA**2+n*3.45/(10*NA)
                self.assertAlmostEqual(self.metric(result,'depth'),expected)
                self.assertAlmostEqual(self.metric(result,'halfDepth'),expected/2)
                known=dict(D=expected,n=n,NA=NA,lambda_=wavelength/1000,e=3.45,M=10)
                known['lambda']=known.pop('lambda_')
                for target in known:
                    solved=solve_formula('microscope-depth',target,{k:v for k,v in known.items() if k!=target})
                    self.assertAlmostEqual(solved['values'][0],known[target])
        with self.assertRaises(ValueError):calculate(state('instruments-0',NA=1.3,medium=1))
        with self.assertRaises(ValueError):solve_formula('microscope-depth','D',{'n':1,'NA':1.3,'lambda':.55,'e':0,'M':10})
        with self.assertRaises(ValueError):solve_formula('microscope-depth','M',{'D':3.4375,'n':1,'NA':.4,'lambda':.55,'e':0})

    def test_spherical_mirrors_real_virtual_and_infinite(self):
        for patch,v,m in [({},200,-1),({'u':60},-150,2.5),({'kind':-1},-200/3,1/3)]:
            result=calculate(state('paraxial-1',**patch))
            self.assertAlmostEqual(self.metric(result,'v'),v)
            self.assertAlmostEqual(self.metric(result,'m'),m)
            for ray in [s for s in result['segments'] if s['role']=='reflected']:
                x0,y0=ray['start'];x1,y1=ray['end']
                self.assertAlmostEqual(y0+(y1-y0)/(x1-x0)*(-v-x0),self.metric(result,'imageHeight'))
        self.assertIsNone(self.metric(calculate(state('paraxial-1',u=100)),'v'))

    def test_matrix_determinant_and_sequential_conjugates(self):
        for f1,f2,d,u in [(100,100,350,200),(100,100,100,200),(100,-50,90,200),(-100,100,150,200)]:
            result=double_image(f1,f2,d,u)
            a,b,c,dd=result['matrix']
            self.assertAlmostEqual(a*dd-b*c,1)
            v1=1/(1/f1-1/u);u2=d-v1;v2=1/(1/f2-1/u2)
            self.assertAlmostEqual(result['v'],v2)
            self.assertAlmostEqual(result['m'],(-v1/u)*(-v2/u2))
        result=calculate(state('paraxial-2'))
        self.assertAlmostEqual(self.metric(result,'v'),300)
        self.assertAlmostEqual(self.metric(result,'m'),2)
        rays=[s for s in result['segments'] if s['role']=='transmitted']
        for ray in rays:
            x0,y0=ray['start'];x1,y1=ray['end']
            self.assertAlmostEqual(y0+(y1-y0)/(x1-x0)*300,10)
        self.assertIsNone(self.metric(calculate(state('paraxial-2',d=300)),'v'))

    def test_microscope_relaxed_eye_finite_virtual_and_projection(self):
        result=calculate(state('instruments-0'))
        self.assertAlmostEqual(self.metric(result,'v1'),110)
        self.assertIsNone(self.metric(result,'v'))
        self.assertAlmostEqual(self.metric(result,'angularM'),-125)
        result=calculate(state('instruments-0',d=125))
        self.assertLess(self.metric(result,'v'),0)
        self.assertAlmostEqual(self.metric(result,'angularM'),-10*250/15)
        result=calculate(state('instruments-0',d=150))
        self.assertGreater(self.metric(result,'v'),0)
        self.assertIsNone(self.metric(result,'angularM'))
        self.assertTrue(any('投影' in w for w in result['warnings']))

    def test_microscope_camera_field_and_real_ray_focus(self):
        for f in [5,10,50]:
            for ft in [40,200,300]:
                for adapter in [.25,.5,2]:
                    for d in [40,130,300]:
                        result=calculate(state('instruments-0',mode=1,f1=f,u=f,tubeF=ft,adapter=adapter,d=d))
                        mag=ft/f*adapter
                        self.assertAlmostEqual(self.metric(result,'cameraM'),-mag)
                        self.assertAlmostEqual(self.metric(result,'fieldWidth')*mag,8.8)
                        self.assertAlmostEqual(self.metric(result,'fieldHeight')*mag,6.6)
                        self.assertAlmostEqual(self.metric(result,'fieldDiagonal'),11/mag)
                        self.assertAlmostEqual(self.metric(result,'v'),ft)
                        self.assertAlmostEqual(self.metric(result,'focusOffset'),0)
                        for ray in [s for s in result['segments'] if s['role']=='transmitted']:
                            self.assertAlmostEqual(ray['end'][0],d+ft)
                            self.assertAlmostEqual(ray['end'][1],-ft/f*.1)
                        self.assertFalse(any('未对焦' in w for w in result['warnings']))
        for u in [5,9,11,100]:
            result=calculate(state('instruments-0',mode=1,u=u))
            self.assertTrue(any('未对焦' in w for w in result['warnings']))
            self.assertFalse(any(m['role']=='image' for m in result['markers']))
            heights=[s['end'][1] for s in result['segments'] if s['role']=='transmitted']
            self.assertGreater(abs(heights[0]-heights[1]),1e-6)

    def test_microscope_camera_assistant_focus_uses_objective_focal_plane(self):
        from backend.scene_agent import SceneWorkspace
        workspace=SceneWorkspace(state('instruments-0',mode=1,u=11))
        before=workspace.state['parameters'].copy()
        with self.assertRaises(ValueError):workspace.execute('solve_target',dict(target='relaxed_eye',apply=True))
        workspace.execute('solve_target',dict(target='focus_sensor',apply=True))
        self.assertEqual(workspace.state['parameters'],{**before,'u':10,'defocus':0})
        self.assertAlmostEqual(next(m['value'] for m in workspace.evidence['metrics'] if m['key']=='focusOffset'),0)

    def test_microscope_view_field_and_camera_formulas(self):
        result=calculate(state('instruments-0'))
        self.assertAlmostEqual(self.metric(result,'fieldDiameter'),1.8)
        self.assertIsNone(self.metric(calculate(state('instruments-0',d=150)),'fieldDiameter'))
        values=dict(fo=10,ft=200,a=.5,M=10)
        for target in values:
            solved=solve_formula('microscope-camera-magnification',target,{k:v for k,v in values.items() if k!=target})
            self.assertAlmostEqual(solved['values'][0],values[target])
        values=dict(S=8.8,M=10,L=.88)
        for target in values:
            solved=solve_formula('microscope-camera-field',target,{k:v for k,v in values.items() if k!=target})
            self.assertAlmostEqual(solved['values'][0],values[target])

    def test_telescopes_afocal_magnification_and_misalignment(self):
        for patch,expected in [({},-200/30),({'k2':-1,'d':170},200/30)]:
            result=calculate(state('instruments-1',**patch))
            self.assertAlmostEqual(self.metric(result,'angularM'),expected)
            rays=[s for s in result['segments'] if s['role']=='transmitted']
            slopes=[(s['end'][1]-s['start'][1])/(s['end'][0]-s['start'][0]) for s in rays]
            self.assertAlmostEqual(max(slopes)-min(slopes),0)
            self.assertAlmostEqual(self.metric(result,'angularSpread'),0)
        result=calculate(state('instruments-1',d=250))
        self.assertIsNone(self.metric(result,'angularM'))
        self.assertGreater(self.metric(result,'angularSpread'),0)

    def test_camera_best_focus_and_aperture_scaling(self):
        result=calculate(state('instruments-2'))
        self.assertAlmostEqual(self.metric(result,'v'),400/7)
        self.assertAlmostEqual(self.metric(result,'blurDiameter'),0)
        blur=calculate(state('instruments-2',sensor=65))
        self.assertAlmostEqual(self.metric(blur,'blurDiameter'),1.71875)
        small=calculate(state('instruments-2',sensor=65,aperture=6.25))
        self.assertAlmostEqual(self.metric(small,'blurDiameter'),self.metric(blur,'blurDiameter')/2)
        ys=[s['end'][1] for s in blur['segments'] if s['role']=='transmitted']
        self.assertAlmostEqual(max(ys)-min(ys),self.metric(blur,'blurDiameter'))
        self.assertTrue(solve_formula('system-focal','F',{'f1':200,'f2':30,'d':230})['infinite'])
        self.assertEqual(len(solve_formula('camera-defocus','s',{'a':12.5,'v':400/7,'c':1.71875})['values']),2)

    def test_random_valid_geometry_states_produce_finite_drawings(self):
        from backend.scene_physics import DEFINITIONS
        rng=random.Random(314)
        for scene_id in ['paraxial-1','paraxial-2','instruments-0','instruments-1','instruments-2']:
            fields=DEFINITIONS[scene_id]['parameters']
            for _ in range(100):
                patch={p['key']:rng.choice(p['options'])['value'] if p.get('options') else rng.uniform(p['min'],p['max']) for p in fields}
                if scene_id=='instruments-0':patch['NA']=min(patch['NA'],patch['medium'])
                result=calculate(state(scene_id,**patch));json.dumps(result,allow_nan=False)
                for ray in result['segments']:
                    for value in ray['start']+ray['end']:self.assertTrue(math.isfinite(value))

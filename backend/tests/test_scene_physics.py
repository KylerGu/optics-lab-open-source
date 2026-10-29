import json
import math
import unittest
from backend.scene_physics import DEFINITIONS, FORMULAS, SceneState, calculate, fresnel, solve_formula


def state(scene_id, **patch):
    parameters={p['key']:p['default'] for p in DEFINITIONS[scene_id]['parameters']}
    return SceneState(sceneId=scene_id,parameters={**parameters,**patch})


class ScenePhysicsTests(unittest.TestCase):
    def metric(self,result,key): return next(m['value'] for m in result['metrics'] if m['key']==key)

    def test_snell_normal_incidence_energy_conservation(self):
        r=calculate(state('reflection-refraction-0',angle=0))
        self.assertAlmostEqual(self.metric(r,'R'),4)
        self.assertAlmostEqual(self.metric(r,'T'),96)
        self.assertEqual(self.metric(r,'transmittedAngle'),0)
        for n1,n2 in [(1,1.5),(1.5,1),(1.33,2.4),(1.5,1.5)]:
            for angle in (0,15,30,45,60,89.9):
                f=fresnel(n1,n2,angle)
                self.assertAlmostEqual(f['R']+f['T'],1)
                self.assertTrue(0<=f['R']<=1)
                if f['angle'] is not None: self.assertAlmostEqual(n1*math.sin(math.radians(angle)),n2*math.sin(math.radians(f['angle'])),places=10)

    def test_critical_grazing_and_tir_boundaries(self):
        critical=math.degrees(math.asin(2/3))
        r=calculate(state('reflection-refraction-1',angle=critical))
        self.assertEqual(self.metric(r,'transmittedAngle'),90)
        self.assertAlmostEqual(self.metric(r,'R'),100)
        r=calculate(state('reflection-refraction-1',angle=critical+.001))
        self.assertIsNone(self.metric(r,'transmittedAngle'))
        self.assertEqual(self.metric(r,'T'),0)
        self.assertEqual(len(r['segments']),2)
        r=calculate(state('reflection-refraction-1',n1=1,n2=1.5))
        self.assertIsNone(self.metric(r,'criticalAngle'))

    def test_prism_symmetric_path_and_ray_geometry(self):
        r=calculate(state('reflection-refraction-2'))
        self.assertAlmostEqual(self.metric(r,'r1'),30)
        self.assertAlmostEqual(self.metric(r,'r2'),30)
        self.assertAlmostEqual(self.metric(r,'deviation'),37.18075578145828)
        internal=r['segments'][1]
        self.assertAlmostEqual(internal['start'][1],internal['end'][1])
        self.assertAlmostEqual(self.metric(r,'deviation'),self.metric(r,'minimumDeviation'))
        for angle in (40,48.59037789072914,60):
            sample=calculate(state('reflection-refraction-2',angle=angle))
            self.assertGreaterEqual(self.metric(sample,'deviation')+1e-10,self.metric(sample,'minimumDeviation'))
        r=calculate(state('reflection-refraction-2',angle=10))
        self.assertIsNone(self.metric(r,'deviation'))
        self.assertIn('全反射',r['status'])
        r=calculate(state('reflection-refraction-2',n=1,outside=2.5,angle=80))
        self.assertIn('第一面全反射',r['status'])

    def test_lens_real_virtual_infinite_and_ray_intersections(self):
        for patch,expected_v,expected_m in [({},200,-1),({'u':60},-150,2.5),({'kind':-1},-200/3,1/3)]:
            r=calculate(state('paraxial-0',**patch))
            self.assertAlmostEqual(self.metric(r,'v'),expected_v)
            self.assertAlmostEqual(self.metric(r,'m'),expected_m)
            rays=[s for s in r['segments'] if s['role']=='transmitted']
            for ray in rays:
                x0,y0=ray['start'];x1,y1=ray['end']
                height=y0+(y1-y0)/(x1-x0)*(expected_v-x0)
                self.assertAlmostEqual(height,self.metric(r,'imageHeight'))
        r=calculate(state('paraxial-0',u=100))
        self.assertIsNone(self.metric(r,'v'))
        rays=[s for s in r['segments'] if s['role']=='transmitted']
        slopes=[(s['end'][1]-s['start'][1])/(s['end'][0]-s['start'][0]) for s in rays]
        self.assertAlmostEqual(*slopes)
        json.dumps(r,allow_nan=False)

    def test_formula_inverse_roundtrips_and_impossible_inputs(self):
        for formula in FORMULAS:
            values={f['key']:f['default'] for f in formula['fields']}
            for target in formula.get('targets',values):
                answer=solve_formula(formula['id'],target,{k:v for k,v in values.items() if k!=target})
                self.assertTrue(any(abs(a-values[target])<1e-7 for a in answer['values']),msg=f"{formula['id']} / {target}")
        self.assertTrue(solve_formula('thin-lens','v',{'f':100,'u':100})['infinite'])
        for formula,target,values in [('critical-angle','c',{'n1':1,'n2':1.5}),('snell-law','n1',{'n2':1.5,'i':0,'t':0}),('snell-law','t',{'n1':1.5,'n2':1,'i':60}),('thin-lens','v',{'f':0,'u':200}),('magnification','u',{'v':100,'m':0})]:
            with self.assertRaises(ValueError): solve_formula(formula,target,values)

    def test_validation_ranges_serialization_and_all_preset_boundaries(self):
        for scene_id,d in DEFINITIONS.items():
            for preset in d['presets']:
                json.dumps(calculate(state(scene_id,**preset['values'])),allow_nan=False)
            for field in d['parameters']:
                for value in (field['min'],field['max']):
                    patch={field['key']:value}
                    if scene_id=='instruments-0' and field['key']=='NA':patch['medium']=max(1,value)
                    if scene_id=='beam-transformation-1' and field['key']=='firstPositionMm':patch['secondPositionMm']=max(175,value+1)
                    if scene_id=='beam-transformation-1' and field['key']=='secondPositionMm':patch['firstPositionMm']=min(100,value-1)
                    json.dumps(calculate(state(scene_id,**patch)),allow_nan=False)
            for invalid in (True,float('nan'),float('inf')):
                with self.assertRaises(ValueError): state(scene_id,**{d['parameters'][0]['key']:invalid})
            with self.assertRaises(ValueError): state(scene_id,unknown=0)

import cmath
import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.scene_physics import calculate,solve_formula
from backend.scene_film_interference import thin_values,newton_values,gap_thickness,film_target,film_change_answer
from backend.scene_agent import SceneWorkspace
from backend.tests.test_scene_physics import state

class FilmTests(unittest.TestCase):
    def test_complex_multiple_bounce_reference_and_energy(self):
        for n,ns,angle in [(1.38,1.52,0),(1.333,1,25),(2.1,1,60),(1.05,2.2,60)]:
            for t in [0,1,100,499.123,1500]:
                p=state('interference-1',filmIndex=n,substrateIndex=ns,incidentAngleDeg=angle,thicknessNm=t).parameters
                b=thin_values(p); q0=math.cos(math.radians(angle)); q1=n*b['cosine']; q2=ns*math.sqrt(1-(math.sin(math.radians(angle))/ns)**2)
                phase=cmath.exp(1j*math.tau*n*b['cosine']*t/p['wavelengthNm'])
                # Independent sum of internal bounces, including both transmissions.
                amplitude=b['a']+4*q0*q1/(q0+q1)**2*b['b']*phase**2*sum((-b['a']*b['b']*phase**2)**k for k in range(60))
                self.assertAlmostEqual(abs(amplitude)**2,b['current']['reflectance'],places=12)
                transmission=(2*q0/(q0+q1))*(2*q1/(q1+q2))*phase/(1+b['a']*b['b']*phase**2)
                self.assertAlmostEqual(b['current']['reflectance']+q2/q0*abs(transmission)**2,1,places=12)
                if t==0:self.assertAlmostEqual(b['current']['reflectance'],((q0-q2)/(q0+q2))**2,places=12)

    def test_quarter_wave_cancellation_and_interface_phase(self):
        p=state('interference-1',filmIndex=math.sqrt(1.52),substrateIndex=1.52,incidentAngleDeg=0,thicknessNm=600/(4*math.sqrt(1.52))).parameters
        self.assertAlmostEqual(thin_values(p)['current']['reflectance'],0,places=12)
        soap={**p,'filmIndex':1.333,'substrateIndex':1,'thicknessNm':0};self.assertEqual(thin_values(soap)['current']['reflectance'],0)
        soap['thicknessNm']=600/(4*1.333);self.assertAlmostEqual(thin_values(soap)['current']['reflectance'],thin_values(soap)['max'])
        same={**p,'filmIndex':1.52};self.assertEqual(thin_values(same)['contrast'],0)
        with self.assertRaises(ValueError):film_target(same,'dark')

    def test_newton_contact_order_and_center_lift(self):
        p=state('interference-1',mode=1).parameters;n=newton_values(p);self.assertEqual(n['current']['intensity'],0)
        r=n['firstDarkRadiusMm'];self.assertAlmostEqual(r,math.sqrt(.6-.0003**2),places=12);self.assertEqual(n['at'](r)['intensity'],0)
        self.assertEqual(newton_values({**p,'centralGapNm':150})['current']['intensity'],1)
        self.assertIsNone(newton_values({**p,'centralGapNm':301})['firstDarkRadiusMm'])
        self.assertEqual(newton_values({**p,'centralGapNm':300})['firstDarkRadiusMm'],0)
        self.assertAlmostEqual(gap_thickness(p,1),500.0001250000625,places=9)
        # Complete sphere reconstructed independently from its height.
        for radius in [0,.001,.25,1,3]:
            sag=gap_thickness(p,radius)*1e-6
            self.assertAlmostEqual((p['curvatureRadiusMm']-sag)**2+radius**2,p['curvatureRadiusMm']**2,places=8)

    def test_targets_keep_other_settings_and_cover_boundaries(self):
        for mode in [0,1]:
            for index in range(20):
                p=state('interference-1',mode=mode,wavelengthNm=380+index*20,incidentAngleDeg=index*3,thicknessNm=index*75,gapIndex=1+index*.02,centralGapNm=index*50,observationRadiusMm=index*3/19).parameters
                for target in ['bright','dark']:
                    patch=film_target(p,target);candidate={**p,**patch}
                    for key in p:
                        if key not in patch:self.assertEqual(p[key],candidate[key])
                    if mode==0:
                        b=thin_values(candidate);self.assertAlmostEqual(b['current']['reflectance'],b['max' if target=='bright' else 'min'],places=10)
                    else:self.assertEqual(newton_values(candidate)['current']['intensity'],1 if target=='bright' else 0)
        with self.assertRaises(ValueError):film_target(p,'unknown')

    def test_formulas_units_and_no_imaginary_ring(self):
        self.assertAlmostEqual(solve_formula('film-path','delta',dict(n=1.5,t=100,theta=60))['values'][0],150)
        self.assertAlmostEqual(solve_formula('film-path','t',dict(n=1.5,delta=150,theta=60))['values'][0],100)
        t=solve_formula('newton-thickness','t',dict(R=1000,r=1,t0=125))['values'][0]
        self.assertAlmostEqual(solve_formula('newton-thickness','r',dict(R=1000,t=t,t0=125))['values'][0],1)
        for id,target,values in [('newton-thickness','r',dict(R=1000,t=100,t0=125)),('newton-dark-radius','r1',{'R':1000,'n':1,'lambda':600,'t0':301})]:
            with self.assertRaises(ValueError):solve_formula(id,target,values)
        self.assertAlmostEqual(solve_formula('film-reflection','reflectance',{'n':1.38,'ns':1.52,'theta0':0,'t':0,'lambda':600})['values'][0],((1-1.52)/(1+1.52))**2*100)

    def test_assistant_identity_and_readonly(self):
        for mode in [0,1]:
            source=state('interference-1',mode=mode).model_dump();w=SceneWorkspace(source);before=w.state.copy()
            candidate=w.execute('solve_target',dict(target='bright',apply=False));self.assertEqual(w.state,before)
            answer=w.execute('solve_target',dict(target='bright',apply=True));self.assertEqual(w.state,candidate['candidate']);self.assertTrue(answer['applied'])
            ro=SceneWorkspace(source,allow_edit=False)
            with self.assertRaises(ValueError):ro.execute('solve_target',dict(target='dark',apply=True))
            ro.execute('compare_parameter',dict(field='thicknessNm' if mode==0 else 'centralGapNm',values=[0,100,200]));self.assertEqual(ro.state,source)

    def test_api_state_and_full_curves(self):
        client=TestClient(app)
        for mode in [0,1]:
            s=state('interference-1',mode=mode).model_dump();response=client.post('/api/scenes/calculate',json=dict(state=s,revision='film-check'));self.assertEqual(response.status_code,200)
            data=response.json();self.assertEqual(data['input'],s);self.assertEqual(data['revision'],'film-check');self.assertEqual(len(data['curve']),1501)
            self.assertTrue(all(0<=v['y']<=100 if mode==0 else 0<=v['y']<=1 for v in data['curve']))
            s['parameters']['mode']=True;self.assertEqual(client.post('/api/scenes/calculate',json=dict(state=s)).status_code,422)

    def test_applied_feedback_uses_measured_values_and_correct_phase_signs(self):
        from backend.scene_physics import DEFINITIONS
        for mode in [0,1]:
            before=state('interference-1',mode=mode).model_dump();after={**before,'parameters':{**before['parameters'],**film_target(before['parameters'],'bright' if mode==1 else 'dark')}}
            answer=film_change_answer(before,after,DEFINITIONS['interference-1'])
            self.assertIn('300 nm',answer)
            if mode==1:self.assertIn('半整数个波长时是亮环',answer);self.assertIn('此处膜厚 150 nm',answer)
            else:self.assertIn('两次反射都反转相位',answer);self.assertIn('最弱仍有少量反射光',answer)
        before=state('interference-1',filmIndex=1.333,substrateIndex=1).model_dump();after={**before,'parameters':{**before['parameters'],**film_target(before['parameters'],'dark')}}
        self.assertIn('只有一次反射相位反转',film_change_answer(before,after,DEFINITIONS['interference-1']))

if __name__=='__main__':unittest.main()

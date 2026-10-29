import math
import unittest
import numpy as np
from scipy.integrate import quad
from pydantic import ValidationError
from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialElement, SpatialExperiment, trace
from backend.amplitude_grating import grating_orders, grating_profile, fresnel_intensity, grating_count
from backend.spatial_components import basis, dot


def apparatus(**patch):
    source=SpatialElement(id='source',name='光源',kind='laser',position=(0,60,0),rayCount=1)
    grating=SpatialElement(id='grating',name='光栅',kind='amplitude-grating',position=(100,60,0),**patch)
    screen=SpatialElement(id='screen',name='观察屏',kind='screen',position=(400,60,0),diameterMm=60)
    return source,grating,screen


class AmplitudeGratingTests(unittest.TestCase):
    def test_normal_incidence_orders_satisfy_grating_equation_and_missing_even_orders(self):
        _,g,_=apparatus()
        orders=grating_orders(g,(1,0,0),.000532)
        self.assertEqual(len(orders),37)
        for o in orders:
            self.assertAlmostEqual(math.sin(math.radians(o['angleDeg'])),o['m']*.000532/.01,places=12)
            self.assertAlmostEqual(dot(o['direction'],o['direction']),1,places=12)
            if o['m']!=0 and o['m']%2==0:self.assertEqual(o['efficiency'],0)
        self.assertEqual(orders[0]['efficiency'],.25)
        self.assertAlmostEqual(orders[1]['efficiency'],1/math.pi**2)
        self.assertLess(sum(o['efficiency'] for o in orders),.5)

    def test_oblique_reverse_incidence_and_roll_preserve_tangential_components(self):
        for roll in (0,33,90):
            for forward in (1,-1):
                _,g,_=apparatus(rollDeg=roll)
                n,u,v=basis(g);d=(forward*math.sqrt(.95),.1,.2)
                for o in grating_orders(g,d,.00065):
                    self.assertAlmostEqual(dot(o['direction'],u)-dot(d,u),o['m']*.00065/.01,places=11)
                    self.assertAlmostEqual(dot(o['direction'],v),dot(d,v),places=11)
                    self.assertGreater(dot(o['direction'],n)*dot(d,n),0)

    def test_fully_open_mask_has_only_zero_order_and_subwavelength_mask_excludes_evanescent_orders(self):
        _,g,_=apparatus(gratingSlitUm=10)
        self.assertEqual([o['m'] for o in grating_orders(g,(1,0,0),.000532) if o['efficiency']>0],[0])
        _,g,_=apparatus(gratingPeriodUm=1000/1200,gratingSlitUm=.3)
        self.assertEqual([o['m'] for o in grating_orders(g,(1,0,0),.0011)],[0])

    def test_fresnel_field_matches_independent_complex_quadrature(self):
        _,g,_=apparatus(gratingWidthMm=.03,gratingSlitUm=3)
        wavelength,L=.000532,3
        for x in (-.02,-.004,0,.012):
            real=imag=0
            for centre in (-.01,0,.01):
                lo,hi=centre-.0015,centre+.0015
                phase=lambda t:math.pi*(t-x)**2/(wavelength*L)
                real+=quad(lambda t:math.cos(phase(t)),lo,hi,epsabs=1e-13)[0]
                imag+=quad(lambda t:math.sin(phase(t)),lo,hi,epsabs=1e-13)[0]
            expected=(real*real+imag*imag)/(wavelength*L)
            self.assertAlmostEqual(float(fresnel_intensity(g,wavelength,L,[x])[0]),expected,places=11)

    def test_far_field_limit_has_single_slit_envelope_times_finite_array(self):
        _,g,_=apparatus(gratingWidthMm=.04,gratingSlitUm=4)
        wavelength,L=.000532,10000
        for phase in (0,.7,math.pi,2*math.pi+.2):
            x=phase*wavelength*L/(2*math.pi*.01)
            single=np.sinc(.004*x/(wavelength*L))
            array=sum(complex(math.cos(-phase*k),math.sin(-phase*k)) for k in range(4))
            expected=.004**2/(wavelength*L)*single**2*abs(array)**2
            value=float(fresnel_intensity(g,wavelength,L,[x])[0])
            self.assertAlmostEqual(value,expected,delta=3e-10)

    def test_open_strips_telescope_to_one_finite_aperture_and_nearfield_can_exceed_one(self):
        _,g,_=apparatus(gratingWidthMm=.1,gratingSlitUm=10)
        from scipy.special import fresnel
        x=np.linspace(-.06,.06,101);scale=math.sqrt(2/(.000532*1))
        sr,cr=fresnel((.05-x)*scale);sl,cl=fresnel((-.05-x)*scale)
        expected=.5*((cr-cl)**2+(sr-sl)**2)
        np.testing.assert_allclose(fresnel_intensity(g,.000532,1,x),expected,atol=1e-12)
        self.assertGreater(float(max(expected)),1)

    def test_direct_profile_coordinates_stay_on_screen_and_do_not_depend_on_ray_count(self):
        source,g,screen=apparatus()
        profile,reason=grating_profile(g,screen,source,(1,0,0))
        self.assertIsNone(reason);self.assertEqual(profile['periodCount'],100)
        self.assertEqual(profile['points'][0]['xMm'],-30)
        self.assertEqual(profile['points'][-1]['xMm'],30)
        self.assertGreaterEqual(len(profile['points']),401)
        source.rayCount=201
        other,_=grating_profile(g,screen,source,(1,0,0))
        self.assertEqual(profile,other)
        g.rollDeg=90
        rotated,_=grating_profile(g,screen,source,(1,0,0))
        self.assertAlmostEqual(abs(rotated['axis'][1]),1)
        self.assertEqual(profile['points'],rotated['points'])

    def test_profile_rejects_unsupported_beams_incidence_and_resolution(self):
        source,g,screen=apparatus()
        for patch in ({'beamModel':'gaussian'},{'divergenceMrad':1},{'beamRadiusMm':.1}):
            altered=source.model_copy(update=patch)
            profile,reason=grating_profile(g,screen,altered,(1,0,0))
            self.assertIsNone(profile);self.assertTrue(reason)
        profile,reason=grating_profile(g,screen,source,(math.sqrt(.99),0,.1))
        self.assertIsNone(profile);self.assertTrue(reason)
        source,g,screen=apparatus(gratingWidthMm=5)
        profile,reason=grating_profile(g,screen,source,(1,0,0),max_work=100)
        self.assertIsNone(profile);self.assertIn('分辨',reason)
        source,g,screen=apparatus();source.beamRadiusMm=20;source.position=(0,60,19)
        profile,reason=grating_profile(g,screen,source,(1,0,0))
        self.assertIsNone(profile);self.assertIn('遮光框',reason)

    def test_paraxial_section_limits_aperture_to_observation_angle_and_rejects_wide_near_screen(self):
        source,g,screen=apparatus(gratingWidthMm=.1)
        screen.position=(101,60,0);screen.diameterMm=1
        profile,_=grating_profile(g,screen,source,(1,0,0))
        self.assertLessEqual(max(abs(p['xMm']) for p in profile['points'])+g.gratingWidthMm/2,.2+1e-12)
        g.gratingWidthMm=1
        profile,reason=grating_profile(g,screen,source,(1,0,0))
        self.assertIsNone(profile);self.assertIn('屏距',reason)

    def test_incomplete_edge_periods_are_opaque_without_changing_other_rays(self):
        source,g,screen=apparatus(gratingWidthMm=.025)
        source.position=(0,60,.011)
        result=trace(SpatialExperiment(schemaVersion=2,name='遮光边缘',elements=[source,g,screen]))
        self.assertEqual(result['segments'][0]['hitId'],g.id)
        self.assertEqual(result['screens'][0]['hits'],0)
        self.assertEqual(result['gratingOrders'],[])

    def test_opaque_mount_blocks_outside_clear_rectangle_but_has_finite_extent(self):
        source,g,screen=apparatus()
        for z,expected in ((3,0),(40,1)):
            source.position=(0,60,z);screen.diameterMm=100
            result=trace(SpatialExperiment(schemaVersion=2,name='遮光框',elements=[source,g,screen]))
            self.assertEqual(result['screens'][0]['hits'],expected)
            self.assertEqual(result['gratingOrders'],[])

    def test_trace_and_api_expose_real_orders_profile_and_bounded_power(self):
        source,g,screen=apparatus()
        experiment=SpatialExperiment(schemaVersion=2,name='光栅测试',elements=[source,g,screen])
        response=TestClient(app).post('/api/spatial/simulate',json={'revision':4,'experiment':experiment.model_dump()})
        self.assertEqual(response.status_code,200)
        result=response.json();self.assertEqual(result['revision'],4)
        self.assertEqual(len(result['gratingOrders']),1);self.assertEqual(len(result['diffraction']),1)
        self.assertLessEqual(result['screens'][0]['sampledPowerMw'],source.powerMw*.5)
        self.assertGreater(result['screens'][0]['sampledPowerMw'],source.powerMw*.25)
        nonzero={o['m'] for o in result['gratingOrders'][0]['orders'] if o['efficiency']>0}
        self.assertNotIn(2,nonzero);self.assertIn(1,nonzero)

    def test_intervening_lens_does_not_claim_full_wave_grating_image(self):
        source,g,screen=apparatus()
        lens=SpatialElement(id='lens',name='透镜',kind='lens',position=(250,60,0))
        result=trace(SpatialExperiment(schemaVersion=2,name='不虚构完整传播',elements=[source,g,lens,screen]))
        self.assertTrue(result['gratingOrders']);self.assertEqual(result['diffraction'],[])
        self.assertTrue(any('无遮挡' in w for w in result['warnings']))
        lens.position=(50,60,0)
        result=trace(SpatialExperiment(schemaVersion=2,name='镜后光栅',elements=[source,lens,g,screen]))
        self.assertEqual(result['diffraction'],[]);self.assertTrue(any('直接' in w for w in result['warnings']))

    def test_api_rejects_impossible_coupled_parameters_and_preserves_old_documents(self):
        for patch in ({'gratingSlitUm':11},{'gratingWidthMm':.01},{'gratingPeriodUm':.5},{'gratingHeightMm':0}):
            with self.assertRaises(ValidationError):apparatus(**patch)
        source,g,screen=apparatus();self.assertEqual(g.transmission,1)
        self.assertEqual(grating_count(g),100)
        old=SpatialElement(id='old',name='旧镜片',kind='lens',position=(20,60,0))
        self.assertEqual(old.gratingPeriodUm,10)

    def test_builder_assistant_catalog_and_comparison_keep_grating_scope(self):
        from backend.spatial_agent import SpatialWorkspace
        source,g,screen=apparatus()
        workspace=SpatialWorkspace(SpatialExperiment(schemaVersion=2,name='助手光栅',elements=[source,g,screen]))
        catalog,_=workspace.execute('list_apparatus',{})
        self.assertIn('amplitude-grating',catalog['categories']['衍射'])
        self.assertEqual(catalog['defaults']['amplitude-grating']['gratingPeriodUm'],10)
        workspace.execute('update_apparatus',{'elementId':g.id,'patch':{'gratingSlitUm':3,'rollDeg':30}})
        result,_=workspace.execute('trace_light',{})
        self.assertTrue(result['gratingOrders']);self.assertEqual(result['diffraction'][0]['kind'],'amplitude-grating')
        workspace.execute('set_goal',{'criteria':[{'label':'不混用狭缝宽度','elementId':screen.id,'metric':'diffraction_width_mm','value':1,'operator':'ge'}]})
        self.assertIsNone(workspace.checks(trace(workspace.experiment))[0]['actual'])

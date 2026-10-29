"""Independent analytic checks for cylindrical optics and polarization control."""
import math
import unittest
from backend.spatial import SpatialElement, SpatialExperiment, trace
from backend.spatial_agent import SpatialWorkspace
from backend.spatial_components import basis, sub, mul, source_modes, waveplate, stokes

def e(kind, id, position, **params):
    return SpatialElement(kind=kind, id=id, name=id, position=position, **params)
def doc(*elements):
    return SpatialExperiment(schemaVersion=2, name='新器材核对', elements=list(elements))

class CylindricalTests(unittest.TestCase):
    def test_focus_in_one_axis_and_rotation(self):
        source=e('laser','l',(0,60,0),rayCount=201)
        for roll in [0,90,45]:
            lens=e('cylindrical-lens','c',(100,60,0),rollDeg=roll)
            screen=e('screen','s',(200,60,0),diameterMm=100,rollDeg=roll)
            r=trace(doc(source,lens,screen));s=r['screens'][0]
            self.assertAlmostEqual(s['sampledRadiusUMm'],0,places=8)
            self.assertGreater(s['sampledRadiusVMm'],3.8)
            self.assertAlmostEqual(s['sampledPowerMw'],10)
        negative=e('cylindrical-lens','c',(100,60,0),focalLengthMm=-100)
        s=trace(doc(source,negative,e('screen','s',(200,60,0),diameterMm=100)))['screens'][0]
        self.assertGreater(s['sampledRadiusUMm'],7.5)
        self.assertLess(s['sampledRadiusVMm'],4.01)

    def test_gaussian_limit_and_legacy_restore(self):
        d=doc(e('laser','l',(0,60,0),beamModel='gaussian'),e('cylindrical-lens','c',(100,60,0)),e('screen','s',(200,60,0)))
        r=trace(d)
        self.assertIsNone(r['screens'][0]['gaussianRadiusMm'])
        self.assertTrue(any('椭圆高斯' in w for w in r['warnings']))
        self.assertEqual(SpatialExperiment.model_validate_json(d.model_dump_json()),d)
        with self.assertRaises(ValueError): e('cylindrical-lens','bad',(100,60,0),focalLengthMm=0)

    def test_agent_select_add_adjust_calculate_and_verify(self):
        w=SpatialWorkspace(doc(e('laser','l',(0,60,0),rayCount=201),e('screen','s',(200,60,0),diameterMm=100)))
        catalog,_=w.execute('list_apparatus',{});self.assertIn('cylindrical-lens',catalog['kinds'])
        w.execute('add_apparatus',{'element':e('cylindrical-lens','c',(100,60,0),focalLengthMm=120).model_dump()})
        w.execute('update_apparatus',{'elementId':'c','patch':{'focalLengthMm':100,'rollDeg':90}})
        w.execute('set_goal',{'criteria':[{'label':'V方向聚焦','elementId':'s','metric':'screen_radius_v_mm','operator':'le','value':1e-7}, {'label':'U方向保留','elementId':'s','metric':'screen_radius_u_mm','operator':'ge','value':3.8}]})
        r,_=w.execute('trace_light',{});self.assertTrue(all(c['passed'] for c in r['checks']))

class HalfWaveTests(unittest.TestCase):
    def test_halfwave_rotates_linear_polarization_without_losing_power(self):
        for fast in [0,22.5,45,73,-30]:
            source=e('laser','l',(0,60,0),rayCount=1,polarizationDeg=15)
            plate=e('half-wave-plate','w',(100,60,0),rollDeg=fast)
            result=trace(doc(source,plate,e('screen','s',(300,60,0))))['screens'][0]
            expected=math.radians(2*(2*fast-15))
            self.assertAlmostEqual(result['sampledPowerMw'],10)
            self.assertAlmostEqual(result['polarizationStokes']['s1'],math.cos(expected))
            self.assertAlmostEqual(result['polarizationStokes']['s2'],math.sin(expected))
            self.assertAlmostEqual(result['polarizationStokes']['s3'],0)

    def test_unpolarized_incoherent_modes_remain_unpolarized(self):
        r=trace(doc(e('laser','l',(0,60,0),polarization='unpolarized'),e('half-wave-plate','w',(100,60,0),rollDeg=37,transmission=.8),e('power-meter','s',(300,60,0))))['screens'][0]
        self.assertAlmostEqual(r['readingMw'],8)
        for value in r['polarizationStokes'].values():self.assertAlmostEqual(value,0)

    def test_three_dimensional_pose_and_off_design_delay(self):
        plate=e('half-wave-plate','w',(100,160,30),yawDeg=35,pitchDeg=25,rollDeg=22.5)
        n,_,_=basis(plate)
        source=e('laser','l',sub(plate.position,mul(n,100)),yawDeg=35,pitchDeg=25)
        screen=e('screen','s',sub(plate.position,mul(n,-100)),yawDeg=35,pitchDeg=25)
        s=trace(doc(source,plate,screen))['screens'][0]
        self.assertAlmostEqual(s['polarizationStokes']['s2'],1)
        # At twice design wavelength an HWP acts as a QWP under constant birefringence.
        plate=e('half-wave-plate','w',(100,60,0),rollDeg=45)
        r=trace(doc(e('laser','l',(0,60,0),wavelengthNm=1064),plate,e('screen','s',(300,60,0))))
        self.assertAlmostEqual(abs(r['screens'][0]['polarizationStokes']['s3']),1)
        self.assertTrue(any('偏离设计波长' in x for x in r['warnings']))

    def test_agent_adds_plate_adjusts_axis_and_verifies_polarization(self):
        w=SpatialWorkspace(doc(e('laser','l',(0,60,0)),e('screen','s',(300,60,0))))
        catalog,_=w.execute('list_apparatus',{});self.assertIn('half-wave-plate',catalog['kinds'])
        w.execute('add_apparatus',{'element':e('half-wave-plate','w',(100,60,0)).model_dump()})
        w.execute('update_apparatus',{'elementId':'w','patch':{'rollDeg':22.5,'designWavelengthNm':532}})
        w.execute('set_goal',{'criteria':[{'label':'45度线偏振','elementId':'s','metric':'polarization_s2','operator':'eq','value':1,'tolerance':1e-8}]})
        r,_=w.execute('trace_light',{});self.assertTrue(r['checks'][0]['passed'])

class QuarterWaveTests(unittest.TestCase):
    def test_quarterwave_phase_circular_and_linear_analyzer(self):
        for fast, expected_s3 in [(45,1),(-45,-1),(0,0)]:
            source=e('laser','l',(0,60,0),rayCount=1)
            plate=e('quarter-wave-plate','q',(100,60,0),rollDeg=fast)
            r=trace(doc(source,plate,e('screen','s',(300,60,0))))['screens'][0]
            self.assertAlmostEqual(r['polarizationStokes']['s3'],expected_s3)
            self.assertAlmostEqual(r['sampledPowerMw'],10)
            if fast:
                for axis in [0,17,45,90]:
                    r=trace(doc(source,plate,e('polarizer','p',(200,60,0),transmission=1,rollDeg=axis),e('power-meter','s',(300,60,0))))
                    self.assertAlmostEqual(r['screens'][0]['readingMw'],5)

    def test_two_quarterplates_equal_halfwave_and_inverse_restore(self):
        source=e('laser','l',(0,60,0),rayCount=1)
        q1=e('quarter-wave-plate','q1',(100,60,0),rollDeg=45)
        for second,expected_s1 in [(45,-1),(-45,1)]:
            q2=e('quarter-wave-plate','q2',(200,60,0),rollDeg=second)
            s=trace(doc(source,q1,q2,e('screen','s',(300,60,0))))['screens'][0]
            self.assertAlmostEqual(s['polarizationStokes']['s1'],expected_s1)
            self.assertAlmostEqual(s['polarizationStokes']['s3'],0)

    def test_no_light_has_no_polarization_claim_and_unpolarized_stays_mixed(self):
        for power,polarization in [(0,'linear'),(10,'unpolarized')]:
            s=trace(doc(e('laser','l',(0,60,0),powerMw=power,polarization=polarization),e('quarter-wave-plate','q',(100,60,0),rollDeg=45),e('screen','s',(300,60,0))))['screens'][0]
            if power==0:self.assertIsNone(s['polarizationStokes'])
            else:
                for value in s['polarizationStokes'].values():self.assertAlmostEqual(value,0)

    def test_agent_creates_circular_polarization_and_restores_plate_parameters(self):
        w=SpatialWorkspace(doc(e('laser','l',(0,60,0)),e('screen','s',(300,60,0))))
        w.execute('add_apparatus',{'element':e('quarter-wave-plate','q',(100,60,0)).model_dump()})
        w.execute('update_apparatus',{'elementId':'q','patch':{'rollDeg':45,'transmission':1}})
        w.execute('set_goal',{'criteria':[{'label':'圆偏振','elementId':'s','metric':'polarization_s3','operator':'eq','value':1,'tolerance':1e-8}]})
        r,_=w.execute('trace_light',{});self.assertTrue(r['checks'][0]['passed'])
        self.assertEqual(SpatialExperiment.model_validate_json(w.experiment.model_dump_json()),w.experiment)

class PolarizingSplitterTests(unittest.TestCase):
    def apparatus(self, angle=0, polarization='linear', middle=(), **params):
        return doc(e('laser','l',(0,60,0),rayCount=1,polarizationDeg=angle,polarization=polarization),*middle,
                   e('polarizing-splitter','b',(200,60,0),yawDeg=-45,**params),
                   e('power-meter','t',(400,60,0)),e('power-meter','r',(200,60,200),yawDeg=90))

    def test_actual_linear_polarization_controls_both_powers_and_output_state(self):
        for angle in [0,30,45,60,90]:
            r=trace(self.apparatus(angle));t,s=r['screens']
            self.assertAlmostEqual(t['readingMw'],10*math.cos(math.radians(angle))**2)
            self.assertAlmostEqual(s['readingMw'],10*math.sin(math.radians(angle))**2)
            self.assertAlmostEqual(t['readingMw']+s['readingMw'],10)
            if t['hits']:self.assertAlmostEqual(t['polarizationStokes']['s1'],1)
            if s['hits']:self.assertAlmostEqual(s['polarizationStokes']['s1'],-1)

    def test_circular_unpolarized_and_leakage_are_not_fixed_ratio(self):
        cases=[self.apparatus(polarization='unpolarized'),self.apparatus(middle=(e('quarter-wave-plate','q',(100,60,0),rollDeg=45),))]
        for d in cases:
            t,r=trace(d)['screens'];self.assertAlmostEqual(t['readingMw'],5);self.assertAlmostEqual(r['readingMw'],5)
        t,r=trace(self.apparatus(30,pTransmission=.9,sTransmission=.02))['screens']
        self.assertAlmostEqual(t['readingMw'],10*(.9*.75+.02*.25))
        self.assertAlmostEqual(t['readingMw']+r['readingMw'],10)

    def test_incidence_plane_in_three_dimensions_determines_ps(self):
        # A vertical folding plane swaps the roles of the source's U/V polarization.
        d=doc(e('laser','l',(0,60,0),rayCount=1),e('polarizing-splitter','b',(200,60,0),yawDeg=0,pitchDeg=-45),
              e('screen','t',(400,60,0)),e('screen','r',(200,260,0),pitchDeg=90))
        t,r=trace(d)['screens'];self.assertAlmostEqual(t['sampledPowerMw'],0);self.assertAlmostEqual(r['sampledPowerMw'],10)
        self.assertEqual(r['hits'],1)

    def test_agent_selects_aims_adjusts_plate_and_verifies_both_outputs(self):
        w=SpatialWorkspace(self.apparatus(middle=(e('half-wave-plate','w',(100,60,0)),)))
        catalog,_=w.execute('list_apparatus',{});self.assertIn('polarizing-splitter',catalog['kinds'])
        w.execute('aim_apparatus',{'elementId':'b','incomingFrom':[0,60,0],'target':[200,60,200]})
        w.execute('update_apparatus',{'elementId':'w','patch':{'rollDeg':15}})
        w.execute('set_goal',{'criteria':[{'label':'透射功率','elementId':'t','metric':'meter_reading_mw','operator':'eq','value':7.5,'tolerance':1e-8}, {'label':'反射功率','elementId':'r','metric':'meter_reading_mw','operator':'eq','value':2.5,'tolerance':1e-8}]})
        r,_=w.execute('trace_light',{});self.assertTrue(all(c['passed'] for c in r['checks']))
        scan,_=w.execute('compare_parameter',{'elementId':'w','field':'rollDeg','start':0,'stop':45,'count':3})
        self.assertEqual(len(scan['rows']),3)
        self.assertAlmostEqual(scan['rows'][0]['screens'][0]['readingMw'],10)
        self.assertAlmostEqual(scan['rows'][-1]['screens'][0]['readingMw'],0)
        self.assertEqual(SpatialExperiment.model_validate_json(w.experiment.model_dump_json()),w.experiment)

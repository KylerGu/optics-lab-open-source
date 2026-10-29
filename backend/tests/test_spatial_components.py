import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialElement,SpatialExperiment,trace
from backend.spatial_components import index_at,interface,basis,unit,sub,dot,add,mul
from backend.spatial_agent import SpatialWorkspace


def e(kind,id,position,**kw): return SpatialElement(kind=kind,id=id,name=id,position=position,**kw)
def doc(*elements): return SpatialExperiment(schemaVersion=2,name='器材验证',elements=list(elements))
def line(*middle,source=None,screen=None):
    return doc(source or e('laser','l',(0,60,0),powerMw=10,rayCount=1),*middle,screen or e('power-meter','s',(400,60,0),diameterMm=100))


class NewComponentsTests(unittest.TestCase):
    def test_bk7_matches_independent_vendor_indices_and_custom_abbe(self):
        prism=e('dispersion-prism','p',(150,60,0))
        for wavelength,reference in [(587.6,1.51680),(486.1,1.52238),(656.3,1.51432),(1060,1.50669)]:
            self.assertAlmostEqual(index_at(prism,wavelength),reference,places=5)
        custom=prism.model_copy(update={'glass':'custom','refractiveIndex':1.6,'abbeNumber':50})
        self.assertAlmostEqual(index_at(custom,587.56),1.6)
        self.assertAlmostEqual(index_at(custom,486.13)-index_at(custom,656.27),.6/50)

    def test_snell_and_total_internal_reflection_with_power_conservation(self):
        incident=(math.cos(math.pi/6),0,math.sin(math.pi/6))
        out,modes,fraction,tir=interface(incident,(-1,0,0),1,1.5,[(0,1,0)])
        self.assertFalse(tir);self.assertAlmostEqual(out[2],math.sin(math.pi/6)/1.5)
        self.assertGreater(fraction,0);self.assertLess(fraction,1)
        self.assertAlmostEqual(sum(abs(x)**2 for x in modes[0]),1)
        incident=unit((1,0,1));out,modes,fraction,tir=interface(incident,(1,0,0),1.5,1,[(0,1,0)])
        self.assertTrue(tir);self.assertEqual(fraction,1);self.assertAlmostEqual(out[0],-incident[0])
        self.assertAlmostEqual(sum(abs(x)**2 for x in modes[0]),1)

    def test_right_prism_traces_real_faces_turns_90_degrees_and_surface_loss(self):
        prism=e('right-prism','p',(150,60,0));r=trace(line(prism,screen=e('power-meter','s',(163.3333333333,60,-180),yawDeg=-90)))
        self.assertEqual(len(r['segments']),4);self.assertEqual(r['screens'][0]['hits'],1)
        n=index_at(prism,532);expected=10*(4*n/(1+n)**2)**2
        self.assertAlmostEqual(r['screens'][0]['readingMw'],expected,places=9)
        self.assertAlmostEqual(unit(sub(r['segments'][-1]['end'],r['segments'][-1]['start']))[2],-1)

    def test_prism_rotation_in_3d_rotates_actual_exit(self):
        prism=e('right-prism','p',(100,160,30),yawDeg=35,pitchDeg=25,rollDeg=48)
        n,u,v=basis(prism);source=e('laser','l',sub(prism.position,mul(n,200)),yawDeg=35,pitchDeg=25,rayCount=1)
        r=trace(doc(source,prism));out=unit(sub(r['segments'][-1]['end'],r['segments'][-1]['start']))
        self.assertAlmostEqual(dot(out,u),-1,places=9);self.assertEqual(len(r['segments']),4)

    def test_three_prism_minimum_deviation_matches_analytic_geometry(self):
        prism=e('dispersion-prism','p',(150,60,0));n=index_at(prism,532)
        deviation=2*math.asin(n*.5)-math.pi/3
        prism=prism.model_copy(update={'yawDeg':-math.degrees(deviation)/2})
        r=trace(doc(e('laser','l',(0,60,0),rayCount=1),prism));last=r['segments'][-1]
        out=unit(sub(last['end'],last['start']))
        self.assertAlmostEqual(math.acos(out[0]),deviation,places=8)

    def test_prism_dispersion_and_finite_height(self):
        prism=e('dispersion-prism','p',(150,60,0),yawDeg=-20)
        directions=[]
        for wavelength in [450,650]:
            r=trace(doc(e('laser','l',(0,60,0),rayCount=1,wavelengthNm=wavelength),prism))
            out=unit(sub(r['segments'][-1]['end'],r['segments'][-1]['start']));directions.append(math.acos(out[0]))
        self.assertGreater(directions[0],directions[1])
        r=trace(doc(e('laser','l',(0,90,0),rayCount=1),prism))
        self.assertEqual(len(r['segments']),1);self.assertIsNone(r['segments'][0]['hitId'])

    def test_malus_law_for_linear_and_unpolarized_sources(self):
        for polarization,factor in [('linear',1),('unpolarized',.5)]:
            for angle in [0,30,45,60,90]:
                r=trace(line(e('polarizer','p',(150,60,0),transmission=1,rollDeg=angle),source=e('laser','l',(0,60,0),rayCount=1,polarization=polarization)))
                expected=10*(math.cos(math.radians(angle))**2 if polarization=='linear' else factor)
                self.assertAlmostEqual(r['screens'][0]['readingMw'],expected,places=9)

    def test_two_crossed_and_three_polarizers(self):
        first=e('polarizer','p1',(100,60,0),transmission=1)
        last=e('polarizer','p3',(250,60,0),rollDeg=90,transmission=1)
        self.assertAlmostEqual(trace(line(first,last))['screens'][0]['readingMw'],0)
        middle=e('polarizer','p2',(175,60,0),rollDeg=45,transmission=1)
        self.assertAlmostEqual(trace(line(first,middle,last))['screens'][0]['readingMw'],2.5)

    def test_power_meter_is_finite_absorbing_and_reports_overload(self):
        source=e('laser','l',(0,60,0),rayCount=201,beamRadiusMm=4)
        r=trace(doc(source,e('power-meter','m',(150,60,0),diameterMm=4,meterRangeMw=1),e('screen','s',(300,60,0))))
        meter,screen=r['screens'];self.assertTrue(meter['overRange']);self.assertIsNone(meter['readingMw'])
        self.assertAlmostEqual(meter['sampledPowerMw'],2.5,delta=10/201)
        self.assertGreater(screen['hits'],0) # rays outside the finite sensor keep propagating
        self.assertAlmostEqual(meter['sampledPowerMw']+screen['sampledPowerMw'],10)
        self.assertTrue(any('量程' in w for w in r['warnings']))

    def test_single_slit_width_and_profile_against_analytic_reference(self):
        slit=e('slit','a',(100,60,0),slitWidthMm=.05)
        r=trace(line(slit,screen=e('screen','s',(600,60,0),diameterMm=80)))
        profile=r['diffraction'][0];ratio=.000532/.05
        self.assertAlmostEqual(profile['firstMinimumMm'],500*ratio/math.sqrt(1-ratio*ratio))
        for point in profile['points'][::40]:
            beta=math.pi*.05*point['xMm']/math.hypot(500,point['xMm'])/.000532
            expected=(math.sin(beta)/beta)**2 if beta else 1
            self.assertAlmostEqual(point['intensity'],expected)
        narrower=slit.model_copy(update={'slitWidthMm':.025})
        width=trace(line(narrower,screen=e('screen','s',(600,60,0))))['diffraction'][0]['centralMaximumWidthMm']
        self.assertGreater(width,profile['centralMaximumWidthMm']*2)

    def test_slit_clips_rectangle_and_rotation(self):
        for roll in [0,45,90]:
            r=trace(line(e('slit','a',(100,60,0),slitWidthMm=2,slitHeightMm=8,rollDeg=roll),source=e('laser','l',(0,60,0),rayCount=201)))
            self.assertGreater(r['screens'][0]['hits'],1);self.assertLess(r['screens'][0]['hits'],201)

    def test_diffraction_does_not_claim_near_field_gaussian_or_obstructed_results(self):
        slit=e('slit','a',(100,60,0),slitWidthMm=.05)
        for setup in [line(slit,screen=e('screen','s',(110,60,0))),line(slit,source=e('laser','l',(0,60,0),beamModel='gaussian')),line(slit,e('filter','f',(300,60,0)),screen=e('screen','s',(600,60,0))),line(slit,screen=e('screen','s',(600,60,0),yawDeg=15))]:
            r=trace(setup);self.assertEqual(r['diffraction'],[]);self.assertTrue(any('几何截光' in w for w in r['warnings']))

    def test_api_accepts_new_components_and_preserves_extended_parameters(self):
        setup=line(e('polarizer','p',(150,60,0),transmission=1,rollDeg=45))
        with TestClient(app) as client:
            response=client.post('/api/spatial/simulate',json={'revision':3,'experiment':setup.model_dump()})
        self.assertEqual(response.status_code,200);data=response.json()
        self.assertEqual(data['inputSnapshot'],setup.model_dump(mode='json'));self.assertAlmostEqual(data['screens'][0]['readingMw'],5)

    def test_agent_catalog_edits_and_scan_use_new_physics_not_templates(self):
        setup=line(e('polarizer','p',(150,60,0),transmission=1))
        workspace=SpatialWorkspace(setup);catalog,_=workspace.execute('list_apparatus',{})
        for kind in ['right-prism','dispersion-prism','polarizer','slit','power-meter']: self.assertIn(kind,catalog['kinds'])
        workspace.execute('set_goal',{'criteria':[{'label':'45度功率','metric':'meter_reading_mw','elementId':'s','operator':'eq','value':5,'tolerance':1e-8}]})
        workspace.execute('update_apparatus',{'elementId':'p','patch':{'rollDeg':45}})
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])
        comparison,_=workspace.execute('compare_parameter',{'elementId':'p','field':'rollDeg','start':0,'stop':90,'count':3})
        self.assertEqual([round(r['screens'][0]['readingMw'],5) for r in comparison['rows']],[10,5,0])
        self.assertEqual(workspace.element('p').rollDeg,45)

    def test_agent_single_slit_goals_and_comparisons_use_diffraction_evidence(self):
        workspace=SpatialWorkspace(line(e('slit','a',(100,60,0),slitWidthMm=.05),screen=e('screen','s',(600,60,0))))
        workspace.execute('set_goal',{'criteria':[{'label':'条纹宽度','metric':'diffraction_width_mm','elementId':'s','operator':'ge','value':10}]})
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])
        scan,_=workspace.execute('compare_parameter',{'elementId':'a','field':'slitWidthMm','start':.03,'stop':.05,'count':3})
        self.assertTrue(all(r['diffraction'] for r in scan['rows']))
        self.assertTrue(all('points' not in p for r in scan['rows'] for p in r['diffraction']))
        self.assertTrue(all(len(p['points'])==401 for r in workspace.comparisons[0]['rows'] for p in r['diffraction']))
        workspace.execute('set_goal',{'criteria':[{'label':'宽度变化','metric':'comparison_span','comparisonId':scan['comparisonId'],'measurement':'diffraction_width_mm','elementId':'s','operator':'ge','value':5}]})
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])
        workspace.update('s',{'position':(650,60,0)})
        self.assertFalse(workspace.calculate()['checks'][0]['passed'])

    def test_monotonic_decrease_is_distinct_from_not_monotonic_increase(self):
        workspace=SpatialWorkspace(line(e('slit','a',(100,60,0),slitWidthMm=.05),screen=e('screen','s',(600,60,0))))
        scan,_=workspace.execute('compare_parameter',{'elementId':'a','field':'slitWidthMm','start':.03,'stop':.05,'count':3})
        workspace.execute('set_goal',{'criteria':[{'label':'单调不增','metric':'comparison_nonincreasing','comparisonId':scan['comparisonId'],'measurement':'diffraction_width_mm','elementId':'s','operator':'eq','value':1}]})
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])
        # A nonmonotonic sequence is neither nonincreasing nor nondecreasing.
        for row,value in zip(workspace.comparisons[0]['rows'],[3,1,2]): row['diffraction'][0]['centralMaximumWidthMm']=value
        self.assertEqual(workspace.comparison_value(workspace.criteria[0]),0)

    def test_agent_prism_deflection_uses_actual_unique_chief_path(self):
        workspace=SpatialWorkspace(doc(e('laser','l',(0,60,0),rayCount=1),e('right-prism','p',(150,60,0))))
        workspace.execute('set_goal',{'criteria':[{'label':'90度折转','metric':'deflection_deg','elementId':'p','operator':'eq','value':90,'tolerance':1e-7}]})
        self.assertTrue(workspace.calculate()['checks'][0]['passed'])
        workspace.update('p',{'yawDeg':20})
        self.assertFalse(workspace.calculate()['checks'][0]['passed'])

    def test_weak_source_power_is_not_silently_removed_beside_a_bright_source(self):
        r=trace(doc(e('laser','bright',(0,60,-30),powerMw=1000,rayCount=201),e('laser','weak',(0,60,30),powerMw=.0001,rayCount=201),e('power-meter','m',(200,60,30))))
        self.assertEqual(r['screens'][0]['hits'],201)
        self.assertAlmostEqual(r['screens'][0]['readingMw'],.0001,places=12)


if __name__=='__main__': unittest.main()

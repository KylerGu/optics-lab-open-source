import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialElement, SpatialExperiment, trace
from backend.spherical_lenses import SPHERICAL_KINDS, lens_hit, focal_lengths, surface_positions
from backend.spatial_components import basis, add, sub, mul, dot, unit, interface, source_modes
from backend.spatial_agent import SpatialWorkspace


def e(kind, id, position=(100,60,0), **params):
    return SpatialElement(kind=kind,id=id,name=id,position=position,**params)


def doc(*elements):return SpatialExperiment(schemaVersion=2,name='实体球面透镜',elements=list(elements))


def through(lens, origin, direction, wavelength=587.56):
    from backend.spatial_components import index_at
    entry=lens_hit(lens,origin,direction)
    modes=source_modes(lens,direction)
    outgoing,modes,_,_=interface(direction,entry[2],1,index_at(lens,wavelength),modes)
    exit=lens_hit(lens,entry[1],outgoing,True)
    outgoing,_,_,tir=interface(outgoing,exit[2],index_at(lens,wavelength),1,modes)
    assert not tir
    return entry[1],exit[1],outgoing


class SphericalLensTests(unittest.TestCase):
    def test_shapes_thickness_and_independent_thick_lens_formula(self):
        for kind in sorted(SPHERICAL_KINDS):
            lens=e(kind,'lens',glass='custom',refractiveIndex=1.5)
            front,back=surface_positions(lens,10)
            self.assertAlmostEqual(surface_positions(lens,0)[1]-surface_positions(lens,0)[0],5)
            if 'convex' in kind or kind=='positive-meniscus-lens':self.assertLess(back-front,5)
            else:self.assertGreater(back-front,5)
            # n=1.5, R=50 for plano; R1=+/-100,R2=-/+100 for bi.
            f,bfl=focal_lengths(lens)
            if kind.startswith('plano'):
                expected=100 if 'convex' in kind else -100
                self.assertAlmostEqual(f,expected)
                self.assertAlmostEqual(bfl,expected-5/1.5)
            elif kind.endswith('meniscus-lens'):
                power=(.005 if kind=='positive-meniscus-lens' else -.005)+5/1.5*.00005
                self.assertAlmostEqual(f,1/power)
            else:
                power=(.01 if 'convex' in kind else -.01)-5/1.5*.000025
                self.assertAlmostEqual(f,1/power)
            start=(0,60,.001)
            _,exit,d=through(lens,start,(1,0,0))
            actual_focus=(60-exit[1])/d[1] if abs(d[1])>1e-12 else -exit[2]/d[2]
            self.assertAlmostEqual(actual_focus*d[0],bfl,places=5)

    def test_actual_focus_divergence_and_fresnel_losses(self):
        for kind in sorted(SPHERICAL_KINDS):
            lens=e(kind,'lens',glass='custom',refractiveIndex=1.5)
            source=e('laser','source',(0,60,0),beamRadiusMm=.1,wavelengthNm=587.56,rayCount=201)
            bfl=focal_lengths(lens)[1]
            screen=e('screen','screen',(100+2.5+abs(bfl),60,0),diameterMm=100)
            result=trace(doc(source,lens,screen));s=result['screens'][0]
            self.assertEqual(s['hits'],201)
            self.assertLess(s['sampledPowerMw'],10)
            self.assertGreater(s['sampledPowerMw'],9.21)
            if 'convex' in kind or kind=='positive-meniscus-lens':self.assertLess(s['footprintRadiusMm'],1e-5)
            else:self.assertGreater(s['footprintRadiusMm'],.18)
            chief=[seg for seg in result['segments'] if seg['chief']]
            self.assertEqual(len(chief),3)
            self.assertAlmostEqual(chief[1]['powerMw']/chief[0]['powerMw'],.96)
            self.assertAlmostEqual(chief[2]['powerMw']/chief[1]['powerMw'],.96)

    def test_reversal_reciprocity_and_spherical_aberration(self):
        lens=e('plano-convex-lens','lens')
        entry,exit,d=through(lens,(0,60,8),(1,0,0))
        _,reverse_exit,reverse_d=through(lens,add(exit,mul(d,50)),mul(d,-1))
        self.assertLess(math.dist(entry,reverse_exit),1e-8)
        self.assertLess(math.dist(reverse_d,(-1,0,0)),1e-8)
        _,exit1,d1=through(lens,(0,60,.01),(1,0,0))
        marginal_focus=exit[0]-exit[2]/d[2]*d[0]
        paraxial_focus=exit1[0]-exit1[2]/d1[2]*d1[0]
        self.assertGreater(abs(marginal_focus-paraxial_focus),.5)
        flipped=e('plano-convex-lens','lens',yawDeg=180)
        _,exit2,d2=through(flipped,(0,60,8),(1,0,0))
        self.assertGreater(abs(exit2[0]-exit2[2]/d2[2]*d2[0]-marginal_focus),.5)

    def test_arbitrary_3d_pose_and_material_dispersion(self):
        lens=e('biconvex-lens','lens',(20,120,-80),yawDeg=43,pitchDeg=27,rollDeg=61)
        n,u,_=basis(lens);start=add(add(lens.position,mul(n,-100)),mul(u,.001))
        _,exit,d=through(lens,start,n)
        radial=dot(sub(exit,lens.position),u);slope=dot(d,u)
        self.assertAlmostEqual(-radial/slope*dot(d,n),focal_lengths(lens)[1],places=5)
        self.assertLess(focal_lengths(lens,450)[0],focal_lengths(lens,650)[0])

    def test_invalid_solids_api_and_absorbing_edge(self):
        for params in [{'frontRadiusMm':12.5},{'centerThicknessMm':1},{'glass':'custom','refractiveIndex':1}]:
            with self.assertRaises(ValueError):e('plano-convex-lens','bad',**params)
        with self.assertRaises(ValueError):e('biconvex-lens','bad',backRadiusMm=12.5)
        lens=e('plano-concave-lens','lens')
        hit=lens_hit(lens,(100,60,-30),(0,0,1));self.assertEqual(hit[3],'edge')
        source=e('laser','s',(100,60,-30),yawDeg=90,rayCount=1)
        r=trace(doc(source,lens,e('screen','screen',(100,60,30),yawDeg=90)))
        self.assertEqual(r['screens'][0]['hits'],0)
        invalid=doc(e('plano-convex-lens','lens')).model_dump();invalid['elements'][0]['centerThicknessMm']=1
        response=TestClient(app).post('/api/spatial/simulate',json={'revision':0,'experiment':invalid})
        self.assertEqual(response.status_code,422)

    def test_gaussian_and_old_models_remain_separate(self):
        source=e('laser','s',(0,60,0),beamModel='gaussian',beamRadiusMm=1)
        screen=e('screen','screen',(200,60,0))
        old=trace(doc(source,e('lens','ideal'),screen))
        self.assertIsNotNone(old['screens'][0]['gaussianRadiusMm'])
        new=trace(doc(source,e('plano-convex-lens','real'),screen))
        self.assertIsNone(new['screens'][0]['gaussianRadiusMm'])
        self.assertTrue(any('高斯包络' in x for x in new['warnings']))
        self.assertEqual(SpatialExperiment.model_validate_json(doc(source,screen).model_dump_json()),doc(source,screen))

    def test_internal_total_reflection_and_zero_paraxial_power(self):
        lens=e('plano-convex-lens','lens')
        direction=(.4,0,math.sqrt(.84));hit=lens_hit(lens,lens.position,direction,True)
        self.assertEqual(hit[3],'back')
        out,_,fraction,tir=interface(direction,hit[2],1.5,1,source_modes(lens,direction))
        self.assertTrue(tir);self.assertAlmostEqual(fraction,1);self.assertAlmostEqual(out[0],-.4)
        # Two convex ends of a long glass rod can have zero net paraxial power.
        zero=e('biconvex-lens','zero',glass='custom',refractiveIndex=1.5,frontRadiusMm=20,backRadiusMm=20,centerThicknessMm=120)
        self.assertEqual(focal_lengths(zero),(None,None))

    def test_agent_select_update_verify_scan_and_atomic_invalid_update(self):
        for kind in sorted(SPHERICAL_KINDS):
            w=SpatialWorkspace(doc(e('laser','s',(0,60,0)),e('screen','screen',(250,60,0),diameterMm=100)))
            catalog,_=w.execute('list_apparatus',{});self.assertIn(kind,catalog['lensGroups']['球面透镜'])
            w.execute('add_apparatus',{'element':e(kind,'lens').model_dump()})
            w.execute('update_apparatus',{'elementId':'lens','patch':{'centerThicknessMm':6,'glass':'custom','refractiveIndex':1.5}})
            before=w.experiment.model_dump()
            with self.assertRaises(ValueError):w.execute('update_apparatus',{'elementId':'lens','patch':{'frontRadiusMm':5}})
            self.assertEqual(w.experiment.model_dump(),before)
            with self.assertRaises(ValueError):w.execute('update_apparatus',{'elementId':'lens','patch':{'focalLengthMm':100}})
            f,bfl=focal_lengths(w.element('lens'))
            w.execute('set_goal',{'criteria':[{'label':'焦距核对','metric':'lens_focal_mm','elementId':'lens','operator':'eq','value':f,'tolerance':1e-8}]})
            r,_=w.execute('trace_light',{});self.assertTrue(r['checks'][0]['passed'])
            comparison,_=w.execute('compare_parameter',{'elementId':'lens','field':'frontRadiusMm','start':50 if kind=='positive-meniscus-lens' else 80,'stop':80 if kind=='positive-meniscus-lens' else 120,'count':3})
            self.assertTrue(all(row['error'] is None for row in comparison['rows']))

    def test_meniscus_sign_constraints_and_back_surface_updates(self):
        for kind,params in [('positive-meniscus-lens',{'frontRadiusMm':100,'backRadiusMm':50}),('negative-meniscus-lens',{'frontRadiusMm':50,'backRadiusMm':100}),('negative-meniscus-lens',{'frontRadiusMm':100,'backRadiusMm':95,'centerThicknessMm':20})]:
            with self.assertRaises(ValueError):e(kind,'bad',**params)
        for kind in ['positive-meniscus-lens','negative-meniscus-lens']:
            lens=e(kind,'lens');entry,exit,d=through(lens,(0,60,4),(1,0,0))
            _,reverse_exit,reverse_d=through(lens,add(exit,mul(d,30)),mul(d,-1))
            self.assertLess(math.dist(entry,reverse_exit),1e-8)
            self.assertLess(math.dist(reverse_d,(-1,0,0)),1e-8)
            w=SpatialWorkspace(doc(lens));w.execute('update_apparatus',{'elementId':'lens','patch':{'backRadiusMm':120 if kind=='positive-meniscus-lens' else 60}})
            self.assertEqual(w.element('lens').backRadiusMm,120 if kind=='positive-meniscus-lens' else 60)
            restored=SpatialExperiment.model_validate_json(w.experiment.model_dump_json());self.assertEqual(restored,w.experiment)

    def test_edmund_72433_manufacturer_focal_and_edge_thickness(self):
        # Manufacturer: 25.4mm N-BK7, R1=57.97,R2=129.813,CT=2.80;
        # published EFL=200.00,BFL=196.71,ET=1.98 at 587.6nm.
        lens=e('positive-meniscus-lens','72433',diameterMm=25.4,frontRadiusMm=57.97,backRadiusMm=129.813,centerThicknessMm=2.8)
        f,bfl=focal_lengths(lens,587.6);front,back=surface_positions(lens,12.7)
        # Published radii are rounded (R1 has only two decimals); allow 0.025%.
        self.assertAlmostEqual(f,200,delta=.05);self.assertAlmostEqual(bfl,196.71,delta=.05)
        # Nominal radii and CT yield ET=2.01448, while the catalogue lists 1.98;
        # the 0.03448mm difference lies within its stated CT tolerance +/-0.10.
        # Keep the actual spherical sag rather than tuning geometry to that ET.
        self.assertAlmostEqual(back-front,2.0144775973429874,places=10)
        self.assertLessEqual(abs(back-front-1.98),.10)


if __name__=='__main__':unittest.main()

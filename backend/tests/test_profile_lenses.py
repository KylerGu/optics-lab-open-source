import math
import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialElement,SpatialExperiment,trace
from backend.profile_lenses import PROFILE_KINDS,physical_lens_hit,physical_focal_lengths,profile_sag
from backend.spatial_components import add,sub,mul,dot,basis,interface,index_at,source_modes
from backend.spatial_agent import SpatialWorkspace


def e(kind,id,position=(100,60,0),**params):return SpatialElement(kind=kind,id=id,name=id,position=position,**params)
def doc(*elements):return SpatialExperiment(schemaVersion=2,name='实体曲面透镜',elements=list(elements))
def path(lens,origin,d,wavelength=587.56):
    entry=physical_lens_hit(lens,origin,d);assert entry and entry[3]=='front' or entry and entry[3]=='back'
    n=index_at(lens,wavelength);inside,modes,_,_=interface(d,entry[2],1,n,source_modes(lens,d))
    exit=physical_lens_hit(lens,entry[1],inside,True);assert exit and exit[3]!='edge'
    outgoing,_,_,tir=interface(inside,exit[2],n,1,modes);assert not tir
    return entry,exit,outgoing


class ProfileLensTests(unittest.TestCase):
    def test_zero_conic_asphere_equals_existing_sphere(self):
        for sign in ['convex','concave']:
            a=e('aspheric-'+sign+'-lens','a',conicConstant=0)
            s=e('plano-'+sign+'-lens','a')
            source=e('laser','source',(0,60,0),beamRadiusMm=4,rayCount=101)
            screen=e('screen','screen',(250,60,0),diameterMm=100)
            r1=trace(doc(source,a,screen));r2=trace(doc(source,s,screen))
            self.assertEqual(len(r1['segments']),len(r2['segments']))
            for one,two in zip(r1['segments'],r2['segments']):
                self.assertLess(math.dist(one['end'],two['end']),1e-8)
                self.assertAlmostEqual(one['powerMw'],two['powerMw'],places=10)

    def test_exact_hyperbolic_focus_from_constant_optical_path(self):
        # Plane-first glass->air hyperbola k=-n² obeys n*x+sqrt((f-x)²+r²)=f.
        # This independent Fermat construction focuses ALL heights at f=R/(n-1).
        lens=e('aspheric-convex-lens','a',yawDeg=180,glass='custom',refractiveIndex=1.5,conicConstant=-2.25)
        source=e('laser','s',(0,60,0),beamRadiusMm=10,wavelengthNm=587.56,rayCount=201)
        screen=e('screen','p',(202.5,60,0))
        result=trace(doc(source,lens,screen));self.assertEqual(result['screens'][0]['hits'],201)
        self.assertLess(result['screens'][0]['footprintRadiusMm'],1e-8)
        self.assertLess(trace(doc(source,e('plano-convex-lens','sph',yawDeg=180,glass='custom',refractiveIndex=1.5),screen))['screens'][0]['footprintRadiusMm'],2)
        for r in [0,2,8,12]:
            sag=profile_sag(lens,r)
            self.assertAlmostEqual(-1.5*sag+math.sqrt((100+sag)**2+r*r),100,places=10)

    def test_polynomial_intersection_normal_and_reciprocity(self):
        lens=e('aspheric-convex-lens','a',conicConstant=-1,asphericA4=1e-6,asphericA6=1e-9)
        entry,exit,d=path(lens,(0,60,6),(1,0,0))
        expected=97.5+6**2/100+1e-6*6**4+1e-9*6**6
        self.assertAlmostEqual(entry[1][0],expected,places=8)
        slope=6/50+4e-6*6**3+6e-9*6**5
        self.assertAlmostEqual(entry[2][2]/-entry[2][0],slope,places=10)
        reverse_entry,reverse_exit,reverse_d=path(lens,add(exit[1],mul(d,30)),mul(d,-1))
        self.assertLess(math.dist(entry[1],reverse_exit[1]),1e-7)
        self.assertLess(math.dist(reverse_d,(-1,0,0)),1e-8)
        # Oblique ray: polynomial solver and exact residual, not a centre-plane hit.
        direction=(math.sqrt(.99),0,-.1);hit=physical_lens_hit(lens,(0,60,12),direction)
        r=abs(hit[1][2]);self.assertAlmostEqual(hit[1][0],97.5+r*r/100+1e-6*r**4+1e-9*r**6,places=7)
        # Two intersections of the same convex profile, with a stationary point between.
        grazing=physical_lens_hit(lens,(98,60,-20),(0,0,1))
        self.assertIsNotNone(grazing);self.assertEqual(grazing[3],'front')

    def test_cylindrical_focus_rotation_and_divergence(self):
        source=e('laser','s',(0,60,0),wavelengthNm=587.56,beamRadiusMm=2,rayCount=201)
        for roll in [0,45,90]:
            lens=e('plano-convex-cylinder-lens','c',glass='custom',refractiveIndex=1.5,rollDeg=roll)
            self.assertEqual(physical_focal_lengths(lens),(100,100-5/1.5))
            screen=e('screen','p',(100+2.5+100-5/1.5,60,0),rollDeg=roll,diameterMm=100)
            r=trace(doc(source,lens,screen));s=r['screens'][0]
            self.assertEqual(s['hits'],201);self.assertLess(s['sampledRadiusUMm'],.01);self.assertGreater(s['sampledRadiusVMm'],1.8)
            self.assertGreater(s['sampledPowerMw'],9.21);self.assertLess(s['sampledPowerMw'],9.22)
        negative=e('plano-concave-cylinder-lens','c',glass='custom',refractiveIndex=1.5)
        screen=e('screen','p',(200,60,0),diameterMm=100)
        s=trace(doc(source,negative,screen))['screens'][0]
        self.assertGreater(s['sampledRadiusUMm'],3.5);self.assertLess(s['sampledRadiusVMm'],2.01)

    def test_cylinder_rectangle_blocks_and_rim_absorbs(self):
        lens=e('plano-convex-cylinder-lens','c',cylinderWidthMm=8,cylinderHeightMm=6)
        self.assertIsNone(physical_lens_hit(lens,(0,64,0),(1,0,0)))
        self.assertIsNotNone(physical_lens_hit(lens,(0,62.9,3.9),(1,0,0)))
        hit=physical_lens_hit(lens,(100,70,0),(0,-1,0));self.assertEqual(hit[3],'edge')
        source=e('laser','s',(100,70,0),pitchDeg=-90,rayCount=1)
        screen=e('screen','p',(100,40,0),pitchDeg=-90)
        self.assertEqual(trace(doc(source,lens,screen))['screens'][0]['hits'],0)

    def test_pose_material_gaussian_and_old_cylinder_preserved(self):
        for kind in sorted(PROFILE_KINDS):
            lens=e(kind,'c',(20,120,-80),yawDeg=43,pitchDeg=27,rollDeg=61)
            n,u,v=basis(lens);origin=add(add(lens.position,mul(n,-100)),mul(u,.001))
            entry,exit,d=path(lens,origin,n)
            focus=-dot(sub(exit[1],lens.position),u)/dot(d,u)*dot(d,n)
            self.assertAlmostEqual(focus,physical_focal_lengths(lens)[1],places=5)
            self.assertLess(abs(dot(sub(exit[1],lens.position),v)),1e-8)
            # |f| decreases for blue (higher index) for both signs.
            self.assertLess(abs(physical_focal_lengths(lens,450)[0]),abs(physical_focal_lengths(lens,650)[0]))
            r=trace(doc(e('laser','s',(0,60,0),beamModel='gaussian'),e(kind,'c'),e('screen','p',(250,60,0))))
            self.assertIsNone(r['screens'][0]['gaussianRadiusMm']);self.assertTrue(any('高斯包络' in w for w in r['warnings']))
        old=trace(doc(e('laser','s',(0,60,0)),e('cylindrical-lens','old'),e('screen','p',(200,60,0))))
        self.assertAlmostEqual(old['screens'][0]['sampledPowerMw'],10)
        self.assertAlmostEqual(old['screens'][0]['sampledRadiusUMm'],0)

    def test_invalid_profiles_api_restore_and_agent_scans(self):
        for kind,params in [('aspheric-convex-lens',{'conicConstant':10,'frontRadiusMm':20}),('aspheric-convex-lens',{'asphericA4':-.001}),('aspheric-convex-lens',{'centerThicknessMm':1}),('plano-convex-cylinder-lens',{'frontRadiusMm':12}),('plano-convex-cylinder-lens',{'cylinderWidthMm':0})]:
            with self.assertRaises(ValueError):e(kind,'bad',**params)
        for kind in sorted(PROFILE_KINDS):
            w=SpatialWorkspace(doc(e('laser','s',(0,60,0)),e(kind,'c'),e('screen','p',(250,60,0),diameterMm=100)))
            before=w.experiment.model_dump()
            with self.assertRaises(ValueError):w.update('c',{'focalLengthMm':100})
            self.assertEqual(w.experiment.model_dump(),before)
            w.update('c',{'centerThicknessMm':6,'glass':'custom','refractiveIndex':1.5})
            field='conicConstant' if 'aspheric' in kind else 'rollDeg'
            comparison,_=w.execute('compare_parameter',{'elementId':'c','field':field,'start':-2 if field=='conicConstant' else 0,'stop':0 if field=='conicConstant' else 90,'count':3})
            self.assertTrue(all(row['error'] is None for row in comparison['rows']))
            f=physical_focal_lengths(w.element('c'))[0]
            w.execute('set_goal',{'criteria':[{'label':'近轴焦距','metric':'lens_focal_mm','elementId':'c','operator':'eq','value':f,'tolerance':.000001}]})
            r,_=w.execute('trace_light',{});self.assertTrue(r['checks'][0]['passed'])
            self.assertEqual(SpatialExperiment.model_validate_json(w.experiment.model_dump_json()),w.experiment)
        invalid=doc(e('aspheric-convex-lens','a')).model_dump();invalid['elements'][0]['asphericA4']=-.001
        self.assertEqual(TestClient(app).post('/api/spatial/simulate',json={'revision':0,'experiment':invalid}).status_code,422)


if __name__=='__main__':unittest.main()

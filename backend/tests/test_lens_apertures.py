import unittest
from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialElement,SpatialExperiment,trace
from backend.spatial_agent import SpatialWorkspace
from backend.profile_lenses import PHYSICAL_KINDS,within_clear_aperture
from backend.spatial_components import basis,add,mul
from backend.profile_lenses import physical_focal_lengths

def element(kind,id,position=(100,60,0),**parameters):return SpatialElement(kind=kind,id=id,name=id,position=position,**parameters)
def document(*elements):return SpatialExperiment(schemaVersion=2,name='通光口径',elements=list(elements))

class LensApertureTests(unittest.TestCase):
    def test_agent_catalog_shares_all_thirty_valid_teaching_specifications(self):
        catalog,_=SpatialWorkspace(document(element('laser','laser',(0,60,0)))).execute('list_apparatus',{})
        presets=catalog['teachingLensPresets']['presets'];self.assertEqual(len(presets),30)
        for p in presets:
            fields={key:value for key,value in p.items() if key not in {'name','focalMm'}}
            lens=SpatialElement(**fields,name=p['name'],position=(100,60,0))
            self.assertAlmostEqual(physical_focal_lengths(lens)[0],p['focalMm'],places=6)
    def test_legacy_defaults_and_api_reject_oversized_apertures(self):
        for kind in PHYSICAL_KINDS:
            lens=element(kind,'lens',diameterMm=30,cylinderWidthMm=28,cylinderHeightMm=18)
            self.assertEqual(lens.clearApertureMm,30);self.assertEqual(lens.clearWidthMm,28);self.assertEqual(lens.clearHeightMm,18)
            raw=lens.model_dump();raw['clearApertureMm']=31;raw['clearWidthMm']=29
            with self.assertRaises(ValueError):SpatialElement.model_validate(raw)
            self.assertEqual(TestClient(app).post('/api/spatial/simulate',json={'revision':0,'experiment':{'schemaVersion':2,'name':'拒绝','elements':[raw]}}).status_code,422)

    def test_real_surface_clipping_blocks_entrance_and_exit_without_changing_outer_shape(self):
        laser=element('laser','laser',(0,60,3),beamRadiusMm=.01,rayCount=1,wavelengthNm=587.56)
        screen=element('screen','screen',(300,60,0),diameterMm=100)
        for kind in PHYSICAL_KINDS:
            lens=element(kind,'lens',clearApertureMm=2,clearWidthMm=2,clearHeightMm=2)
            self.assertEqual(trace(document(laser,lens,screen))['screens'][0]['hits'],0)
            lens=element(kind,'lens')
            self.assertEqual(trace(document(laser,lens,screen))['screens'][0]['hits'],1)
        lens=element('plano-concave-lens','lens',clearApertureMm=2,centerThicknessMm=20)
        laser=element('laser','laser',(0,60,.99),beamRadiusMm=.01,rayCount=1,wavelengthNm=587.56)
        result=trace(document(laser,lens,screen));self.assertEqual(result['screens'][0]['hits'],0)
        self.assertEqual(len([s for s in result['segments'] if s.get('fromId')=='lens']),1)

    def test_sampling_power_matches_aperture_area_and_rotated_rectangular_bounds(self):
        laser=element('laser','laser',(0,60,0),beamRadiusMm=4,rayCount=201,wavelengthNm=587.56,polarization='unpolarized')
        screen=element('screen','screen',(300,60,0),diameterMm=100)
        full=trace(document(laser,element('plano-convex-lens','lens'),screen))['screens'][0]
        clipped=trace(document(laser,element('plano-convex-lens','lens',clearApertureMm=2),screen))['screens'][0]
        self.assertAlmostEqual(clipped['sampledPowerMw']/full['sampledPowerMw'],(2/8)**2,delta=.025)
        lens=element('plano-convex-cylinder-lens','lens',rollDeg=37,clearWidthMm=4,clearHeightMm=2)
        n,u,v=basis(lens)
        self.assertTrue(within_clear_aperture(lens,add(lens.position,mul(u,1.9))))
        self.assertFalse(within_clear_aperture(lens,add(lens.position,mul(u,2.1))))
        self.assertFalse(within_clear_aperture(lens,add(lens.position,mul(v,1.1))))

    def test_agent_modification_and_scan_are_atomic_and_resize_uses_explicit_opening(self):
        lens=element('plano-convex-lens','lens');workspace=SpatialWorkspace(document(element('laser','source',(0,60,0)),lens))
        workspace.update('lens',{'diameterMm':20});self.assertEqual(workspace.element('lens').clearApertureMm,20)
        workspace.update('lens',{'clearApertureMm':12});workspace.update('lens',{'diameterMm':25});self.assertEqual(workspace.element('lens').clearApertureMm,12)
        before=workspace.experiment.model_dump()
        with self.assertRaises(ValueError):workspace.update('lens',{'clearApertureMm':26})
        self.assertEqual(workspace.experiment.model_dump(),before)
        comparison,_=workspace.execute('compare_parameter',{'elementId':'lens','field':'clearApertureMm','start':10,'stop':30,'count':3})
        self.assertIsNone(comparison['rows'][0]['error']);self.assertIsNotNone(comparison['rows'][-1]['error']);self.assertEqual(workspace.experiment.model_dump(),before)

if __name__=='__main__':unittest.main()

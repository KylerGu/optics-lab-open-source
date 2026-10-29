import math
import unittest

from fastapi.testclient import TestClient
from backend.app import app
from backend.spatial import SpatialExperiment, sample_offsets, trace


def element(kind, id, position, **params):
    return {"id": id, "name": id, "kind": kind, "position": position, **params}


def experiment(*elements):
    return SpatialExperiment.model_validate({"schemaVersion": 2, "name": "三维验证", "elements": list(elements)})


class SpatialOpticsTests(unittest.TestCase):
    def test_disk_samples_keep_count_balance_and_boundary(self):
        for count in (1,2,3,4,9,18,100,201):
            points=sample_offsets(4,count)
            self.assertEqual(len(points),count)
            self.assertEqual(points[0],(0,0))
            if count>1:
                self.assertAlmostEqual(max(math.hypot(x,y) for x,y in points),4)
            if count!=2:
                self.assertAlmostEqual(sum(x for x,_ in points),0,places=10)
                self.assertAlmostEqual(sum(y for _,y in points),0,places=10)

    def test_aperture_power_tracks_uniform_beam_area_instead_of_one_jump(self):
        powers=[]
        for diameter in (1,2,4,6,8):
            result=trace(experiment(element('laser','source',[0,60,0],beamRadiusMm=4,rayCount=201,powerMw=10),
                                    element('aperture','iris',[100,60,0],diameterMm=diameter),
                                    element('screen','screen',[200,60,0])))
            power=result['screens'][0]['sampledPowerMw']
            expected=10*(diameter/8)**2
            self.assertAlmostEqual(power,expected,delta=10/201)
            powers.append(power)
        self.assertTrue(all(a<b for a,b in zip(powers,powers[1:])))
        self.assertAlmostEqual(powers[-1],10)

    def test_divergence_matches_half_angle_at_screen(self):
        result=trace(experiment(element('laser','source',[0,60,0],beamRadiusMm=2,divergenceMrad=20,rayCount=17),
                               element('screen','screen',[200,60,0],diameterMm=100)))
        self.assertEqual(result['screens'][0]['hits'],17)
        self.assertAlmostEqual(result['screens'][0]['footprintRadiusMm'],2+200*math.tan(.020),places=10)

    def test_ray_count_changes_sampling_without_changing_emitted_power(self):
        for count in (1,9,25,201):
            result=trace(experiment(element('laser','source',[0,60,0],powerMw=75,rayCount=count),
                                   element('filter','filter',[100,60,0],transmission=.2),
                                   element('screen','screen',[200,60,0])))
            self.assertEqual(result['screens'][0]['hits'],count)
            self.assertAlmostEqual(result['screens'][0]['sampledPowerMw'],15,places=10)
            self.assertAlmostEqual(sum(s['powerMw'] for s in result['segments'] if s['hitId']=='filter'),75)

    def test_source_power_weights_multiple_sources_and_split_branches(self):
        result=trace(experiment(element('laser','low',[0,60,-5],powerMw=10),
                               element('laser','high',[0,60,5],powerMw=90,rayCount=17),
                               element('splitter','split',[100,60,0],yawDeg=-45,transmission=.3),
                               element('screen','through',[200,60,0],diameterMm=100),
                               element('screen','reflect',[100,60,100],yawDeg=90,diameterMm=100)))
        self.assertAlmostEqual(result['screens'][0]['sampledPowerMw'],30)
        self.assertAlmostEqual(result['screens'][1]['sampledPowerMw'],70)
        first=[s for s in result['segments'] if s['hitId']=='split']
        self.assertAlmostEqual(sum(s['powerMw'] for s in first if s['sourceId']=='low'),10)
        self.assertAlmostEqual(sum(s['powerMw'] for s in first if s['sourceId']=='high'),90)

    def test_zero_power_emits_no_rays_and_gaussian_envelope_keeps_full_power(self):
        off=trace(experiment(element('laser','off',[0,60,0],powerMw=0)))
        self.assertEqual(off['segments'],[])
        self.assertTrue(any('功率' in warning for warning in off['warnings']))
        for count in (1,17):
            gaussian=trace(experiment(element('laser','source',[0,60,0],beamModel='gaussian',powerMw=12,rayCount=count),
                                      element('filter','filter',[100,60,0],transmission=.25)))
            self.assertAlmostEqual(gaussian['beams'][0]['powerMw'],12)
            self.assertAlmostEqual(gaussian['beams'][1]['powerMw'],3)

    def test_api_rejects_invalid_source_controls(self):
        client=TestClient(app)
        for key,values in {'powerMw':[-1,1001],'divergenceMrad':[-1,101],'rayCount':[0,202,1.5,True]}.items():
            for value in values:
                response=client.post('/api/spatial/simulate',json={'revision':1,'experiment':{'schemaVersion':2,'name':'验证','elements':[element('laser','source',[0,60,0],**{key:value})]}})
                self.assertEqual(response.status_code,422,(key,value))

    def test_gaussian_scene_copy_keeps_original_free_propagation_reading(self):
        result=trace(experiment(element("laser","source",[30,60,0],beamRadiusMm=.2,wavelengthNm=532,beamModel="gaussian"),
                               element("screen","screen",[350,60,0])))
        zr=math.pi*.2**2/.000532
        expected=.2*math.sqrt(1+(320/zr)**2)
        self.assertAlmostEqual(result["screens"][0]["gaussianRadiusMm"],expected,places=12)
        self.assertAlmostEqual(result["beams"][0]["radiiMm"][-1],expected,places=12)

    def test_gaussian_focus_is_finite_and_mirror_adds_optical_path(self):
        focused=trace(experiment(element("laser","source",[0,60,0],beamRadiusMm=1,wavelengthNm=500,beamModel="gaussian"),
                                element("lens","lens",[100,60,0],focalLengthMm=100),
                                element("screen","screen",[200,60,0])))
        self.assertAlmostEqual(focused["screens"][0]["gaussianRadiusMm"],.0005*100/math.pi,places=12)
        folded=trace(experiment(element("laser","source",[0,60,0],beamRadiusMm=.2,beamModel="gaussian"),
                               element("mirror","mirror",[100,60,0],yawDeg=-45),
                               element("screen","screen",[100,60,100],yawDeg=90)))
        zr=math.pi*.2**2/.000532
        self.assertAlmostEqual(folded["screens"][0]["gaussianRadiusMm"],.2*math.sqrt(1+(200/zr)**2),places=12)

    def test_mirrors_fold_light_horizontally_then_vertically(self):
        result = trace(experiment(
            element("laser", "source", [70, 60, -70]),
            element("mirror", "horizontal", [280, 60, -70], yawDeg=-45),
            element("mirror", "vertical", [280, 60, 90], yawDeg=90, pitchDeg=-45),
            element("screen", "screen", [280, 235, 90], pitchDeg=90, diameterMm=70)))
        chief = [s for s in result["segments"] if s["chief"]]
        self.assertEqual([s["hitId"] for s in chief], ["horizontal", "vertical", "screen"])
        for got, expected in zip(chief[-1]["end"], [280, 235, 90]):
            self.assertAlmostEqual(got, expected)
        self.assertEqual(result["screens"][0]["hits"], 9)
        self.assertAlmostEqual(result["screens"][0]["footprintRadiusMm"], 4)

    def test_positive_lens_focuses_parallel_rays_at_focal_plane(self):
        result = trace(experiment(element("laser", "source", [0,60,0]),
                                  element("lens", "lens", [100,60,0], focalLengthMm=100),
                                  element("screen", "screen", [200,60,0])))
        self.assertEqual(result["screens"][0]["hits"], 9)
        self.assertAlmostEqual(result["screens"][0]["footprintRadiusMm"], 0, places=9)

    def test_tilted_optical_axis_focuses_in_space(self):
        direction = [math.sqrt(.5), math.sqrt(.5), 0]
        source = [10,60,0]
        lens = [source[i]+100*direction[i] for i in range(3)]
        screen = [source[i]+200*direction[i] for i in range(3)]
        result = trace(experiment(element("laser", "source", source, pitchDeg=45),
                                  element("lens", "lens", lens, pitchDeg=45, focalLengthMm=100),
                                  element("screen", "screen", screen, pitchDeg=45)))
        self.assertEqual(result["screens"][0]["hits"], 9)
        self.assertAlmostEqual(result["screens"][0]["footprintRadiusMm"], 0, places=9)

    def test_negative_lens_diverges_and_filter_attenuates(self):
        result = trace(experiment(element("laser", "source", [0,60,0]),
                                  element("lens", "lens", [100,60,0], focalLengthMm=-100),
                                  element("filter", "filter", [150,60,0], transmission=.2),
                                  element("screen", "screen", [200,60,0])))
        self.assertAlmostEqual(result["screens"][0]["footprintRadiusMm"], 8)
        self.assertAlmostEqual(result["screens"][0]["sampledPowerFraction"], .2)

    def test_splitter_conserves_sampled_power_across_branches(self):
        result = trace(experiment(element("laser", "source", [0,60,0]),
                                  element("splitter", "splitter", [100,60,0], yawDeg=-45, transmission=.3),
                                  element("screen", "transmitted", [200,60,0]),
                                  element("screen", "reflected", [100,60,100], yawDeg=90)))
        self.assertEqual([s["hits"] for s in result["screens"]], [9,9])
        self.assertAlmostEqual(result["screens"][0]["sampledPowerFraction"], .3)
        self.assertAlmostEqual(result["screens"][1]["sampledPowerFraction"], .7)

    def test_aperture_blocks_peripheral_rays(self):
        result = trace(experiment(element("laser", "source", [0,60,0], beamRadiusMm=4),
                                  element("aperture", "aperture", [100,60,0], diameterMm=2),
                                  element("screen", "screen", [200,60,0])))
        self.assertEqual(result["screens"][0]["hits"], 1)
        self.assertAlmostEqual(result["screens"][0]["sampledPowerFraction"], 1/9)

    def test_off_axis_screen_reports_no_hits(self):
        result = trace(experiment(element("laser", "source", [0,60,0]),
                                  element("screen", "screen", [200,160,0])))
        self.assertEqual(result["screens"][0]["hits"], 0)
        self.assertIsNone(result["screens"][0]["footprintRadiusMm"])
        self.assertTrue(result["warnings"])

    def test_reflection_loop_has_finite_limit(self):
        result = trace(experiment(element("laser", "source", [50,60,0]),
                                  element("mirror", "right", [100,60,0]),
                                  element("mirror", "left", [0,60,0])))
        self.assertLessEqual(len(result["segments"]), 9*32)
        self.assertTrue(any("32" in w for w in result["warnings"]))

    def test_api_preserves_revision_and_rejects_invalid_data(self):
        client=TestClient(app)
        body={"revision":17,"experiment":experiment(element("laser","source",[0,60,0])).model_dump(mode="json")}
        reply=client.post('/api/spatial/simulate',json=body)
        self.assertEqual(reply.status_code,200)
        self.assertEqual(reply.json()["revision"],17)
        self.assertEqual(reply.json()["inputSnapshot"],body["experiment"])
        body["experiment"]["elements"].append(element("lens","bad",[100,60,0],focalLengthMm=0))
        self.assertEqual(client.post('/api/spatial/simulate',json=body).status_code,422)

    def test_api_requires_a_source(self):
        response=TestClient(app).post('/api/spatial/simulate',json={"revision":1,"experiment":experiment().model_dump()})
        self.assertEqual(response.status_code,422)


if __name__ == '__main__':
    unittest.main()

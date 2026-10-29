import copy
import json
import math
import unittest

from fastapi.testclient import TestClient

from backend.app import app
from backend.models import Experiment
from backend.optics import relative_intensity, simulate


def source(position=0, waist=1, wavelength=500):
    return {"id": "source", "kind": "laser", "name": "光源", "positionMm": position, "waistMm": waist, "wavelengthNm": wavelength}


def lens(position, focal, diameter=25.4, id="lens"):
    return {"id": id, "kind": "lens", "name": id, "positionMm": position, "focalLengthMm": focal, "diameterMm": diameter}


def screen(position, size=40, id="screen"):
    return {"id": id, "kind": "screen", "name": id, "positionMm": position, "sizeMm": size}


def experiment(*elements):
    return Experiment.model_validate({"schemaVersion": 1, "name": "验证实验", "railLengthMm": 600, "elements": list(elements)})


class AnalyticOpticsTests(unittest.TestCase):
    def test_free_space_matches_closed_form_and_nm_conversion(self):
        radius0 = 0.1
        result = simulate(experiment(source(30, radius0, 500), screen(230)))
        rayleigh = math.pi * radius0 ** 2 / 0.0005
        expected = radius0 * math.sqrt(1 + (200 / rayleigh) ** 2)
        self.assertAlmostEqual(result["rayleighRangeMm"], rayleigh, places=12)
        self.assertAlmostEqual(result["screens"][0]["radiusMm"], expected, places=12)
        self.assertAlmostEqual(result["minimum"]["positionMm"], 30)

    def test_parallel_rays_focus_one_focal_length_after_positive_lens(self):
        result = simulate(experiment(source(), lens(100, 100), screen(200)))
        for ray in result["rayPaths"]:
            first, at_lens, last = ray["points"]
            slope = (last["heightMm"] - at_lens["heightMm"]) / (last["positionMm"] - at_lens["positionMm"])
            focus_height = at_lens["heightMm"] + slope * 100
            self.assertAlmostEqual(focus_height, 0, places=12)
            self.assertAlmostEqual(at_lens["heightMm"], first["heightMm"], places=12)

    def test_gaussian_focus_is_finite_and_exact_minimum_is_sampled(self):
        # Input waist is one focal length before lens: new waist occurs f after it,
        # and w_new = lambda*f/(pi*w0), independently derived from the analytic law.
        result = simulate(experiment(source(), lens(100, 100), screen(200)))
        expected = 0.0005 * 100 / math.pi
        self.assertAlmostEqual(result["minimum"]["positionMm"], 200, places=10)
        self.assertAlmostEqual(result["minimum"]["radiusMm"], expected, places=12)
        self.assertAlmostEqual(result["screens"][0]["radiusMm"], expected, places=12)
        self.assertTrue(any(abs(point["positionMm"] - 200) < 1e-9 for point in result["samples"]))
        self.assertGreater(result["minimum"]["radiusMm"], 0)

    def test_galilean_two_times_expander_matches_hand_matrix(self):
        result = simulate(experiment(source(), lens(50, -50, id="L1"), lens(100, 100, id="L2")))
        for key, expected in {"A": 2, "B": 400, "C": 0, "D": 0.5}.items():
            self.assertAlmostEqual(result["endMatrix"][key], expected, places=12)
        for ray in result["rayPaths"]:
            self.assertAlmostEqual(ray["points"][-1]["heightMm"], ray["initialHeightMm"] * 2, places=12)
            self.assertAlmostEqual(ray["points"][-1]["heightMm"], ray["points"][-2]["heightMm"], places=12)

    def test_sampling_screens_do_not_change_downstream_propagation(self):
        plain = simulate(experiment(source(), lens(100, 100)))
        with_probes = simulate(experiment(source(), screen(50, id="S1"), lens(100, 100), screen(200, id="S2")))
        self.assertEqual(plain["endMatrix"], with_probes["endMatrix"])
        self.assertAlmostEqual(plain["samples"][-1]["radiusMm"], with_probes["samples"][-1]["radiusMm"])

    def test_square_capture_fraction_matches_independent_quadrature(self):
        result = simulate(experiment(source(0, 10), screen(1, size=5)))
        measurement = result["screens"][0]
        width = measurement["radiusMm"]
        step = 5 / 20000
        integral = sum(math.sqrt(2 / math.pi) / width * math.exp(-2 * ((-2.5 + (index + 0.5) * step) / width) ** 2) * step for index in range(20000))
        self.assertAlmostEqual(measurement["capturedFraction"], integral ** 2, places=9)
        self.assertAlmostEqual(relative_intensity(width, width), math.exp(-2), places=14)

    def test_aperture_clips_rays_and_marks_gaussian_as_reference(self):
        result = simulate(experiment(source(0, 2), lens(100, 100, diameter=1)))
        self.assertEqual(result["quality"], "reference-only")
        self.assertGreater(result["apertureChecks"][0]["clippedFraction"], 0.01)
        self.assertTrue(any(ray["blockedBy"] == "lens" for ray in result["rayPaths"]))
        self.assertIsNone(result["rayPaths"][4]["blockedBy"])

    def test_large_angle_is_reported(self):
        result = simulate(experiment(source(), lens(100, 1)))
        self.assertEqual(result["quality"], "reference-only")
        self.assertTrue(any("近轴" in warning for warning in result["warnings"]))

    def test_wavelength_affects_diffraction_but_not_geometrical_rays(self):
        blue = simulate(experiment(source(0, 0.1, 400), screen(500)))
        red = simulate(experiment(source(0, 0.1, 800), screen(500)))
        self.assertGreater(red["screens"][0]["radiusMm"], blue["screens"][0]["radiusMm"])
        self.assertEqual(red["rayPaths"], blue["rayPaths"])

    def test_invalid_geometry_is_not_silently_ignored(self):
        for invalid in [experiment(), experiment(source(100), lens(50, 100)), experiment(source(), lens(100, 100), screen(100)), experiment(source(600))]:
            with self.assertRaises(ValueError):
                simulate(invalid)

    def test_lens_radius_is_continuous_across_thin_lens(self):
        result = simulate(experiment(source(), screen(99.999, id="before"), lens(100, 100), screen(100.001, id="after")))
        self.assertAlmostEqual(result["screens"][0]["radiusMm"], result["screens"][1]["radiusMm"], delta=2e-5)
        json.dumps(result, allow_nan=False)


class ServiceContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_api_echoes_snapshot_revision_and_finite_results(self):
        document = experiment(source(), lens(100, 100), screen(200)).model_dump()
        original = copy.deepcopy(document)
        response = self.client.post("/api/simulate", json={"revision": 7, "experiment": document})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["revision"], 7)
        self.assertEqual(response.json()["inputSnapshot"], original)
        self.assertEqual(document, original)
        json.dumps(response.json(), allow_nan=False)

    def test_invalid_parameters_and_unsupported_geometry_return_422(self):
        invalid = experiment(source(), lens(100, 100)).model_dump()
        invalid["elements"][1]["focalLengthMm"] = 0
        response = self.client.post("/api/simulate", json={"revision": 0, "experiment": invalid})
        self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/simulate", json={"revision": 0, "experiment": experiment(source(200), screen(100)).model_dump()})
        self.assertEqual(response.status_code, 422)
        self.assertIn("光源右侧", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()

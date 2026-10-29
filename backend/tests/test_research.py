import copy
import json
import math
import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import app
from backend.models import Experiment
from backend.optics import simulate
from backend.research import FocusGoal, search_focus
from backend.tests import test_agent as agent_tests
from backend.tests.test_agent import answer, call, experiment


def goal(**patch):
    return FocusGoal.model_validate({"lensId": "lens", "screenId": "screen", "screenPositionMm": 350,
                                   "positionRange": {"start": 200, "stop": 300},
                                   "focalRange": {"start": 80, "stop": 160}, **patch})


class ResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = experiment()
        cls.design = search_focus(cls.original, goal())

    def test_every_grid_radius_agrees_with_independent_abcd_formula(self):
        # For a waist at z=0: w_screen^2 = A^2*w0^2 + B^2*(lambda/pi/w0)^2.
        # Free-space s, thin lens f, free-space L: A=1-L/f, B=s+L-s*L/f.
        for row in self.design["rows"]:
            s, f = row["positionMm"], row["focalLengthMm"]
            distance = 350 - s
            a, b = 1 - distance / f, s + distance - s * distance / f
            expected = math.hypot(a, b * 0.0005 / math.pi)
            self.assertAlmostEqual(row["radiusMm"], expected, places=12)

    def test_recommendation_minimizes_screen_radius_and_is_recomputed(self):
        design = self.design
        best = design["recommendation"]
        self.assertEqual(design["counts"]["total"], 882)
        self.assertEqual(best["radiusMm"], min(row["radiusMm"] for row in design["rows"]))
        actual = simulate(Experiment.model_validate(best["experiment"]))
        self.assertEqual(best["radiusMm"], actual["screens"][0]["radiusMm"])
        self.assertAlmostEqual(best["radiusMm"], 0.0005 * 80 / math.pi, places=12)
        self.assertEqual(best["boundaryParameters"], ["焦距"])
        self.assertTrue(best["verified"])

    def test_search_keeps_inputs_and_baseline_uses_fixed_screen(self):
        before = copy.deepcopy(self.original.model_dump())
        design = search_focus(self.original, goal())
        self.assertEqual(self.original.model_dump(), before)
        self.assertEqual(design["inputSnapshot"], before)
        a = 1 - (350 - 100) / 100
        b = 350 - 100 * (350 - 100) / 100
        self.assertAlmostEqual(design["baseline"]["radiusMm"], math.hypot(a, b*0.0005/math.pi), places=12)
        self.assertEqual(design["recommendation"]["experiment"]["elements"][-1]["positionMm"], 350)
        json.dumps(design, allow_nan=False)

    def test_warned_cases_are_recorded_but_never_recommended(self):
        document = experiment().model_dump()
        document["elements"][0]["waistMm"] = 10
        document["elements"][1]["diameterMm"] = 1
        design = search_focus(Experiment.model_validate(document), goal())
        self.assertIsNone(design["recommendation"])
        self.assertEqual(design["counts"]["referenceOnly"], 441)
        self.assertEqual(len(design["grids"]), 1)
        self.assertTrue(design["noRecommendationReason"])

    def test_collision_combinations_are_not_silently_removed(self):
        document = experiment().model_dump()
        document["elements"].append({"id": "extra", "kind": "screen", "name": "额外屏", "positionMm": 200, "sizeMm": 40})
        design = search_focus(Experiment.model_validate(document), goal())
        self.assertEqual(design["counts"]["invalid"], 21)
        self.assertTrue(all(row["error"] for row in design["rows"] if row["positionMm"] == 200))
        self.assertIsNotNone(design["recommendation"])

    def test_bounds_and_unsupported_devices_fail_before_search(self):
        for patch in [{"positionRange": {"start": 300, "stop": 200}}, {"focalRange": {"start": -10, "stop": 160}},
                      {"positionRange": {"start": 200, "stop": 350}}, {"focalRange": {"start": 1, "stop": 1e308}},
                      {"focalRange": {"start": 4000, "stop": 4000.00000000001}},
                      {"screenPositionMm": float("nan")}, {"gridSize": 100000}]:
            with self.assertRaises(ValidationError):
                goal(**patch)
        for invalid in [goal(lensId="missing"), goal(screenId="lens"), goal(positionRange={"start": 0, "stop": 300})]:
            with self.assertRaises(ValueError):
                search_focus(experiment(), invalid)
        document = experiment().model_dump()
        document["elements"].append({**document["elements"][1], "id": "lens2", "positionMm": 180})
        with self.assertRaisesRegex(ValueError, "一片透镜"):
            search_focus(Experiment.model_validate(document), goal())

    def test_api_echoes_request_and_returns_reproducible_record(self):
        client = TestClient(app)
        payload = {"requestId": "research-turn", "experiment": experiment().model_dump(), "goal": goal().model_dump()}
        response = client.post("/api/research/focus", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["requestId"], payload["requestId"])
        repeated = search_focus(Experiment.model_validate(data["design"]["inputSnapshot"]), FocusGoal.model_validate(data["design"]["goal"]))
        self.assertEqual(data["design"]["rows"], repeated["rows"])
        payload["goal"]["focalRange"]["start"] = 0
        self.assertEqual(client.post("/api/research/focus", json=payload).status_code, 422)


class ResearchAgentTests(unittest.TestCase):
    def test_agent_search_returns_full_grid_without_modifying_device(self):
        observed = []
        result = agent_tests.AgentLoopTests().execute([answer(calls=[call("search_focus_design", {"goal": goal().model_dump()})]), answer("搜索完成，点击载入。")], observer=observed.append)
        self.assertFalse(result["changed"])
        self.assertEqual(len(result["designs"][0]["rows"]), 882)
        tool_data = json.loads(observed[-1]["messages"][-1]["content"])["data"]
        self.assertNotIn("rows", tool_data)
        self.assertTrue(tool_data["recommendation"]["verified"])

    def test_search_apply_runs_real_calculation_and_stale_design_cannot_apply(self):
        from backend.agent import Workspace
        workspace = Workspace(experiment())
        design, _ = workspace.execute("search_focus_design", {"goal": goal().model_dump()})
        workspace.execute("apply_focus_design", {"designId": design["id"]})
        self.assertEqual(workspace.evidence["screens"][0]["radiusMm"], design["recommendation"]["radiusMm"])
        self.assertEqual(workspace.evidence_key, workspace.key())
        with self.assertRaises(ValueError):
            workspace.execute("search_focus_design", {"goal": goal().model_dump()})
        with self.assertRaises(ValueError):
            workspace.execute("apply_focus_design", {"designId": design["id"]})


if __name__ == "__main__":
    unittest.main()

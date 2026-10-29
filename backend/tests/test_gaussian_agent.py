"""Scene isolation and real physics through the agent protocol, without API charges."""
import json
import math
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentRequest, Workspace, run_agent
from backend.app import app
from backend.models import Experiment
from backend.gaussian import GaussianTarget, solve_gaussian_target
from backend.settings import Settings
from backend.tests.test_agent import answer, call, experiment as lens_experiment


def scene():
    return Experiment.model_validate({"schemaVersion": 1, "name": "高斯光束 · 自由传播", "railLengthMm": 600, "elements": [
        {"id": "source", "kind": "laser", "name": "束腰", "positionMm": 30, "waistMm": 0.2, "wavelengthNm": 532},
        {"id": "screen", "kind": "screen", "name": "观察平面", "positionMm": 350, "sizeMm": 40},
    ]})


class GaussianAgentTests(unittest.TestCase):
    def execute(self, responses, observed=None, message="解释当前光束"):
        queue = iter(responses)
        def handle(request):
            if observed is not None:
                observed.append(json.loads(request.content))
            return httpx.Response(200, json=next(queue))
        request = AgentRequest(requestId="gaussian-turn", scene="gaussian", experiment=scene(), message=message)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            return run_agent(request, Settings("test-private", "deepseek-flash"), client)

    def test_scene_context_contains_current_readings_and_only_scene_tools(self):
        observed = []
        result = self.execute([answer(calls=[call("simulate_experiment", {})]), answer("当前光束在观察位置展开。")], observed)
        payload = observed[0]
        self.assertEqual({entry["function"]["name"] for entry in payload["tools"]},
                         {"read_experiment", "update_element", "simulate_experiment", "scan_parameter", "solve_gaussian_target", "apply_gaussian_target"})
        prompt = payload["messages"][0]["content"]
        self.assertIn("高斯光束自由传播场景", prompt)
        self.assertIn("按本平面峰值归一化", prompt)
        self.assertNotIn("单透镜自动设计", prompt)
        beam = result["evidence"]["gaussian"]
        self.assertEqual(beam["distanceMm"], 320)
        self.assertEqual(beam["waistPositionMm"], 30)
        self.assertEqual(beam["observationPositionMm"], 350)
        rayleigh = math.pi * 0.2 ** 2 / 0.000532
        self.assertAlmostEqual(beam["rayleighMm"], rayleigh)
        self.assertAlmostEqual(beam["radiusMm"], 0.2 * math.hypot(1, 320 / rayleigh))
        self.assertAlmostEqual(beam["wavefrontRadiusMm"], 320 + rayleigh ** 2 / 320)
        self.assertEqual(beam["region"], "transition")
        self.assertEqual(beam["maxDistanceMm"], 570)
        self.assertFalse(beam["farRegionReachable"])
        self.assertFalse(result["changed"])
        self.assertTrue(all("透镜" not in step["summary"] for step in result["trace"]))

    def test_definition_question_does_not_run_physics_or_add_evidence(self):
        with patch('backend.agent.simulate') as physics:
            result = self.execute([answer(r'瑞利长度为$z_R=\frac{\pi w_0^2}{\lambda}$，光斑半径在此距离增至$\sqrt{2}w_0$。')])
            physics.assert_not_called()
        self.assertEqual(result['trace'], [])
        self.assertIsNone(result['evidence'])
        self.assertEqual(result['scans'], [])
        self.assertFalse(result['changed'])

    def test_old_tools_and_non_scene_fields_are_rejected_without_mutation(self):
        workspace = Workspace(scene(), "gaussian")
        before = workspace.experiment.model_dump()
        for name, args in [
            ("set_experiment", {"experiment": lens_experiment().model_dump()}),
            ("remove_element", {"elementId": "screen"}),
            ("search_focus_design", {"goal": {}}),
            ("analyze_tolerance", {"tolerance": {}}),
            ("update_element", {"elementId": "screen", "patch": {"sizeMm": 60}}),
            ("update_element", {"elementId": "source", "patch": {"name": "新名称"}}),
            ("update_element", {"elementId": "screen", "patch": {"positionMm": 29}}),
            ("update_element", {"elementId": "source", "patch": {"positionMm": 350}}),
            ("scan_parameter", {"elementId": "screen", "field": "sizeMm", "start": 20, "stop": 40, "count": 3}),
        ]:
            with self.subTest(tool=name, args=args), self.assertRaises(ValueError):
                workspace.execute(name, args)
            self.assertEqual(workspace.experiment.model_dump(), before)

    def test_out_of_scene_provider_call_is_returned_as_error(self):
        observed = []
        result = self.execute([answer(calls=[call("set_experiment", {"experiment": lens_experiment().model_dump()})]),
                               answer("透镜任务请在光路搭建中完成。")], observed)
        self.assertFalse(result["changed"])
        self.assertEqual(result["trace"][-1]["status"], "error")
        self.assertFalse(json.loads(observed[-1]["messages"][-1]["content"])["ok"])

    def test_requested_parameter_edit_is_verified_before_returning(self):
        result = self.execute([answer(calls=[call("update_element", {"elementId": "source", "patch": {"waistMm": 0.1}})]),
                               answer("已调整束腰。"), answer("已根据计算核对新光束。")], message="帮我调整束腰")
        self.assertTrue(result["changed"])
        self.assertEqual(result["inputSnapshot"]["elements"][0]["waistMm"], 0.2)
        self.assertEqual(result["experiment"]["elements"][0]["waistMm"], 0.1)
        beam = result["evidence"]["gaussian"]
        self.assertEqual(beam["waistMm"], 0.1)
        expected = 0.1 * math.hypot(1, 320 * 0.000532 / (math.pi * 0.1 ** 2))
        self.assertAlmostEqual(beam["radiusMm"], expected)

    def test_comparison_uses_real_free_propagation_and_preserves_scene(self):
        observed = []
        result = self.execute([answer(calls=[call("scan_parameter", {"elementId": "source", "field": "waistMm", "start": 0.1, "stop": 0.3, "count": 3})]),
                               answer("束腰较小不保证此处光斑较小。")], observed)
        self.assertFalse(result["changed"])
        rows = result["scans"][0]["rows"]
        for row in rows:
            expected = row["value"] * math.hypot(1, 320 * 0.000532 / (math.pi * row["value"] ** 2))
            self.assertAlmostEqual(row["result"]["screens"][0]["radiusMm"], expected)
            self.assertEqual(row["result"]["gaussian"]["observationPositionMm"], 350)
        self.assertGreater(rows[0]["result"]["gaussian"]["radiusMm"], rows[1]["result"]["gaussian"]["radiusMm"])
        self.assertGreater(rows[2]["result"]["gaussian"]["radiusMm"], rows[1]["result"]["gaussian"]["radiusMm"])
        self.assertIsNone(result["evidence"])
        self.assertEqual(result["experiment"]["elements"][0]["waistMm"], 0.2)
        self.assertTrue(rows[0]["result"]["gaussian"]["farRegionReachable"])
        self.assertFalse(rows[2]["result"]["gaussian"]["farRegionReachable"])
        self.assertEqual(observed[-1]["messages"][-1]["role"], "system")
        self.assertIn("不要再生成表格", observed[-1]["messages"][-1]["content"])

    def test_position_comparison_marks_invalid_planes_and_preserves_original(self):
        workspace = Workspace(scene(), "gaussian")
        before = workspace.experiment.model_dump()
        scan, _ = workspace.execute("scan_parameter", {"elementId": "screen", "field": "positionMm", "start": 20, "stop": 40, "count": 3})
        self.assertEqual(scan["fieldLabel"], "观察位置")
        self.assertIsNone(scan["rows"][0]["result"])
        self.assertIsNone(scan["rows"][1]["result"])
        self.assertEqual(scan["rows"][2]["result"]["gaussian"]["distanceMm"], 10)
        self.assertEqual(workspace.experiment.model_dump(), before)

    def test_invalid_scene_requests_never_reach_provider(self):
        base = AgentRequest(requestId="validation", scene="gaussian", experiment=scene(), message="解释").model_dump()
        reversed_scene = scene().model_dump()
        reversed_scene["elements"][1]["positionMm"] = 30
        for patch_fields in [
            {"scene": "unknown"}, {"experiment": lens_experiment().model_dump()}, {"experiment": reversed_scene},
            {"mode": "research"}, {"learningContext": {"courseId": "gaussian-lens", "lessonId": "focus", "prediction": ""}},
        ]:
            with self.subTest(fields=patch_fields), patch("backend.app.run_agent") as provider:
                response = TestClient(app).post("/api/agent/chat", json={**base, **patch_fields})
                self.assertEqual(response.status_code, 422)
                provider.assert_not_called()

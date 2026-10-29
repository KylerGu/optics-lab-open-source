import copy
import json
import math
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError, AgentRequest, Workspace, run_agent
from backend.app import app
from backend.models import Experiment
from backend.settings import Settings, get_settings


def experiment():
    return Experiment.model_validate({"schemaVersion": 1, "name": "工具调用验证", "railLengthMm": 600, "elements": [
        {"id": "source", "kind": "laser", "name": "光源", "positionMm": 0, "waistMm": 1, "wavelengthNm": 500},
        {"id": "lens", "kind": "lens", "name": "透镜", "positionMm": 100, "focalLengthMm": 100, "diameterMm": 25.4},
        {"id": "screen", "kind": "screen", "name": "观察屏", "positionMm": 200, "sizeMm": 40},
    ]})


def call(name, arguments, id="tool1"):
    return {"id": id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}


def answer(content="验证回复", calls=None, finish=None):
    return {"choices": [{"finish_reason": finish or ("tool_calls" if calls else "stop"), "message": {"role": "assistant", "content": content, **({"tool_calls": calls} if calls else {})}}]}


def request(document=None):
    return AgentRequest(requestId="test-turn", experiment=document or experiment(), message="调整并计算")


class AgentToolTests(unittest.TestCase):
    def test_parameter_scan_runs_physics_and_preserves_original(self):
        workspace = Workspace(experiment())
        before = workspace.experiment.model_dump()
        data, _ = workspace.execute("scan_parameter", {"elementId": "lens", "field": "focalLengthMm", "start": 80, "stop": 120, "count": 5})
        self.assertEqual(workspace.experiment.model_dump(), before)
        self.assertEqual(len(data["rows"]), 5)
        standard = data["rows"][2]["result"]
        self.assertAlmostEqual(standard["minimum"]["radiusMm"], 0.0005 * 100 / math.pi, places=12)
        self.assertAlmostEqual(standard["minimum"]["positionMm"], 200, places=10)
        json.dumps(data, allow_nan=False)

    def test_invalid_edits_are_atomic(self):
        workspace = Workspace(experiment())
        before = workspace.experiment.model_dump()
        for arguments in [{"elementId": "lens", "patch": {"focalLengthMm": 0}}, {"elementId": "lens", "patch": {"waistMm": 1}}, {"elementId": "lens", "patch": {"id": "renamed"}}]:
            with self.assertRaises(ValueError):
                workspace.execute("update_element", arguments)
            self.assertEqual(workspace.experiment.model_dump(), before)

    def test_tools_cannot_execute_arbitrary_commands_or_unknown_fields(self):
        workspace = Workspace(experiment())
        for name, args in [("execute_python", {"code": "print(1)"}), ("read_experiment", {"filename": ".env"}), ("remove_element", {})]:
            with self.assertRaises(ValueError):
                workspace.execute(name, args)

    def test_scan_bounds_and_invalid_points_are_reported(self):
        workspace = Workspace(experiment())
        base = {"elementId": "lens", "field": "focalLengthMm", "start": -1, "stop": 1, "count": 3}
        result, _ = workspace.execute("scan_parameter", base)
        self.assertIsNone(result["rows"][1]["result"])
        self.assertIsNotNone(result["rows"][1]["error"])
        for invalid in [{**base, "count": 1000}, {**base, "start": float("inf")}, {**base, "start": -1e308, "stop": 1e308}, {**base, "start": 2}, {**base, "field": "wavelengthNm"}]:
            with self.assertRaises(ValueError):
                workspace.execute("scan_parameter", invalid)


class AgentLoopTests(unittest.TestCase):
    def execute(self, responses, document=None, observer=None):
        queue = iter(responses)
        def handle(req):
            payload = json.loads(req.content)
            if observer:
                observer(payload)
            return httpx.Response(200, json=next(queue))
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            return run_agent(request(document), Settings("unit-test-credential", "deepseek-flash"), client)

    def test_real_tools_complete_multi_round_edit_simulation_and_scan(self):
        document = experiment()
        original = copy.deepcopy(document.model_dump())
        observed = []
        result = self.execute([
            answer(calls=[call("update_element", {"elementId": "lens", "patch": {"focalLengthMm": 120}})]),
            answer(calls=[call("simulate_experiment", {}, "tool2"), call("scan_parameter", {"elementId": "lens", "field": "focalLengthMm", "start": 80, "stop": 160, "count": 5}, "tool3")]),
            answer("依据实际计算完成比较。"),
        ], document, observed.append)
        self.assertEqual(document.model_dump(), original)
        self.assertTrue(result["changed"])
        self.assertEqual(result["experiment"]["elements"][1]["focalLengthMm"], 120)
        self.assertEqual(len(result["scans"][0]["rows"]), 5)
        self.assertGreater(result["evidence"]["minimum"]["radiusMm"], 0)
        self.assertTrue(any(message["role"] == "tool" and json.loads(message["content"])["ok"] for message in observed[-1]["messages"]))
        self.assertNotIn("unit-test-credential", json.dumps(result))

    def test_edit_is_verified_even_when_model_forgets_calculation(self):
        observed = []
        result = self.execute([answer(calls=[call("update_element", {"elementId": "lens", "patch": {"focalLengthMm": 150}})]), answer("初步方案"), answer("根据核对数据解释。")], observer=observed.append)
        self.assertTrue(result["changed"])
        self.assertEqual(result["answer"], "根据核对数据解释。")
        self.assertTrue(any("应用前核对" in step["summary"] for step in result["trace"]))
        self.assertIn("真实计算结果", observed[-1]["messages"][-1]["content"])

    def test_failed_physical_plan_is_not_returned_as_applied(self):
        with self.assertRaises(AgentError) as error:
            self.execute([answer(calls=[call("update_element", {"elementId": "lens", "patch": {"positionMm": 200}})]), answer()])
        self.assertEqual(error.exception.status, 422)

    def test_tool_error_is_returned_to_model_for_correction(self):
        observed = []
        result = self.execute([answer(calls=[call("update_element", {"elementId": "lens", "patch": {"focalLengthMm": 0}})]), answer("焦距无效，未修改。")], observer=observed.append)
        self.assertFalse(result["changed"])
        self.assertEqual(result["trace"][-1]["status"], "error")
        self.assertFalse(json.loads(observed[-1]["messages"][-1]["content"])["ok"])

    def test_model_truncation_and_malformed_response_are_not_success(self):
        for malformed in [answer(finish="length"), {"choices": []}, answer(calls=[{"type": "function"}])]:
            with self.assertRaises(AgentError):
                self.execute([malformed])

    def test_tool_loop_is_bounded(self):
        with self.assertRaises(AgentError):
            self.execute([answer(calls=[call("read_experiment", {})])] * 8)

    def test_upstream_error_body_and_credential_are_not_exposed(self):
        for status in [401, 402, 429, 500]:
            with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status, text="private-upstream-details"))) as client:
                with self.assertRaises(AgentError) as error:
                    run_agent(request(), Settings("private-test-key", "deepseek-flash"), client)
                self.assertNotIn("private-upstream-details", error.exception.message)
                self.assertNotIn("private-test-key", error.exception.message)

    def test_read_only_reply_has_actual_current_calculation(self):
        result = self.execute([answer(calls=[call("simulate_experiment", {})]), answer("解释当前装置。")])
        self.assertFalse(result["changed"])
        self.assertAlmostEqual(result["evidence"]["minimum"]["radiusMm"], 0.0005 * 100 / math.pi, places=12)
        self.assertAlmostEqual(result["evidence"]["minimumDistancesFromLensesMm"][0]["distanceMm"], 100, places=10)

    def test_two_lens_reference_distinguishes_equal_focal_sum_and_absolute_position(self):
        document = experiment().model_dump()
        document["elements"][1]["positionMm"] = 180
        document["elements"].insert(2, {"id": "lens2", "kind": "lens", "name": "第二片透镜", "positionMm": 430, "focalLengthMm": 150, "diameterMm": 25.4})
        document["elements"][-1]["positionMm"] = 520
        result = self.execute([answer(calls=[call("simulate_experiment", {})]), answer("解释两透镜参考数据。")], Experiment.model_validate(document))
        pair = result["evidence"]["twoLensReference"][0]
        self.assertEqual(pair["separationMinusFocalSumMm"], 0)
        self.assertTrue(pair["afocalForParallelInput"])
        self.assertEqual(pair["parallelInputWidthRatioAbs"], 1.5)


class AgentConfigurationTests(unittest.TestCase):
    def test_dotenv_is_private_and_environment_takes_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('DEEPSEEK_API_KEY="local-test-key"\nDEEPSEEK_MODEL=deepseek-flash\nIGNORED=anything', encoding="utf-8")
            with patch("backend.settings.ENV_PATH", path), patch.dict("os.environ", {}, clear=True):
                self.assertEqual(get_settings().api_key, "local-test-key")
                with patch.dict("os.environ", {"DEEPSEEK_API_KEY": "environment-test-key"}):
                    self.assertEqual(get_settings().api_key, "environment-test-key")

    def test_custom_provider_model_and_endpoint_are_configurable(self):
        captured=[]
        def handle(req):
            captured.append((str(req.url),json.loads(req.content)))
            return httpx.Response(200,json=answer('普通问答。'))
        settings=Settings('private-custom-key','my-optics-model','https://models.example/v1')
        self.assertTrue(settings.configured)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            run_agent(request(),settings,client)
        self.assertEqual(captured[0][0],'https://models.example/v1/chat/completions')
        self.assertEqual(captured[0][1]['model'],'my-optics-model')
        self.assertNotIn('thinking',captured[0][1])
        with patch.dict('os.environ',{'AI_API_KEY':'generic-key','AI_MODEL':'custom-model','AI_BASE_URL':'http://127.0.0.1:1234/v1'},clear=True):
            loaded=get_settings()
            self.assertEqual(loaded.model,'custom-model')
            self.assertEqual(loaded.base_url,'http://127.0.0.1:1234/v1')
            self.assertTrue(loaded.configured)

    def test_incomplete_or_malformed_custom_configuration_is_not_connected(self):
        for endpoint in ['', 'file:///private', 'https://user:secret@example.com', 'https://example.com?key=secret']:
            self.assertFalse(Settings('key','custom-model',endpoint).configured)

    def test_missing_key_makes_no_provider_request(self):
        with patch("backend.agent.completion") as provider:
            with self.assertRaises(AgentError):
                run_agent(request(), Settings("", "deepseek-flash"))
            provider.assert_not_called()

    def test_status_and_missing_configuration_endpoint(self):
        client = TestClient(app)
        with patch("backend.app.get_settings", return_value=Settings("", "deepseek-flash")):
            self.assertFalse(client.get("/api/agent/status").json()["configured"])
            response = client.post("/api/agent/chat", json=request().model_dump())
            self.assertEqual(response.status_code, 503)
        with patch("backend.app.get_settings", return_value=Settings("private-test-key", "deepseek-flash")):
            status = client.get("/api/agent/status").json()
            self.assertTrue(status["configured"])
            self.assertNotIn("private-test-key", json.dumps(status))

    def test_chat_history_cannot_inject_system_role(self):
        document = request().model_dump()
        document["history"] = [{"role": "system", "content": "invalid"}]
        self.assertEqual(TestClient(app).post("/api/agent/chat", json=document).status_code, 422)


if __name__ == "__main__":
    unittest.main()

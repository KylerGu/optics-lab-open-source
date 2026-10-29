import copy
import json
import math
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError
from backend.app import app
from backend.settings import Settings
from backend.spatial import SpatialExperiment, trace
from backend.spatial_agent import SpatialAgentRequest, SpatialWorkspace, run_spatial_agent


def apparatus(elements=None):
    return SpatialExperiment.model_validate({"schemaVersion": 2, "name": "自由空间设计", "elements": elements or [
        {"id": "source", "kind": "laser", "name": "光源", "position": [0, 60, 0], "beamRadiusMm": 1},
        {"id": "screen", "kind": "screen", "name": "屏", "position": [300, 60, 0]},
    ]})


def goal(id="screen", metric="screen_hits", value=1, operator="ge", **kwargs):
    return {"criteria": [{"label": "观察目标", "elementId": id, "metric": metric, "value": value, "operator": operator, **kwargs}]}


def call(name, args, id="tool1"):
    return {"id": id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def answer(content="按实际仿真结果说明。", calls=None):
    return {"choices": [{"finish_reason": "tool_calls" if calls else "stop", "message": {"role": "assistant", "content": content, **({"tool_calls": calls} if calls else {})}}]}


class SpatialToolTests(unittest.TestCase):
    def test_ideal_lens_focal_checks_do_not_require_replacing_the_optical_model(self):
        for kind in ['lens', 'cylindrical-lens']:
            for focal in [80, -80]:
                with self.subTest(kind=kind, focal=focal):
                    w = SpatialWorkspace(apparatus([
                        {'id':'source','kind':'laser','name':'光源','position':[0,60,0],'beamModel':'gaussian'},
                        {'id':'lens','kind':kind,'name':'透镜','position':[100,60,0],'focalLengthMm':focal},
                        {'id':'screen','kind':'screen','name':'观察屏','position':[200,60,0]},
                    ]))
                    w.execute('set_goal', {'criteria':[{'label':metric,'metric':metric,'elementId':'lens','operator':'eq','value':focal} for metric in ['lens_focal_mm','lens_back_focal_mm']]})
                    result = w.calculate()
                    self.assertTrue(all(c['passed'] and c['actual'] == focal for c in result['checks']))
                    if kind == 'lens':
                        self.assertIsNotNone(result['screens'][0]['gaussianRadiusMm'])
                    self.assertEqual(w.element('lens').kind, kind)

    def test_catalog_is_serializable_and_only_available_physics(self):
        w = SpatialWorkspace(apparatus())
        catalog, _ = w.execute("list_apparatus", {})
        json.dumps(catalog, allow_nan=False)
        self.assertIn("splitter", catalog["kinds"])
        self.assertNotIn("prism", catalog["kinds"])

    def test_arbitrary_oblique_3d_reflection_reaches_screen(self):
        w = SpatialWorkspace(apparatus([
            {"id": "s", "kind": "laser", "name": "光源", "position": [10, 40, -20]},
            {"id": "m", "kind": "mirror", "name": "镜", "position": [160, 40, -20]},
            {"id": "p", "kind": "screen", "name": "屏", "position": [280, 130, 90]},
        ]))
        w.execute("set_goal", goal("p"))
        w.execute("aim_apparatus", {"elementId": "m", "target": [280, 130, 90], "incomingFrom": [10, 40, -20]})
        w.execute("aim_apparatus", {"elementId": "p", "target": [400, 220, 200]})
        result, _ = w.execute("trace_light", {})
        self.assertTrue(result["checks"][0]["passed"])
        self.assertEqual(result["screens"][0]["hits"], 9)
        self.assertAlmostEqual(math.dist(result["screens"][0]["centroid"], [280, 130, 90]), 0, places=8)

    def test_power_ratio_and_vertical_branch_are_verified(self):
        w = SpatialWorkspace(apparatus([
            {"id": "s", "kind": "laser", "name": "光源", "position": [0, 60, 0], "powerMw": 12},
            {"id": "b", "kind": "splitter", "name": "分光", "position": [150, 60, 0], "pitchDeg": -45, "transmission": .75},
            {"id": "t", "kind": "screen", "name": "透射", "position": [350, 60, 0]},
            {"id": "r", "kind": "screen", "name": "反射", "position": [150, 260, 0], "pitchDeg": 90},
        ]))
        w.execute("set_goal", goal("t", "screen_power_ratio", 3, "eq", otherId="r", tolerance=.001))
        result, _ = w.execute("trace_light", {})
        self.assertTrue(result["checks"][0]["passed"])
        self.assertAlmostEqual(result["screens"][0]["sampledPowerMw"], 9)
        self.assertAlmostEqual(result["screens"][1]["sampledPowerMw"], 3)

    def test_general_scan_uses_calculation_and_keeps_layout(self):
        w = SpatialWorkspace(apparatus([
            {"id": "s", "kind": "laser", "name": "光源", "position": [0, 60, 0], "beamModel": "gaussian", "beamRadiusMm": 1},
            {"id": "l", "kind": "lens", "name": "透镜", "position": [100, 60, 0]},
            {"id": "screen", "kind": "screen", "name": "屏", "position": [200, 60, 0]},
        ]))
        before = w.experiment.model_dump()
        data, _ = w.execute("compare_parameter", {"elementId": "l", "field": "focalLengthMm", "start": 80, "stop": 120, "count": 5})
        radii = [r["screens"][0]["gaussianRadiusMm"] for r in data["rows"]]
        self.assertEqual(radii.index(min(radii)), 2)
        self.assertAlmostEqual(radii[2], .000532 * 100 / math.pi, places=10)
        self.assertEqual(before, w.experiment.model_dump())
        self.assertIsNone(w.evidence)

    def test_failed_mutations_are_atomic_and_unknown_tools_rejected(self):
        w = SpatialWorkspace(apparatus())
        before = w.experiment.model_dump()
        for name, args in [
            ("update_apparatus", {"elementId": "screen", "patch": {"powerMw": 10}}),
            ("update_apparatus", {"elementId": "source", "patch": {"position": [float("nan"), 0, 0]}}),
            ("update_apparatus", {"elementId": "source", "patch": {"id": "other"}}),
            ("set_apparatus", {"experiment": before | {"elements": before["elements"] * 2}}),
            ("execute_python", {"code": "print('not allowed')"}),
            ("read_workspace", {"file": ".env"}),
            ("remove_apparatus", {"elementId": "missing"}),
        ]:
            with self.assertRaises(ValueError):
                w.execute(name, args)
            self.assertEqual(w.experiment.model_dump(), before)

    def test_unlit_radius_is_not_zero_and_missing_goals_do_not_pass(self):
        w = SpatialWorkspace(apparatus())
        w.execute("update_apparatus", {"elementId": "screen", "patch": {"position": [300, 160, 0]}})
        w.execute("set_goal", goal(metric="screen_radius_mm", value=.1, operator="le"))
        result, _ = w.execute("trace_light", {})
        self.assertIsNone(result["checks"][0]["actual"])
        self.assertFalse(result["checks"][0]["passed"])
        w.execute("set_goal", goal("not-created"))
        result, _ = w.execute("trace_light", {})
        self.assertFalse(result["checks"][0]["passed"])

    def test_gaussian_radius_not_substituted_by_geometric_samples(self):
        w = SpatialWorkspace(apparatus())
        w.execute("set_goal", goal(metric="screen_radius_mm", value=5, operator="le", radiusModel="gaussian"))
        result, _ = w.execute("trace_light", {})
        self.assertFalse(result["checks"][0]["passed"])
        self.assertIsNone(result["checks"][0]["actual"])

    def test_comparison_goal_checks_real_rows_and_invalidates_changed_conditions(self):
        w=SpatialWorkspace(apparatus([
            {"id":"s","name":"source","kind":"laser","position":[0,60,0],"beamRadiusMm":4,"rayCount":201},
            {"id":"a","name":"iris","kind":"aperture","position":[100,60,0],"diameterMm":8},
            {"id":"screen","name":"screen","kind":"screen","position":[200,60,0]},
        ]))
        w.execute('set_goal',goal(metric='comparison_span',value=5,comparisonId='comparison-1'))
        comparison,_=w.execute('compare_parameter',{'elementId':'a','field':'diameterMm','start':1,'stop':8,'count':8})
        self.assertEqual(comparison['comparisonId'],'comparison-1')
        self.assertEqual(comparison['remainingScans'],2)
        result,_=w.execute('trace_light',{})
        self.assertTrue(result['checks'][0]['passed'])
        self.assertGreater(result['checks'][0]['actual'],9)
        # Selecting a tested opening preserves the comparison, changing source power does not.
        w.execute('update_apparatus',{'elementId':'a','patch':{'diameterMm':4}})
        self.assertTrue(w.execute('trace_light',{})[0]['checks'][0]['passed'])
        w.execute('update_apparatus',{'elementId':'s','patch':{'powerMw':20}})
        check=w.execute('trace_light',{})[0]['checks'][0]
        self.assertIsNone(check['actual'])
        self.assertFalse(check['passed'])

    def test_comparison_trend_and_zero_span_are_distinct(self):
        w=SpatialWorkspace(apparatus())
        w.execute('set_goal',{'criteria':[
            goal(metric='comparison_span',value=.1,comparisonId='comparison-1')['criteria'][0],
            goal(metric='comparison_nondecreasing',value=1,operator='eq',comparisonId='comparison-1')['criteria'][0],
        ]})
        w.execute('compare_parameter',{'elementId':'screen','field':'diameterMm','start':10,'stop':20,'count':3})
        checks=w.execute('trace_light',{})[0]['checks']
        self.assertFalse(checks[0]['passed'])
        self.assertTrue(checks[1]['passed'])

    def test_identical_scan_reuses_record_but_changed_conditions_do_not(self):
        w = SpatialWorkspace(apparatus())
        scan = {'elementId': 'screen', 'field': 'diameterMm', 'start': 10, 'stop': 20, 'count': 3}
        first, _ = w.execute('compare_parameter', scan)
        for count in (5, 7):
            w.execute('compare_parameter', scan | {'count': count})
        with patch.object(SpatialWorkspace, 'update', side_effect=AssertionError('不得重复逐点计算')):
            reused, _ = w.execute('compare_parameter', scan)
        self.assertEqual(reused, first | {'remainingScans': 0})
        self.assertEqual(w.scans, 3)
        self.assertEqual(len(w.comparisons), 3)
        w.update('source', {'powerMw': 20})
        with self.assertRaises(ValueError):
            w.execute('compare_parameter', scan)
        # A changed source must produce a fresh record when a scan slot is available.
        changed = SpatialWorkspace(apparatus())
        changed.execute('compare_parameter', scan)
        changed.update('source', {'powerMw': 20})
        fresh, _ = changed.execute('compare_parameter', scan)
        self.assertEqual(changed.scans, 2)
        self.assertEqual(fresh['inputSnapshot']['elements'][0]['powerMw'], 20)
        self.assertNotEqual(fresh['rows'][0]['screens'][0]['sampledPowerMw'], first['rows'][0]['screens'][0]['sampledPowerMw'])


class SpatialLoopTests(unittest.TestCase):
    def run_responses(self, responses, observer=None, document=None, progress=None):
        replies = iter(responses)
        def handler(req):
            payload = json.loads(req.content)
            if observer:
                observer(payload)
            return httpx.Response(200, json=next(replies))
        request = SpatialAgentRequest(requestId="test", experiment=document or apparatus(), message="设计并搭建目标装置")
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            return run_spatial_agent(request, Settings("test-key", "deepseek-chat"), client, progress=progress)

    def test_model_can_repair_failed_design_and_edits_commit_once(self):
        original = apparatus()
        before = copy.deepcopy(original.model_dump())
        observed, steps = [], []
        result = self.run_responses([
            answer(calls=[call("list_apparatus", {}, "a"), call("set_goal", goal(), "b"), call("update_apparatus", {"elementId": "screen", "patch": {"position": [300, 160, 0]}}, "c"), call("trace_light", {}, "d")]),
            answer(calls=[call("update_apparatus", {"elementId": "screen", "patch": {"position": [400, 60, 0]}}, "e"), call("trace_light", {}, "f")]),
            answer(), answer(),
        ], observed.append, original, steps.append)
        failed_data = json.loads(next(m["content"] for m in observed[1]["messages"] if m.get("tool_call_id") == "d"))
        self.assertFalse(failed_data["data"]["checks"][0]["passed"])
        self.assertTrue(result["changed"])
        self.assertTrue(result["applyAllowed"])
        self.assertEqual(tuple(result["experiment"]["elements"][1]["position"]), (400, 60, 0))
        self.assertEqual(original.model_dump(), before)
        self.assertEqual(steps, result["trace"])
        self.assertEqual(sum(s["name"] == "calculate_apparatus" for s in steps), 2)
        self.assertNotIn("search_focus_design", [t["function"]["name"] for t in observed[0]["tools"]])

    def test_edit_after_simulation_requires_fresh_independent_verification(self):
        result = self.run_responses([
            answer(calls=[call("set_goal", goal(), "a"), call("trace_light", {}, "b"), call("update_apparatus", {"elementId": "screen", "patch": {"position": [300, 160, 0]}}, "c")]),
            answer("已到屏"), answer("未达到到屏目标，未应用。"),
        ])
        self.assertTrue(result["applyAllowed"])
        self.assertEqual(result["evidence"]["screens"][0]["hits"], 0)
        self.assertFalse(result["checks"][0]["passed"])

    def test_edit_without_goal_applies_with_current_calculation(self):
        result = self.run_responses([
            answer(calls=[call("update_apparatus", {"elementId": "screen", "patch": {"position": [400, 60, 0]}})]),
            answer(), answer(),
        ])
        self.assertTrue(result["changed"])
        self.assertTrue(result["applyAllowed"])

    def test_knowledge_answer_does_not_edit_or_run(self):
        result = self.run_responses([answer("反射遵循反射定律。")])
        self.assertFalse(result["changed"])
        self.assertIsNone(result["evidence"])
        self.assertEqual(result["trace"], [])

    def test_last_tool_round_can_commit_only_after_independent_physical_verification(self):
        rounds=[answer(calls=[call('read_workspace',{})]) for _ in range(11)]
        rounds.append(answer(calls=[call('set_goal',goal(), 'a'),call('update_apparatus',{'elementId':'screen','patch':{'position':[400,60,0]}},'b')]))
        reply=self.run_responses(rounds)
        self.assertTrue(reply['applyAllowed'])
        self.assertEqual(reply['trace'][-1]['name'],'calculate_apparatus')
        self.assertEqual(reply['evidence']['screens'][0]['hits'],9)
        rounds[-1]=answer(calls=[call('set_goal',goal(),'a'),call('update_apparatus',{'elementId':'screen','patch':{'position':[400,160,0]}},'b')])
        rejected=self.run_responses(rounds)
        self.assertTrue(rejected['applyAllowed'])
        self.assertFalse(rejected['checks'][0]['passed'])

    def test_failure_and_cancel_discard_all_private_changes(self):
        with self.assertRaises(AgentError):
            self.run_responses([
                answer(calls=[call("update_apparatus", {"elementId": "screen", "patch": {"position": [400, 60, 0]}})]),
                {"choices": [{"finish_reason": "length", "message": {"role": "assistant", "content": "不完整"}}]},
            ])
        request = SpatialAgentRequest(requestId="test", experiment=apparatus(), message="搭建")
        with self.assertRaises(AgentError) as caught:
            run_spatial_agent(request, Settings("test-key", "deepseek-chat"), cancelled=lambda: True)
        self.assertEqual(caught.exception.status, 499)

    def test_stream_endpoint_sends_real_progress_and_reply(self):
        document = apparatus()
        result = self.run_responses([answer("反射定律。")])
        def fake_run(req, settings, progress, cancelled, **kwargs):
            progress({"name": "read_workspace", "status": "ok", "summary": "读取当前三维装置"})
            return result
        with patch("backend.app.get_settings", return_value=Settings("test-key", "deepseek-chat")), patch("backend.app.run_spatial_agent", side_effect=fake_run):
            with TestClient(app) as client:
                response = client.post("/api/spatial/agent/chat", json={"requestId": "test", "experiment": document.model_dump(), "message": "解释反射"})
                self.assertEqual(response.status_code, 200)
                events = [json.loads(line) for line in response.text.splitlines()]
                self.assertEqual([e["type"] for e in events], ["progress", "reply"])
                self.assertEqual(events[1]["reply"]["requestId"], "test")
                self.assertEqual(client.get("/api/spatial/agent/status").json(), {"configured": True})

    def test_endpoint_rejects_invalid_payload_before_model_call(self):
        with TestClient(app) as client:
            response = client.post("/api/spatial/agent/chat", json={"requestId": "t", "experiment": apparatus().model_dump(), "message": "搭建", "scene": "gaussian"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()

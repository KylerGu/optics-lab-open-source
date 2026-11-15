import json
import unittest
from unittest.mock import patch

import httpx

from backend.prompt_modules import (
    COMPARISON_GUIDANCE,
    IMAGING_GUIDANCE,
    MODELS_SCENE_GUIDANCE,
    PHYSICAL_LENS_GUIDANCE,
    POLARIZATION_GUIDANCE,
    PRISM_GUIDANCE,
    RESEARCH_CORE_ORDER,
    RESEARCH_MODULE_MAP,
    SPATIAL_CORE_ORDER,
    SPATIAL_MODULE_MAP,
    WAVE_FOURIER_GUIDANCE,
    detect_topics,
    render_topics,
)
from backend.research_agent import (
    ResearchAgentRequest,
    ResearchObject,
    ResearchWorkspace,
    build_research_prompt,
    research_tools_for,
    run_research_agent,
)
from backend.settings import Settings
from backend.spatial import SpatialExperiment, trace
from backend.spatial_agent import (
    SpatialAgentRequest,
    SpatialWorkspace,
    build_spatial_prompt,
    run_spatial_agent,
    spatial_tools_for,
)


def _call(name, args, call_id="c1"):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def _basic_elements():
    return [
        {"id": "source", "kind": "laser", "name": "激光", "position": [0, 60, 0], "beamModel": "parallel", "beamRadiusMm": 1},
        {"id": "lens", "kind": "lens", "name": "透镜", "position": [100, 60, 0], "focalLengthMm": 100},
        {"id": "screen", "kind": "screen", "name": "观察屏", "position": [200, 60, 0]},
    ]


def _basic_experiment():
    return SpatialExperiment.model_validate({"schemaVersion": 2, "name": "基础光路", "elements": _basic_elements()})


class PromptModuleSlimmingTests(unittest.TestCase):
    def test_ordinary_qa_and_basic_setup_omit_unrelated_modules_and_stay_compact(self):
        qa_topics = detect_topics(["你好，什么是瑞利长度？"])
        self.assertNotIn("polarization", qa_topics)
        self.assertNotIn("wave_fourier", qa_topics)
        self.assertNotIn("prism", qa_topics)
        self.assertNotIn("physical_lens", qa_topics)
        self.assertNotIn("imaging", qa_topics)

        qa_req = ResearchAgentRequest(requestId="qa", message="什么是焦点？")
        qa_ws = ResearchWorkspace()
        qa_prompt = build_research_prompt(qa_ws, qa_topics)
        qa_tools = research_tools_for(qa_ws, qa_topics, [qa_req.message])
        qa_tool_names = {t["function"]["name"] for t in qa_tools}

        self.assertLess(len(qa_prompt), 4000)
        self.assertLess(len(json.dumps(qa_tools, ensure_ascii=False)), 6000)
        for excluded in (
            "search_focus_design",
            "analyze_tolerance",
            "search_robust_focus",
            "compare_objects",
            "set_research_plan",
            "update_research_step",
            "set_research_title",
        ):
            self.assertNotIn(excluded, qa_tool_names)
        for excluded_text in (POLARIZATION_GUIDANCE, WAVE_FOURIER_GUIDANCE, PRISM_GUIDANCE, PHYSICAL_LENS_GUIDANCE):
            self.assertNotIn(excluded_text, qa_prompt)

        exp = _basic_experiment()
        sp_topics = detect_topics(["帮我搭一个准直激光聚焦光路"], elements=exp.elements)
        sp_prompt = build_spatial_prompt(exp, sp_topics)
        sp_tools = spatial_tools_for(exp.elements, sp_topics, ["帮我搭一个准直激光聚焦光路"])
        sp_tool_names = {t["function"]["name"] for t in sp_tools}

        self.assertLess(len(sp_prompt), 4000)
        self.assertLess(len(json.dumps(sp_tools, ensure_ascii=False)), 6000)
        for excluded in ("search_focus_design", "analyze_tolerance", "search_robust_focus"):
            self.assertNotIn(excluded, sp_tool_names)
        for excluded_text in (POLARIZATION_GUIDANCE, WAVE_FOURIER_GUIDANCE, PRISM_GUIDANCE, PHYSICAL_LENS_GUIDANCE):
            self.assertNotIn(excluded_text, sp_prompt)

    def test_domain_elements_and_keywords_inject_matching_modules_and_tools(self):
        cases = [
            ("quarter-wave-plate", {"id": "qwp", "kind": "quarter-wave-plate", "name": "四分之一波片", "position": [80, 60, 0]}, "polarization", POLARIZATION_GUIDANCE),
            ("dispersion-prism", {"id": "prism", "kind": "dispersion-prism", "name": "色散棱镜", "position": [80, 60, 0]}, "prism", PRISM_GUIDANCE),
            ("positive-meniscus-lens", {"id": "pm", "kind": "positive-meniscus-lens", "name": "正弯月透镜", "position": [80, 60, 0]}, "physical_lens", PHYSICAL_LENS_GUIDANCE),
        ]
        for label, extra_elem, topic, guidance_snippet in cases:
            with self.subTest(label=label):
                exp = SpatialExperiment.model_validate({"schemaVersion": 2, "name": label, "elements": [*_basic_elements(), extra_elem]})
                topics = detect_topics(["检查光路"], elements=exp.elements)
                self.assertIn(topic, topics)
                rendered = render_topics(topics, SPATIAL_MODULE_MAP, SPATIAL_CORE_ORDER)
                self.assertIn(guidance_snippet, rendered)

        kw_topics = detect_topics(["请帮我做 4f 空间滤波并分析公差"])
        self.assertIn("wave_fourier", kw_topics)
        self.assertIn("comparison_metric", kw_topics)
        self.assertIn(WAVE_FOURIER_GUIDANCE, render_topics(kw_topics, RESEARCH_MODULE_MAP, RESEARCH_CORE_ORDER))
        self.assertIn(COMPARISON_GUIDANCE, render_topics(kw_topics, RESEARCH_MODULE_MAP, RESEARCH_CORE_ORDER))

        exp = _basic_experiment()
        req = ResearchAgentRequest(
            requestId="multi",
            titleNeeded=True,
            activeObjectId="a",
            message="比较两个方案的公差稳健性并制定探究计划",
            objects=[
                ResearchObject(id="a", source="draft", label="方案A", experiment=exp),
                ResearchObject(id="b", source="draft", label="方案B", experiment=exp),
            ],
        )
        ws = ResearchWorkspace(objects=req.objects, active_object_id=req.activeObjectId, title_needed=req.titleNeeded)
        topics = detect_topics(
            [req.message],
            elements=exp.elements,
            has_plan=True,
            has_comparisons=True,
            needs_title=req.titleNeeded,
        )
        tools = research_tools_for(ws, topics, [req.message])
        tool_names = {t["function"]["name"] for t in tools}
        self.assertTrue({"set_research_title", "compare_objects", "analyze_tolerance", "search_robust_focus", "set_research_plan"} <= tool_names)

        sp_tools = spatial_tools_for(exp.elements, topics, [req.message])
        sp_names = {t["function"]["name"] for t in sp_tools}
        self.assertIn("compare_parameter", sp_names)
        self.assertIn("set_goal", sp_names)

    def test_spatial_lazy_guidance_attached_once_on_add_apparatus(self):
        requests = []
        replies = iter([
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("add_apparatus", {"element": {"id": "p1", "kind": "polarizer", "name": "偏振片", "position": [60, 60, 0]}}, "add1"),
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("add_apparatus", {"element": {"id": "q1", "kind": "quarter-wave-plate", "name": "波片", "position": [120, 60, 0]}}, "add2"),
                ],
            },
            {"role": "assistant", "content": "已完成搭建并按仿真说明。"},
        ])

        def provider(request):
            requests.append(json.loads(request.content))
            msg = next(replies)
            return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls" if msg.get("tool_calls") else "stop", "message": msg}]})

        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_spatial_agent(
                SpatialAgentRequest(requestId="sp-lazy", experiment=_basic_experiment(), message="帮我搭一个简单器件测试"),
                Settings("test", "test", "https://example.test"),
                client=client,
            )

        self.assertEqual(len(requests), 3)
        self.assertNotIn(POLARIZATION_GUIDANCE, requests[0]["messages"][0]["content"])
        first_tool_msg = next(m for m in reversed(requests[1]["messages"]) if m.get("role") == "tool")
        first_tool_payload = json.loads(first_tool_msg["content"])
        self.assertIn("guidance", first_tool_payload["data"])
        self.assertIn("偏振与波片", first_tool_payload["data"]["guidance"])
        second_tool_msg = next(m for m in reversed(requests[2]["messages"]) if m.get("role") == "tool")
        second_tool_payload = json.loads(second_tool_msg["content"])
        self.assertNotIn("guidance", second_tool_payload["data"])
        self.assertEqual(len(result["experiment"]["elements"]), 5)

    def test_research_lazy_guidance_for_build_and_run_model_experiment_without_duplication(self):
        prism_exp = SpatialExperiment.model_validate({
            "schemaVersion": 2,
            "name": "棱镜色散实验",
            "elements": [
                {"id": "s1", "kind": "laser", "name": "光源", "position": [0, 60, 0]},
                {"id": "pr", "kind": "dispersion-prism", "name": "色散棱镜", "position": [100, 60, 0]},
                {"id": "sc", "kind": "screen", "name": "屏", "position": [220, 60, 0]},
            ],
        })
        prism_evidence = trace(prism_exp)
        fake_proposal = {
            "experiment": prism_exp,
            "evidence": prism_evidence,
            "comparisons": [],
            "checks": [],
        }

        requests = []
        replies = iter([
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("build_research_apparatus", {"goal": "搭建色散测试光路"}, "b1"),
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("run_model_experiment", {"sceneId": "instruments-0", "parameters": {"study": 1}}, "m1"),
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("run_model_experiment", {"sceneId": "interference-0", "parameters": {}}, "m2"),
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    _call("run_model_experiment", {"sceneId": "interference-0", "parameters": {"wavelengthNm": 633}}, "m3"),
                ],
            },
            {"role": "assistant", "content": "全部计算完成。"},
        ])

        def provider(request):
            requests.append(json.loads(request.content))
            msg = next(replies)
            return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls" if msg.get("tool_calls") else "stop", "message": msg}]})

        with patch("backend.research_agent.build_research_apparatus", return_value=fake_proposal), \
             httpx.Client(transport=httpx.MockTransport(provider)) as client:
            run_research_agent(
                ResearchAgentRequest(requestId="lazy", message="先随便搭建几个参考装置做个小测试"),
                Settings("test", "test", "https://example.test"),
                client=client,
            )

        self.assertEqual(len(requests), 5)
        self.assertNotIn(PRISM_GUIDANCE, requests[0]["messages"][0]["content"])

        build_payload = json.loads(requests[1]["messages"][-1]["content"])["data"]
        self.assertIn(PRISM_GUIDANCE, build_payload.get("guidance", ""))

        model_instr_payload = json.loads(requests[2]["messages"][-1]["content"])["data"]
        self.assertIn(MODELS_SCENE_GUIDANCE, model_instr_payload.get("guidance", ""))
        self.assertIn(IMAGING_GUIDANCE, model_instr_payload.get("guidance", ""))

        model_wave_payload = json.loads(requests[3]["messages"][-1]["content"])["data"]
        self.assertNotIn(MODELS_SCENE_GUIDANCE, model_wave_payload.get("guidance", ""))
        self.assertIn(WAVE_FOURIER_GUIDANCE, model_wave_payload.get("guidance", ""))

        model_repeat_payload = json.loads(requests[4]["messages"][-1]["content"])["data"]
        self.assertNotIn("guidance", model_repeat_payload)

    def test_update_apparatus_unknown_field_reports_applicable_fields_hint(self):
        workspace = SpatialWorkspace(_basic_experiment())
        with self.assertRaises(ValueError) as ctx:
            workspace.execute("update_apparatus", {"elementId": "lens", "patch": {"curvatureMm": 50}})
        self.assertIn("可用字段", str(ctx.exception))
        self.assertIn("focalLengthMm", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()

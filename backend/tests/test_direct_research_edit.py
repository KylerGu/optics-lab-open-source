import json
import unittest
from unittest.mock import patch

import httpx

from backend.agent import AgentError
from backend.research_agent import ResearchAgentRequest, ResearchObject, ResearchWorkspace, run_research_agent
from backend.research_builder import build_research_apparatus
from backend.spatial import trace
from backend.spatial import SpatialExperiment
from backend.spatial_agent import SpatialWorkspace
from backend.tests.test_research_builder import SETTINGS, apparatus, call, message, response, verified_proposal


class DirectResearchEditTests(unittest.TestCase):
    def test_new_build_can_be_corrected_in_same_turn_with_history(self):
        proposal = verified_proposal()
        w = ResearchWorkspace(builder=lambda *_: proposal)
        w.context_read = True
        w.execute('build_research_apparatus', {'goal': '搭建装置'})
        original_id = w.active_id
        w.execute('update_research_element', {'elementId': 'screen', 'patch': {'position': [220, 60, 0]}})
        result = w.reply('r', '已修改新装置', [])
        self.assertTrue(result['editsApplyAllowed'])
        self.assertEqual(result['activeObjectId'], original_id)
        self.assertEqual(len(result['objectSnapshots']), 1)
        self.assertEqual(result['apparatusBuilds'][0]['reply']['experiment']['elements'][-1]['position'][0], 200)
        self.assertEqual(result['apparatusEdits'][0]['reply']['experiment']['elements'][-1]['position'][0], 220)
        self.assertEqual(result['parameterHistory'][0]['inputSnapshot']['elements'][-1]['position'][0], 200)

    def test_comparison_supplies_real_adjustment_button_without_model_call(self):
        w = self.workspace()
        data, _ = w.execute('compare_parameter', {'elementId': 'screen', 'field': 'x', 'start': 180, 'stop': 220, 'count': 3})
        action = data['visualActions'][0]
        self.assertEqual((action['objectId'], action['elementId'], action['kind'], action['field']), ('o', 'screen', 'adjust', 'x'))
        self.assertEqual(w.reply('r', '可以点击下面的调整按钮', [])['visualActions'], [action])

    def test_builder_comparison_is_reused_at_matching_parameters(self):
        proposal = verified_proposal()
        spatial = SpatialWorkspace(apparatus())
        args = {'elementId': 'lens', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 3}
        spatial.execute('compare_parameter', args)
        proposal['comparisons'] = spatial.comparisons
        w = ResearchWorkspace(builder=lambda *_: proposal)
        w.context_read = True
        data, _ = w.execute('build_research_apparatus', {'goal': '搭建'})
        self.assertEqual(len(data['comparisons']), 1)
        with patch('backend.spatial_agent.trace', wraps=trace) as compute:
            result, explanation = w.execute('compare_parameter', args)
        self.assertIn('复用', explanation)
        self.assertEqual(len(w.spatial.comparisons), 1)
        self.assertEqual(result['rows'], spatial.comparisons[0]['rows'])
        self.assertEqual(compute.call_count, 0)

    def workspace(self, **kwargs):
        seed = apparatus()
        return ResearchWorkspace(objects=[ResearchObject(id='o', source='saved', experiment=seed)], active_object_id='o', **kwargs)

    def test_direct_edits_keep_other_parameters_and_reuse_real_calculation(self):
        for element_id, changes in [('lens', {'focalLengthMm': 120}), ('screen', {'position': [220, 60, 0]}), ('source', {'powerMw': 5})]:
            with self.subTest(element=element_id):
                w = self.workspace(builder=lambda *_: self.fail('明确参数不应交给搭建助手'))
                original = w.original.model_dump()
                expected = apparatus()
                for e in expected.elements:
                    if e.id == element_id:
                        for key, value in changes.items():
                            setattr(e, key, tuple(value) if key == 'position' else value)
                expected = SpatialExperiment.model_validate(expected.model_dump())
                with patch('backend.spatial_agent.trace', wraps=trace) as compute:
                    data, _ = w.execute('update_research_element', {'elementId': element_id, 'patch': changes})
                    w.execute('simulate_apparatus', {})
                self.assertEqual(compute.call_count, 1)
                self.assertEqual(w.original, expected)
                self.assertEqual(w.parameter_history[0][2].original.model_dump(), original)
                self.assertEqual(w.spatial.evidence, trace(expected))
                self.assertEqual(data['result']['screens'], trace(expected)['screens'])
                reply = w.reply('r', '已修改', [])
                self.assertTrue(reply['editsApplyAllowed'])
                self.assertEqual(reply['activeObjectId'], 'o')

    def test_invalid_changes_and_cancellation_do_not_replace_original(self):
        for element_id, changes in [('missing', {'focalLengthMm': 120}), ('lens', {'kind': 'mirror'}), ('screen', {'position': [2000, 60, 0]}), ('lens', {})]:
            w = self.workspace()
            with self.assertRaises(ValueError):
                w.execute('update_research_element', {'elementId': element_id, 'patch': changes})
            self.assertEqual(w.original, apparatus())
            self.assertEqual(w.apparatus_edits, [])
        w = self.workspace(cancelled=lambda: True)
        with self.assertRaises(AgentError):
            w.execute('update_research_element', {'elementId': 'lens', 'patch': {'focalLengthMm': 120}})
        self.assertEqual(w.original, apparatus())

    def test_cache_refreshes_when_parameters_change(self):
        w = SpatialWorkspace(apparatus())
        with patch('backend.spatial_agent.trace', wraps=trace) as compute:
            before = w.calculate()
            self.assertEqual(before, w.calculate())
            w.update('lens', {'focalLengthMm': 120})
            after = w.calculate()
            w.calculate()
        self.assertEqual(compute.call_count, 2)
        self.assertNotEqual(before['screens'][0]['gaussianRadiusMm'], after['screens'][0]['gaussianRadiusMm'])
        self.assertEqual(w.evidence, trace(w.experiment))

    def test_handoff_reuses_only_matching_evidence(self):
        proposal = verified_proposal()
        with patch('backend.research_builder.run_spatial_agent', return_value=proposal), patch('backend.spatial_agent.trace', wraps=trace) as compute:
            result = build_research_apparatus('设计', None, SETTINGS, None, None, None)
        self.assertEqual(compute.call_count, 0)
        self.assertEqual(result['evidence'], proposal['evidence'])
        proposal['experiment']['elements'][1]['focalLengthMm'] = 120
        with patch('backend.research_builder.run_spatial_agent', return_value=proposal), patch('backend.spatial_agent.trace', wraps=trace) as compute:
            result = build_research_apparatus('设计', None, SETTINGS, None, None, None)
        self.assertEqual(compute.call_count, 1)
        self.assertEqual(result['evidence']['inputSnapshot'], result['experiment'])

    def test_model_direct_path_has_two_calls_and_incomplete_turn_does_not_apply(self):
        for fail_final in [False, True]:
            calls = []
            def provider(req):
                calls.append(json.loads(req.content))
                if len(calls) == 1:
                    return response(message([call('update_research_element', {'elementId': 'lens', 'patch': {'focalLengthMm': 120}}, 'edit')]))
                if fail_final:
                    return httpx.Response(500)
                return response(message(text='已修改焦距为120mm。'))
            with patch('backend.research_agent.build_research_apparatus') as build, httpx.Client(transport=httpx.MockTransport(provider)) as client:
                reply = run_research_agent(ResearchAgentRequest(requestId='r', message='把焦距改为120mm', experiment=apparatus()), SETTINGS, client=client)
            build.assert_not_called()
            self.assertEqual(len(calls), 2)
            self.assertEqual(reply['editsApplyAllowed'], not fail_final)

    def test_complex_handoff_keeps_original_user_words(self):
        original = '重新设计折叠光路，光源功率保持不变。'
        responses = iter([message([call('modify_research_apparatus', {'goal': '设计折叠光路'}, 'build')]), message()])
        proposal = verified_proposal(apparatus())
        with patch('backend.research_builder.run_spatial_agent', return_value=proposal) as build, httpx.Client(transport=httpx.MockTransport(lambda req: response(next(responses)))) as client:
            run_research_agent(ResearchAgentRequest(requestId='r', message=original, experiment=apparatus()), SETTINGS, client=client)
        self.assertEqual(build.call_args.kwargs['original_message'], original)
        self.assertTrue(build.call_args.kwargs['delegated'])


if __name__ == '__main__':
    unittest.main()

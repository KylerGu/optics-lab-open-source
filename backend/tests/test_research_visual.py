import unittest
import json
import httpx
from backend.research_agent import ResearchObject, ResearchWorkspace
from backend.research_agent import ResearchAgentRequest, run_research_agent
from backend.settings import Settings
from backend.tests.test_research_agent import apparatus, call


class ResearchVisualTests(unittest.TestCase):
    def test_visual_link_does_not_discard_its_explanation(self):
        replies = iter([
            {'role': 'assistant', 'content': '移动屏幕不改变光束的会聚位置。', 'reasoning_content': 'private',
             'tool_calls': [call('offer_visual_action', dict(elementId='screen', kind='locate', explanation='定位观察屏'), 'link')]},
            {'role': 'assistant', 'content': '可以点击入口查看。'},
        ])
        def provider(request):
            message = next(replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if message.get('tool_calls') else 'stop', 'message': message}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            reply = run_research_agent(ResearchAgentRequest(requestId='link-answer', message='解释并定位屏幕', experiment=apparatus()), Settings('test', 'test', 'https://example.test'), client=client)
        self.assertIn('移动屏幕不改变光束的会聚位置。', reply['answer'])
        self.assertIn('可以点击入口查看。', reply['answer'])
        self.assertNotIn('private', json.dumps(reply))

    def setUp(self):
        self.experiment = apparatus()
        self.workspace = ResearchWorkspace(objects=[ResearchObject(id='device', source='draft', experiment=self.experiment)], active_object_id='device')
        self.action = dict(elementId='screen', kind='compare', field='x', screenId='screen', explanation='只移动观察屏，比较光斑半径。')

    def test_offer_is_optional_and_does_not_compute_change_or_plan(self):
        initial = self.experiment.model_dump()
        self.assertEqual(self.workspace.reply('r', '你好', [])['visualActions'], [])
        data, _ = self.workspace.execute('offer_visual_action', self.action)
        reply = self.workspace.reply('r', '可点击查看。', [])
        self.assertEqual(data['status'], 'offered')
        self.assertEqual(reply['visualActions'][0]['objectId'], 'device')
        self.assertEqual(reply['inputSnapshot'], initial)
        self.assertIsNone(reply['evidence'])
        self.assertFalse(reply['plan'])
        self.assertFalse(reply['comparisons'])

    def test_reject_invalid_targets_and_fields(self):
        for change in [dict(objectId='missing'), dict(elementId='missing'), dict(elementId='source'), dict(field='focalLengthMm'), dict(screenId='lens'), dict(kind='locate'), dict(field='yawDeg'), dict(explanation='')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.workspace.execute('offer_visual_action', self.action | change)
        self.assertFalse(self.workspace.visual_actions)

    def test_targets_resolve_within_correct_object_and_support_lens_focus(self):
        second = self.experiment.model_copy(deep=True)
        second.elements = [e for e in second.elements if e.id != 'screen']
        workspace = ResearchWorkspace(objects=[ResearchObject(id='a', source='draft', experiment=self.experiment), ResearchObject(id='b', source='draft', experiment=second)], active_object_id='a')
        with self.assertRaises(ValueError):
            workspace.execute('offer_visual_action', self.action | dict(objectId='b'))
        workspace.execute('offer_visual_action', self.action | dict(elementId='lens', field='focalLengthMm'))
        self.assertEqual(workspace.visual_actions[0]['elementId'], 'lens')

    def test_locate_without_field_and_deduplication(self):
        action = dict(elementId='lens', kind='locate', explanation='这片透镜改变光束的会聚。')
        self.workspace.execute('offer_visual_action', action)
        self.workspace.execute('offer_visual_action', action)
        self.assertEqual(len(self.workspace.visual_actions), 1)
        self.assertIsNone(self.workspace.visual_actions[0]['field'])

    def test_automatic_and_model_links_share_identity_not_explanation(self):
        scan = dict(elementId='screen', field='x', start=180, stop=220, count=3)
        self.workspace.execute('compare_parameter', scan)
        self.workspace.execute('offer_visual_action', dict(elementId='screen', kind='adjust', field='x', explanation='沿X方向移动这块屏，观察光斑。'))
        self.workspace.execute('compare_parameter', scan)
        self.assertEqual(len(self.workspace.visual_actions), 1)
        self.assertEqual(self.workspace.visual_actions[0]['explanation'], '沿X方向移动这块屏，观察光斑。')
        self.workspace.execute('offer_visual_action', dict(elementId='screen', kind='adjust', field='y', explanation='调整高度。'))
        self.workspace.execute('offer_visual_action', dict(elementId='lens', kind='locate', explanation='定位透镜。'))
        self.assertEqual(len(self.workspace.visual_actions), 3)
        self.workspace.execute('offer_visual_action', dict(elementId='lens', kind='locate', explanation='新的透镜说明。'))
        self.assertEqual(len(self.workspace.visual_actions), 3)

    def test_geometric_source_cannot_offer_gaussian_spot_comparison(self):
        self.workspace.workspaces['device'].original.elements[0].beamModel = 'parallel'
        with self.assertRaises(ValueError):
            self.workspace.execute('offer_visual_action', self.action)

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
        for change in [
            dict(objectId='missing'),
            dict(elementId='missing'),
            dict(elementId='source', field='focalLengthMm'),
            dict(field='focalLengthMm'),
            dict(field='slitWidthMm'),
            dict(screenId='lens'),
            dict(kind='locate'),
            dict(field='unknownField'),
            dict(explanation=''),
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.workspace.execute('offer_visual_action', self.action | change)
        self.assertFalse(self.workspace.visual_actions)

    def test_supports_physical_lenses_polarizers_slits_lasers_and_power_meters(self):
        app = self.experiment.model_copy(deep=True)
        app.elements = [
            app.elements[0],
            self.experiment.elements[1].model_copy(update={'id': 'sph', 'kind': 'biconvex-lens', 'frontRadiusMm': 100, 'backRadiusMm': 100}),
            self.experiment.elements[2].model_copy(update={'id': 'pol', 'kind': 'polarizer', 'rollDeg': 30}),
            self.experiment.elements[2].model_copy(update={'id': 'slit', 'kind': 'slit', 'slitWidthMm': 0.05}),
            self.experiment.elements[2].model_copy(update={'id': 'pm', 'kind': 'power-meter'}),
        ]
        ws = ResearchWorkspace(objects=[ResearchObject(id='device', source='draft', experiment=app)], active_object_id='device')
        ws.execute('offer_visual_action', dict(elementId='pol', kind='adjust', field='rollDeg', explanation='转动偏振片透光轴。'))
        ws.execute('offer_visual_action', dict(elementId='slit', kind='adjust', field='slitWidthMm', explanation='改变狭缝宽度。'))
        ws.execute('offer_visual_action', dict(elementId='sph', kind='adjust', field='frontRadiusMm', explanation='调节球面曲率。'))
        self.assertEqual(len(ws.visual_actions), 3)
        with self.assertRaises(ValueError):
            ws.execute('offer_visual_action', dict(elementId='pol', kind='adjust', field='focalLengthMm', explanation='无效参数。'))

    def test_compare_parameter_emits_adjust_link_for_expanded_devices(self):
        app = self.experiment.model_copy(deep=True)
        app.elements[0] = app.elements[0].model_copy(update={'polarization': 'linear', 'polarizationDeg': 0})
        app.elements.append(self.experiment.elements[2].model_copy(update={'id': 'pol', 'kind': 'polarizer', 'position': [150, 60, 0], 'rollDeg': 0}))
        ws = ResearchWorkspace(objects=[ResearchObject(id='device', source='draft', experiment=app)], active_object_id='device')
        ws.execute('compare_parameter', dict(elementId='pol', field='rollDeg', start=0, stop=90, count=3))
        self.assertEqual(len(ws.visual_actions), 1)
        self.assertEqual(ws.visual_actions[0]['kind'], 'adjust')
        self.assertEqual(ws.visual_actions[0]['elementId'], 'pol')
        self.assertEqual(ws.visual_actions[0]['field'], 'rollDeg')

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

    def test_compare_supports_geometric_power_meter_and_rejects_missing_source(self):
        self.workspace.workspaces['device'].original.elements[0].beamModel = 'parallel'
        self.workspace.execute('offer_visual_action', self.action)
        self.assertEqual(len(self.workspace.visual_actions), 1)

        no_source = self.experiment.model_copy(deep=True)
        no_source.elements = [e for e in no_source.elements if e.kind not in {'laser', 'object'}]
        ws = ResearchWorkspace(objects=[ResearchObject(id='device', source='draft', experiment=no_source)], active_object_id='device')
        with self.assertRaises(ValueError):
            ws.execute('offer_visual_action', self.action)

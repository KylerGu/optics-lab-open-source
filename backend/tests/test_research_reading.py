import json
import unittest

import httpx

from backend.research_agent import ResearchAgentRequest, ResearchWorkspace, run_research_agent
from backend.settings import Settings
from backend.tests.test_research_agent import apparatus, call


class ResearchReadingTests(unittest.TestCase):
    def test_default_reading_keeps_actual_layout_without_duplicate_snapshots_or_catalogues(self):
        experiment = apparatus()
        experiment.elements[0].powerMw = 17
        before = experiment.model_dump()
        workspace = ResearchWorkspace(experiment)
        current, _ = workspace.execute('read_research', {})
        self.assertNotIn('modelCapabilities', current)
        self.assertNotIn('supportedElements', current)
        self.assertNotIn('historicalEvidence', current)
        self.assertNotIn('experiment', current['objects'][0])
        self.assertLess(len(json.dumps(current)), len(json.dumps(before)))
        for element, compact in zip(experiment.elements, current['apparatus']['elements']):
            self.assertEqual(compact['position'], list(element.position))
            self.assertEqual(compact['yawDeg'], element.yawDeg)
            self.assertEqual(compact['pitchDeg'], element.pitchDeg)
        self.assertEqual(current['apparatus']['elements'][0]['powerMw'], 17)
        self.assertEqual(experiment.model_dump(), before)

    def test_full_capabilities_and_history_are_still_readable_on_demand(self):
        workspace = ResearchWorkspace(apparatus())
        capabilities, _ = workspace.execute('read_research', {'section': 'capabilities'})
        self.assertTrue(capabilities['modelCapabilities'])
        self.assertTrue(capabilities['physicsCapabilities'])
        self.assertIn('gaussianRadiusMm', capabilities['measurementDefinitions'])
        self.assertIn('splitter', capabilities['supportedElements'])
        history, _ = workspace.execute('read_research', {'section': 'history'})
        self.assertIn('historicalEvidence', history)
        self.assertIn('modelExperiments', history)
        with self.assertRaises(ValueError):
            workspace.execute('read_research', {'section': 'invented'})

    def test_reading_tool_reply_is_compact_without_discarding_required_private_context(self):
        captured = []
        thought = 'private-reasoning-' * 2000
        replies = iter([
            {'role': 'assistant', 'content': None, 'reasoning_content': thought, 'tool_calls': [call('read_research', {}, 'read')]},
            {'role': 'assistant', 'content': '已核对当前参数。', 'reasoning_content': 'private-final'},
        ])
        def provider(request):
            captured.append(json.loads(request.content))
            message = next(replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if message.get('tool_calls') else 'stop', 'message': message}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            result = run_research_agent(ResearchAgentRequest(requestId='reading', message='核对装置位置', experiment=apparatus()),
                                        Settings('test', 'deepseek-flash', reasoning_effort='max'), client=client)
        self.assertEqual(len(captured), 2)
        data = json.loads(captured[1]['messages'][-1]['content'])['data']
        self.assertNotIn('modelCapabilities', data)
        assistant = next(m for m in captured[1]['messages'] if m['role'] == 'assistant')
        self.assertEqual(assistant['reasoning_content'], thought)
        self.assertEqual(result['answer'], '已核对当前参数。')
        self.assertNotIn('private-reasoning', json.dumps(result))

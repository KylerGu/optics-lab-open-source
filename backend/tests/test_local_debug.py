import json
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError
from backend.app import app
from backend.local_debug import DebugRun, save_snapshot
from backend.research_agent import ResearchAgentRequest, run_research_agent
from backend.research_builder import build_research_apparatus
from backend.research_trace import ResearchTrace
from backend.settings import Settings
from backend.tests.test_research_agent import apparatus, call


class LocalDebugTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.patcher = patch('backend.local_debug.DEBUG_ROOT', self.root)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(self.directory.cleanup)

    def test_research_request_tool_and_reply_are_saved_without_secrets_or_reasoning(self):
        settings = Settings('secret-api-key', 'deepseek-flash', reasoning_effort='max')
        replies = iter([
            {'role': 'assistant', 'content': None, 'reasoning_content': 'private-model-thought', 'tool_calls': [call('simulate_apparatus', {}, 'simulate')]},
            {'role': 'assistant', 'content': '已得到实际读数。', 'reasoning_content': 'private-model-thought'},
        ])
        def provider(request):
            message = next(replies)
            return httpx.Response(200, json={'choices': [{'message': message, 'finish_reason': 'tool_calls' if message.get('tool_calls') else 'stop'}]})
        def run(document, configuration, **kwargs):
            with httpx.Client(transport=httpx.MockTransport(provider)) as client:
                return run_research_agent(document, configuration, client=client, **kwargs)
        with patch('backend.app.get_settings', return_value=settings), patch('backend.app.run_research_agent', side_effect=run), TestClient(app) as client:
            response = client.post('/api/research/agent/chat', json={'requestId': 'logged', 'message': '计算当前装置', 'experiment': apparatus().model_dump()})
        self.assertIn('已得到实际读数', response.text)
        raw = next(self.root.glob('run-*.jsonl')).read_text(encoding='utf-8')
        rows = [json.loads(line) for line in raw.splitlines()]
        self.assertEqual(rows[0]['request']['experiment'], apparatus().model_dump(mode='json'))
        self.assertEqual(rows[0]['reasoningEffort'], 'max')
        self.assertGreater(next(r for r in rows if r['event'] == 'tool')['result']['data']['screens'][0]['sampledPowerMw'], 0)
        self.assertEqual(next(r for r in rows if r['event'] == 'reply')['reply']['answer'], '已得到实际读数。')
        self.assertNotIn('secret-api-key', raw)
        self.assertNotIn('private-model-thought', raw)

    def test_failed_builder_keeps_its_actual_candidate_for_diagnosis(self):
        request = ResearchAgentRequest(requestId='failed-build', message='搭建装置')
        settings = Settings('secret', 'deepseek-flash', reasoning_effort='high')
        debug = DebugRun('research', request, settings)
        calls = [call('set_goal', {'criteria': [{'label': '到屏目标', 'elementId': 'screen', 'metric': 'screen_hits', 'operator': 'ge', 'value': 1000}]}, 'goal'),
                 call('set_apparatus', {'experiment': apparatus().model_dump()}, 'layout')]
        first = True
        def provider(request):
            nonlocal first
            if not first:
                raise httpx.ReadTimeout('test timeout')
            first = False
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls', 'message': {'role': 'assistant', 'content': None, 'tool_calls': calls}}]})
        with httpx.Client(transport=httpx.MockTransport(provider)) as client:
            with self.assertRaises(AgentError) as caught:
                build_research_apparatus('设计装置', None, settings, client, None, None,
                                         diagnostics=ResearchTrace(path=self.root / 'timing.jsonl', debug=debug))
            self.assertEqual(caught.exception.status, 504)
            self.assertIn('响应超时', caught.exception.message)
        rows = [json.loads(line) for line in debug.path.read_text(encoding='utf-8').splitlines()]
        layout = next(r for r in rows if r['event'] == 'tool' and r['name'] == 'set_apparatus')
        self.assertEqual(layout['experiment'], apparatus().model_dump(mode='json'))

    def test_snapshots_keep_previous_and_current_and_reject_other_paths(self):
        with TestClient(app) as client:
            for position in [10, 20]:
                response = client.post('/api/debug/snapshot', json={'area': 'builder', 'state': {'position': position}})
                self.assertEqual(response.json(), {'saved': True})
            self.assertEqual(client.post('/api/debug/snapshot', json={'area': '../outside', 'state': {}}).status_code, 422)
        data = json.loads((self.root / 'builder-latest.json').read_text(encoding='utf-8'))
        self.assertEqual(data['previous'], {'position': 10})
        self.assertEqual(data['current'], {'position': 20})

    def test_agent_errors_are_recorded_and_storage_failure_is_nonfatal(self):
        with patch('backend.app.get_settings', return_value=Settings('secret', 'test', 'https://example.test')), patch('backend.app.run_research_agent', side_effect=AgentError('测试错误', 504)), TestClient(app) as client:
            response = client.post('/api/research/agent/chat', json={'requestId': 'failure', 'message': '继续研究'})
        self.assertIn('测试错误', response.text)
        self.assertIn('"event": "error"', next(self.root.glob('run-*.jsonl')).read_text(encoding='utf-8'))
        blocked = self.root / 'file-not-directory'
        blocked.write_text('test', encoding='utf-8')
        with patch('backend.local_debug.DEBUG_ROOT', blocked):
            record = DebugRun('research', ResearchAgentRequest(requestId='r', message='你好'), Settings('secret', 'test'))
            record.record('reply', answer='你好')
            self.assertFalse(save_snapshot('research', {}))

    def test_only_twenty_recent_run_files_are_retained(self):
        for i in range(23):
            DebugRun('research', ResearchAgentRequest(requestId=str(i), message='研究'), Settings('secret', 'test'))
        self.assertEqual(len(list(self.root.glob('run-*.jsonl'))), 20)

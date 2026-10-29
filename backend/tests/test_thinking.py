"""Thinking-mode protocol checks, with private reasoning confined to requests."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError, AgentRequest, completion, run_agent
from backend.app import app
from backend.settings import Settings, get_settings
from backend.tests.test_agent import answer, call
from backend.tests.test_gaussian_verification import RIGHT, SCAN, WRONG, screenshot_scene


def thought(text, content='', calls=None):
    response = answer(content, calls)
    response['choices'][0]['message']['reasoning_content'] = text
    return response


class ThinkingTests(unittest.TestCase):
    def execute(self, responses, message='解释当前光束', history=None, settings=None):
        captured = []
        queue = iter(responses)
        def handle(request):
            captured.append((json.loads(request.content), request.extensions['timeout']))
            return httpx.Response(200, json=next(queue))
        request = AgentRequest(requestId='thinking-test', scene='gaussian', experiment=screenshot_scene(),
                               message=message, history=history or [])
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            result = run_agent(request, settings or Settings('test-key', 'deepseek-flash'), client)
        return result, captured

    def test_default_enables_high_with_room_for_reasoning(self):
        result, captured = self.execute([thought('private-definition-thought', '瑞利长度描述传播尺度。')], message='瑞利长度是什么？')
        payload, timeout = captured[0]
        self.assertEqual(payload['thinking'], {'type': 'enabled'})
        self.assertEqual(payload['reasoning_effort'], 'high')
        self.assertEqual(payload['max_tokens'], 32768)
        self.assertIsNone(timeout['read'])
        self.assertEqual(timeout['connect'], 15)
        self.assertEqual(result['trace'], [])
        self.assertNotIn('private-definition-thought', json.dumps(result))

    def test_tool_rounds_replay_full_reasoning_without_exposing_it(self):
        first = 'private-first-thought-' + 'x' * 20000
        second = 'private-second-thought'
        result, captured = self.execute([
            thought(first, calls=[call('read_experiment', {})]),
            thought(second, calls=[call('simulate_experiment', {}, 'tool2')]),
            thought('private-final-thought', '已根据当前参数计算。')])
        self.assertEqual(len(captured), 3)
        assistants = [item for item in captured[-1][0]['messages'] if item['role'] == 'assistant']
        self.assertEqual([item['reasoning_content'] for item in assistants], [first, second])
        self.assertEqual(assistants[0]['tool_calls'][0]['function']['name'], 'read_experiment')
        self.assertNotIn('private-', json.dumps(result))

    def test_max_is_sent_as_max_with_a_larger_generation_allowance(self):
        result, captured = self.execute([thought('private-max-thought', '理论说明。')],
            settings=Settings('test-key', 'deepseek-flash', reasoning_effort='max'))
        payload, _ = captured[0]
        self.assertEqual(payload['thinking'], {'type': 'enabled'})
        self.assertEqual(payload['reasoning_effort'], 'max')
        self.assertEqual(payload['max_tokens'], 131072)
        self.assertIsNone(captured[0][1]['read'])
        self.assertEqual(captured[0][1]['connect'], 15)
        self.assertNotIn('private-max-thought', json.dumps(result))

    def test_answer_before_automatic_verification_keeps_its_thought(self):
        result, captured = self.execute([
            thought('private-edit-thought', calls=[call('update_element', {'elementId': 'source', 'patch': {'waistMm': .6}})]),
            thought('private-pre-verification-thought', '已调整。'),
            thought('private-verified-thought', '当前光束属于近场。')], message='帮我调整束腰')
        assistants = [item for item in captured[-1][0]['messages'] if item['role'] == 'assistant']
        self.assertEqual(assistants[-1]['reasoning_content'], 'private-pre-verification-thought')
        self.assertTrue(result['changed'])
        self.assertNotIn('private-', json.dumps(result))

    def test_evidence_rewrite_keeps_context_but_has_no_operations(self):
        result, captured = self.execute([
            thought('private-scan-thought', calls=[call('scan_parameter', SCAN)]),
            thought('private-conflicting-thought', WRONG),
            thought('private-corrected-thought', RIGHT)], message='比较束腰半径，帮我验证一下。')
        payload = captured[-1][0]
        self.assertEqual(payload['reasoning_effort'], 'high')
        self.assertNotIn('tools', payload)
        assistants = [item for item in payload['messages'] if item['role'] == 'assistant']
        self.assertEqual(assistants[-1]['reasoning_content'], 'private-conflicting-thought')
        self.assertEqual(result['answer'], RIGHT)
        self.assertNotIn('private-', json.dumps(result))

    def test_visible_history_has_no_invented_private_reasoning(self):
        history = [{'role': 'user', 'content': '瑞利长度是什么？'}, {'role': 'assistant', 'content': '瑞利长度描述传播尺度。'}]
        result, captured = self.execute([thought('private-new-thought', '可以继续比较。')], history=history)
        old = next(item for item in captured[0][0]['messages'] if item['role'] == 'assistant')
        self.assertEqual(old['content'], history[-1]['content'])
        self.assertEqual(old['reasoning_content'], '')
        self.assertNotIn('reasoning_content', history[-1])
        self.assertNotIn('private-', json.dumps(result))

    def test_disabled_mode_and_custom_providers_remain_supported(self):
        for settings in [Settings('key', 'deepseek-flash', reasoning_effort='none'),
                         Settings('key', 'custom', 'https://models.example/v1')]:
            with self.subTest(settings=settings.model):
                _, captured = self.execute([answer('普通回答。')], settings=settings)
                payload, timeout = captured[0]
                self.assertEqual(payload['max_tokens'], 3500)
                self.assertIsNone(timeout['read'])
                if settings.uses_deepseek:
                    self.assertEqual(payload['thinking'], {'type': 'disabled'})
                    self.assertEqual(payload['reasoning_effort'], 'none')
                else:
                    self.assertNotIn('thinking', payload)
                    self.assertNotIn('reasoning_effort', payload)

    def test_effort_configuration_works_with_legacy_and_generic_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('DEEPSEEK_API_KEY=test-key\nDEEPSEEK_MODEL=deepseek-flash\nAI_REASONING_EFFORT=low', encoding='utf-8')
            with patch('backend.settings.ENV_PATH', path), patch.dict('os.environ', {}, clear=True):
                self.assertEqual(get_settings().reasoning_effort, 'low')
                self.assertTrue(get_settings().configured)
                with patch.dict('os.environ', {'AI_REASONING_EFFORT': 'high'}):
                    self.assertEqual(get_settings().reasoning_effort, 'high')
            with patch.dict('os.environ', {'AI_BASE_URL':'https://api.deepseek.com/v1', 'AI_MODEL':'deepseek-flash', 'AI_API_KEY':'test-key', 'AI_REASONING_EFFORT':'max'}, clear=True):
                self.assertEqual(get_settings().reasoning_effort, 'max')
                self.assertTrue(get_settings().thinking_enabled)
        self.assertFalse(Settings('key', 'deepseek-flash', reasoning_effort='invalid').configured)

    def test_malformed_reasoning_or_truncated_response_is_not_applied(self):
        malformed = thought(['invalid'], '回答。')
        for response in [malformed, answer('截断回复', finish='length')]:
            with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))) as client:
                with self.assertRaises(AgentError):
                    completion(client, Settings('key','deepseek-flash'), [{'role':'user','content':'问题'}], 120)

    def test_research_defaults_to_high_without_changing_other_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('DEEPSEEK_API_KEY=test-key\nAI_REASONING_EFFORT=high', encoding='utf-8')
            with patch('backend.settings.ENV_PATH', path), patch.dict('os.environ', {}, clear=True):
                self.assertEqual(get_settings().reasoning_effort, 'high')
                self.assertEqual(get_settings(research=True).reasoning_effort, 'high')
                path.write_text('DEEPSEEK_API_KEY=test-key\nAI_REASONING_EFFORT=low\nAI_RESEARCH_REASONING_EFFORT=high', encoding='utf-8')
                self.assertEqual(get_settings().reasoning_effort, 'low')
                self.assertEqual(get_settings(research=True).reasoning_effort, 'high')
                with patch.dict('os.environ', {'AI_RESEARCH_REASONING_EFFORT':'MAX'}):
                    self.assertEqual(get_settings(research=True).reasoning_effort, 'max')
                    self.assertEqual(get_settings().reasoning_effort, 'low')

    def test_research_endpoint_loads_its_own_effort_setting(self):
        captured = []
        def reply(document, settings, **kwargs):
            captured.append(settings)
            return {'requestId':document.requestId, 'answer':'理论说明。'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            path.write_text('DEEPSEEK_API_KEY=test-key\nAI_REASONING_EFFORT=low', encoding='utf-8')
            with patch('backend.settings.ENV_PATH', path), patch.dict('os.environ', {}, clear=True), patch('backend.app.run_research_agent', side_effect=reply), TestClient(app) as client:
                response = client.post('/api/research/agent/chat', json={'requestId':'high-entry', 'message':'解释这个现象'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.text.splitlines()[-1])['type'], 'reply')
                self.assertEqual(captured[0].reasoning_effort, 'high')
                self.assertEqual(get_settings().reasoning_effort, 'low')


if __name__ == '__main__':
    unittest.main()

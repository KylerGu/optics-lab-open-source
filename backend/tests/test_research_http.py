import asyncio
import json
import time
import unittest
from threading import Event, Timer
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.agent import AgentError
from backend.research_http import ResearchClient
from backend.app import app
from backend.settings import Settings


class ResearchHTTPTests(unittest.TestCase):
    def test_provider_can_keep_working_beyond_the_previous_total_deadline(self):
        class KeepAlive(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                for _ in range(10):
                    yield b': keep-alive\n\n'
                    await asyncio.sleep(.01)
                yield b'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n'
                yield b'data: [DONE]\n\n'
            async def aclose(self):
                self.closed = True
        body = KeepAlive()
        async def provider(request):
            return httpx.Response(200, headers={'content-type':'text/event-stream'}, stream=body)
        started = time.monotonic()
        result = ResearchClient(transport=httpx.MockTransport(provider)).post('https://example.test/chat/completions', json={}, timeout=.02)
        self.assertEqual(result.json()['choices'][0]['message']['content'], 'done')
        self.assertGreater(time.monotonic() - started, .09)
        self.assertTrue(body.closed)

    def test_stream_preserves_reasoning_and_reassembles_multiple_fragmented_tools(self):
        def chunk(delta, finish=None):
            return 'data: ' + json.dumps({'choices':[{'delta':delta,'finish_reason':finish}]},ensure_ascii=False) + '\n\n'
        content = ': keep-alive\n\n' + chunk({'reasoning_content':'private-完整思考'}) + chunk({'tool_calls':[
            {'index':1,'id':'two','function':{'name':'trace_light','arguments':'{}'}},
            {'index':0,'id':'one','function':{'name':'set_','arguments':'{"experiment":'}}]}) + chunk({'tool_calls':[
            {'index':0,'function':{'name':'apparatus','arguments':'{"name":"装置"}}'}}]},'tool_calls') + 'data: [DONE]\n\n'
        class Pieces(httpx.AsyncByteStream):
            async def __aiter__(self):
                data=content.encode('utf-8')
                for i in range(0,len(data),7):
                    yield data[i:i+7]
        async def provider(request):
            self.assertTrue(json.loads(request.content)['stream'])
            return httpx.Response(200,headers={'content-type':'text/event-stream'},stream=Pieces())
        response=ResearchClient(transport=httpx.MockTransport(provider)).post('https://example.test/chat/completions',json={'reasoning_effort':'max'},timeout=2)
        message=response.json()['choices'][0]['message']
        self.assertEqual(message['reasoning_content'],'private-完整思考')
        self.assertEqual([call['id'] for call in message['tool_calls']],['one','two'])
        self.assertEqual(message['tool_calls'][0]['function']['name'],'set_apparatus')
        self.assertEqual(json.loads(message['tool_calls'][0]['function']['arguments']),{'experiment':{'name':'装置'}})

    def test_incomplete_stream_never_becomes_a_successful_message(self):
        async def provider(request):
            return httpx.Response(200,headers={'content-type':'text/event-stream'},content=b'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\ndata: [DONE]\n\n')
        with self.assertRaises(AgentError):
            ResearchClient(transport=httpx.MockTransport(provider)).post('https://example.test/chat/completions',json={},timeout=2)

    def test_cancel_endpoint_stops_only_the_named_running_research(self):
        started = {'first': Event(), 'second': Event()}
        ended = {'first': Event(), 'second': Event()}
        def research(document, settings, progress, cancelled, **kwargs):
            started[document.requestId].set()
            try:
                deadline = time.monotonic() + 5
                while not cancelled():
                    if time.monotonic() >= deadline:
                        raise RuntimeError('cancel was not delivered')
                    time.sleep(.01)
                raise AgentError('已停止本轮研究。', 499)
            finally:
                ended[document.requestId].set()
        with patch.dict('os.environ', {'AI_ALLOW_SERVER_KEY': '1'}), patch('backend.app.get_settings', return_value=Settings('test', 'test', 'https://example.test')), patch('backend.app.run_research_agent', side_effect=research), TestClient(app) as client, ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(client.post, '/api/research/agent/chat', json={'requestId': 'first', 'message': '研究甲'})
            second = pool.submit(client.post, '/api/research/agent/chat', json={'requestId': 'second', 'message': '研究乙'})
            try:
                self.assertTrue(started['first'].wait(2))
                self.assertTrue(started['second'].wait(2))
                self.assertEqual(client.post('/api/research/agent/cancel', json={'requestId': 'unknown'}).json(), {'stopped': False})
                self.assertEqual(client.post('/api/research/agent/cancel', json={'requestId': 'first'}).json(), {'stopped': True})
                self.assertTrue(ended['first'].wait(2))
                self.assertFalse(ended['second'].is_set())
                self.assertEqual(first.result(timeout=2).status_code, 200)
            finally:
                client.post('/api/research/agent/cancel', json={'requestId': 'first'})
                client.post('/api/research/agent/cancel', json={'requestId': 'second'})
                second.result(timeout=2)

    def test_stop_interrupts_wait_and_closes_provider_request(self):
        stopped, closed = Event(), Event()
        async def provider(request):
            try:
                await asyncio.sleep(30)
                return httpx.Response(200, json={})
            finally:
                closed.set()
        timer = Timer(.15, stopped.set)
        timer.start()
        started = time.monotonic()
        try:
            with self.assertRaises(AgentError) as caught:
                ResearchClient(stopped.is_set, httpx.MockTransport(provider)).post('https://example.test/chat/completions', json={}, timeout=240)
            self.assertEqual(caught.exception.status, 499)
            self.assertLess(time.monotonic() - started, 2)
            self.assertTrue(closed.is_set())
        finally:
            timer.cancel()

    def test_success_and_provider_errors_are_passed_through(self):
        async def provider(request):
            return httpx.Response(429, json={'error': 'busy'})
        result = ResearchClient(transport=httpx.MockTransport(provider)).post('https://example.test/chat/completions', json={'model': 'test'}, timeout=10)
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result.json(), {'error': 'busy'})


class BrowserStreamKeepaliveTests(unittest.IsolatedAsyncioTestCase):
    async def test_silent_research_keeps_connection_alive_then_returns_reply(self):
        from backend.app import research_agent_chat
        from backend.research_agent import ResearchAgentRequest
        release = Event()
        class ConnectedRequest:
            async def is_disconnected(self):
                return False
        def slow_research(*args, **kwargs):
            release.wait(2)
            return {'answer': 'done'}
        with patch.dict('os.environ', {'AI_ALLOW_SERVER_KEY': '1'}), patch('backend.app.get_settings', return_value=Settings('test', 'test', 'https://example.test')), patch('backend.app.run_research_agent', side_effect=slow_research), patch('backend.app.STREAM_KEEPALIVE_SECONDS', .01):
            response = await research_agent_chat(ResearchAgentRequest(requestId='keepalive-test', message='test'), ConnectedRequest())
            stream = response.body_iterator
            try:
                self.assertEqual(await asyncio.wait_for(anext(stream), .5), '\n')
                self.assertFalse(release.is_set())
                release.set()
                chunks = [chunk async for chunk in stream]
                events = [json.loads(chunk) for chunk in chunks if chunk.strip()]
                self.assertEqual(events, [{'type': 'reply', 'reply': {'answer': 'done'}}])
            finally:
                release.set()
                await stream.aclose()


class FineGrainedProgressTests(unittest.TestCase):
    def test_research_client_emits_thinking_preparing_and_writing_phases_without_leaking_reasoning(self):
        def sse(delta, finish=None):
            return 'data: ' + json.dumps({'choices': [{'delta': delta, 'finish_reason': finish}]}, ensure_ascii=False) + '\n\n'

        reasoning_body = sse({'reasoning_content': 'SECRET_CHAIN_OF_THOUGHT'}) + sse({'content': '公开说明'}, 'stop') + 'data: [DONE]\n\n'
        tool_body = sse({'reasoning_content': 'SECRET_TOOL_THOUGHT'}) + sse({'tool_calls': [{'index': 0, 'id': 'c1', 'function': {'name': 'trace_light', 'arguments': '{}'}}]}, 'tool_calls') + 'data: [DONE]\n\n'

        bodies = iter([reasoning_body.encode('utf-8'), tool_body.encode('utf-8')])
        async def provider(request):
            return httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=next(bodies))

        events = []
        client = ResearchClient(transport=httpx.MockTransport(provider), progress=events.append)
        client.post('https://example.test/chat/completions', json={}, timeout=2)
        client.post('https://example.test/chat/completions', json={}, timeout=2)

        names = [e['name'] for e in events]
        self.assertEqual(names, ['phase_thinking', 'phase_writing', 'phase_thinking', 'phase_preparing'])
        serialized = json.dumps(events, ensure_ascii=False)
        self.assertNotIn('SECRET_CHAIN_OF_THOUGHT', serialized)
        self.assertNotIn('SECRET_TOOL_THOUGHT', serialized)

    def test_research_and_spatial_agents_emit_pre_tool_phases_excluded_from_finished_steps(self):
        from backend.research_agent import ResearchAgentRequest, run_research_agent
        from backend.spatial import SpatialExperiment
        from backend.spatial_agent import SpatialAgentRequest, run_spatial_agent
        from backend.turn_limits import finished_steps

        exp = SpatialExperiment.model_validate({'schemaVersion': 2, 'name': '测试光路', 'elements': [
            {'id': 's', 'kind': 'laser', 'name': '激光', 'position': [0, 60, 0]},
            {'id': 'l', 'kind': 'lens', 'name': '透镜', 'position': [100, 60, 0], 'focalLengthMm': 100},
            {'id': 'p', 'kind': 'screen', 'name': '屏', 'position': [200, 60, 0]},
        ]})

        r_replies = iter([
            {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'compare_parameter', 'arguments': json.dumps({'elementId': 'l', 'field': 'focalLengthMm', 'start': 80, 'stop': 120, 'count': 5})}}]},
            {'role': 'assistant', 'content': '完成扫参验证。'},
        ])
        def r_provider(req):
            m = next(r_replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if m.get('tool_calls') else 'stop', 'message': m}]})

        r_events = []
        with httpx.Client(transport=httpx.MockTransport(r_provider)) as client:
            run_research_agent(ResearchAgentRequest(requestId='prog-r', experiment=exp, message='扫描焦距'), Settings('test', 'test', 'https://example.test'), client=client, progress=r_events.append)

        r_names = [e['name'] for e in r_events]
        self.assertIn('phase_research', r_names)
        self.assertIn('phase_compare_parameter', r_names)
        self.assertTrue(any('focalLengthMm' in e['summary'] and '5' in e['summary'] for e in r_events if e['name'] == 'phase_compare_parameter'))
        self.assertEqual([e['name'] for e in finished_steps(r_events)], ['compare_parameter'])

        s_replies = iter([
            {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'trace_light', 'arguments': '{}'}}]},
            {'role': 'assistant', 'content': '已完成追迹。'},
        ])
        def s_provider(req):
            m = next(s_replies)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'tool_calls' if m.get('tool_calls') else 'stop', 'message': m}]})

        s_events = []
        with httpx.Client(transport=httpx.MockTransport(s_provider)) as client:
            run_spatial_agent(SpatialAgentRequest(requestId='prog-s', experiment=exp, message='追迹看看'), Settings('test', 'test', 'https://example.test'), client=client, progress=s_events.append)

        s_names = [e['name'] for e in s_events]
        self.assertIn('phase_design', s_names)
        self.assertIn('phase_trace_light', s_names)
        self.assertEqual([e['name'] for e in finished_steps(s_events)], ['trace_light'])

    def test_research_client_streams_answer_deltas_and_resets_before_tools(self):
        def sse(delta, finish=None):
            return 'data: ' + json.dumps({'choices': [{'delta': delta, 'finish_reason': finish}]}, ensure_ascii=False) + '\n\n'

        tool_round_body = (
            sse({'reasoning_content': 'HIDDEN_THOUGHT'})
            + sse({'content': '先查一下'})
            + sse({'tool_calls': [{'index': 0, 'id': 't1', 'function': {'name': 'calculate_scene', 'arguments': '{}'}}]}, 'tool_calls')
            + 'data: [DONE]\n\n'
        )
        final_round_body = (
            sse({'reasoning_content': 'HIDDEN_REASON'})
            + sse({'content': '像距'})
            + sse({'content': '为 200 mm。'}, 'stop')
            + 'data: [DONE]\n\n'
        )
        bodies = iter([tool_round_body.encode('utf-8'), final_round_body.encode('utf-8')])

        async def provider(request):
            return httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=next(bodies))

        deltas = []
        client = ResearchClient(transport=httpx.MockTransport(provider), on_delta=deltas.append)
        client.post('https://example.test/chat/completions', json={}, timeout=2)
        client.post('https://example.test/chat/completions', json={}, timeout=2)

        self.assertEqual(deltas, ['先查一下', None, '像距', '为 200 mm。'])

    def test_scene_chat_streams_progress_deltas_and_supports_cancel(self):
        from backend.tests.test_scene_physics import state

        def fake_scene_agent(document, settings, client=None, progress=None, on_delta=None):
            progress({'name': 'phase_scene', 'status': 'ok', 'summary': '正在分析当前场景与问题…'})
            on_delta('临界角')
            on_delta('是全反射起点。')
            return {
                'requestId': document.requestId,
                'inputSnapshot': document.state.model_dump(),
                'state': document.state.model_dump(),
                'changed': False,
                'answer': '临界角是全反射起点。',
                'evidence': None,
                'scans': [],
                'trace': [],
            }

        body = {'requestId': 'scene-stream-1', 'state': state('reflection-refraction-1').model_dump(), 'message': '临界角是什么？'}
        with patch.dict('os.environ', {'AI_ALLOW_SERVER_KEY': '1'}), patch('backend.app.get_settings', return_value=Settings('test', 'test', 'https://example.test')), patch('backend.app.run_scene_agent', side_effect=fake_scene_agent), TestClient(app) as client:
            res = client.post('/api/scenes/agent/chat', json=body)
            self.assertEqual(res.status_code, 200)
            events = [json.loads(line) for line in res.text.splitlines() if line.strip()]
            self.assertEqual([e['type'] for e in events], ['progress', 'delta', 'delta', 'reply'])
            self.assertEqual(events[1]['text'], '临界角')
            self.assertEqual(events[3]['reply']['answer'], '临界角是全反射起点。')
            self.assertEqual(client.post('/api/scenes/agent/cancel', json={'requestId': 'missing'}).json(), {'stopped': False})


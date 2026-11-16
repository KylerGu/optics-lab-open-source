"""Interrupt provider waits when a research conversation is stopped."""
import asyncio
import json
import time
from urllib.parse import urlsplit

import httpx

from .agent import AgentError
from .turn_limits import BUDGET_MESSAGE


class ResearchClient:
    def __init__(self, cancelled=None, transport=None, diagnostics=None, *, streaming=True, deadline=None, progress=None, on_delta=None):
        self.cancelled = cancelled
        self.transport = transport
        self.diagnostics = diagnostics
        self.streaming = streaming
        self.deadline = deadline
        self.progress = progress
        self.on_delta = on_delta

    def _emit_phase(self, name, summary):
        if self.progress:
            self.progress({'name': name, 'status': 'ok', 'summary': summary})

    def _closed_error(self):
        if self.deadline is not None and time.monotonic() >= self.deadline:
            raise AgentError(BUDGET_MESSAGE, 504)
        if self.cancelled and self.cancelled():
            if getattr(self.cancelled, "budget", False):
                raise AgentError(BUDGET_MESSAGE, 504)
            raise AgentError('已停止本轮研究。', 499)

    def post(self, url, **kwargs):
        if self.diagnostics:
            payload = kwargs.get('json', {})
            self.diagnostics.record('provider.request', messageCount=len(payload.get('messages', [])), inputCharacters=sum(len(str(m.get('content') or '')) + len(str(m.get('reasoning_content') or '')) for m in payload.get('messages', [])))
        async def request():
            self._closed_error()
            hostname = (urlsplit(url).hostname or '').lower()
            trust_env = hostname not in {'127.0.0.1', 'localhost', '::1'}
            async with httpx.AsyncClient(follow_redirects=False, transport=self.transport, trust_env=trust_env) as client:
                task = asyncio.create_task(self.receive(client, url, kwargs))
                try:
                    while True:
                        self._closed_error()
                        done, _ = await asyncio.wait({task}, timeout=.1)
                        if done:
                            return task.result()
                finally:
                    if not task.done():
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
        result = asyncio.run(request())
        if self.diagnostics:
            self.diagnostics.record('provider.response', statusCode=result.status_code)
        return result

    async def receive(self, client, url, kwargs):
        payload = dict(kwargs.get('json', {}))
        if self.streaming:
            payload['stream'] = True
        options = {**kwargs, 'json': payload}
        if not self.streaming:
            return await client.post(url, **options)
        async with client.stream('POST', url, **options) as response:
            if self.diagnostics:
                self.diagnostics.record('provider.headers', statusCode=response.status_code)
            if response.status_code != 200 or 'text/event-stream' not in response.headers.get('content-type', ''):
                await response.aread()
                return response
            message = {'role': 'assistant', 'content': '', 'reasoning_content': ''}
            tools, finish, size, last_log, first = {}, None, 0, time.monotonic(), True
            stream_phase, last_phase_emit, last_phase_chars = None, 0.0, 0
            streamed_answer = False
            async for line in response.aiter_lines():
                size += len(line)
                if size > 64_000_000:
                    raise AgentError('AI回复过长，本轮未完成。', 422)
                if not line.startswith('data:'):
                    continue
                data = line[5:].strip()
                if data == '[DONE]':
                    if finish not in {'stop', 'tool_calls'}:
                        raise AgentError('AI回复未完整生成，请重试。')
                    if tools:
                        if streamed_answer and self.on_delta:
                            self.on_delta(None)
                            streamed_answer = False
                        message['tool_calls'] = [tools[key] for key in sorted(tools)]
                    return httpx.Response(200, json={'choices': [{'finish_reason': finish, 'message': message}]})
                try:
                    event = json.loads(data)
                    choices = event['choices']
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = choice.get('delta') or {}
                    for key in ['content', 'reasoning_content']:
                        part = delta.get(key)
                        if part is not None:
                            if not isinstance(part, str):
                                raise ValueError('invalid delta')
                            message[key] += part
                    for part in delta.get('tool_calls') or []:
                        index = part['index']
                        if not isinstance(index, int) or not 0 <= index < 24:
                            raise ValueError('invalid tool index')
                        target = tools.setdefault(index, {'id': f'call_{index}', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                        if part.get('id'):
                            target['id'] = part['id']
                        for key in ['name', 'arguments']:
                            fragment = part.get('function', {}).get(key)
                            if fragment is not None:
                                if not isinstance(fragment, str):
                                    raise ValueError('invalid tool delta')
                                target['function'][key] += fragment
                    if choice.get('finish_reason') is not None:
                        finish = choice['finish_reason']
                    if len(message['content']) + len(message['reasoning_content']) + sum(len(t['function']['arguments']) for t in tools.values()) > 2_000_000:
                        raise AgentError('AI回复过长，本轮未完成。', 422)
                    content_part = delta.get('content')
                    if tools and streamed_answer and self.on_delta:
                        self.on_delta(None)
                        streamed_answer = False
                    elif not tools and self.on_delta and isinstance(content_part, str) and content_part:
                        if streamed_answer or content_part.strip():
                            streamed_answer = True
                            self.on_delta(content_part)
                    now = time.monotonic()
                    if self.progress:
                        r_chars = len(message['reasoning_content'])
                        c_chars = len(message['content'].strip())
                        if tools:
                            if stream_phase != 'tools':
                                stream_phase = 'tools'
                                self._emit_phase('phase_preparing', '正在准备调用实验工具…')
                        elif delta.get('reasoning_content') is not None and r_chars > 0 and c_chars == 0:
                            if stream_phase != 'thinking':
                                stream_phase, last_phase_emit, last_phase_chars = 'thinking', now, r_chars
                                self._emit_phase('phase_thinking', '正在深度推理…')
                            elif now - last_phase_emit >= 2.0 and r_chars > last_phase_chars:
                                last_phase_emit, last_phase_chars = now, r_chars
                                self._emit_phase('phase_thinking', f'正在深度推理（已推演约 {r_chars} 字）…')
                        elif c_chars > 0:
                            if stream_phase != 'writing':
                                stream_phase, last_phase_emit, last_phase_chars = 'writing', now, c_chars
                                self._emit_phase('phase_writing', '正在组织回答…')
                            elif now - last_phase_emit >= 2.5 and c_chars > last_phase_chars:
                                last_phase_emit, last_phase_chars = now, c_chars
                                self._emit_phase('phase_writing', f'正在整理回答（已生成约 {c_chars} 字）…')
                    if self.diagnostics and (first or now - last_log >= 5):
                        self.diagnostics.record('provider.progress', reasoningCharacters=len(message['reasoning_content']), answerCharacters=len(message['content']), toolCount=len(tools))
                        first, last_log = False, now
                except (ValueError, KeyError, IndexError, TypeError):
                    raise AgentError('AI回复格式异常，本轮未完成。') from None
            raise AgentError('AI连接提前结束，未收到完整回复。')

    def close(self):
        # Each request owns and closes its connection, including on cancellation.
        pass

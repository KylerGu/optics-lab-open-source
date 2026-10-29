"""Interrupt provider waits when a research conversation is stopped."""
import asyncio
import json
import time

import httpx

from .agent import AgentError


class ResearchClient:
    def __init__(self, cancelled=None, transport=None, diagnostics=None):
        self.cancelled = cancelled
        self.transport = transport
        self.diagnostics = diagnostics

    def post(self, url, **kwargs):
        if self.diagnostics:
            payload = kwargs.get('json', {})
            self.diagnostics.record('provider.request', messageCount=len(payload.get('messages', [])), inputCharacters=sum(len(str(m.get('content') or '')) + len(str(m.get('reasoning_content') or '')) for m in payload.get('messages', [])))
        async def request():
            async with httpx.AsyncClient(follow_redirects=False, transport=self.transport) as client:
                task = asyncio.create_task(self.receive(client, url, kwargs))
                try:
                    while True:
                        if self.cancelled and self.cancelled():
                            raise AgentError('已停止本轮研究。', 499)
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
        payload['stream'] = True
        options = {**kwargs, 'json': payload}
        async with client.stream('POST', url, **options) as response:
            if self.diagnostics:
                self.diagnostics.record('provider.headers', statusCode=response.status_code)
            if response.status_code != 200 or 'text/event-stream' not in response.headers.get('content-type', ''):
                await response.aread()
                return response
            message = {'role': 'assistant', 'content': '', 'reasoning_content': ''}
            tools, finish, size, last_log, first = {}, None, 0, time.monotonic(), True
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
                        target = tools.setdefault(index, {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
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
                    if self.diagnostics and (first or time.monotonic() - last_log >= 5):
                        self.diagnostics.record('provider.progress', reasoningCharacters=len(message['reasoning_content']), answerCharacters=len(message['content']), toolCount=len(tools))
                        first, last_log = False, time.monotonic()
                except (ValueError, KeyError, IndexError, TypeError):
                    raise AgentError('AI回复格式异常，本轮未完成。') from None
            raise AgentError('AI连接提前结束，未收到完整回复。')

    def close(self):
        # Each request owns and closes its connection, including on cancellation.
        pass

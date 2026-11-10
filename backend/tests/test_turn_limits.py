"""Hung providers must time out, release the two assistant slots, and drop the upstream socket."""
import asyncio
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from backend.agent import AgentError, AgentRequest
from backend.app import agent_chat, agent_slots, research_agent_chat, research_agent_slots, scene_chat, spatial_agent_chat, spatial_agent_slots
from backend.research_agent import ResearchAgentRequest
from backend.scene_agent import SceneAgentRequest
from backend.settings import Settings
from backend.spatial_agent import SpatialAgentRequest
from backend.tests.test_agent import experiment
from backend.tests.test_scene_physics import state
from backend.tests.test_spatial_agent import apparatus
from backend.spatial_agent import run_spatial_agent
from backend.turn_limits import BUDGET_MESSAGE, STALL_MESSAGE, STOP_MESSAGE, TurnStop, finished_steps, provider_timeout


SECRET = "UNIQUE-SECRET-KEY-9f3a"
USER_TEXT = "UNIQUE-USER-TEXT-9f3a"


class Connected:
    async def is_disconnected(self):
        return False


class DropAfter:
    def __init__(self, ready):
        self.ready = ready
        self.seen = 0

    async def is_disconnected(self):
        if not self.ready.is_set():
            return False
        self.seen += 1
        return self.seen >= 2


class SilentUpstream:
    """Accepts HTTP and reads the request, then never writes a response."""

    def __init__(self):
        self.stop = threading.Event()
        self.accepted = threading.Event()
        self.closed = threading.Event()
        self.lock = threading.Lock()
        self.accepts = 0
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._listen, daemon=True)
        self.thread.start()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.port}"

    def close(self):
        self.stop.set()
        try:
            self.sock.close()
        except OSError:
            pass
        self.thread.join(timeout=1)

    def _listen(self):
        self.sock.settimeout(0.2)
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except (socket.timeout, OSError):
                continue
            threading.Thread(target=self._hold, args=(conn,), daemon=True).start()

    def _hold(self, conn):
        with self.lock:
            self.accepts += 1
        self.accepted.set()
        conn.settimeout(0.2)
        try:
            while not self.stop.is_set():
                try:
                    data = conn.recv(65536)
                except socket.timeout:
                    continue
                if not data:
                    self.closed.set()
                    return
        finally:
            try:
                conn.close()
            except OSError:
                pass


class DripUpstream(SilentUpstream):
    """Reads the request, then sends a chunk every 50 ms so the read timeout stays idle."""

    def _hold(self, conn):
        with self.lock:
            self.accepts += 1
        self.accepted.set()
        conn.settimeout(0.2)
        buffer = b""
        try:
            while b"\r\n\r\n" not in buffer and not self.stop.is_set():
                try:
                    data = conn.recv(65536)
                except socket.timeout:
                    continue
                if not data:
                    self.closed.set()
                    return
                buffer += data
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
            while not self.stop.is_set():
                try:
                    conn.sendall(b"1\r\n \r\n")
                except (BrokenPipeError, ConnectionError, OSError):
                    self.closed.set()
                    return
                if conn.recv is not None:
                    # Detect a peer close without blocking the drip for long.
                    conn.settimeout(0.05)
                    try:
                        extra = conn.recv(1)
                        if extra == b"":
                            self.closed.set()
                            return
                    except socket.timeout:
                        pass
                    conn.settimeout(0.2)
        finally:
            try:
                conn.close()
            except OSError:
                pass


def slots_free(slot, count=2):
    held = 0
    try:
        while held < count and slot.acquire(blocking=False):
            held += 1
        return held == count
    finally:
        for _ in range(held):
            slot.release()


def agent_document():
    return AgentRequest(requestId="timeout-turn", experiment=experiment(), message=USER_TEXT)


def scene_document():
    return SceneAgentRequest(requestId="scene-timeout", state=state("reflection-refraction-1"), message=USER_TEXT)


class TurnLimitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.servers = []

    def tearDown(self):
        for server in self.servers:
            server.close()

    def server(self, kind=SilentUpstream):
        server = kind()
        self.servers.append(server)
        return server

    def settings(self, server):
        return Settings(SECRET, "test-model", server.base_url)

    def test_provider_timeout_bounds_connect_and_read(self):
        timeout = provider_timeout()
        self.assertEqual(timeout.connect, 10)
        self.assertEqual(timeout.read, 60)
        self.assertIsNotNone(timeout.read)
        self.assertEqual(Settings(SECRET, "m", "https://example.test").provider_timeout.read, 60)

    async def test_silent_upstream_times_out_releases_slot_and_logs_without_secrets(self):
        server = self.server()
        settings = self.settings(server)

        async def once():
            try:
                await agent_chat(agent_document(), Connected())
            except HTTPException as error:
                return error

        with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=settings), \
                patch("backend.turn_limits.READ_SECONDS", 0.6), \
                patch("backend.turn_limits.CONNECT_SECONDS", 2), \
                patch("backend.turn_limits.WRITE_SECONDS", 2), \
                patch("backend.turn_limits.SCENE_TURN_SECONDS", 8), \
                self.assertLogs("optics.assistant", level="INFO") as captured:
            started = time.monotonic()
            first = asyncio.create_task(once())
            second = asyncio.create_task(once())
            for _ in range(40):
                if server.accepts >= 2:
                    break
                await asyncio.sleep(0.05)
            self.assertGreaterEqual(server.accepts, 2)
            self.assertFalse(agent_slots.acquire(blocking=False))
            third = await once()
            self.assertEqual(third.status_code, 429)
            one, two = await asyncio.gather(first, second)
        self.assertLess(time.monotonic() - started, 4)
        for error in (one, two):
            self.assertEqual(error.status_code, 504)
            self.assertEqual(error.detail, STALL_MESSAGE)
        self.assertTrue(slots_free(agent_slots))
        text = "\n".join(captured.output)
        self.assertIn("route=agent", text)
        self.assertIn("timed_out=True", text)
        self.assertIn("reason=stall", text)
        self.assertEqual(one.detail, STALL_MESSAGE)
        self.assertNotIn(SECRET, text)
        self.assertNotIn(USER_TEXT, text)

    async def test_turn_budget_aborts_an_upstream_that_keeps_sending(self):
        server = self.server(DripUpstream)
        settings = self.settings(server)
        with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=settings), \
                patch("backend.turn_limits.READ_SECONDS", 5), \
                patch("backend.turn_limits.CONNECT_SECONDS", 2), \
                patch("backend.turn_limits.WRITE_SECONDS", 2), \
                patch("backend.turn_limits.SCENE_TURN_SECONDS", 0.4):
            started = time.monotonic()
            with self.assertRaises(HTTPException) as caught:
                await agent_chat(agent_document(), Connected())
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(caught.exception.detail, BUDGET_MESSAGE)
        self.assertTrue(server.closed.wait(2))
        self.assertTrue(slots_free(agent_slots))

    async def test_disconnect_aborts_scene_and_legacy_upstream(self):
        for endpoint, document in ((agent_chat, agent_document()), (scene_chat, scene_document())):
            with self.subTest(endpoint=endpoint.__name__):
                server = self.server()
                ready = threading.Event()
                server.accepted = ready
                settings = self.settings(server)
                with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=settings), \
                        patch("backend.turn_limits.READ_SECONDS", 20), \
                        patch("backend.turn_limits.CONNECT_SECONDS", 2), \
                        patch("backend.turn_limits.WRITE_SECONDS", 2), \
                        patch("backend.turn_limits.SCENE_TURN_SECONDS", 20):
                    started = time.monotonic()
                    with self.assertRaises(HTTPException) as caught:
                        await endpoint(document, DropAfter(ready))
                self.assertLess(time.monotonic() - started, 3)
                self.assertNotEqual(caught.exception.status_code, 504)
                self.assertTrue(server.closed.wait(2))
                self.assertTrue(slots_free(agent_slots))

    async def test_research_silent_upstream_times_out_and_releases_its_slot(self):
        server = self.server()
        settings = self.settings(server)

        async def read(response):
            chunks = []
            try:
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
            finally:
                await response.body_iterator.aclose()
            return [json.loads(chunk) for chunk in chunks if chunk.strip()]

        with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=settings), \
                patch("backend.turn_limits.READ_SECONDS", 0.6), \
                patch("backend.turn_limits.CONNECT_SECONDS", 2), \
                patch("backend.turn_limits.WRITE_SECONDS", 2), \
                patch("backend.turn_limits.LONG_TURN_SECONDS", 8):
            started = time.monotonic()
            response = await research_agent_chat(ResearchAgentRequest(requestId="research-hang", message=USER_TEXT), Connected())
            events = await read(response)
        self.assertLess(time.monotonic() - started, 4)
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["message"], STALL_MESSAGE)
        self.assertTrue(slots_free(research_agent_slots))
        text = json.dumps(events)
        self.assertNotIn(SECRET, text)

    async def test_builder_budget_cancels_and_releases_its_slot(self):
        def slow(document, settings, progress, cancelled, **kwargs):
            limit = time.monotonic() + 5
            while not cancelled():
                if time.monotonic() > limit:
                    raise AssertionError("turn budget did not cancel the builder")
                time.sleep(0.01)
            raise AgentError("已停止本轮设计，装置未修改。", 499)

        settings = Settings(SECRET, "test-model", "https://example.test")
        with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=settings), \
                patch("backend.app.run_spatial_agent", side_effect=slow), \
                patch("backend.turn_limits.LONG_TURN_SECONDS", 0.25):
            started = time.monotonic()
            response = await spatial_agent_chat(
                SpatialAgentRequest(requestId="builder-budget", experiment=apparatus(), message=USER_TEXT),
                Connected(),
            )
            chunks = []
            try:
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
            finally:
                await response.body_iterator.aclose()
        self.assertLess(time.monotonic() - started, 2)
        events = [json.loads(chunk) for chunk in chunks if chunk.strip()]
        self.assertEqual(events[-1], {"type": "error", "message": BUDGET_MESSAGE})
        self.assertTrue(slots_free(spatial_agent_slots))
        self.assertNotIn(USER_TEXT, "\n".join(chunks))
        self.assertNotIn(SECRET, "\n".join(chunks))

    def test_budget_keeps_the_original_apparatus_and_says_progress_remains(self):
        stop = TurnStop()
        stop.expire()
        request = SpatialAgentRequest(requestId="kept", experiment=apparatus(), message="继续搭建")
        result = run_spatial_agent(request, Settings(SECRET, "test-model", "https://example.test"), client=object(), cancelled=stop)
        self.assertFalse(result["changed"])
        self.assertFalse(result["applyAllowed"])
        self.assertEqual(result["experiment"], request.experiment.model_dump())
        self.assertTrue(result["answer"].startswith(BUDGET_MESSAGE))
        with self.assertRaises(AgentError) as caught:
            run_spatial_agent(request, Settings(SECRET, "test-model", "https://example.test"), client=object(), cancelled=stop, delegated=True)
        self.assertEqual(caught.exception.message, BUDGET_MESSAGE)

    def test_user_stop_keeps_finished_steps_and_drops_the_one_still_running(self):
        self.assertEqual(
            [step["summary"] for step in finished_steps([
                {"name": "read_workspace", "status": "ok", "summary": "读取当前三维装置"},
                {"name": "phase_compute", "status": "ok", "summary": "正在计算"},
            ])],
            ["读取当前三维装置"],
        )
        seen = {"n": 0}

        def handler(_request):
            seen["n"] += 1
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "read", "type": "function", "function": {"name": "read_workspace", "arguments": "{}"}}]} if seen["n"] == 1 else {"role": "assistant", "content": "不应再调用"}
            return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls" if seen["n"] == 1 else "stop", "message": message}]})

        class Stop:
            # Allow the first round and its finished tool, then stop before another model call.
            budget = False
            def __init__(self):
                self.checks = 0
            def __call__(self):
                self.checks += 1
                return self.checks >= 3

        request = SpatialAgentRequest(requestId="stop-keep", experiment=apparatus(), message="搭建并计算")
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            result = run_spatial_agent(request, Settings(SECRET, "test-model", "https://example.test"), client=client, cancelled=Stop())
        self.assertEqual(seen["n"], 1)
        self.assertFalse(result["changed"])
        self.assertFalse(result["applyAllowed"])
        self.assertEqual(result["experiment"], request.experiment.model_dump())
        self.assertEqual([step["name"] for step in result["trace"]], ["read_workspace"])
        self.assertTrue(result["answer"].startswith(STOP_MESSAGE))
        self.assertNotIn("正在", result["answer"])

    async def test_spatial_stop_returns_the_finished_reply_and_frees_the_slot(self):
        from backend.app import ResearchCancelRequest, cancel_spatial

        def fake(document, settings, progress, cancelled, **kwargs):
            progress({"name": "read_workspace", "status": "ok", "summary": "读取当前三维装置"})
            progress({"name": "phase_compute", "status": "ok", "summary": "正在计算"})
            while not cancelled():
                time.sleep(0.01)
            return {"requestId": document.requestId, "inputSnapshot": document.experiment.model_dump(),
                    "experiment": document.experiment.model_dump(), "changed": False, "applyAllowed": False,
                    "answer": "已停止\n已完成：读取当前三维装置", "trace": [{"name": "read_workspace", "status": "ok", "summary": "读取当前三维装置"}],
                    "checks": [], "comparisons": [], "evidence": None}

        request = SpatialAgentRequest(requestId="stop-slot", experiment=apparatus(), message="停止")
        with patch.dict("os.environ", {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=Settings(SECRET, "test-model", "https://example.test")), patch("backend.app.run_spatial_agent", side_effect=fake):
            response = await spatial_agent_chat(request, Connected())
            stopped = await cancel_spatial(ResearchCancelRequest(requestId="stop-slot"))
            chunks = []
            try:
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
            finally:
                await response.body_iterator.aclose()
        self.assertTrue(stopped["stopped"])
        self.assertTrue(slots_free(spatial_agent_slots))
        events = [json.loads(chunk) for chunk in chunks if chunk.strip()]
        self.assertEqual(events[-1]["type"], "reply")
        self.assertIn("读取当前三维装置", events[-1]["reply"]["answer"])
        self.assertNotIn("正在计算", events[-1]["reply"]["answer"])


if __name__ == "__main__":
    unittest.main()

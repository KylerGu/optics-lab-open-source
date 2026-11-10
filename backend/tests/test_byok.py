"""Browser-supplied DeepSeek keys stay out of logs, and other providers are refused."""
import json
import logging
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.app import app
from backend.settings import ByokRejected, Settings, get_settings, settings_for_request
from backend.tests.test_agent import answer, request


SECRET = "sk-byok-TESTKEY-zz99"
SERVER_SECRET = "server-key-SHOULD-NOT-LEAK"


class Collect(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(self.format(record))


class ByokSettingsTests(unittest.TestCase):
    def test_server_key_is_ignored_unless_the_switch_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("AI_API_KEY=from-dotenv\nAI_MODEL=deepseek-flash\nAI_BASE_URL=https://api.deepseek.com\n", encoding="utf-8")
            with patch("backend.settings.ENV_PATH", path), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(get_settings().api_key, "from-dotenv")
                self.assertEqual(settings_for_request(None).api_key, "")
                self.assertFalse(settings_for_request({}).configured)
            with patch("backend.settings.ENV_PATH", path), patch.dict(os.environ, {"AI_ALLOW_SERVER_KEY": "1"}, clear=True):
                self.assertEqual(settings_for_request(None).api_key, "from-dotenv")

    def test_non_deepseek_addresses_and_unknown_models_are_rejected(self):
        headers = {"x-ai-key": SECRET, "x-ai-model": "deepseek-flash"}
        for base in [
            "https://evil.example/v1",
            "https://api.deepseek.com.evil.com",
            "http://api.deepseek.com",
            "https://user:secret@api.deepseek.com",
            "https://api.deepseek.com/other",
            "https://api.deepseek.com?key=secret",
            "file:///tmp/key",
        ]:
            with self.subTest(base=base):
                with self.assertRaises(ByokRejected) as caught:
                    settings_for_request({**headers, "x-ai-base-url": base})
                self.assertNotIn(SECRET, caught.exception.message)
                self.assertNotIn(base, caught.exception.message)
        with self.assertRaises(ByokRejected) as caught:
            settings_for_request({"x-ai-key": SECRET, "x-ai-model": "deepseek-chat"})
        self.assertNotIn(SECRET, caught.exception.message)
        for base in ("https://api.deepseek.com", "https://api.deepseek.com/", "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/"):
            settings = settings_for_request({**headers, "x-ai-base-url": base, "x-ai-reasoning": "low"})
            self.assertEqual(settings.base_url, base.rstrip("/"))
            self.assertEqual(settings.model, "deepseek-flash")
            self.assertEqual(settings.reasoning_effort, "low")
            self.assertTrue(settings.configured)

    def test_user_key_wins_over_an_enabled_server_key(self):
        headers = {"x-ai-key": SECRET, "x-ai-model": "deepseek-v4-pro"}
        with patch.dict(os.environ, {"AI_ALLOW_SERVER_KEY": "1", "AI_API_KEY": SERVER_SECRET, "AI_MODEL": "server-model", "AI_BASE_URL": "https://example.test"}, clear=True):
            chosen = settings_for_request(headers)
        self.assertEqual(chosen.api_key, SECRET)
        self.assertEqual(chosen.model, "deepseek-v4-pro")
        self.assertEqual(chosen.base_url, "https://api.deepseek.com")
        with self.assertRaises(ByokRejected):
            settings_for_request({**headers, "x-ai-base-url": "https://evil.example"})


class ByokHttpTests(unittest.TestCase):
    def test_user_key_reaches_the_provider_but_not_the_response_or_logs(self):
        seen = []

        def handle(req):
            seen.append(req.headers.get("authorization"))
            return httpx.Response(200, json=answer("焦距表示汇聚能力。"))

        real_client = httpx.Client

        def factory(*_args, **_kwargs):
            return real_client(transport=httpx.MockTransport(handle), follow_redirects=False)

        collector = Collect()
        backend_log = logging.getLogger("backend")
        previous = backend_log.level
        backend_log.setLevel(logging.DEBUG)
        backend_log.addHandler(collector)
        try:
            with patch("backend.agent.httpx.Client", factory), patch("backend.app.get_settings", return_value=Settings(SERVER_SECRET, "server-model", "https://example.test")), patch.dict(os.environ, {"AI_ALLOW_SERVER_KEY": "1"}):
                response = TestClient(app).post("/api/agent/chat", headers={"X-AI-Key": SECRET, "X-AI-Model": "deepseek-flash"}, json=request().model_dump())
        finally:
            backend_log.removeHandler(collector)
            backend_log.setLevel(previous)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(seen, [f"Bearer {SECRET}"])
        self.assertNotIn(SECRET, response.text)
        self.assertNotIn(SERVER_SECRET, response.text)
        logged = "\n".join(collector.messages)
        self.assertNotIn(SECRET, logged)
        self.assertNotIn(SERVER_SECRET, logged)

    def test_rejected_address_is_not_called_and_does_not_echo_the_key(self):
        body = request().model_dump()
        with patch("backend.app.run_agent") as provider:
            response = TestClient(app).post("/api/agent/chat", headers={"X-AI-Key": SECRET, "X-AI-Base-URL": "https://evil.example/v1", "X-AI-Model": "deepseek-flash"}, json=body)
        self.assertEqual(response.status_code, 422)
        provider.assert_not_called()
        self.assertNotIn(SECRET, response.text)
        self.assertNotIn("evil.example", response.text)
        self.assertIn("DeepSeek", response.text)

    def test_key_in_json_body_is_not_echoed(self):
        body = request().model_dump()
        body["apiKey"] = SECRET
        response = TestClient(app).post("/api/agent/chat", json=body)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(SECRET, response.text)

    def test_research_debug_file_omits_browser_and_server_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("backend.local_debug.DEBUG_ROOT", Path(directory)), patch.dict(os.environ, {"AI_ALLOW_SERVER_KEY": "1"}), patch("backend.app.get_settings", return_value=Settings(SERVER_SECRET, "server-model", "https://example.test")), patch("backend.app.run_research_agent", return_value={"answer": "已记录"}):
                response = TestClient(app).post("/api/research/agent/chat", headers={"X-AI-Key": SECRET, "X-AI-Model": "deepseek-v4-pro", "X-AI-Base-URL": "https://api.deepseek.com"}, json={"requestId": "byok", "message": "解释干涉"})
            self.assertEqual(response.status_code, 200, response.text)
            files = list(Path(directory).glob("run-*.jsonl"))
            self.assertEqual(len(files), 1)
            raw = files[0].read_text(encoding="utf-8")
            self.assertIn("deepseek-v4-pro", raw)
            self.assertNotIn(SECRET, raw)
            self.assertNotIn(SERVER_SECRET, raw)
            self.assertNotIn("example.test", raw)
            self.assertNotIn("authorization", raw.lower())
            self.assertNotIn(SECRET, response.text)


if __name__ == "__main__":
    unittest.main()

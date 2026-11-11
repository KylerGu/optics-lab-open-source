"""APP_ENV=production hides debug output and API docs, and adds security headers."""
import asyncio
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import SECURITY_HEADERS, ProductionGuard, app, fastapi_docs_options
from backend.local_debug import DebugRun, save_snapshot
from backend.research_agent import ResearchAgentRequest
from backend.settings import Settings, production_mode

ROOT = Path(__file__).resolve().parents[2]


def _http_scope(path):
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }


class ProductionModeTests(unittest.TestCase):
    def test_only_production_value_enables_the_switch(self):
        for value in ("", "development", "dev", "prod", "Production "):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"APP_ENV": value}):
                    # Trailing space on "Production" still counts; other values do not.
                    self.assertEqual(production_mode(), value.strip().lower() == "production")
                    self.assertEqual(
                        fastapi_docs_options(),
                        {"docs_url": None, "redoc_url": None, "openapi_url": None} if production_mode() else {},
                    )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("APP_ENV", None)
            self.assertFalse(production_mode())
            self.assertEqual(fastapi_docs_options(), {})

    def test_app_started_in_production_does_not_register_docs(self):
        script = (
            "import os\n"
            "os.environ['APP_ENV'] = 'production'\n"
            "from backend.app import app\n"
            "assert app.debug is False\n"
            "assert app.docs_url is None and app.redoc_url is None and app.openapi_url is None\n"
        )
        completed = subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_dev_process_keeps_docs_and_tracebacks_off(self):
        self.assertNotEqual(os.environ.get("APP_ENV", "").strip().lower(), "production")
        self.assertFalse(app.debug)
        self.assertEqual(app.docs_url, "/docs")
        self.assertEqual(app.redoc_url, "/redoc")
        self.assertEqual(app.openapi_url, "/openapi.json")


class ProductionHttpTests(unittest.TestCase):
    def test_production_hides_docs_snapshot_and_sets_headers(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"APP_ENV": "production"}), patch("backend.local_debug.DEBUG_ROOT", root), TestClient(app) as client:
                health = client.get("/api/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "ok")
                for key, value in SECURITY_HEADERS.items():
                    self.assertEqual(health.headers[key], value)
                self.assertIn("connect-src 'self'", health.headers["content-security-policy"])
                self.assertNotIn("api.deepseek.com", health.headers["content-security-policy"])
                self.assertNotIn("unsafe-eval", health.headers["content-security-policy"])
                self.assertNotIn("access-control-allow-origin", {name.lower() for name in health.headers})
                for path in ("/docs", "/docs/", "/redoc", "/openapi.json"):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 404, path)
                    self.assertNotIn("swagger", response.text.lower())
                    self.assertEqual(response.headers["x-frame-options"], "DENY")
                snapshot = client.post("/api/debug/snapshot", json={"area": "builder", "state": {"note": "场景内容"}})
                self.assertEqual(snapshot.status_code, 404)
                self.assertEqual(list(root.iterdir()), [])

    def test_development_keeps_docs_snapshots_and_omits_production_headers(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"APP_ENV": "development"}), patch("backend.local_debug.DEBUG_ROOT", root), TestClient(app) as client:
                health = client.get("/api/health")
                self.assertEqual(health.status_code, 200)
                self.assertNotIn("strict-transport-security", {name.lower() for name in health.headers})
                self.assertNotIn("content-security-policy", {name.lower() for name in health.headers})
                docs = client.get("/docs")
                self.assertEqual(docs.status_code, 200)
                self.assertIn("swagger", docs.text.lower())
                self.assertEqual(client.get("/openapi.json").status_code, 200)
                snapshot = client.post("/api/debug/snapshot", json={"area": "research", "state": {"position": 1}})
                self.assertEqual(snapshot.json(), {"saved": True})
            self.assertTrue((root / "research-latest.json").is_file())

    def test_production_does_not_write_conversation_records(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            request = ResearchAgentRequest(requestId="prod", message="请记录这段对话")
            with patch("backend.local_debug.DEBUG_ROOT", root), patch.dict(os.environ, {"APP_ENV": "production"}):
                debug = DebugRun("research", request, Settings("secret-api-key", "deepseek-flash"))
                debug.record("reply", answer="不应落盘")
                self.assertFalse(save_snapshot("builder", {"scene": "private"}))
            self.assertEqual(list(root.iterdir()), [])
            self.assertFalse(debug.path.exists())

    def test_development_still_writes_conversation_records(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            request = ResearchAgentRequest(requestId="dev", message="本地对话")
            with patch("backend.local_debug.DEBUG_ROOT", root), patch.dict(os.environ, {"APP_ENV": "development"}):
                debug = DebugRun("research", request, Settings("secret-api-key", "deepseek-flash"))
                debug.record("reply", answer="可以落盘")
            text = debug.path.read_text(encoding="utf-8")
            self.assertIn("本地对话", text)
            self.assertNotIn("secret-api-key", text)


class ProductionGuardTests(unittest.TestCase):
    def test_headers_are_added_without_merging_stream_chunks(self):
        chunks = []

        async def inner(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/x-ndjson")]})
            await send({"type": "http.response.body", "body": b"one\n", "more_body": True})
            await send({"type": "http.response.body", "body": b"two\n", "more_body": False})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            chunks.append(message)

        with patch.dict(os.environ, {"APP_ENV": "production"}):
            asyncio.run(ProductionGuard(inner)(_http_scope("/api/research/agent/chat"), receive, send))
        self.assertEqual([message["body"] for message in chunks if message["type"] == "http.response.body"], [b"one\n", b"two\n"])
        header_map = {name.decode(): value.decode() for name, value in chunks[0]["headers"]}
        self.assertEqual(header_map["content-type"], "application/x-ndjson")
        self.assertEqual(header_map["x-content-type-options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", header_map["content-security-policy"])

    def test_development_passthrough_does_not_touch_the_response(self):
        seen = []

        async def inner(_scope, _receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok", "more_body": False})

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            seen.append(message)

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("APP_ENV", None)
            asyncio.run(ProductionGuard(inner)(_http_scope("/api/health"), receive, send))
        self.assertEqual(seen[0]["headers"], [])

    def test_production_docs_paths_never_reach_the_app(self):
        called = False

        async def inner(_scope, _receive, _send):
            nonlocal called
            called = True

        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        with patch.dict(os.environ, {"APP_ENV": "Production"}):
            asyncio.run(ProductionGuard(inner)(_http_scope("/openapi.json"), receive, send))
        self.assertFalse(called)
        self.assertEqual(messages[0]["status"], 404)

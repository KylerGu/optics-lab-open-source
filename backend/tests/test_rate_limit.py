"""Server-key rate limiting applies to fallback requests while leaving BYOK exempt."""
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app, server_key_limiter
from backend.rate_limit import ServerKeyRateLimiter
from backend.settings import Settings
from backend.tests.test_agent import request as agent_request
from backend.tests.test_scene_physics import state as scene_state
from backend.tests.test_spatial_agent import apparatus as spatial_apparatus

MISSING_ENV = Path("__nonexistent_test_env__")


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds: float):
        self.now += seconds


class ServerKeyRateLimiterTests(unittest.TestCase):
    def test_minute_limit_resets_after_sixty_seconds(self):
        clock = FakeClock()
        limiter = ServerKeyRateLimiter(clock=clock)
        self.assertIsNone(limiter.consume("1.2.3.4", minute_limit=2, ip_daily_limit=10, global_daily_limit=20))
        self.assertIsNone(limiter.consume("1.2.3.4", minute_limit=2, ip_daily_limit=10, global_daily_limit=20))
        denied = limiter.consume("1.2.3.4", minute_limit=2, ip_daily_limit=10, global_daily_limit=20)
        self.assertIsNotNone(denied)
        self.assertIn("频繁", denied)
        # Another IP is unaffected by the per-IP minute limit.
        self.assertIsNone(limiter.consume("5.6.7.8", minute_limit=2, ip_daily_limit=10, global_daily_limit=20))
        clock.advance(61.0)
        self.assertIsNone(limiter.consume("1.2.3.4", minute_limit=2, ip_daily_limit=10, global_daily_limit=20))

    def test_ip_daily_and_global_daily_limits(self):
        clock = FakeClock()
        limiter = ServerKeyRateLimiter(clock=clock)
        self.assertIsNone(limiter.consume("1.1.1.1", minute_limit=0, ip_daily_limit=2, global_daily_limit=3))
        self.assertIsNone(limiter.consume("1.1.1.1", minute_limit=0, ip_daily_limit=2, global_daily_limit=3))
        ip_denied = limiter.consume("1.1.1.1", minute_limit=0, ip_daily_limit=2, global_daily_limit=3)
        self.assertIsNotNone(ip_denied)
        self.assertIn("上限", ip_denied)

        # A second IP gets 1 remaining global slot, then hits the global daily cap.
        self.assertIsNone(limiter.consume("2.2.2.2", minute_limit=0, ip_daily_limit=2, global_daily_limit=3))
        global_denied = limiter.consume("3.3.3.3", minute_limit=0, ip_daily_limit=2, global_daily_limit=3)
        self.assertIsNotNone(global_denied)
        self.assertIn("全站", global_denied)

        clock.advance(86401.0)
        self.assertIsNone(limiter.consume("3.3.3.3", minute_limit=0, ip_daily_limit=2, global_daily_limit=3))


class ServerKeyEndpointRateLimitTests(unittest.TestCase):
    def setUp(self):
        server_key_limiter.reset()

    def tearDown(self):
        server_key_limiter.reset()

    def test_server_key_requests_are_limited_and_byok_is_exempt(self):
        body = agent_request().model_dump()
        env = {
            "AI_ALLOW_SERVER_KEY": "1",
            "AI_SERVER_KEY_MINUTE_LIMIT": "2",
            "AI_SERVER_KEY_IP_DAILY_LIMIT": "10",
            "AI_SERVER_KEY_DAILY_LIMIT": "10",
        }
        reply = {
            "requestId": body["requestId"],
            "model": "deepseek-flash",
            "inputSnapshot": body["experiment"],
            "experiment": body["experiment"],
            "changed": False,
            "answer": "已收到。",
            "trace": [],
            "evidence": None,
            "scans": [],
            "designs": [],
            "studies": [],
        }
        with patch("backend.settings.ENV_PATH", MISSING_ENV), \
                patch.dict(os.environ, env, clear=True), \
                patch("backend.app.get_settings", return_value=Settings("server-secret", "deepseek-flash")), \
                patch("backend.app.run_agent", return_value=reply):
            client = TestClient(app)
            self.assertEqual(client.post("/api/agent/chat", json=body, headers={"X-Forwarded-For": "203.0.113.10"}).status_code, 200)
            self.assertEqual(client.post("/api/agent/chat", json=body, headers={"X-Forwarded-For": "203.0.113.10"}).status_code, 200)
            limited = client.post("/api/agent/chat", json=body, headers={"X-Forwarded-For": "203.0.113.10"})
            self.assertEqual(limited.status_code, 429)
            self.assertIn("模型设置", limited.json()["detail"])

            # BYOK requests bypass the server-key rate limit and verify the concurrency slot was released.
            byok = client.post(
                "/api/agent/chat",
                json=body,
                headers={"X-Forwarded-For": "203.0.113.10", "X-AI-Key": "sk-user-byok-key", "X-AI-Model": "deepseek-flash"},
            )
            self.assertEqual(byok.status_code, 200)

    def test_global_daily_cap_covers_streaming_endpoints_and_releases_slots(self):
        env = {
            "AI_ALLOW_SERVER_KEY": "1",
            "AI_SERVER_KEY_MINUTE_LIMIT": "0",
            "AI_SERVER_KEY_IP_DAILY_LIMIT": "0",
            "AI_SERVER_KEY_DAILY_LIMIT": "1",
        }
        with patch("backend.settings.ENV_PATH", MISSING_ENV), \
                patch.dict(os.environ, env, clear=True), \
                patch("backend.app.get_settings", return_value=Settings("server-secret", "deepseek-flash")), \
                patch("backend.app.run_research_agent", return_value={"answer": "完成"}):
            client = TestClient(app)
            first = client.post(
                "/api/research/agent/chat",
                json={"requestId": "req-1", "message": "解释衍射"},
                headers={"X-Forwarded-For": "198.51.100.1"},
            )
            self.assertEqual(first.status_code, 200)

            second = client.post(
                "/api/research/agent/chat",
                json={"requestId": "req-2", "message": "再解释一次"},
                headers={"X-Forwarded-For": "198.51.100.2"},
            )
            self.assertEqual(second.status_code, 429)
            self.assertIn("全站", second.json()["detail"])

            # Other streaming endpoints share the same global daily cap and release slots cleanly on 429.
            scene_limited = client.post(
                "/api/scenes/agent/chat",
                json={"requestId": "req-scene", "state": scene_state("reflection-refraction-1").model_dump(), "message": "解释成像"},
                headers={"X-Forwarded-For": "198.51.100.3"},
            )
            self.assertEqual(scene_limited.status_code, 429)
            self.assertIn("全站", scene_limited.json()["detail"])

            spatial_limited = client.post(
                "/api/spatial/agent/chat",
                json={"requestId": "req-spatial", "experiment": spatial_apparatus().model_dump(), "message": "搭建光路"},
                headers={"X-Forwarded-For": "198.51.100.4"},
            )
            self.assertEqual(spatial_limited.status_code, 429)
            self.assertIn("全站", spatial_limited.json()["detail"])

            # Ensure the semaphore was released after the 429 so a BYOK call succeeds immediately.
            byok = client.post(
                "/api/research/agent/chat",
                json={"requestId": "req-3", "message": "使用自有密钥"},
                headers={"X-Forwarded-For": "198.51.100.2", "X-AI-Key": "sk-user-byok-key", "X-AI-Model": "deepseek-flash"},
            )
            self.assertEqual(byok.status_code, 200)


if __name__ == "__main__":
    unittest.main()

"""Cache-Control for the built site: revalidate index.html, cache hashed assets."""
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from backend.app import SECURITY_HEADERS, ProductionGuard, app
from backend.web import WebsiteFiles, mount_website


def write_site(directory):
    root = Path(directory)
    (root / "assets").mkdir()
    (root / "index.html").write_text(
        "<!doctype html><title>光学智研</title><script src=\"/assets/index-abc123.js\"></script>",
        encoding="utf-8",
    )
    (root / "assets" / "index-abc123.js").write_text("console.log(1)\n", encoding="utf-8")
    (root / "assets" / "index-abc123.css").write_text("body{}\n", encoding="utf-8")
    (root / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    return root


def client_app(directory):
    application = FastAPI()
    application.add_middleware(ProductionGuard)

    @application.get("/api/health")
    def health():
        return {"status": "ok"}

    @application.get("/api/stream")
    def stream():
        return StreamingResponse(
            iter([b"{}\n"]),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    mount_website(application, directory)
    return application


class StaticCacheTests(unittest.TestCase):
    def test_html_revalidates_and_hashed_assets_are_immutable(self):
        with TemporaryDirectory() as directory:
            root = write_site(directory)
            with TestClient(client_app(root)) as client:
                page = client.get("/")
                self.assertEqual(page.status_code, 200)
                self.assertIn("/assets/index-abc123.js", page.text)
                self.assertEqual(page.headers["cache-control"], "no-cache")
                self.assertIn("etag", page.headers)
                self.assertIn("last-modified", page.headers)

                direct = client.get("/index.html")
                self.assertEqual(direct.status_code, 200)
                self.assertEqual(direct.text, page.text)
                self.assertEqual(direct.headers["cache-control"], "no-cache")

                head = client.head("/")
                self.assertEqual(head.status_code, 200)
                self.assertEqual(head.headers["cache-control"], "no-cache")

                revalidated = client.get("/", headers={"if-none-match": page.headers["etag"]})
                self.assertEqual(revalidated.status_code, 304)
                self.assertEqual(revalidated.headers["cache-control"], "no-cache")
                self.assertEqual(revalidated.headers["etag"], page.headers["etag"])

                script = client.get("/assets/index-abc123.js")
                self.assertEqual(script.status_code, 200)
                self.assertEqual(script.headers["cache-control"], "public, max-age=31536000, immutable")
                style = client.get("/assets/index-abc123.css")
                self.assertEqual(style.headers["cache-control"], "public, max-age=31536000, immutable")

                icon = client.get("/favicon.svg")
                self.assertEqual(icon.status_code, 200)
                self.assertNotIn("cache-control", icon.headers)

                missing = client.get("/assets/missing-abc123.js")
                self.assertEqual(missing.status_code, 404)
                self.assertNotEqual(missing.headers.get("cache-control"), "public, max-age=31536000, immutable")

    def test_index_html_fallback_for_any_path_is_revalidated(self):
        with TemporaryDirectory() as directory:
            root = write_site(directory)
            files = WebsiteFiles(directory=root, html=True)
            scope = {"type": "http", "method": "GET", "path": "/scenes", "headers": [], "query_string": b""}
            response = files.file_response(str(root / "index.html"), (root / "index.html").stat(), scope)
            self.assertEqual(response.headers["cache-control"], "no-cache")
            self.assertIn("etag", response.headers)

    def test_production_security_headers_and_api_cache_stay_intact(self):
        with TemporaryDirectory() as directory:
            application = client_app(write_site(directory))
            with patch.dict(os.environ, {"APP_ENV": "production"}), TestClient(application) as client:
                page = client.get("/")
                self.assertEqual(page.headers["cache-control"], "no-cache")
                for key, value in SECURITY_HEADERS.items():
                    self.assertEqual(page.headers[key], value)
                asset = client.get("/assets/index-abc123.js")
                self.assertEqual(asset.headers["cache-control"], "public, max-age=31536000, immutable")
                self.assertEqual(asset.headers["x-content-type-options"], "nosniff")
                self.assertIn("frame-ancestors 'none'", asset.headers["content-security-policy"])

                health = client.get("/api/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()["status"], "ok")
                self.assertNotIn("cache-control", health.headers)
                self.assertEqual(health.headers["x-frame-options"], "DENY")

                streamed = client.get("/api/stream")
                self.assertEqual(streamed.status_code, 200)
                self.assertEqual(streamed.headers["cache-control"], "no-store")
                self.assertEqual(streamed.headers["x-accel-buffering"], "no")
                self.assertEqual(streamed.headers["strict-transport-security"], "max-age=15552000")

            with patch.dict(os.environ, {"APP_ENV": "development"}), TestClient(application) as client:
                page = client.get("/")
                self.assertEqual(page.headers["cache-control"], "no-cache")
                self.assertNotIn("strict-transport-security", {name.lower() for name in page.headers})
                streamed = client.get("/api/stream")
                self.assertEqual(streamed.headers["cache-control"], "no-store")

    def test_real_api_is_not_given_static_cache_headers(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}), TestClient(app) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertNotIn("cache-control", health.headers)
            for key, value in SECURITY_HEADERS.items():
                self.assertEqual(health.headers[key], value)

    def test_mount_still_requires_a_build(self):
        fresh = FastAPI()
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "npm run build"):
                mount_website(fresh, directory)

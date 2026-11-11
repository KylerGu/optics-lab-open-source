"""Serve the built website and calculation APIs from one production service."""
import os
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles

from .app import app


website_directory = Path(__file__).resolve().parents[1] / "dist"

# index.html is the SPA shell. Without Cache-Control, browsers heuristically
# cache it and keep the previous hashed bundle after a deploy.
# Files under /assets/ include a content hash, so they can be cached for a year.
HTML_CACHE_CONTROL = "no-cache"
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


class WebsiteFiles(StaticFiles):
    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        cache_control = static_cache_control(scope.get("path", ""), full_path)
        if cache_control is not None:
            response.headers["cache-control"] = cache_control
        return response


def static_cache_control(url_path, full_path):
    """Header for one static file. None leaves the response as Starlette sent it.

    index.html covers `/`, `/index.html`, and any html-mode fallback that
    resolves to that file. Hashed build output lives under /assets/.
    """
    if Path(str(full_path)).name == "index.html":
        return HTML_CACHE_CONTROL
    path = "/" + str(url_path).split("?", 1)[0].lstrip("/")
    if path == "/assets" or path.startswith("/assets/"):
        return ASSET_CACHE_CONTROL
    return None


def mount_website(application, directory=website_directory):
    directory = Path(directory)
    if not (directory / "index.html").is_file():
        raise RuntimeError("网页尚未构建，请先运行 npm run build。")
    application.mount("/", WebsiteFiles(directory=directory, html=True), name="website")


# API routes are registered first. Only dist is public; source and .env stay private.
# Import still succeeds before the frontend build so tests can construct WebsiteFiles.
if (website_directory / "index.html").is_file():
    mount_website(app)
elif __name__ == "__main__":
    raise RuntimeError("网页尚未构建，请先运行 npm run build。")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))

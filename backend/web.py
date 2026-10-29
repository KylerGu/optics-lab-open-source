"""Serve the built website and calculation APIs from one production service."""
import os
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles

from .app import app


website_directory = Path(__file__).resolve().parents[1] / "dist"
if not (website_directory / "index.html").is_file():
    raise RuntimeError("网页尚未构建，请先运行 npm run build。")

# API routes are registered first. Only dist is public; source and .env stay private.
app.mount("/", StaticFiles(directory=website_directory, html=True), name="website")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))

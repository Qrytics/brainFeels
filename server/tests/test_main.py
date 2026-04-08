"""
Unit tests for the BrainFeels local server (demo mode — no TRIBE v2 required).

Run:
    pip install -r requirements.txt pytest httpx
    pytest tests/ -v
"""

from __future__ import annotations

import io
import pytest
import numpy as np

from httpx import AsyncClient, ASGITransport

# Import the FastAPI app
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from main import app, _summarize_predictions  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fake_webm(size_bytes: int = 1024) -> bytes:
    """Return a trivially-sized byte payload (not a valid WebM, but sufficient
    for demo-mode tests that never actually decode the video)."""
    return b"\x1a\x45\xdf\xa3" + b"\x00" * (size_bytes - 4)


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# /analyze — demo mode (tribev2 not installed in CI)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_analyze_demo_mode(monkeypatch):
    """When tribev2 is absent the server must return mode='demo' with HTTP 200."""

    # Force _run_tribe to raise RuntimeError (simulating missing package)
    import main as server_module

    def _fake_run_tribe(video_path, cache_folder):
        raise RuntimeError("tribev2 not installed (test stub)")

    monkeypatch.setattr(server_module, "_run_tribe", _fake_run_tribe)

    fake_webm = _make_fake_webm(512)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/analyze",
            files={"file": ("clip.webm", io.BytesIO(fake_webm), "video/webm")},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "demo"
    assert "disclaimer" in body
    assert "brain_summary" in body
    assert "emotion_overview" in body
    assert "meta" in body


# ---------------------------------------------------------------------------
# /analyze — file too large (413)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_analyze_too_large():
    """Payloads above MAX_BYTES must be rejected with HTTP 413."""
    big = b"\x00" * (121 * 1024 * 1024)  # 121 MB
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/analyze",
            files={"file": ("clip.webm", io.BytesIO(big), "video/webm")},
        )
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# /analyze — unknown suffix is normalised to .webm
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_analyze_unknown_suffix_normalized(monkeypatch, tmp_path):
    """A file with an unrecognised suffix must be written as .webm and still
    return a valid demo-mode response (no 5xx from suffix error)."""
    import main as server_module

    def _fake_run_tribe(video_path, cache_folder):
        raise RuntimeError("tribev2 not installed (test stub)")

    monkeypatch.setattr(server_module, "_run_tribe", _fake_run_tribe)

    fake_data = _make_fake_webm(256)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/analyze",
            files={"file": ("clip.xyz", io.BytesIO(fake_data), "application/octet-stream")},
        )
    assert resp.status_code == 200
    assert resp.json()["mode"] == "demo"


# ---------------------------------------------------------------------------
# _summarize_predictions
# ---------------------------------------------------------------------------

def test_summarize_predictions_valid_shape():
    preds = np.random.randn(10, 100).astype(np.float32)
    result = _summarize_predictions(preds)
    assert "brain_summary" in result
    assert "emotion_overview" in result
    meta = result["meta"]
    assert meta["n_time_segments"] == 10
    assert meta["n_vertices"] == 100
    assert isinstance(meta["mean_abs_pred"], float)


def test_summarize_predictions_bad_shape():
    preds_1d = np.array([1.0, 2.0, 3.0])
    with pytest.raises(ValueError):
        _summarize_predictions(preds_1d)

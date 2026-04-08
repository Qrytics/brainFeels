"""
Local API for the BrainFeels extension. Optionally runs TRIBE v2 on uploaded video clips.

TRIBE v2 predicts fMRI-like cortical responses; it does not measure real brains or output emotion labels.
"""

from __future__ import annotations

import pathlib
import platform

if platform.system() == "Windows":
    pathlib.PosixPath = pathlib.WindowsPath

import asyncio
import ipaddress
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_BYTES = 120 * 1024 * 1024  # 120 MB

app = FastAPI(title="BrainFeels TRIBE v2 local server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _summarize_predictions(preds: np.ndarray) -> dict[str, Any]:
    """Turn vertex-wise predictions into a short, cautious overview."""
    if preds.ndim != 2:
        raise ValueError("Expected preds shape (n_tr, n_vertices)")
    t, v = preds.shape
    mean_mag = float(np.mean(np.abs(preds)))
    spatial_var = float(np.std(preds, axis=0).mean())
    temporal_var = float(np.std(preds, axis=1).mean())

    brain_summary = (
        f"The model produced predictions for {t} TR-sized segments across {v} cortical vertices (fsaverage mesh). "
        f"Mean absolute predicted response magnitude is {mean_mag:.4f}. "
        f"Average variability across brain regions (per TR) is {spatial_var:.4f}; "
        f"average variability over time (per vertex) is {temporal_var:.4f}. "
        "Larger magnitudes indicate stronger predicted cortical responses for this stimulus, relative to the model's scale."
    )

    emotion_overview = (
        "TRIBE v2 does not classify emotions. As a loose, non-clinical proxy only: "
        "higher temporal variability can correspond to more rapidly changing predicted responses over the clip; "
        "higher overall magnitude suggests more intense predicted cortical engagement with the stimulus. "
        "This is not a measure of your feelings or mental state—only modelled brain-response patterns."
    )

    meta = {
        "n_time_segments": t,
        "n_vertices": v,
        "mean_abs_pred": mean_mag,
        "mean_spatial_std_per_tr": spatial_var,
        "mean_temporal_std_per_vertex": temporal_var,
    }
    return {
        "brain_summary": brain_summary,
        "emotion_overview": emotion_overview,
        "meta": meta,
    }


def _run_tribe(video_path: Path, cache_folder: Path) -> np.ndarray:
    """Load TribeModel and return prediction array (n_tr, n_vertices)."""
    try:
        from tribev2.demo_utils import TribeModel  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "TRIBE v2 Python package not found. Install Meta's tribev2 repo "
            "(see README) and dependencies, including PyTorch."
        ) from e

    cache_folder.mkdir(parents=True, exist_ok=True)
    model = TribeModel.from_pretrained(
        "facebook/tribev2",
        cache_folder=str(cache_folder),
        device="auto",
    )
    events = model.get_events_dataframe(video_path=str(video_path))
    preds, _segments = model.predict(events, verbose=False)
    return preds


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Pydantic models for thumbnail analysis
# ---------------------------------------------------------------------------

class ThumbnailAnalysisRequest(BaseModel):
    """Request body for the /analyze-thumbnail endpoint."""

    thumbnail_url: str
    grid_rows: int = 3
    grid_cols: int = 4


def _is_safe_thumbnail_url(url: str) -> bool:
    """
    Return True only for public HTTP(S) URLs.

    Rejects non-HTTP(S) schemes and any URL whose hostname resolves to a
    private, loopback, link-local, or reserved IP range — guarding against
    SSRF if the endpoint is later extended to fetch the URL server-side.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False

    if parsed.scheme not in {"http", "https"}:
        return False

    hostname = parsed.hostname or ""
    if not hostname:
        return False

    # Reject bare "localhost" regardless of case.
    if hostname.lower() in {"localhost", "localhost."}:
        return False

    # Try to parse as an IP address and reject non-global ranges.
    try:
        addr = ipaddress.ip_address(hostname)
        if not addr.is_global:
            return False
    except ValueError:
        # Not a bare IP — domain name; allow it.
        pass

    return True


@app.post("/analyze-thumbnail")
async def analyze_thumbnail(req: ThumbnailAnalysisRequest) -> dict[str, Any]:
    """
    Acknowledge a thumbnail emotion-mosaic analysis request.

    The browser extension performs color-heuristic analysis client-side
    (using the Canvas API) to build the mosaic.  This endpoint exists to:
    1. Return a canonical disclaimer and mode tag for the overlay UI.
    2. Serve as a hook for future TRIBE-based still-image analysis.

    TRIBE v2 is designed for multimodal video; still-image analysis is a
    color-psychology approximation only.
    """
    disclaimer = (
        "Color-heuristic analysis maps dominant hues in each thumbnail region to "
        "approximate emotional tones using color-psychology principles. "
        "This is not a scientific measurement of emotional intent and is not "
        "produced by TRIBE v2, which requires video + audio input."
    )

    if not _is_safe_thumbnail_url(req.thumbnail_url):
        raise HTTPException(
            status_code=422,
            detail="thumbnail_url must be a public absolute HTTP(S) URL (private/local addresses are not permitted).",
        )

    return {
        "mode": "color-heuristic",
        "disclaimer": disclaimer,
        "note": (
            "Mosaic colors are derived from per-cell dominant hues of the thumbnail image. "
            "TRIBE v2 video analysis is available separately via /analyze."
        ),
        "grid": {"rows": req.grid_rows, "cols": req.grid_cols},
        "thumbnail_url": req.thumbnail_url,
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> dict[str, Any]:
    disclaimer = (
        "TRIBE v2 predicts modelled cortical responses to multimodal stimuli—not your actual brain activity. "
        "It is research software (CC-BY-NC) and not medical or psychological advice."
    )

    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 120 MB).")

    suffix = Path(file.filename or "clip").suffix.lower()
    if suffix not in {".webm", ".mp4", ".mkv", ".mov", ".avi"}:
        suffix = ".webm"

    cache_root = Path(os.environ.get("BRAINFEELS_CACHE", Path(tempfile.gettempdir()) / "brainfeels-cache"))
    cache_root.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw)
        tmp_path = Path(tmp.name)

    # Chrome MediaRecorder writes WebM with Duration=N/A which moviepy cannot
    # parse. Remux through ffmpeg to fix the container duration metadata.
    fixed_path = tmp_path.with_name(tmp_path.stem + "_fixed" + suffix)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(tmp_path), "-c", "copy", str(fixed_path)],
            check=True,
            capture_output=True,
        )
        analysis_path = fixed_path
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning("ffmpeg remux failed (%s); attempting TRIBE on original file", e)
        analysis_path = tmp_path

    try:
        try:
            preds = _run_tribe(analysis_path, cache_root / "tribe")
        except RuntimeError as e:
            logger.warning("TRIBE unavailable or failed: %s", e)
            return {
                "mode": "demo",
                "disclaimer": disclaimer,
                "brain_summary": (
                    "TRIBE v2 did not run on this machine. "
                    "Install the tribev2 package, PyTorch, accept Hugging Face gating for bundled encoders (e.g. LLaMA), "
                    "then restart this server. "
                    f"Details: {e}"
                ),
                "emotion_overview": (
                    "Once TRIBE is installed, you will see statistics derived from predicted cortical responses. "
                    "Emotion labels are not part of the model; we only provide cautious interpretive language."
                ),
                "meta": {"error": str(e)},
            }
        except Exception as e:
            logger.exception("TRIBE inference failed")
            raise HTTPException(status_code=500, detail=f"TRIBE inference failed: {e}") from e

        out = _summarize_predictions(preds)
        return {
            "mode": "tribe",
            "disclaimer": disclaimer,
            **out,
        }
    finally:
        for p in (tmp_path, fixed_path if fixed_path != tmp_path else None):
            if p is not None:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# YouTube trending-moment analysis
# ---------------------------------------------------------------------------

class YouTubeAnalysisRequest(BaseModel):
    url: str
    clip_seconds: int = 30


def _is_youtube_url(url: str) -> bool:
    """Return True only for YouTube watch/shorts URLs."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    hostname = (parsed.hostname or "").lower()
    return hostname in {"www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"}


def _find_peak_segment(info: dict, clip_seconds: int) -> tuple[float, float]:
    """Return (start, end) in seconds for the most-replayed window."""
    duration = float(info.get("duration") or 0)
    heatmap = info.get("heatmap") or []

    if not heatmap or duration <= 0:
        start = min(max(30.0, duration * 0.2), max(0.0, duration - clip_seconds))
        return start, start + clip_seconds

    peak = max(heatmap, key=lambda b: b.get("value", 0))
    peak_mid = (peak["start_time"] + peak["end_time"]) / 2
    half = clip_seconds / 2
    start = max(0.0, peak_mid - half)
    end = min(duration, start + clip_seconds)
    start = max(0.0, end - clip_seconds)
    return start, end


@app.post("/analyze-youtube")
async def analyze_youtube(req: YouTubeAnalysisRequest) -> dict[str, Any]:
    """Download the most-replayed segment of a YouTube video and run TRIBE on it."""
    disclaimer = (
        "TRIBE v2 predicts modelled cortical responses to multimodal stimuli—not your actual brain activity. "
        "It is research software (CC-BY-NC) and not medical or psychological advice."
    )
    clip_seconds = max(10, min(120, req.clip_seconds))

    if not _is_youtube_url(req.url):
        raise HTTPException(status_code=422, detail="url must be a YouTube video URL.")

    # Resolve yt-dlp relative to the running Python so we always find the
    # venv copy, regardless of whether the venv is activated in the shell.
    _scripts_dir = Path(sys.executable).parent
    _ytdlp = str(_scripts_dir / "yt-dlp")

    # --- 1. Fetch video metadata (heatmap lives here) ----------------------
    def _get_info() -> dict:
        result = subprocess.run(
            [_ytdlp, "--dump-json", "--no-playlist", req.url],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp metadata failed: {result.stderr[:800]}")
        return json.loads(result.stdout)

    try:
        info = await asyncio.to_thread(_get_info)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    start, end = _find_peak_segment(info, clip_seconds)
    logger.info("YouTube trending segment: %.1f–%.1f s (%s)", start, end, info.get("title", ""))

    # --- 2. Download only that segment ------------------------------------
    tmp_dir = Path(tempfile.mkdtemp(prefix="brainfeels-yt-"))
    try:
        def _download() -> Path:
            result = subprocess.run(
                [
                    _ytdlp,
                    "--download-sections", f"*{start:.3f}-{end:.3f}",
                    "--no-playlist",
                    "-f", "best[height<=720]/best",
                    "--merge-output-format", "mp4",
                    "-o", str(tmp_dir / "clip.%(ext)s"),
                    req.url,
                ],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode != 0:
                raise RuntimeError(f"yt-dlp download failed: {result.stderr[:800]}")
            candidates = [f for f in tmp_dir.iterdir()
                          if f.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}]
            if not candidates:
                raise RuntimeError("yt-dlp produced no video file.")
            return candidates[0]

        try:
            raw_clip = await asyncio.to_thread(_download)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))

        # --- 3. Remux to fix container duration for moviepy ---------------
        fixed_clip = tmp_dir / "clip_fixed.mp4"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(raw_clip), "-c", "copy", str(fixed_clip)],
                check=True, capture_output=True,
            )
            analysis_path = fixed_clip
        except (subprocess.CalledProcessError, FileNotFoundError):
            analysis_path = raw_clip

        # --- 4. TRIBE inference -------------------------------------------
        cache_root = Path(os.environ.get("BRAINFEELS_CACHE",
                          Path(tempfile.gettempdir()) / "brainfeels-cache"))
        try:
            preds = await asyncio.to_thread(_run_tribe, analysis_path, cache_root / "tribe")
        except RuntimeError as e:
            logger.warning("TRIBE unavailable or failed: %s", e)
            return {
                "mode": "demo",
                "disclaimer": disclaimer,
                "brain_summary": f"TRIBE v2 did not run. Details: {e}",
                "emotion_overview": (
                    "Once TRIBE is installed you will see statistics derived from predicted cortical responses."
                ),
                "meta": {
                    "error": str(e),
                    "segment_start_s": round(start, 2),
                    "segment_end_s": round(end, 2),
                    "video_title": info.get("title", ""),
                },
            }
        except Exception as e:
            logger.exception("TRIBE inference failed (YouTube)")
            raise HTTPException(status_code=500, detail=f"TRIBE inference failed: {e}") from e

        out = _summarize_predictions(preds)
        out["meta"]["segment_start_s"] = round(start, 2)
        out["meta"]["segment_end_s"] = round(end, 2)
        out["meta"]["video_title"] = info.get("title", "")
        return {
            "mode": "tribe",
            "disclaimer": disclaimer,
            **out,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main() -> None:
    import uvicorn

    host = os.environ.get("BRAINFEELS_HOST", "127.0.0.1")
    port = int(os.environ.get("BRAINFEELS_PORT", "8765"))
    uvicorn.run("main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()

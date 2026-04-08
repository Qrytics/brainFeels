"""
Local API for the BrainFeels extension. Optionally runs TRIBE v2 on uploaded video clips.

TRIBE v2 predicts fMRI-like cortical responses; it does not measure real brains or output emotion labels.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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

    try:
        try:
            preds = _run_tribe(tmp_path, cache_root / "tribe")
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
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def main() -> None:
    import uvicorn

    host = os.environ.get("BRAINFEELS_HOST", "127.0.0.1")
    port = int(os.environ.get("BRAINFEELS_PORT", "8765"))
    uvicorn.run("main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()

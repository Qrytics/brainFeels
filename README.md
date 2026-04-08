# brainFeels

Browser extension plus a **local** Python server that uses Meta’s [TRIBE v2](https://huggingface.co/facebook/tribev2) model to summarize **predicted cortical (fMRI-like) responses** to a short video clip captured from the page (e.g. YouTube).

## What TRIBE v2 actually is

- It is **not** a chat LLM. It is a **multimodal brain encoding model**: video + audio + text features are mapped to predictions on a cortical surface mesh (~20k vertices).
- It does **not** measure anyone’s real brain and does **not** output emotion class labels. The server turns model outputs into **statistics** and **careful, non-clinical language** about “engagement” and variability—**not** verified emotions.
- Weights and code are heavy (PyTorch, large checkpoints, gated Hugging Face assets such as LLaMA). There is **no** hosted Hugging Face Inference API for this model; you run inference yourself.

## Architecture

1. **Chrome extension** (`extension/`): floating **BrainFeels** button opens a panel. **Record & analyze** uses `HTMLVideoElement.captureStream()` + `MediaRecorder` to grab a few seconds of what is playing, then POSTs the file to your machine.
2. **Local FastAPI server** (`server/`): saves the upload, runs TRIBE v2 if installed, returns JSON with `brain_summary`, `emotion_overview` (interpretive proxy text), and numeric `meta`.

## Quick start (extension + server without TRIBE)

Useful to verify wiring before installing TRIBE.

```powershell
cd server
python -m pip install -r requirements.txt
python main.py
```

Then load the unpacked extension in Chrome: **Extensions → Developer mode → Load unpacked** → select the `extension` folder. Set the server URL in the extension popup if needed (default `http://127.0.0.1:8765`).

Open a **video page**, start playback, click **BrainFeels → Record & analyze**. If TRIBE is not installed, the API responds in **`demo` mode** with setup instructions.

## Full TRIBE v2 setup (advanced)

1. Clone [facebookresearch/tribev2](https://github.com/facebookresearch/tribev2) and follow its README: Python environment, `pip install -e .`, Hugging Face login for gated models, optional GPU.
2. Ensure the `tribev2` package imports in the **same** environment as `server/main.py` (e.g. activate that venv, then `python main.py` from `server/`).
3. First inference will download checkpoints and feature caches; allow time and disk space.

Environment variables (optional):

| Variable | Meaning |
|----------|---------|
| `BRAINFEELS_HOST` | Bind address (default `127.0.0.1`) |
| `BRAINFEELS_PORT` | Port (default `8765`) |
| `BRAINFEELS_CACHE` | Directory for caches (default system temp under `brainfeels-cache`) |

## Limitations

- **DRM / capture**: Some streaming sites block or complicate capture; the recorder needs a normal HTML5 `<video>` that `captureStream()` can read while the clip plays.
- **Message size**: Very long or high-bitrate clips may hit browser extension message limits—keep the default clip length modest.
- **Science & ethics**: Treat outputs as exploratory model behaviour, not diagnostics or emotional truth.

## License

TRIBE v2 and its weights are **CC-BY-NC**; follow Meta’s license for model use. This repo’s extension and server are scaffolding only—ensure your use complies with site terms of service and applicable law when recording or analyzing video.

# brainFeels

Browser extension plus a **local** Python server that uses Meta's [TRIBE v2](https://huggingface.co/facebook/tribev2) model to summarize **predicted cortical (fMRI-like) responses** to a short video clip captured from the page (e.g. YouTube).

> **Docs:** [Tech Stack](docs/TECH_STACK.md) · [File Architecture](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md)

---

## What TRIBE v2 actually is

- It is **not** a chat LLM. It is a **multimodal brain encoding model**: video + audio + text features are mapped to predictions on a cortical surface mesh (~20 k vertices).
- It does **not** measure anyone's real brain and does **not** output emotion class labels. The server turns model outputs into **statistics** and **careful, non-clinical language** about "engagement" and variability — **not** verified emotions.
- Weights and code are heavy (PyTorch, large checkpoints, gated Hugging Face assets such as LLaMA). There is **no** hosted Hugging Face Inference API for this model; you run inference yourself.

---

## Repository layout

```
brainFeels/
├── .github/workflows/ci.yml   # Lint + unit-test pipeline
├── docs/
│   ├── PRD.md                 # Full Product Requirements Document
│   ├── TECH_STACK.md          # Technology stack decisions & rationale
│   └── ARCHITECTURE.md        # File structure & data-flow diagrams
├── extension/                 # Chrome extension (Manifest V3)
│   ├── assets/icons/          # PNG icons (16, 32, 48, 128 px)
│   ├── popup/                 # Settings popup (HTML + JS)
│   ├── background.js          # Service worker — relays clip to server
│   ├── content.js             # In-page panel + MediaRecorder + mosaic overlay
│   ├── manifest.json
│   └── styles.css
├── server/                    # Local FastAPI server
│   ├── tests/                 # pytest suite (demo mode; no TRIBE needed)
│   ├── main.py
│   └── requirements.txt
└── README.md
```

Full rationale for every choice is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Tech stack (summary)

| Layer | Technology |
|---|---|
| Chrome extension | Vanilla JS ES2022, Manifest V3 |
| In-page UI | Plain HTML + scoped CSS |
| Background worker | Chrome MV3 service worker |
| Local server | Python 3.10+, FastAPI, Uvicorn |
| ML / AI | Meta TRIBE v2 (PyTorch, optional GPU) |
| Testing | pytest + httpx (server); Jest + jest-webextension-mock (extension) |
| Linting | Ruff + mypy (Python); ESLint (JS) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

See **[docs/TECH_STACK.md](docs/TECH_STACK.md)** for detailed rationale and alternative options considered.

---

## Quick start (extension + server without TRIBE)

Useful to verify the wiring before installing TRIBE.

```bash
cd server
python -m pip install -r requirements.txt
python main.py
```

Then load the unpacked extension in Chrome: **Extensions → Developer mode → Load unpacked** → select the `extension/` folder. Set the server URL in the extension popup if needed (default `http://127.0.0.1:8765`).

Open a **video page**, start playback, click **BrainFeels → Record & analyze**. If TRIBE is not installed the API responds in **`demo` mode** with setup instructions.

---

## YouTube Thumbnail Emotion Mosaic

When browsing YouTube the extension automatically overlays a **color-coded emotion mosaic** on every visible thumbnail.

### How it works

1. A `MutationObserver` and `IntersectionObserver` detect thumbnail `<img>` elements as they appear during scroll, infinite-scroll, and SPA navigation.
2. Each thumbnail image is fetched with CORS and drawn onto an off-screen `<canvas>`.
3. The canvas is divided into a **3 × 4 grid**. For each cell the dominant RGB color is mapped to an emotional tone using color-psychology heuristics:

| Color range | Inferred tone |
|---|---|
| Red / deep pink | Excitement |
| Orange | Energy |
| Yellow | Happiness |
| Green | Calm |
| Cyan | Serenity |
| Blue | Trust |
| Purple | Mystery |
| Dark / desaturated | Tension / Neutral |

4. A semi-transparent mosaic overlay (`mix-blend-mode: multiply`) is placed over the thumbnail. The thumbnail image remains clearly visible beneath it.
5. The overlay opacity increases slightly on hover, and updates whenever a new thumbnail `src` is set (e.g., after YouTube replaces a placeholder).

### Enabling / disabling

Open the **BrainFeels popup** (click the extension icon) and toggle **"YouTube Thumbnail Emotion Mosaic"**. The setting is saved to `chrome.storage.sync` and takes effect immediately — no page reload required.

### Server endpoint

The Python server exposes a lightweight `POST /analyze-thumbnail` endpoint that returns a disclaimer and mode tag for the overlay. The primary color analysis is performed client-side (no round-trips required for the overlay to work).

```
POST /analyze-thumbnail
{
  "thumbnail_url": "https://i.ytimg.com/vi/<video_id>/hqdefault.jpg",
  "grid_rows": 3,
  "grid_cols": 4
}
```

Response:
```json
{
  "mode": "color-heuristic",
  "disclaimer": "...",
  "note": "...",
  "grid": { "rows": 3, "cols": 4 },
  "thumbnail_url": "..."
}
```

> **Note:** TRIBE v2 is designed for multimodal *video* stimuli. Still-image thumbnail analysis uses color-psychology heuristics only and is an approximation of emotional intent, not a scientific measurement.

---

## Running the tests

```bash
cd server
pip install pytest anyio httpx
pytest tests/ -v
```

All tests run in **demo mode** — TRIBE v2 is not required. Expected output: **10 passed**.

---

## Full TRIBE v2 setup (advanced)

1. Clone [facebookresearch/tribev2](https://github.com/facebookresearch/tribev2) and follow its README: Python environment, `pip install -e .`, Hugging Face login for gated models, optional GPU.
2. Ensure the `tribev2` package imports in the **same** environment as `server/main.py` (e.g. activate that venv, then `python main.py` from `server/`).
3. First inference will download checkpoints and feature caches; allow time and disk space.

Environment variables (optional):

| Variable | Default | Meaning |
|---|---|---|
| `BRAINFEELS_HOST` | `127.0.0.1` | Bind address |
| `BRAINFEELS_PORT` | `8765` | Port |
| `BRAINFEELS_CACHE` | system temp / `brainfeels-cache` | Directory for model weight caches |

---

## Limitations

- **DRM / capture**: Some streaming sites block `captureStream()`; the recorder needs a normal HTML5 `<video>` playing in the tab.
- **Message size**: Very long or high-bitrate clips may exceed browser extension message limits — keep the default clip length modest.
- **Mosaic CORS**: Thumbnails must be served with CORS headers (YouTube's CDN `i.ytimg.com` does this). Sites that omit `Access-Control-Allow-Origin` will cause the canvas read to fail silently — no overlay is shown for those images.
- **Science & ethics**: Treat outputs as exploratory model behaviour, not diagnostics or emotional truth. Every result includes a disclaimer to this effect.

---

## License

TRIBE v2 and its weights are **CC-BY-NC**; follow Meta's license for model use. This repo's extension and server code are scaffolding only — ensure your use complies with site terms of service and applicable law when recording or analysing video.

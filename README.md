# BrainFeels

Browser extension plus a **local** Python server that uses Meta's [TRIBE v2](https://huggingface.co/facebook/tribev2) model to summarise **predicted cortical (fMRI-like) responses** to a short video clip captured from the page (e.g. YouTube).

> **Docs:** [Tech Stack](docs/TECH_STACK.md) · [Architecture](docs/ARCHITECTURE.md) · [PRD](docs/PRD.md)

---

## What TRIBE v2 actually is

- It is **not** a chat LLM. It is a **multimodal brain encoding model**: video + audio + text features are mapped to predictions on a cortical surface mesh (~20 k vertices).
- It does **not** measure anyone's real brain and does **not** output emotion class labels. The server turns model outputs into **statistics** and **careful, non-clinical language** about "engagement" and variability — **not** verified emotions.
- Weights and code are heavy (PyTorch, large checkpoints, gated Hugging Face assets such as LLaMA). There is **no** hosted Hugging Face Inference API for this model; you run inference yourself.

---

## Repository layout

```
brainFeels/
├── .github/workflows/ci.yml        # Python lint/test + JS lint/test pipeline
├── docs/
│   ├── PRD.md                       # Full Product Requirements Document
│   ├── TECH_STACK.md                # Technology stack decisions & rationale
│   └── ARCHITECTURE.md              # File structure & data-flow diagrams
├── extension/                       # Chrome extension (Manifest V3)
│   ├── assets/icons/                # PNG icons (16, 32, 48, 128 px)
│   ├── popup/                       # Settings popup (HTML + JS)
│   ├── tests/                       # Jest unit tests
│   │   ├── background.test.js
│   │   └── content.test.js
│   ├── background.js                # Service worker — relays clip to server
│   ├── content.js                   # In-page panel + MediaRecorder + mosaic overlay
│   ├── eslint.config.js             # ESLint 9 flat config
│   ├── manifest.json
│   ├── package.json                 # ESLint + Jest dev tooling
│   └── styles.css
├── server/                          # Local FastAPI server
│   ├── tests/                       # pytest suite (demo mode; no TRIBE needed)
│   ├── main.py
│   └── requirements.txt
└── README.md
```

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
| Linting | Ruff + mypy (Python); ESLint 9 (JS) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

See **[docs/TECH_STACK.md](docs/TECH_STACK.md)** for detailed rationale.

---

## Quick start — extension + server without TRIBE

Useful to verify the wiring before installing TRIBE.

### 1. Start the server

```bash
cd server
python -m pip install -r requirements.txt
python main.py
# Server starts on http://127.0.0.1:8765
```

**Optional environment variables:**

| Variable | Default | Meaning |
|---|---|---|
| `BRAINFEELS_HOST` | `127.0.0.1` | Bind address |
| `BRAINFEELS_PORT` | `8765` | Port |
| `BRAINFEELS_CACHE` | system temp / `brainfeels-cache` | Directory for model weight caches |

### 2. Load the extension in Chrome

1. Open **chrome://extensions**
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. The BrainFeels icon appears in the Chrome toolbar

### 3. Analyse a video

1. Open any page with an HTML5 `<video>` (YouTube, Vimeo, a local file, etc.)
2. Start video playback
3. Click the floating **BrainFeels** button (bottom-right of the page)
4. Optionally adjust the clip length (5–120 s; default 20 s)
5. Click **Record & analyze**

If TRIBE v2 is not installed the server responds in **`demo` mode** with setup instructions. No crash, no error code.

### 4. Change the server URL (optional)

Click the **BrainFeels toolbar icon** → enter a custom URL → **Save**.  
The setting persists across browser restarts via `chrome.storage.sync`.

---

## YouTube Thumbnail Emotion Mosaic

When browsing YouTube the extension automatically overlays a **colour-coded emotion mosaic** on every visible thumbnail.

### How it works

1. A `MutationObserver` and `IntersectionObserver` detect thumbnail `<img>` elements as they appear during scroll and SPA navigation.
2. Each thumbnail is fetched with CORS and drawn onto an off-screen `<canvas>`.
3. The canvas is divided into a **3 × 4 grid**. For each cell the dominant RGB colour is mapped to an emotional tone using colour-psychology heuristics:

| Colour range | Inferred tone |
|---|---|
| Red / deep pink | Excitement |
| Orange | Energy |
| Yellow | Happiness |
| Green | Calm |
| Cyan | Serenity |
| Blue | Trust |
| Purple | Mystery |
| Dark / desaturated | Tension / Neutral |

4. A semi-transparent mosaic overlay (`mix-blend-mode: multiply`) is placed over the thumbnail. The thumbnail image remains clearly visible beneath.
5. The overlay opacity increases slightly on hover, and updates whenever a new thumbnail `src` is set.

### Enable / disable

Open the **BrainFeels popup** (click the toolbar icon) and toggle **"YouTube Thumbnail Emotion Mosaic"**. The setting takes effect immediately — no page reload required.

---

## Running the tests

### Python (server)

```bash
cd server
pip install pytest anyio httpx
pytest tests/ -v
# Expected: 10 passed (demo mode — TRIBE v2 not required)
```

### JavaScript (extension)

```bash
cd extension
npm install
npm test        # Jest — 13 tests, all pass
npm run lint    # ESLint — 0 errors
```

---

## Full TRIBE v2 setup (advanced)

1. Clone [facebookresearch/tribev2](https://github.com/facebookresearch/tribev2) and follow its README: create a Python environment, run `pip install -e .`, log in to Hugging Face (`huggingface-cli login`) for gated models, and optionally configure GPU.
2. Ensure the `tribev2` package imports in the **same** environment as `server/main.py` (activate that environment, then `python main.py` from `server/`).
3. First inference downloads model checkpoints and feature caches — allow extra time and disk space.

---

## CI pipeline

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Steps |
|---|---|
| `python-checks` | Ruff lint → mypy → pytest (demo mode) |
| `js-checks` | ESLint → Jest |

TRIBE v2 inference is excluded from CI: the weights are gated on Hugging Face and require tens of GB of disk space plus PyTorch.

---

## Limitations

- **DRM / capture**: Some streaming sites block `captureStream()`; the recorder needs a normal HTML5 `<video>` playing in the tab.
- **Message size**: Very long or high-bitrate clips may exceed browser extension message limits — keep the default clip length modest.
- **Mosaic CORS**: Thumbnails must be served with CORS headers. YouTube's CDN (`i.ytimg.com`) does this. Sites that omit `Access-Control-Allow-Origin` will fail silently — no overlay is shown for those images.
- **Science & ethics**: Treat outputs as exploratory model behaviour, not diagnostics or emotional truth. Every result includes a disclaimer to this effect.

---

## License

TRIBE v2 and its weights are **CC-BY-NC**; follow Meta's licence for model use.  
This repo's extension and server code are scaffolding only — ensure your use complies with site terms of service and applicable law when recording or analysing video.

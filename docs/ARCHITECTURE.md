# BrainFeels – File Architecture

> **Status:** Adopted (v0.1 – April 2026)

---

## 1. Top-Level Layout

```
brainFeels/
├── .github/
│   └── workflows/
│       └── ci.yml              # Lint + unit-test pipeline (Python + JS)
├── docs/
│   ├── ARCHITECTURE.md         # This file
│   ├── PRD.md                  # Product Requirements Document
│   └── TECH_STACK.md           # Technology stack decisions and rationale
├── extension/                  # Chrome extension (Manifest V3)
│   ├── assets/
│   │   └── icons/              # PNG icons at 16, 32, 48, 128 px
│   ├── popup/
│   │   ├── popup.html          # Settings / server-URL popup
│   │   └── popup.js            # Popup logic
│   ├── tests/
│   │   ├── background.test.js  # Jest: background service worker tests
│   │   └── content.test.js     # Jest: escapeHtml + duration clamping tests
│   ├── background.js           # Service worker: relays clip to local server
│   ├── content.js              # In-page panel + MediaRecorder + mosaic overlay
│   ├── eslint.config.js        # ESLint 9 flat config
│   ├── manifest.json           # MV3 manifest (icons, permissions, CSP)
│   ├── package.json            # ESLint + Jest dev dependencies
│   ├── package-lock.json       # Locked dependency tree for npm ci
│   └── styles.css              # Scoped panel/button/mosaic CSS
├── server/                     # Local Python FastAPI server
│   ├── tests/
│   │   ├── conftest.py         # pytest fixtures (anyio backend)
│   │   └── test_main.py        # 10 pytest tests: health, analyze, thumbnail
│   ├── main.py                 # FastAPI app + TRIBE v2 wrapper
│   └── requirements.txt        # Runtime + dev dependencies
├── .gitignore
└── README.md
```

---

## 2. Key Design Decisions

### 2.1 `extension/` is self-contained

The extension directory is loaded directly as an unpacked Chrome extension (no build step required). All JS is vanilla ES2022. Dev tooling (`package.json`, `eslint.config.js`, `tests/`, `node_modules/`) lives alongside the extension files but is not referenced by `manifest.json` and is therefore invisible to Chrome.

A future migration to TypeScript / esbuild would output a `dist/` folder; the source would move to `extension/src/`.

### 2.2 `server/` is a standalone Python package

`server/main.py` is intentionally a single file for simplicity at v0.1. As the server grows (e.g., adding a queue, multiple model backends, auth), it should be refactored into:

```
server/
├── app/
│   ├── __init__.py
│   ├── api/
│   │   ├── routes.py       # FastAPI routers
│   │   └── models.py       # Pydantic request/response schemas
│   ├── core/
│   │   ├── config.py       # Environment variables + settings
│   │   └── tribe.py        # TRIBE v2 wrapper functions
│   └── utils/
│       └── video.py        # Video validation helpers
├── tests/
│   └── test_main.py
├── main.py                 # Entry point (import from app/)
└── requirements.txt
```

### 2.3 `docs/` is the single source of truth for project decisions

All architectural, product, and stack decisions live in `docs/`. Files here are Markdown so they render on GitHub without any extra tooling.

### 2.4 Assets

Extension icons are 16 × 16, 32 × 32, 48 × 48, and 128 × 128 px solid-colour PNGs (BrainFeels purple, `#3d5afe`). They are declared under both `"icons"` and `"action.default_icon"` in `manifest.json` for full Chrome Web Store compatibility.

### 2.5 CI / CD

`.github/workflows/ci.yml` runs on every push and pull request in two parallel jobs:

**`python-checks`**
1. Ruff (style + lint)
2. mypy (strict type checking)
3. pytest (demo mode — TRIBE v2 not installed in CI)

**`js-checks`**
1. ESLint (flat config, `extension/`)
2. Jest (13 unit tests — no browser or TRIBE v2 needed)

TRIBE v2 inference is **excluded** from CI: the model weights are gated on Hugging Face, require tens of GBs of disk space, and need PyTorch which is too heavy for standard GitHub-hosted runners.

---

## 3. Data Flow

### 3.1 Video clip analysis (MVP — current)

```
User clicks "Record & analyze" (content.js)
        │
        ▼
MediaRecorder captures HTMLVideoElement stream → WebM blob (content.js)
        │
        ▼  chrome.runtime.sendMessage (ArrayBuffer)
        │
        ▼
background.js  ──HTTP POST multipart/form-data──►  server/main.py  /analyze
                                                          │
                                                          ▼
                                                   TRIBE v2 inference
                                               (or demo mode if not installed)
                                                          │
                                                          ▼
                                                   JSON response
                  ◄──────────────────────────────────────┘
        │
        ▼  sendResponse callback
        │
        ▼
content.js renders result panel
(disclaimer + brain summary + emotion overview + meta JSON block)
```

### 3.2 YouTube Thumbnail Emotion Mosaic (new)

```
YouTube page loads / user scrolls (content.js — YouTube only)
        │
        ▼
MutationObserver detects new <ytd-thumbnail img#img> elements
IntersectionObserver filters to visible viewport + 200 px margin
        │
        ▼
fetch(thumbnailSrc, {mode:'cors'}) → Blob → createImageBitmap()
        │
        ▼
Off-screen Canvas: divide into 3×4 grid, average RGB per cell
        │
        ▼
Color-heuristic: RGB → HSL → emotion name + color token
        │
        ▼
Render .brainfeels-mosaic overlay div (absolute, mix-blend-mode:multiply)
over ytd-thumbnail container — thumbnail image remains visible beneath
```

---

## 4. Extension Files — Responsibilities

| File | Responsibility |
|---|---|
| `manifest.json` | Declares permissions (`storage`, `activeTab`, `scripting`), content-script injection rules, popup, service worker, and extension icons. |
| `background.js` | Service worker. Listens for `"analyze"` messages from content script. Reads server URL from `chrome.storage.sync`. Sends `multipart/form-data` POST. Returns parsed JSON or error object. |
| `content.js` | Injected into every page. (1) Defines `escapeHtml` at module scope (exported for tests). Creates floating "BrainFeels" button and side panel; finds `<video>`, calls `captureStream()`, runs `MediaRecorder`, sends ArrayBuffer to background, and renders the result. (2) On YouTube only: detects thumbnail `<img>` elements via `MutationObserver` + `IntersectionObserver`, analyses each thumbnail's dominant colours using the Canvas API, and overlays a colour-coded emotion mosaic. |
| `styles.css` | All panel/button/mosaic styles, scoped to `#brainfeels-tribe-*` and `.brainfeels-*` to avoid polluting host page styles. |
| `popup/popup.html` | Settings form: server URL + YouTube Mosaic toggle. |
| `popup/popup.js` | Reads/writes `chrome.storage.sync` keys `serverUrl` and `mosaicEnabled`. |
| `assets/icons/` | Extension icons (16, 32, 48, 128 px). Declared in `manifest.json` under `"icons"` and `"action.default_icon"`. |
| `eslint.config.js` | ESLint 9 flat config — ES2022, browser + webextension globals, `no-unused-vars` with `_`-prefix exception. |
| `package.json` | Dev dependencies: ESLint 9, Jest 29, jest-webextension-mock. Scripts: `npm run lint` and `npm test`. |
| `tests/` | Jest unit tests: background message/fetch handling; `escapeHtml`; duration clamping. |

---

## 5. Server Files — Responsibilities

| File | Responsibility |
|---|---|
| `main.py` | FastAPI app definition. `GET /health`. `POST /analyze` (upload → TRIBE v2 or demo mode). `POST /analyze-thumbnail` (URL validation + color-heuristic disclaimer). `_summarize_predictions()` converts vertex arrays to human-readable stats. `_run_tribe()` lazy-imports `tribev2`. `_is_safe_thumbnail_url()` guards against SSRF. Environment-variable configuration for host, port, and cache directory. |
| `requirements.txt` | Runtime dependencies plus dev/test deps in comments. |
| `tests/conftest.py` | Shared pytest fixture (`anyio_backend`). |
| `tests/test_main.py` | 10 pytest tests: health endpoint, demo mode response shape, 413 file-size guard, unsupported suffix normalisation, `_summarize_predictions` valid/bad shapes, analyze-thumbnail valid/default/invalid/SSRF. |

---

## 6. API Contract

### `GET /health`

```json
{ "status": "ok" }
```

### `POST /analyze`

**Request:** `multipart/form-data`, field `file` — a video file ≤ 120 MB.

**Response (tribe mode):**
```json
{
  "mode": "tribe",
  "disclaimer": "<string>",
  "brain_summary": "<string>",
  "emotion_overview": "<string>",
  "meta": {
    "n_time_segments": 42,
    "n_vertices": 20484,
    "mean_abs_pred": 0.0312,
    "mean_spatial_std_per_tr": 0.0118,
    "mean_temporal_std_per_vertex": 0.0094
  }
}
```

**Response (demo mode — TRIBE v2 not installed):**
```json
{
  "mode": "demo",
  "disclaimer": "<string>",
  "brain_summary": "<string>",
  "emotion_overview": "<string>",
  "meta": { "error": "<string>" }
}
```

### `POST /analyze-thumbnail`

**Request body (JSON):**
```json
{ "thumbnail_url": "https://...", "grid_rows": 3, "grid_cols": 4 }
```

**Response:**
```json
{
  "mode": "color-heuristic",
  "disclaimer": "<string>",
  "note": "<string>",
  "grid": { "rows": 3, "cols": 4 },
  "thumbnail_url": "<string>"
}
```

---

## 7. Future Additions (not yet implemented)

| Path | Purpose |
|---|---|
| `extension/src/` | TypeScript sources if a build step is added. |
| `extension/dist/` | esbuild output (add to `.gitignore`). |
| `server/app/` | Refactored multi-module server (see §2.2). |
| `server/tests/fixtures/` | Small `.webm` file used for integration tests. |
| `.github/ISSUE_TEMPLATE/` | Bug report + feature request templates. |
| `CONTRIBUTING.md` | Contribution guide, code style, PR checklist. |

---

*Last reviewed: April 2026*

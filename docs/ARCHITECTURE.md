# BrainFeels – File Architecture

> **Status:** Adopted (v0.1 – April 2026)

---

## 1. Top-Level Layout

```
brainFeels/
├── .github/
│   └── workflows/
│       └── ci.yml              # Lint + unit-test pipeline (no TRIBE inference)
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
│   ├── background.js           # Service worker: relays clip to local server
│   ├── content.js              # In-page panel + MediaRecorder logic
│   ├── manifest.json           # MV3 manifest
│   └── styles.css              # Scoped panel/button CSS
├── server/                     # Local Python FastAPI server
│   ├── tests/
│   │   └── test_main.py        # pytest unit + integration tests
│   ├── main.py                 # FastAPI app + TRIBE v2 wrapper
│   └── requirements.txt        # Runtime + dev dependencies
├── .gitignore
└── README.md
```

---

## 2. Key Design Decisions

### 2.1 `extension/` is self-contained

The extension directory is loaded directly as an unpacked Chrome extension (no build step required in the current version). All JS is vanilla ES2022 modules. A future migration to TypeScript / esbuild would output a `dist/` folder inside `extension/`; the source would move to `extension/src/`.

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

Extension icons follow Chrome's naming convention (`icon16.png`, `icon48.png`, `icon128.png`). The placeholder directory `extension/assets/icons/` is tracked in Git with a `.gitkeep` so the path exists in fresh clones before icons are added.

### 2.5 CI / CD

`.github/workflows/ci.yml` runs on every push and pull request:
1. **Python linting** – Ruff (style) + mypy (types).
2. **Python tests** – pytest in demo mode (TRIBE v2 not installed in CI).
3. **JavaScript linting** – ESLint when a `package.json` is present.

TRIBE v2 inference is **excluded** from CI: the model weights are gated on Hugging Face, require tens of GBs of disk space, and need PyTorch which is too heavy for standard GitHub-hosted runners.

---

## 3. Data Flow

### 3.1 Video clip analysis (existing)

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
        │
        ▼  (optional, no round-trip required for overlay)
chrome.runtime.sendMessage({type:"analyze-thumbnail", …})
        │
        ▼
background.js  ──HTTP POST JSON──►  server/main.py  /analyze-thumbnail
                                         (returns disclaimer + mode tag)
```

---

## 4. Extension Files — Responsibilities

| File | Responsibility |
|---|---|
| `manifest.json` | Declares permissions (`storage`, `activeTab`, `scripting`), content-script injection rules, popup, and service worker. |
| `background.js` | Service worker. Listens for `"analyze"` messages from content script. Reads server URL from `chrome.storage.sync`. Sends `multipart/form-data` POST. Returns parsed JSON or error. |
| `content.js` | Injected into every page. (1) Creates floating "BrainFeels" button and side panel; finds `<video>`, calls `captureStream()`, runs `MediaRecorder`, sends ArrayBuffer to background. Renders result HTML. (2) On YouTube: detects thumbnail `<img>` elements via `MutationObserver` + `IntersectionObserver`, analyses each thumbnail's dominant colors using the Canvas API, and overlays a color-coded emotion mosaic. |
| `styles.css` | All panel/button/mosaic styles, scoped to `#brainfeels-tribe-*` and `.brainfeels-*` to avoid polluting host page styles. |
| `popup/popup.html` | Settings form: server URL + YouTube Mosaic toggle. |
| `popup/popup.js` | Reads/writes `chrome.storage.sync` keys `serverUrl` and `mosaicEnabled`. |
| `assets/icons/` | Extension icons (16 px, 48 px, 128 px). |

---

## 5. Server Files — Responsibilities

| File | Responsibility |
|---|---|
| `main.py` | FastAPI app definition. `GET /health`. `POST /analyze` (upload + TRIBE v2 or demo). `POST /analyze-thumbnail` (thumbnail URL validation + color-heuristic disclaimer). `_summarize_predictions()` converts vertex arrays to human-readable stats. `_run_tribe()` lazy-imports `tribev2`. |
| `requirements.txt` | All runtime dependencies plus dev/test deps in comments. |
| `tests/test_main.py` | pytest tests: health endpoint, demo mode response shape, 413 file-size guard, unsupported suffix normalisation, analyze-thumbnail valid/default/invalid. |

---

## 6. Future Additions (not yet implemented)

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

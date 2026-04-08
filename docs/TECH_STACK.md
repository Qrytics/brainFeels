# BrainFeels – Technology Stack

> **Status:** Adopted (v0.1 – April 2026)

---

## 1. Overview

BrainFeels is a two-part system:

| Tier | Role |
|---|---|
| **Chrome extension** | In-page UI, video capture, YouTube thumbnail mosaic, result rendering |
| **Local Python server** | Video ingestion, TRIBE v2 inference, JSON response |

The tech-stack choices below are optimised for **developer velocity**, **minimal runtime dependencies on end-user machines**, and **research transparency**.

---

## 2. Chrome Extension Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Extension API | **Chrome Extensions Manifest V3** | Current Chrome standard; required for distribution via Chrome Web Store; supports service-worker background scripts and stricter CSP that improve security. |
| UI language | **Vanilla JavaScript (ES2022+)** | Zero build-step on the content-script side removes complexity; the content script is injected directly into every page so frameworks add non-trivial overhead and potential CSP conflicts. |
| Popup UI | **HTML + CSS (no framework)** | Popup is minimal (one URL input + mosaic toggle + save button); a framework would be disproportionate. |
| Styles | **Plain CSS** (single `styles.css`) | Scoped to `#brainfeels-tribe-*` and `.brainfeels-*` class namespace to avoid collisions with host pages. |
| Build / bundle | **None (direct load)** | Extension loads directly from `extension/` — no build step required in v0.1. esbuild is a candidate for a future TypeScript migration. |
| Linting | **ESLint 9** (flat config, `@eslint/js` recommended + browser globals) | Catches unsafe patterns, dangling promises, and undefined global references. |
| Unit testing | **Jest 29** + **jest-webextension-mock** + **jest-environment-jsdom** | Tests run without a browser; Chrome APIs are mocked; jsdom provides a DOM environment for `escapeHtml` and panel rendering tests. |
| Icons | **PNG** at 16, 32, 48, 128 px | Required by Chrome Web Store; declared under both `"icons"` and `"action.default_icon"` in `manifest.json`. |

### Why not React/Vue for the content script?

Injecting a full framework into every host page risks:
- CSP rejections on sites with strict `script-src` policies.
- Slow first-paint due to framework boot time.
- Shadow DOM complexity when reading host-page `<video>` elements.

A React or Preact popup (rendered in a sandboxed iframe) is viable for a richer settings page in a future iteration.

---

## 3. Backend (Local Python Server)

| Concern | Choice | Rationale |
|---|---|---|
| Web framework | **FastAPI 0.110+** | Async-native; automatic OpenAPI docs; `UploadFile` + `python-multipart` handle binary video uploads cleanly; minimal boilerplate. |
| ASGI server | **Uvicorn (uvicorn[standard])** | Ships with `websockets` and `httptools` for performance; simple CLI startup; `--reload` flag aids local development. |
| Numerical core | **NumPy ≥ 1.24** | Required for vertex-wise prediction statistics; already a TRIBE v2 transitive dependency. |
| ML inference | **Meta TRIBE v2** (`tribev2` package + PyTorch) | The only published model that maps video+audio+text to predicted cortical responses (fMRI-like). Inference runs on CPU or GPU automatically via `device="auto"`. |
| Checkpoints | Hugging Face Hub (`facebook/tribev2`) | Standard weight distribution; supports local caching via `BRAINFEELS_CACHE`. |
| CORS | `fastapi.middleware.cors.CORSMiddleware` (`allow_origins=["*"]`) | Allows the Chrome extension's `fetch()` call (cross-origin to `localhost`) to reach the local server. |
| Linting | **Ruff** | Rust-based; replaces flake8 + isort + pyupgrade in a single pass; near-zero config. |
| Type checking | **mypy (`--ignore-missing-imports`)** | Catches API contract mismatches early, especially important for numpy array shapes. |

---

## 4. Emotional AI / ML Handling

| Component | Approach |
|---|---|
| **Model** | Meta TRIBE v2 (multimodal brain encoding — video, audio, text → cortical surface predictions). |
| **Emotion proxy** | TRIBE v2 is **not** an emotion classifier. The server derives cautious, non-clinical proxies (mean activation magnitude, temporal/spatial variability) and labels them "interpretive affect / engagement". |
| **No cloud ML service** | All inference is intentionally local. This avoids sending user video data to third-party APIs, respects site terms of service, and eliminates latency from a network hop. |
| **Fallback / demo mode** | When `tribev2` is not installed the server responds in `demo` mode with setup guidance — no crash, no HTTP 5xx. |
| **Future upgrade path** | A lighter emotion classifier (e.g., Hugging Face `j-hartmann/emotion-english-distilroberta-base` or TensorFlow.js affect models) could be layered on top without changing the extension–server interface. |

---

## 5. Communication Between Components

| Channel | Protocol | Notes |
|---|---|---|
| Extension content-script → background worker | `chrome.runtime.sendMessage` (ArrayBuffer) | Binary video blob is transferred via structured clone to avoid memory copies. |
| Background worker → local server | **HTTP POST** (`multipart/form-data`) via `fetch()` | RESTful; `/analyze` endpoint; easy to test with curl. |
| Extension popup → Chrome storage | `chrome.storage.sync` | Persists server URL and mosaic-enabled flag across browser restarts and Chrome profiles. |

---

## 6. Testing

| Layer | Tool | Tests |
|---|---|---|
| Extension unit tests | **Jest 29** + `jest-webextension-mock` | 13 tests: background service worker fetch (success + error + edge cases), `escapeHtml` (5 cases), duration clamping (4 groups). |
| Server unit tests | **pytest** + `httpx.AsyncClient` | 10 tests: `/health`, `/analyze` demo mode, 413 file-size guard, bad-suffix normalisation, `_summarize_predictions` valid/bad shape, `/analyze-thumbnail` valid/default/invalid/SSRF. |
| End-to-end | Manual Chrome + local server walkthrough (documented in `docs/ARCHITECTURE.md`). | — |

---

## 7. CI Pipeline

`.github/workflows/ci.yml` has two parallel jobs:

```
python-checks:
  - ruff check server/
  - mypy server/main.py --ignore-missing-imports
  - pytest server/tests/ -v

js-checks:
  - eslint extension/background.js extension/content.js extension/popup/popup.js
  - jest extension/tests/ --no-coverage
```

TRIBE v2 inference CI is skipped (weights are gated, PyTorch is too heavy for standard runners).

---

## 8. Dependency Summary

### Extension (`extension/package.json` — dev only, no runtime bundle)

```
eslint ^9.24.0
@eslint/js ^9.24.0
globals ^16.0.0
jest ^29.7.0
jest-environment-jsdom ^29.7.0
jest-webextension-mock ^3.8.9
```

### Server (`server/requirements.txt`)

```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.9
numpy>=1.24.0
# dev / CI only:
ruff>=0.4
mypy>=1.9
pytest>=8.0
anyio[trio]>=4.0
httpx>=0.27
# TRIBE v2 (manual install from GitHub):
# torch, tribev2 — see README
```

---

*Last reviewed: April 2026*

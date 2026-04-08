# BrainFeels – Technology Stack

> **Status:** Recommended (v0.1 – April 2026)

---

## 1. Overview

BrainFeels is a two-part system:

| Tier | Role |
|---|---|
| **Chrome extension** | In-page UI, video capture, result rendering |
| **Local Python server** | Video ingestion, TRIBE v2 inference, JSON response |

The tech-stack choices below are optimised for **developer velocity**, **minimal runtime dependencies on end-user machines**, and **research transparency**.

---

## 2. Chrome Extension Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Extension API | **Chrome Extensions Manifest V3** | Current Chrome standard; required for distribution via Chrome Web Store; supports service-worker background scripts, declarative net-request, and stricter CSP that improve security. |
| UI language | **Vanilla JavaScript (ES2022+)** | Zero build-step on the content-script side removes complexity; the content script is injected directly into every page so frameworks add non-trivial overhead and potential CSP conflicts. |
| Popup UI | **HTML + CSS (no framework)** | Popup is minimal (one text input + save button); a framework would be disproportionate. |
| Styles | **Plain CSS** (single `styles.css`) | Scoped to `#brainfeels-*` class namespace to avoid collisions with host pages. |
| Build / bundle | **esbuild** (optional, for future expansion) | Sub-millisecond rebuilds; zero config; can bundle future React or TypeScript popup without changes to the content script. |
| Linting | **ESLint** (`eslint:recommended` + `plugin:chrome-extension/recommended`) | Catches MV3 API misuse, dangling promises, and unsafe innerHTML patterns. |

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
| ML inference | **Meta TRIBE v2** (`tribev2` package + PyTorch) | The only published model that maps video+audio+text to predicted cortical responses (fMRI-like). No direct alternative exists for this specific task. Inference runs on CPU or GPU automatically via `device="auto"`. |
| Checkpoints | Hugging Face Hub (`facebook/tribev2`) | Standard weight distribution; supports local caching via `BRAINFEELS_CACHE`. |
| CORS | `fastapi.middleware.cors.CORSMiddleware` | Allows the Chrome extension's `fetch()` call (which arrives as a cross-origin request) to reach the localhost server. |
| Linting | **Ruff** | Rust-based; replaces flake8 + isort + pyupgrade in a single pass; near-zero config. |
| Type checking | **mypy (strict)** | Catches API contract mismatches early, especially important for numpy array shapes. |

---

## 4. Emotional AI / ML Handling

| Component | Approach |
|---|---|
| **Model** | Meta TRIBE v2 (multimodal brain encoding — video, audio, text → cortical surface predictions). |
| **Emotion proxy** | TRIBE v2 is **not** an emotion classifier. The server derives cautious, non-clinical proxies (mean activation magnitude, temporal/spatial variability) and labels them "interpretive affect / engagement". |
| **No cloud ML service** | All inference is intentionally local. This avoids sending user video data to third-party APIs, respects site terms of service, and eliminates latency from a network hop. |
| **Fallback / demo mode** | When `tribev2` is not installed the server responds in `demo` mode with setup guidance — no crash, no data loss. |
| **Future upgrade path** | If a lighter emotion classifier is desired in the future (e.g., for mobile or hosted deployments), [Hugging Face `j-hartmann/emotion-english-distilroberta-base`](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base) or TensorFlow.js NSFW/face-affect models could be layered on top without changing the extension–server interface. |

---

## 5. Communication Between Components

| Channel | Protocol | Notes |
|---|---|---|
| Extension content-script → background worker | `chrome.runtime.sendMessage` (ArrayBuffer) | Binary video blob is transferred via structured clone to avoid memory copies. |
| Background worker → local server | **HTTP POST** (`multipart/form-data`) via `fetch()` | RESTful; single endpoint `/analyze`; easy to test with curl. |
| Extension popup → Chrome storage | `chrome.storage.sync` | Persists the server URL across browser restarts and Chrome profiles. |

---

## 6. Testing

| Layer | Tool | Coverage target |
|---|---|---|
| Extension unit tests | **Jest** + `jest-webextension-mock` | Core logic in `background.js` and `content.js` (message handling, HTML escaping, recorder lifecycle). |
| Server unit tests | **pytest** + `httpx` (via `httpx.AsyncClient`) | `/health`, `/analyze` demo mode, file-size guard, bad-suffix handling. |
| Server integration tests | **pytest** with a real `.webm` fixture | Full `_run_tribe` path skipped unless `TRIBE_AVAILABLE=1` env var is set (CI skips by default). |
| End-to-end | Manual Chrome + local server walkthrough (documented in `docs/ARCHITECTURE.md`). | — |

---

## 7. Deployment

| Scenario | Approach |
|---|---|
| **Local development** | `python server/main.py` + Chrome "Load unpacked". |
| **Chrome Web Store distribution** | Zip `extension/` contents; submit to CWS. Server is never hosted — users run it locally. |
| **CI (GitHub Actions)** | Lint JS (ESLint), lint Python (Ruff + mypy), run pytest (demo mode). TRIBE v2 inference CI is skipped (too heavy/gated). |
| **Packaging server** | Optional `pyinstaller`/`briefcase` one-file binary so non-Python users can run the server without installing Python. |

---

## 8. Dependency Summary

### Extension (no `package.json` yet — install when adding build tooling)

```
eslint
eslint-plugin-chrome-extension   # optional
esbuild                           # optional, for future bundling
jest
jest-webextension-mock
```

### Server (`server/requirements.txt`)

```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
python-multipart>=0.0.9
numpy>=1.24.0
# dev / CI only:
pytest>=8.0
httpx>=0.27
ruff>=0.4
mypy>=1.9
# TRIBE v2 (manual install from GitHub):
# torch, tribev2 — see README Full TRIBE v2 Setup
```

---

*Last reviewed: April 2026*

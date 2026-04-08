# BrainFeels – Product Requirements Document (PRD)

> **Version:** 1.0 — April 2026  
> **Status:** Draft for review  
> **Owner:** Qrytics  
> **Related docs:** [TECH_STACK.md](./TECH_STACK.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Table of Contents

1. [Vision & Goals](#1-vision--goals)
2. [Target Users](#2-target-users)
3. [User Stories](#3-user-stories)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Main Workflows](#6-main-workflows)
7. [Out of Scope](#7-out-of-scope)
8. [Boundary Cases & Edge Conditions](#8-boundary-cases--edge-conditions)
9. [MVP Criteria](#9-mvp-criteria)
10. [Evaluation & Testing Plan](#10-evaluation--testing-plan)
11. [Glossary](#11-glossary)

---

## 1. Vision & Goals

### Vision

BrainFeels lets curious users and researchers explore **how a computational brain-encoding model (Meta TRIBE v2) responds to video content they are watching** — displayed as plain-language statistics in a lightweight Chrome side-panel — without sending any data to third-party cloud services.

### Goals

| # | Goal | Priority |
|---|---|---|
| G1 | Capture a short clip from any HTML5 video in the active browser tab and send it to a local analysis server. | Must |
| G2 | Run Meta TRIBE v2 locally to produce predicted cortical response statistics for the clip. | Must |
| G3 | Render analysis results in a non-intrusive in-page panel with clear scientific disclaimers. | Must |
| G4 | Fall back gracefully (demo mode) when TRIBE v2 is not installed, guiding the user through setup. | Must |
| G5 | Allow users to configure the local server URL via the extension popup. | Must |
| G6 | Keep all video data local; no clip leaves the user's machine. | Must |
| G7 | Provide a one-command server startup. | Should |
| G8 | Support GPU acceleration automatically when available (via PyTorch `device="auto"`). | Should |
| G9 | Be distributable via the Chrome Web Store (compliant with MV3 policies). | Should |

---

## 2. Target Users

| Persona | Description | Primary Need |
|---|---|---|
| **Curious consumer** | Non-technical user watching YouTube or Netflix. | Wants to see something "interesting" about a video in plain English; does not want to install Python. |
| **ML / neuro researcher** | PhD student or engineer familiar with Python and PyTorch. | Wants raw numeric statistics (`meta` JSON); willing to install TRIBE v2 and GPU dependencies. |
| **Content creator / marketer** | Uses engagement metrics to evaluate video effectiveness. | Cares about the "interpretive affect" proxy; needs a quick, reproducible workflow. |
| **Extension developer** | Wants to study or extend BrainFeels. | Needs clean code, documented API contract, and a test suite. |

---

## 3. User Stories

### Core (MVP)

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-01 | Curious consumer | Click a floating button on any video page | I can open the BrainFeels analysis panel without leaving the page. |
| US-02 | Any user | Set how many seconds of video to record (5–120 s) | I can balance analysis time against capture duration. |
| US-03 | Any user | Click "Record & analyze" | The extension captures the current video stream and sends it to my local server. |
| US-04 | ML researcher | See numeric statistics (`mean_abs_pred`, spatial/temporal variance) | I can compare predicted cortical engagement across different clips. |
| US-05 | Content creator | See an interpretive plain-English overview of engagement | I can understand the output without reading ML papers. |
| US-06 | Any user | See a scientific disclaimer on every result | I understand the output is a model prediction, not a real brain measurement. |
| US-07 | Any user (no TRIBE) | See demo-mode guidance when TRIBE v2 is not installed | I know what to do next instead of seeing a cryptic error. |
| US-08 | Any user | Configure the server URL from the popup | I can change the port or bind address without editing code. |

### Secondary

| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US-09 | Any user | Close the panel with a single click | The panel does not obstruct video playback. |
| US-10 | ML researcher | See a JSON `meta` block collapsed in the panel | I can inspect raw numbers without the panel becoming cluttered. |
| US-11 | Developer | Run `python server/main.py` and get a working API immediately | I can start developing without complex setup. |
| US-12 | Developer | Run `pytest` and see all tests pass (demo mode) | I can validate changes without installing TRIBE v2. |

---

## 4. Functional Requirements

### 4.1 Chrome Extension

| ID | Requirement |
|---|---|
| FR-01 | The extension MUST inject a floating toggle button on every page that has an HTML5 `<video>` element when the page is loaded. |
| FR-02 | The toggle button MUST open/close a side-panel anchored to the bottom-right of the viewport. |
| FR-03 | The panel MUST include a numeric duration field (integer seconds, 5–120) with a default of 20. |
| FR-04 | Clicking "Record & analyze" MUST call `HTMLVideoElement.captureStream()` on the first `<video>` found and start a `MediaRecorder` session. |
| FR-05 | If `captureStream()` throws (e.g., DRM), the panel MUST display a human-readable error. |
| FR-06 | On recording completion the extension MUST transfer the raw `ArrayBuffer` to the background service worker via `chrome.runtime.sendMessage`. |
| FR-07 | The background service worker MUST POST the blob as `multipart/form-data` to `{serverUrl}/analyze`. |
| FR-08 | If the server responds with a non-2xx status, the panel MUST show the error detail. |
| FR-09 | On a successful response the panel MUST render: disclaimer, predicted-response overview, interpretive affect overview (if present), and the numeric `meta` block. |
| FR-10 | The popup MUST allow the user to save a custom server URL, which persists across browser restarts via `chrome.storage.sync`. |
| FR-11 | All panel HTML MUST be constructed via DOM APIs or `textContent`/`escapeHtml` — never via unsanitised string interpolation — to prevent XSS on the host page. |

### 4.2 Local Server

| ID | Requirement |
|---|---|
| FR-12 | `GET /health` MUST return `{"status": "ok"}` with HTTP 200. |
| FR-13 | `POST /analyze` MUST accept `multipart/form-data` with a single `file` field. |
| FR-14 | If the uploaded file exceeds 120 MB the server MUST return HTTP 413. |
| FR-15 | The server MUST normalise unrecognised file suffixes to `.webm` before writing the temporary file. |
| FR-16 | If `tribev2` is importable the server MUST run inference and return `{"mode": "tribe", ...}`. |
| FR-17 | If `tribev2` is not importable the server MUST return `{"mode": "demo", ...}` with setup instructions — no HTTP 5xx. |
| FR-18 | The temporary video file MUST be deleted in a `finally` block regardless of inference outcome. |
| FR-19 | CORS MUST be enabled for all origins (extension `fetch()` is cross-origin to `localhost`). |
| FR-20 | Host, port, and cache directory MUST be configurable via environment variables (`BRAINFEELS_HOST`, `BRAINFEELS_PORT`, `BRAINFEELS_CACHE`). |

### 4.3 Result Schema

The `/analyze` endpoint MUST return a JSON object conforming to:

```jsonc
{
  "mode": "tribe" | "demo",
  "disclaimer": "<string>",
  "brain_summary": "<string>",
  "emotion_overview": "<string>",
  "meta": {
    // tribe mode
    "n_time_segments": <int>,
    "n_vertices": <int>,
    "mean_abs_pred": <float>,
    "mean_spatial_std_per_tr": <float>,
    "mean_temporal_std_per_vertex": <float>
    // demo mode
    // "error": "<string>"
  }
}
```

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | **Privacy** | No video data MUST leave the user's machine. The extension POSTs only to `127.0.0.1` or `localhost` by default. |
| NFR-02 | **Security** | The extension MUST NOT use `eval()` or construct HTML from server-controlled strings without escaping. |
| NFR-03 | **Performance** | The panel MUST become interactive within 500 ms of page load on a modern machine. |
| NFR-04 | **Performance** | For a 20-second 720p clip, the upload + demo-mode response MUST complete within 5 s on localhost. |
| NFR-05 | **Reliability** | The server MUST return a structured JSON error (not an unhandled exception traceback) for any input error. |
| NFR-06 | **Usability** | The panel MUST be fully usable without mouse interaction (keyboard-accessible). |
| NFR-07 | **Compatibility** | The extension MUST work on Chrome ≥ 120 (Manifest V3 stable). |
| NFR-08 | **Compatibility** | The server MUST run on Python ≥ 3.10, Windows, macOS, and Linux. |
| NFR-09 | **Maintainability** | Python code MUST pass Ruff linting and mypy strict type-checking. |
| NFR-10 | **Maintainability** | JavaScript code MUST pass ESLint with no errors. |
| NFR-11 | **Ethics** | Every user-visible result MUST include a disclaimer that outputs are model predictions, not real brain measurements. |
| NFR-12 | **Licensing** | Use of TRIBE v2 weights MUST comply with Meta's CC-BY-NC licence; the extension and server scaffolding may be released under MIT. |

---

## 6. Main Workflows

### 6.1 Thumbnail / Image Collection (future — not MVP)

> This workflow is planned for a future version that analyses YouTube thumbnail images before a video is played.

1. User opens a YouTube search results page.
2. Extension detects `<img>` thumbnail elements.
3. User selects thumbnails in the panel.
4. Extension POSTs the image bytes to `/analyze-image` (future endpoint).
5. Server runs a lightweight image feature extractor and returns predicted engagement proxies.
6. Extension overlays engagement indicators on each thumbnail.

### 6.2 Video Clip Analysis (MVP — current)

```
1. User navigates to a page with an HTML5 <video>.
2. BrainFeels button appears (bottom-right).
3. User opens panel, optionally adjusts clip duration, starts video playback.
4. User clicks "Record & analyze".
5. MediaRecorder records {duration} seconds from the live video stream.
6. Recorded WebM blob → ArrayBuffer → chrome.runtime.sendMessage.
7. Background service worker POSTs to {serverUrl}/analyze.
8. Server saves temp file, runs TRIBE v2 (or demo mode).
9. JSON result → background → content script.
10. Panel renders disclaimer + overview + meta stats.
11. Temp file deleted on server.
```

### 6.3 Emotion Mosaic Generation (future — not MVP)

> Planned feature: aggregate results from multiple clips/thumbnails into a visual "emotion mosaic" — a colour-coded cortical surface map rendered as a 2-D projection image in the panel.

1. User analyses 3+ video clips in the same session.
2. Extension accumulates `meta` results in `chrome.storage.session`.
3. User clicks "Generate mosaic" in panel.
4. Extension POSTs all accumulated `meta` arrays to `/mosaic` (future endpoint).
5. Server aggregates predictions across sessions, returns a base-64 PNG of a cortical surface flatmap.
6. Panel renders the mosaic image with a colour-scale legend.

---

## 7. Out of Scope

- **Real EEG / fMRI data**: BrainFeels never reads any biometric sensor. TRIBE v2 is a model, not a sensor.
- **Hosted inference**: No cloud API endpoint is provided. All inference runs on the user's machine.
- **Firefox / Safari / Edge**: Only Chrome MV3 is targeted in v0.1.
- **DRM-protected video**: Sites that prevent `captureStream()` will display an error; no bypass is provided.
- **Emotion classification**: Discrete emotion labels (happy, sad, …) are not produced; only continuous cortical-response proxies.
- **Multi-user / authentication**: The local server has no auth layer; it is intended to bind to `127.0.0.1` only.
- **Persistent result storage**: Results are shown once and are not saved to disk or synced.

---

## 8. Boundary Cases & Edge Conditions

| Case | Expected Behaviour |
|---|---|
| No `<video>` on the page | Panel shows "No HTML5 video found on this page." |
| `captureStream()` throws (DRM, cross-origin iframe) | Panel shows the error message returned by the browser. |
| Recording produces empty blob (video paused) | Panel shows "Recording was empty. Try playing the video first." |
| Upload > 120 MB | Server returns HTTP 413; panel shows server error. |
| Server not running | `fetch()` rejects; background catches it; panel shows connection error. |
| TRIBE v2 not installed | Server returns `mode: "demo"` with setup instructions; no crash. |
| TRIBE inference crashes mid-run | Server returns HTTP 500 with `detail`; panel shows error. |
| User changes server URL mid-recording | The URL in effect at send time (post-recording) is used; no race condition. |
| Clip duration = 5 s (minimum) | MediaRecorder runs for exactly 5 s; small blob sent normally. |
| Clip duration = 120 s (maximum) | Clamped at 120 s in both content script and `setTimeout`. |
| File suffix not in allowed set | Server normalises to `.webm` before writing temp file. |
| TRIBE returns a non-2-D array | `_summarize_predictions` raises `ValueError`; caught, returns HTTP 500 with detail. |

---

## 9. MVP Criteria

The MVP is considered **complete** when ALL of the following are true:

- [x] **FR-01 – FR-20** (extension + server functional requirements) pass manual testing.
- [x] `GET /health` returns 200.
- [x] Demo mode returns a correctly shaped JSON response.
- [x] The panel renders results without JS console errors on YouTube and a generic HTML5 video page.
- [x] The extension loads successfully in Chrome 120+ without manifest errors.
- [x] `pytest server/tests/test_main.py` passes with 0 failures (demo mode only — no TRIBE needed).
- [ ] ESLint runs with 0 errors on `extension/` (when `package.json` + ESLint config are added).
- [ ] Ruff + mypy pass on `server/`.
- [ ] README describes setup clearly enough for a non-developer to follow.
- [ ] Every rendered result contains the scientific disclaimer.

---

## 10. Evaluation & Testing Plan

### 10.1 Unit Tests — Server (`pytest`)

| Test | What it verifies |
|---|---|
| `test_health` | `GET /health` → `{"status": "ok"}` |
| `test_analyze_demo_mode` | `POST /analyze` with small `.webm` → `{"mode": "demo", ...}` when tribev2 absent. |
| `test_analyze_too_large` | 121 MB payload → HTTP 413. |
| `test_analyze_bad_suffix_normalised` | `.xyz` suffix normalised to `.webm`; demo mode response. |
| `test_summarize_predictions_shape` | `_summarize_predictions` with a (10, 100) array → valid dict. |
| `test_summarize_predictions_bad_shape` | 1-D array → `ValueError`. |

### 10.2 Unit Tests — Extension (`Jest`)

| Test | What it verifies |
|---|---|
| `test_background_sends_message` | Mock fetch; background handler returns `{ok: true, data}`. |
| `test_background_server_error` | Mock fetch returns 500; handler returns `{ok: false, ...}`. |
| `test_escape_html` | `escapeHtml("<script>")` → `"&lt;script&gt;"`. |
| `test_duration_clamping` | Duration < 5 clamped to 5; > 120 clamped to 120. |

### 10.3 Manual End-to-End Checklist

1. Start server: `cd server && python main.py`
2. Load extension in Chrome.
3. Open YouTube; start a video.
4. Click BrainFeels → set duration 10 s → click "Record & analyze".
5. Verify: status updates ("Recording…", "Uploading…", "Done."), panel shows disclaimer + overview.
6. Open non-video page: verify no button appears or button shows "No video" error gracefully.
7. Stop server; click "Record & analyze": verify connection error shown in panel.
8. Change server URL to `http://127.0.0.1:9999` in popup → save → verify error message on non-running port.

### 10.4 CI Pipeline (`.github/workflows/ci.yml`)

```
on: [push, pull_request]

jobs:
  python-checks:
    - ruff check server/
    - mypy server/main.py
    - pytest server/tests/ -v

  js-checks:   (when package.json exists)
    - eslint extension/
    - jest
```

---

## 11. Glossary

| Term | Definition |
|---|---|
| **TRIBE v2** | Meta's multimodal brain-encoding model that predicts fMRI-like cortical responses from video, audio, and text inputs. |
| **Cortical surface** | The outer layer of the brain. TRIBE v2 predictions are mapped to ~20 000 vertices on the fsaverage surface mesh. |
| **TR (Time Resolution)** | The temporal unit of TRIBE v2 output; one prediction per TR-length segment of the video. |
| **Demo mode** | Server response when TRIBE v2 is not installed; returns guidance text instead of inference results. |
| **MV3** | Chrome Extensions Manifest Version 3 — the current extension platform standard. |
| **Emotion mosaic** | (Planned) A visual aggregate of cortical predictions across multiple clips, shown as a 2-D cortical flatmap. |
| **captureStream()** | Browser API on `HTMLVideoElement` that returns a `MediaStream` suitable for `MediaRecorder`. |

---

*Last reviewed: April 2026*

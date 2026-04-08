// Exported for unit tests (ignored by the browser; module is undefined there).
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

(function () {
  const PANEL_ID = "brainfeels-tribe-panel";
  const BTN_ID = "brainfeels-tribe-toggle";

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;
    const wrap = document.createElement("div");
    wrap.id = PANEL_ID;
    wrap.innerHTML = `
      <div class="brainfeels-inner">
        <div class="brainfeels-header">
          <span class="brainfeels-title">BrainFeels</span>
          <button type="button" class="brainfeels-close" aria-label="Close">×</button>
        </div>
        <p class="brainfeels-hint">Plays the video and records a short clip for local TRIBE v2 analysis (requires the Python server on your machine).</p>
        <label class="brainfeels-label">Clip length (seconds)</label>
        <input type="number" class="brainfeels-duration" min="5" max="120" value="20" />
        <div class="brainfeels-actions">
          <button type="button" class="brainfeels-record">Record &amp; analyze</button>
        </div>
        <div class="brainfeels-status" aria-live="polite"></div>
        <div class="brainfeels-result"></div>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    wrap.querySelector(".brainfeels-close").addEventListener("click", () => {
      wrap.classList.remove("brainfeels-visible");
    });

    wrap.querySelector(".brainfeels-record").addEventListener("click", () => onRecord(wrap));
  }

  function setStatus(wrap, text, isError) {
    const el = wrap.querySelector(".brainfeels-status");
    el.textContent = text;
    el.classList.toggle("brainfeels-error", !!isError);
  }

  function setResult(wrap, html) {
    wrap.querySelector(".brainfeels-result").innerHTML = html;
  }

  async function onRecord(wrap) {
    const video =
      document.querySelector("video") ||
      document.querySelector("video[src]") ||
      document.querySelector("ytd-player video");
    if (!video) {
      setStatus(wrap, "No HTML5 video found on this page.", true);
      return;
    }

    const sec = Math.min(
      120,
      Math.max(5, parseInt(wrap.querySelector(".brainfeels-duration").value, 10) || 20)
    );
    setResult(wrap, "");
    setStatus(wrap, "Recording… keep the tab focused and video playing.");

    let stream;
    try {
      stream = video.captureStream();
    } catch (e) {
      setStatus(wrap, "Could not capture this video: " + (e?.message || e), true);
      return;
    }

    const mime =
      MediaRecorder.isTypeSupported("video/webm;codecs=vp9") && "video/webm;codecs=vp9";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) chunks.push(ev.data);
    };

    await new Promise((resolve, reject) => {
      rec.onstop = resolve;
      rec.onerror = () => reject(new Error("Recorder error"));
      try {
        rec.start(200);
      } catch (e) {
        reject(e);
        return;
      }
      setTimeout(() => {
        try {
          rec.stop();
        } catch {
          resolve();
        }
      }, sec * 1000);
    });

    const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
    if (!blob.size) {
      setStatus(wrap, "Recording was empty. Try playing the video first.", true);
      return;
    }

    setStatus(wrap, "Uploading to local BrainFeels server…");
    const buf = await blob.arrayBuffer();
    chrome.runtime.sendMessage(
      {
        type: "analyze",
        buffer: buf,
        mimeType: blob.type,
        filename: "clip.webm",
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          setStatus(wrap, chrome.runtime.lastError.message, true);
          return;
        }
        if (!resp?.ok) {
          const err =
            resp?.error ||
            resp?.data?.detail ||
            resp?.data?.error ||
            JSON.stringify(resp?.data || resp);
          setStatus(wrap, "Server error: " + err, true);
          return;
        }
        setStatus(wrap, "Done.");
        renderResult(wrap, resp.data);
      }
    );
  }

  function renderResult(wrap, data) {
    const disclaimer = escapeHtml(
      data.disclaimer ||
        "TRIBE v2 predicts modelled cortical responses to stimuli—not your actual brain or guaranteed emotions."
    );
    const brain = escapeHtml(data.brain_summary || data.summary || "(no summary)");
    const emotion = escapeHtml(data.emotion_overview || "");
    const meta = data.meta
      ? `<pre class="brainfeels-meta">${escapeHtml(JSON.stringify(data.meta, null, 2))}</pre>`
      : "";

    setResult(
      wrap,
      `<p class="brainfeels-disclaimer">${disclaimer}</p>
       <h4 class="brainfeels-h4">Predicted cortical response (overview)</h4>
       <p class="brainfeels-body">${brain.replace(/\n/g, "<br/>")}</p>
       ${
         emotion
           ? `<h4 class="brainfeels-h4">Interpretive affect / engagement</h4><p class="brainfeels-body">${emotion.replace(
               /\n/g,
               "<br/>"
             )}</p>`
           : ""
       }
       ${meta}`
    );
  }

  function ensureToggle() {
    if (document.getElementById(BTN_ID)) return;
    const b = document.createElement("button");
    b.id = BTN_ID;
    b.type = "button";
    b.textContent = "BrainFeels";
    b.title = "Open BrainFeels TRIBE v2 panel";
    b.addEventListener("click", () => {
      ensurePanel();
      const p = document.getElementById(PANEL_ID);
      p.classList.toggle("brainfeels-visible");
    });
    document.documentElement.appendChild(b);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureToggle);
  } else {
    ensureToggle();
  }
})();

// ─── YouTube Thumbnail Emotion Mosaic Overlay ─────────────────────────────────
(function initMosaic() {
  const h = location.hostname;
  if (h !== "www.youtube.com" && h !== "youtube.com" && !h.endsWith(".youtube.com")) return;

  const MOSAIC_ROWS = 3;
  const MOSAIC_COLS = 4;
  // Selectors that cover home, search, channel, trending, and shorts shelves.
  const THUMB_IMG_SELECTOR =
    "ytd-thumbnail img#img, ytd-thumbnail img.yt-core-image, " +
    "ytd-playlist-thumbnail img#img, ytd-movie-renderer img#img";
  const MAX_CONCURRENT = 3;

  const analysisCache = new Map(); // url → mosaic cells[]
  let inFlight = 0;
  const waitQueue = []; // {url, resolve} pending concurrency slot
  let mosaicEnabled = true; // refreshed from storage before first use

  // WeakMap to track per-image src-attribute MutationObservers so they can be
  // disconnected when the feature is disabled, preventing memory leaks.
  const imgAttrObservers = new WeakMap();

  // ── Color / emotion helpers ──────────────────────────────────────────────

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0,
      s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
  }

  function emotionFromHsl(h, s, l) {
    if (s < 0.12) {
      if (l > 0.75) return { name: "calm", color: "#B0BEC5" };
      if (l < 0.25) return { name: "tension", color: "#455A64" };
      return { name: "neutral", color: "#90A4AE" };
    }
    if (h < 15 || h >= 345) return { name: "excitement", color: "#EF5350" };
    if (h < 45) return { name: "energy", color: "#FF7043" };
    if (h < 75) return { name: "happiness", color: "#FFCA28" };
    if (h < 150) return { name: "calm", color: "#66BB6A" };
    if (h < 195) return { name: "serenity", color: "#26C6DA" };
    if (h < 255) return { name: "trust", color: "#42A5F5" };
    if (h < 300) return { name: "mystery", color: "#AB47BC" };
    return { name: "excitement", color: "#EC407A" };
  }

  // ── Concurrency-limited fetch + canvas analysis ──────────────────────────

  function acquireSlot() {
    return new Promise((resolve) => {
      if (inFlight < MAX_CONCURRENT) {
        inFlight++;
        resolve();
      } else {
        waitQueue.push(resolve);
      }
    });
  }

  function releaseSlot() {
    const next = waitQueue.shift();
    if (next) {
      next();
    } else {
      inFlight--;
    }
  }

  async function fetchAndAnalyze(url) {
    if (analysisCache.has(url)) return analysisCache.get(url);

    await acquireSlot();
    try {
      // Re-check cache after waiting for a slot.
      if (analysisCache.has(url)) return analysisCache.get(url);

      const resp = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);

      const W = bitmap.width || 320;
      const H = bitmap.height || 180;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, W, H);
      bitmap.close();

      const cellW = Math.floor(W / MOSAIC_COLS);
      const cellH = Math.floor(H / MOSAIC_ROWS);
      const cells = [];

      for (let row = 0; row < MOSAIC_ROWS; row++) {
        for (let col = 0; col < MOSAIC_COLS; col++) {
          const imgData = ctx.getImageData(col * cellW, row * cellH, cellW, cellH).data;
          let rSum = 0,
            gSum = 0,
            bSum = 0;
          const pixelCount = imgData.length / 4;
          for (let i = 0; i < imgData.length; i += 4) {
            rSum += imgData[i];
            gSum += imgData[i + 1];
            bSum += imgData[i + 2];
          }
          const { h, s, l } = rgbToHsl(rSum / pixelCount, gSum / pixelCount, bSum / pixelCount);
          const { name, color } = emotionFromHsl(h, s, l);
          cells.push({ row, col, emotion: name, color });
        }
      }

      analysisCache.set(url, cells);
      return cells;
    } catch {
      return null;
    } finally {
      releaseSlot();
    }
  }

  // ── Overlay rendering ────────────────────────────────────────────────────

  function renderOverlay(container, cells) {
    container.querySelector(".brainfeels-mosaic")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "brainfeels-mosaic";
    overlay.setAttribute("aria-hidden", "true");

    for (const cell of cells) {
      const cellEl = document.createElement("div");
      cellEl.className = "brainfeels-mosaic-cell";
      cellEl.style.setProperty("--bf-color", cell.color);
      cellEl.title = cell.emotion;
      overlay.appendChild(cellEl);
    }

    // Ensure the parent is positioned so the absolute overlay aligns.
    const pos = getComputedStyle(container).position;
    if (pos === "static") container.style.position = "relative";

    container.appendChild(overlay);
  }

  function removeAllOverlays() {
    document.querySelectorAll(".brainfeels-mosaic").forEach((el) => el.remove());
    document.querySelectorAll("[data-bf-src]").forEach((el) => {
      delete el.dataset.bfSrc;
    });
    // Disconnect per-image src attribute observers.
    document.querySelectorAll(THUMB_IMG_SELECTOR).forEach(disconnectImgObserver);
  }

  // ── Per-thumbnail processing ─────────────────────────────────────────────

  async function processThumbnail(imgEl) {
    if (!mosaicEnabled) return;
    const src = imgEl.src;
    if (!src || !src.startsWith("http")) return;

    // Walk up to find the best overlay container (prefer ytd-thumbnail).
    const container =
      imgEl.closest("ytd-thumbnail") ||
      imgEl.closest("ytd-playlist-thumbnail") ||
      imgEl.parentElement;
    if (!container) return;

    // Skip if already processed for this src.
    if (container.dataset.bfSrc === src) return;
    container.dataset.bfSrc = src;

    const cells = await fetchAndAnalyze(src);
    if (!cells) return;
    renderOverlay(container, cells);
  }

  // ── DOM observation ──────────────────────────────────────────────────────

  // IntersectionObserver — only analyse thumbnails entering the viewport.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) processThumbnail(entry.target);
      });
    },
    { rootMargin: "200px 0px" }
  );

  function observeImg(img) {
    io.observe(img);
    // YouTube sets `src` lazily; watch for the attribute being filled.
    if (imgAttrObservers.has(img)) return; // already watching
    const attrMo = new MutationObserver(() => {
      if (img.src && img.src.startsWith("http")) processThumbnail(img);
    });
    attrMo.observe(img, { attributes: true, attributeFilter: ["src"] });
    imgAttrObservers.set(img, attrMo);
  }

  function disconnectImgObserver(img) {
    const attrMo = imgAttrObservers.get(img);
    if (attrMo) {
      attrMo.disconnect();
      imgAttrObservers.delete(img);
    }
  }

  // MutationObserver — detect newly inserted thumbnail images.
  const mo = new MutationObserver((mutations) => {
    if (!mosaicEnabled) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const imgs = node.matches?.(THUMB_IMG_SELECTOR)
          ? [node]
          : [...(node.querySelectorAll?.(THUMB_IMG_SELECTOR) ?? [])];
        imgs.forEach(observeImg);
      }
    }
  });

  // SPA navigation — YouTube uses History API; rescan after URL changes.
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      // Brief delay to let YouTube render the new page content.
      setTimeout(scanExisting, 800);
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  function scanExisting() {
    document.querySelectorAll(THUMB_IMG_SELECTOR).forEach((img) => {
      observeImg(img);
      if (img.src && img.src.startsWith("http")) processThumbnail(img);
    });
  }

  // ── Startup ──────────────────────────────────────────────────────────────

  chrome.storage.sync.get({ mosaicEnabled: true }, ({ mosaicEnabled: val }) => {
    mosaicEnabled = val;

    if (mosaicEnabled) {
      mo.observe(document.body, { childList: true, subtree: true });
      scanExisting();
    }
  });

  // React to the user toggling the setting in the popup.
  chrome.storage.onChanged.addListener((changes) => {
    if (!("mosaicEnabled" in changes)) return;
    mosaicEnabled = changes.mosaicEnabled.newValue;
    if (mosaicEnabled) {
      mo.observe(document.body, { childList: true, subtree: true });
      scanExisting();
    } else {
      mo.disconnect();
      removeAllOverlays();
    }
  });
})();

// Export utilities for Jest unit tests.
// `module` is undefined in the browser so this line is a no-op there.
if (typeof module !== "undefined") module.exports = { escapeHtml };

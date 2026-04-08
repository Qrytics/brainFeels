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

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
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

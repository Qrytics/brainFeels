const DEFAULT_SERVER = "http://127.0.0.1:8765";

// Keep the MV3 service worker alive while a long-running fetch is in progress.
// Chrome kills idle service workers after ~30 s; TRIBE inference can take minutes.
const KEEPALIVE_ALARM = "brainfeels-keepalive";
let _keepAliveCount = 0;

function _startKeepAlive() {
  if (++_keepAliveCount === 1) {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  }
}
function _stopKeepAlive() {
  if (--_keepAliveCount <= 0) {
    _keepAliveCount = 0;
    chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Accessing any Chrome API resets the service-worker idle timer.
    chrome.runtime.getPlatformInfo(() => {});
  }
});

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
  return serverUrl || DEFAULT_SERVER;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "analyze") {
    return;
  }
  (async () => {
    _startKeepAlive();
    try {
      const base = await getServerUrl();
      const url = `${base.replace(/\/$/, "")}/analyze`;
      const blob = new Blob([msg.buffer], { type: msg.mimeType || "video/webm" });
      const form = new FormData();
      form.append("file", blob, msg.filename || "clip.webm");

      // 15-minute hard timeout — TRIBE on CPU can be slow but shouldn't hang forever.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

      let res;
      try {
        res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text || `HTTP ${res.status}` };
      }
      if (!res.ok) {
        sendResponse({ ok: false, status: res.status, data });
        return;
      }
      sendResponse({ ok: true, data });
    } catch (e) {
      const msg = e?.name === "AbortError"
        ? "Request timed out after 15 minutes. TRIBE inference may still be running on the server."
        : (e?.message || String(e));
      sendResponse({ ok: false, error: msg });
    } finally {
      _stopKeepAlive();
    }
  })();
  return true;
});

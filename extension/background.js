const DEFAULT_SERVER = "http://127.0.0.1:8765";

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
  return serverUrl || DEFAULT_SERVER;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "analyze") {
    return;
  }
  (async () => {
    try {
      const base = await getServerUrl();
      const url = `${base.replace(/\/$/, "")}/analyze`;
      const blob = new Blob([msg.buffer], { type: msg.mimeType || "video/webm" });
      const form = new FormData();
      form.append("file", blob, msg.filename || "clip.webm");
      const res = await fetch(url, { method: "POST", body: form });
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
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});

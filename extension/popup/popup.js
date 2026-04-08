const DEFAULT_SERVER = "http://127.0.0.1:8765";

document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("serverUrl");
  const mosaicCheckbox = document.getElementById("mosaicEnabled");
  const status = document.getElementById("status");

  const { serverUrl, mosaicEnabled } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER,
    mosaicEnabled: true,
  });
  input.value = serverUrl || DEFAULT_SERVER;
  mosaicCheckbox.checked = mosaicEnabled;

  document.getElementById("save").addEventListener("click", async () => {
    let v = (input.value || "").trim();
    if (!v) v = DEFAULT_SERVER;
    await chrome.storage.sync.set({
      serverUrl: v,
      mosaicEnabled: mosaicCheckbox.checked,
    });
    status.textContent = "Saved.";
    setTimeout(() => {
      status.textContent = "";
    }, 1500);
  });
});

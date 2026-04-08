const DEFAULT_SERVER = "http://127.0.0.1:8765";

document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("serverUrl");
  const status = document.getElementById("status");
  const { serverUrl } = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
  input.value = serverUrl || DEFAULT_SERVER;

  document.getElementById("save").addEventListener("click", async () => {
    let v = (input.value || "").trim();
    if (!v) v = DEFAULT_SERVER;
    await chrome.storage.sync.set({ serverUrl: v });
    status.textContent = "Saved.";
    setTimeout(() => {
      status.textContent = "";
    }, 1500);
  });
});

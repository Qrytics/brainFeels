/**
 * Unit tests for background.js (service worker).
 *
 * Chrome APIs are provided by jest-webextension-mock (see package.json
 * setupFiles). fetch() is replaced with a jest.fn() before each test.
 */

"use strict";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

// Helper: load (or re-load) background.js and return the registered listener.
function loadBackground() {
  jest.resetModules();
  // background.js awaits chrome.storage.sync.get() — mock it to resolve.
  chrome.storage.sync.get.mockResolvedValue({ serverUrl: DEFAULT_SERVER });
  require("../background");
  // The listener is the first argument of the most recent addListener call.
  const calls = chrome.runtime.onMessage.addListener.mock.calls;
  return calls[calls.length - 1][0];
}

// Helper: invoke the listener and wait for sendResponse.
function callListener(listener, msg) {
  return new Promise((resolve) => {
    const returnValue = listener(msg, {}, resolve);
    // A return value of `true` means the listener is async; otherwise it may
    // not call sendResponse, so we resolve immediately.
    if (returnValue !== true) resolve(undefined);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

// ---------------------------------------------------------------------------
// test_background_sends_message
// ---------------------------------------------------------------------------

test("test_background_sends_message — returns { ok: true, data } on HTTP 200", async () => {
  const mockData = { mode: "demo", disclaimer: "test disclaimer" };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue(JSON.stringify(mockData)),
  });

  const listener = loadBackground();
  const resp = await callListener(listener, {
    type: "analyze",
    buffer: new ArrayBuffer(8),
    mimeType: "video/webm",
    filename: "clip.webm",
  });

  expect(resp).toMatchObject({ ok: true });
  expect(resp.data).toMatchObject({ mode: "demo" });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/analyze"),
    expect.objectContaining({ method: "POST" })
  );
});

// ---------------------------------------------------------------------------
// test_background_server_error
// ---------------------------------------------------------------------------

test("test_background_server_error — returns { ok: false } on HTTP 500", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: jest.fn().mockResolvedValue(
      JSON.stringify({ detail: "TRIBE inference failed: some error" })
    ),
  });

  const listener = loadBackground();
  const resp = await callListener(listener, {
    type: "analyze",
    buffer: new ArrayBuffer(8),
    mimeType: "video/webm",
  });

  expect(resp).toMatchObject({ ok: false, status: 500 });
  expect(resp.data).toMatchObject({ detail: expect.stringContaining("TRIBE") });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("non-analyze messages are ignored (no sendResponse call)", async () => {
  const listener = loadBackground();
  const sendResponse = jest.fn();
  const returnVal = listener({ type: "other" }, {}, sendResponse);

  // Should return undefined (not true) and never call sendResponse.
  expect(returnVal).toBeUndefined();
  await new Promise((r) => setTimeout(r, 50)); // let any async work settle
  expect(sendResponse).not.toHaveBeenCalled();
});

test("network error is caught and returned as { ok: false, error }", async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error("Failed to fetch"));

  const listener = loadBackground();
  const resp = await callListener(listener, {
    type: "analyze",
    buffer: new ArrayBuffer(8),
  });

  expect(resp).toMatchObject({ ok: false });
  expect(resp.error).toMatch(/Failed to fetch/);
});

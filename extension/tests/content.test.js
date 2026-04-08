/**
 * Unit tests for content.js utility functions.
 *
 * escapeHtml is exported from content.js via the module.exports guard at the
 * bottom of the file.  Duration clamping mirrors the inline logic in onRecord.
 *
 * The YouTube mosaic IIFE returns early in jsdom because location.hostname is
 * not "youtube.com", so no complex DOM setup is required.
 */

"use strict";

// Set up chrome storage mock before content.js is loaded.
beforeAll(() => {
  // content.js (mosaic section) calls the callback form of storage.sync.get.
  chrome.storage.sync.get.mockImplementation((_keys, cb) => {
    if (typeof cb === "function") cb({ mosaicEnabled: true });
    return Promise.resolve({ mosaicEnabled: true });
  });
});

const { escapeHtml } = require("../content");

// ---------------------------------------------------------------------------
// test_escape_html
// ---------------------------------------------------------------------------

describe("test_escape_html", () => {
  test("escapes < and > (script tags)", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("does not alter double quotes (innerHTML text-node behaviour)", () => {
    // innerHTML only encodes < > & in text nodes; " is left as-is.
    expect(escapeHtml('"quoted"')).toBe('"quoted"');
  });

  test("leaves plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// test_duration_clamping
//
// Mirrors the inline clamping expression from content.js onRecord():
//   Math.min(120, Math.max(5, parseInt(value, 10) || 20))
// ---------------------------------------------------------------------------

describe("test_duration_clamping", () => {
  function clampDuration(value) {
    return Math.min(120, Math.max(5, parseInt(value, 10) || 20));
  }

  test("values below 5 are clamped to 5", () => {
    expect(clampDuration("3")).toBe(5);
    // "0" is falsy after parseInt, so the || 20 fallback applies → 20.
    expect(clampDuration("0")).toBe(20);
    expect(clampDuration("-10")).toBe(5);
    expect(clampDuration("1")).toBe(5);
  });

  test("values above 120 are clamped to 120", () => {
    expect(clampDuration("121")).toBe(120);
    expect(clampDuration("999")).toBe(120);
    expect(clampDuration("1000")).toBe(120);
  });

  test("valid values within range pass through unchanged", () => {
    expect(clampDuration("5")).toBe(5);
    expect(clampDuration("20")).toBe(20);
    expect(clampDuration("60")).toBe(60);
    expect(clampDuration("120")).toBe(120);
  });

  test("non-numeric input defaults to 20", () => {
    expect(clampDuration("abc")).toBe(20);
    expect(clampDuration("")).toBe(20);
    expect(clampDuration("NaN")).toBe(20);
  });
});

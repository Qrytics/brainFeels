// ESLint flat config (v9) for the BrainFeels Chrome extension.
// Uses CommonJS format (no "type":"module" in package.json).
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    // Ignore generated / tool directories.
    ignores: ["node_modules/**", "tests/**"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser built-ins used by the extension.
        ...globals.browser,
        // Chrome Extension APIs.
        chrome: "readonly",
        MediaRecorder: "readonly",
        createImageBitmap: "readonly",
        // Node.js module system — present only in Jest; guards like
        // `if (typeof module !== "undefined")` avoid false positives.
        module: "writable",
      },
    },
    rules: {
      // Allow _-prefixed parameters (e.g., _sender in chrome callbacks).
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];

/* eslint-disable @typescript-eslint/no-require-imports */
// CJS shim that resolves + reads the liteparse-wasm binary at runtime using
// the *real* Node.js resolver (not webpack's). This file is intentionally CJS
// and listed in `serverExternalPackages`-style externalization via being
// consumed with a runtime-built specifier, so webpack does not try to inline
// the .wasm asset or rewrite the resolve call.
const fs = require('node:fs');

let cached = null;

function loadLiteparseWasmBytes() {
  if (cached) return cached;
  const wasmPath =
    require.resolve('@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm');
  cached = fs.readFileSync(wasmPath);
  return cached;
}

module.exports = { loadLiteparseWasmBytes };

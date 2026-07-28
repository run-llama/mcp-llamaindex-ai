import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LITEPARSE_TRACE_INCLUDES = [
  // Real (non-symlinked) path inside pnpm's virtual store, so the .wasm
  // asset gets included in the server bundle output.
  './node_modules/.pnpm/@llamaindex+liteparse-wasm@*/node_modules/@llamaindex/liteparse-wasm/**',
  // The CJS shim that reads the .wasm at runtime (loaded via a dynamic import
  // with `webpackIgnore`, so tracing can't see it automatically).
  './shim-wasm.cjs',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs'],
  serverExternalPackages: ['@llamaindex/liteparse-wasm'],
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    '/mcp': LITEPARSE_TRACE_INCLUDES,
    '/parse/mcp': LITEPARSE_TRACE_INCLUDES,
    '/classify/mcp': LITEPARSE_TRACE_INCLUDES,
    '/classify/[configId]/mcp': LITEPARSE_TRACE_INCLUDES,
    '/extract/mcp': LITEPARSE_TRACE_INCLUDES,
    '/extract/[configId]/mcp': LITEPARSE_TRACE_INCLUDES,
    '/split/mcp': LITEPARSE_TRACE_INCLUDES,
    '/split/[configId]/mcp': LITEPARSE_TRACE_INCLUDES,
  },
};

export default nextConfig;

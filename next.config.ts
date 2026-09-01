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
  async redirects() {
    return [
      {
        // There is no root page: this app only serves /mcp endpoints, OAuth
        // discovery under /.well-known, and the /upload flow. Send humans who
        // land on the bare host to the setup guide instead of a 404.
        // Temporary (307) so the destination can move without being cached.
        source: '/',
        destination:
          'https://developers.llamaindex.ai/llamaparse/for-agents/mcp/',
        permanent: false,
      },
      {
        // `/index/[indexId]/mcp` was a live endpoint before /index/mcp
        // replaced it. A 307 keeps the method and body, so already-configured
        // clients reach a working server instead of a 404: they re-list tools
        // on connect and pass `indexId` per call instead of having it pinned
        // by the URL. The id in the old URL is not carried over — the
        // destination's tools take it as an argument, so a caller that only
        // knew its index through the URL now has to call listIndexes first.
        source: '/index/:indexId/mcp',
        destination: '/index/mcp',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

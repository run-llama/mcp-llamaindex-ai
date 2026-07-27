import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LITEPARSE_TRACE_INCLUDES = [
  // Real (non-symlinked) paths inside pnpm's virtual store. See NOTE 3.
  './node_modules/.pnpm/@llamaindex+liteparse@*/node_modules/@llamaindex/liteparse/**',
  './node_modules/.pnpm/@llamaindex+liteparse-linux-x64-gnu@*/node_modules/@llamaindex/liteparse-linux-x64-gnu/**',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs'],
  serverExternalPackages: ['@llamaindex/liteparse'],
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

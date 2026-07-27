import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs'],
  serverExternalPackages: ['@llamaindex/liteparse'],
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    '/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/parse/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/classify/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/classify/[configId]/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/extract/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/extract/[configId]/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/split/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
    '/split/[configId]/mcp': ['./node_modules/@llamaindex/liteparse*/**'],
  },
};

export default nextConfig;

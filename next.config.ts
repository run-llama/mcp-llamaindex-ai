import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs', '@llamaindex/liteparse'],
  outputFileTracingRoot: __dirname,
  // liteparse resolves its native addon (*.node) and the bundled pdfium
  // shared library (*.so/*.dylib) via a *dynamic* require() built from
  // process.platform/process.arch at runtime. Next's file tracer
  // (@vercel/nft) only follows static require/import calls, so it can't
  // see these files and silently drops them from the deployed Vercel
  // function bundle -> "Failed to load native module for linux-x64" in
  // production even though it works locally.
  //
  // outputFileTracingIncludes force-includes them regardless of what
  // static analysis finds. Every route that (transitively) calls into
  // lib/business/liteparse.ts needs this.
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

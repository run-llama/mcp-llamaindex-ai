import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs'],
  outputFileTracingRoot: __dirname,
};

export default nextConfig;

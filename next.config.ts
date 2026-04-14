/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@workos-inc/authkit-nextjs'],
  outputFileTracingRoot: 'pnpm-lock.yaml',
};

export default nextConfig;

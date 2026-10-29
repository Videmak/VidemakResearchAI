/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@videmak/editor'],
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  async rewrites() {
    // The browser talks to one origin; the API and real-time server sit behind it.
    const api = process.env.VIDEMAK_SERVER_URL || 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;

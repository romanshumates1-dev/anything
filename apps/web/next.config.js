/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Standalone output is ONLY for the Docker runner image. On Vercel it is not
  // recommended (Vercel builds its own output) and the monorepo-root
  // outputFileTracingRoot can break serverless function tracing at deploy time,
  // so gate both OFF when VERCEL=1 — Vercel then builds exactly as it did before
  // this was added. Docker builds set DOCKER_BUILD=1 (see Dockerfile) to opt in.
  ...(process.env.VERCEL
    ? {}
    : {
        output: 'standalone',
        outputFileTracingRoot: require('path').join(__dirname, '../../'),
      }),
  // Pin Turbopack's workspace root to THIS app. Without this, Next 16 infers the
  // monorepo root (d:\anything) and resolves `tailwindcss` from d:\anything\apps,
  // hitting the hoisted v3.4.x (pulled in by apps/mobile's NativeWind) instead of
  // this app's own tailwindcss v4 in apps/web/node_modules. That mismatch is what
  // produced `Error: Can't resolve 'tailwindcss' in 'd:\anything\apps'`.
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_CREATE_BASE_URL: process.env.NEXT_PUBLIC_CREATE_BASE_URL,
    NEXT_PUBLIC_CREATE_HOST: process.env.NEXT_PUBLIC_CREATE_HOST,
    NEXT_PUBLIC_PROJECT_GROUP_ID: process.env.NEXT_PUBLIC_PROJECT_GROUP_ID,
  },
  serverExternalPackages: [
    '@neondatabase/serverless',
    'ws',
    '@better-auth/kysely-adapter',
    'kysely',
  ],
  rewrites() {
    return [
      {
        source: '/fontawesome/:path*',
        destination: 'https://ka-p.fontawesome.com/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

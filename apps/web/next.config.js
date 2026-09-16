/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Security headers for production readiness
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://ka-p.fontawesome.com",
              "style-src 'self' 'unsafe-inline' https://ka-p.fontawesome.com",
              "font-src 'self' https://ka-p.fontawesome.com data:",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://ka-p.fontawesome.com https://*.neon.tech wss://*.neon.tech",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // Additional security for API routes
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },
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

// OpenNext Cloudflare adapter: wires Cloudflare bindings into `next dev` so
// local development can reach the same bindings the deployed Worker uses.
//
// Guarded to development on purpose — this repo also builds for Vercel and for
// Docker, and those paths must stay byte-for-byte unaffected by the Cloudflare
// work. See https://opennext.js.org/cloudflare/get-started (step 12).
if (process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@opennextjs/cloudflare').initOpenNextCloudflareForDev();
}

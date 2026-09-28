/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Do not advertise the framework in every response. `X-Powered-By: Next.js`
  // tells an unauthenticated scanner exactly which stack and version family is
  // running, which shortens reconnaissance for no benefit to us. Found by the
  // data-leak audit (scripts/security-probe.mjs checks the header set).
  poweredByHeader: false,
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
              // static.cloudflareinsights.com serves the Cloudflare Web Analytics beacon
              // that the Workers platform injects automatically. Without this the beacon is
              // blocked on EVERY page (verified in a real browser: 11/13 routes logged a CSP
              // violation) and Web Analytics silently collects nothing.
              //
              // 'unsafe-eval' is DEV-ONLY. It is required by React Fast Refresh and the
              // Next.js dev overlay, and nothing in a production Next build needs it.
              // Shipping it to production re-opens the XSS class CSP exists to contain:
              // it re-permits eval()/new Function() from any injected script, so CSP
              // stops meaningfully restricting script execution at all. Before this
              // change the production response carried it unconditionally.
              //
              // The production claim is verified, not assumed: after the change a real
              // browser load of the public, authenticated-shell and interactive routes
              // was checked for CSP violations and console errors (see
              // `scripts/browser-qa.mjs` and the console-health sweep).
              `script-src 'self' 'unsafe-inline'${
                process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
              } https://ka-p.fontawesome.com https://static.cloudflareinsights.com`,
              "style-src 'self' 'unsafe-inline' https://ka-p.fontawesome.com",
              "font-src 'self' https://ka-p.fontawesome.com data:",
              "img-src 'self' data: blob: https:",
              // connect-src must also allow the beacon's reporting endpoint.
              "connect-src 'self' https://ka-p.fontawesome.com https://*.neon.tech wss://*.neon.tech https://cloudflareinsights.com https://static.cloudflareinsights.com",
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
  // recommended (Vercel builds its own output) and it is also wrong for
  // Cloudflare Workers (OpenNext produces its own worker bundle; standalone
  // tracing restructures server output and can break it at deploy time).
  // Gate both OFF when VERCEL=1 or when an OpenNext build runs
  // (OPEN_NEXT=1 is set automatically during `opennextjs-cloudflare build`;
  // CLOUDFLARE=1 covers a manual `cf:*` build). Vercel then builds exactly as
  // it did before this was added, and Docker (which sets neither) is
  // byte-for-byte unaffected.
  //
  // NOTE: a plain `yarn build` with CLOUDFLARE=1 ALSO loses standalone output
  // and will NOT run under Docker. That combination is user error, and it
  // fails loudly (missing .next/standalone), not silently.
  ...(!(process.env.VERCEL || process.env.OPEN_NEXT || process.env.CLOUDFLARE)
    ? {
        output: 'standalone',
        outputFileTracingRoot: require('path').join(__dirname, '../../'),
      }
    : {}),
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

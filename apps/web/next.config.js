/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
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

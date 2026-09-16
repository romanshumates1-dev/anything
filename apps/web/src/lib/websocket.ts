/**
 * Runtime-agnostic WebSocket constructor for Neon's serverless driver.
 *
 * WHY THIS EXISTS
 * `@neondatabase/serverless` talks to Neon over WebSockets, so it needs a
 * WebSocket constructor. Which one is available depends on where the code runs:
 *
 *   Cloudflare Workers (workerd) — has a global `WebSocket` built in.
 *   Node >= 22 (local dev)       — has a global `WebSocket` built in.
 *   Node 20 (Docker image / CI)  — has NO global WebSocket; needs `ws`.
 *
 * Before this helper, `lib/auth.ts` did `import ws from 'ws'` and assigned it
 * unconditionally. That is a Node-only package that pulls in `node:net`/`node:tls`
 * and it is exactly what prevents the app from building for Cloudflare Workers.
 *
 * The `ws` lookup is deliberately deferred into a function body AND placed behind
 * a runtime check, so the Workers bundle never executes it — `require` does not
 * exist in workerd, and on workerd the global WebSocket short-circuits first.
 */
export function resolveWebSocketConstructor(): unknown {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return globalThis.WebSocket;
  }

  // Reached only on Node < 22. Resolved lazily, at most once, on first Pool use.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return ws?.default ?? ws;
}

/**
 * True when executing inside the Cloudflare Workers runtime (workerd).
 * Used to downgrade fatal boot-time checks that would otherwise kill every
 * request on Workers. This is Cloudflare's documented detector.
 */
export function isCloudflareWorkers(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as { userAgent?: string }).userAgent === 'Cloudflare-Workers'
  );
}

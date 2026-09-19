/**
 * Sentry Client Configuration for DealFlow AI
 *
 * This file configures Sentry for the browser/client side.
 * It is automatically loaded by @sentry/nextjs.
 *
 * Installation:
 *   npm install @sentry/nextjs
 *   npx @sentry/wizard@latest -i nextjs
 *
 * Environment Variables (set in .env.local):
 *   NEXT_PUBLIC_SENTRY_DSN - Your Sentry DSN
 *   NEXT_PUBLIC_SENTRY_ENVIRONMENT - Environment name (optional)
 *
 * After running the wizard, you may need to:
 *   1. Update next.config.js to include withSentryConfig wrapper
 *   2. Add sentry.properties file with org/project info
 *   3. Configure source maps upload in CI/CD
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Only initialize Sentry if DSN is configured and package is installed
if (SENTRY_DSN) {
  // Dynamic import to avoid build errors when @sentry/nextjs is not installed
  // @ts-expect-error - @sentry/nextjs may not be installed
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,

        // Environment configuration
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

        // Release version (auto-detected from SENTRY_RELEASE or Vercel env vars)
        // release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

        // Sample rate for error events (1.0 = 100%)
        // Adjust based on traffic volume to stay within quota
        sampleRate: 1.0,

        // Performance monitoring sample rate
        // Set to lower value in production for high-traffic apps
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

        // Session replay configuration
        // Captures user sessions for debugging
        replaysSessionSampleRate: 0.1, // 10% of sessions
        replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

        // Integrations
        integrations: [
          // Replay integration for session recording
          Sentry.replayIntegration({
            // Mask all text content for privacy
            maskAllText: false,
            // Block all media for privacy
            blockAllMedia: false,
          }),
          // Browser tracing for performance
          Sentry.browserTracingIntegration({
            // Trace these URL patterns
            tracePropagationTargets: [
              'localhost',
              /^https:\/\/.*\.dealflow\.ai/,
              /^https:\/\/.*\.vercel\.app/,
            ],
          }),
        ],

        // Filter out noisy errors
        beforeSend(event: { message?: string; tags?: Record<string, string> }, hint: { originalException?: unknown }) {
          const error = hint.originalException;

          // Ignore network errors that are common and not actionable
          if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (
              message.includes('network request failed') ||
              message.includes('failed to fetch') ||
              message.includes('load failed') ||
              message.includes('cancelled')
            ) {
              return null;
            }
          }

          // Ignore ResizeObserver errors (common browser noise)
          if (event.message?.includes('ResizeObserver')) {
            return null;
          }

          return event;
        },

        // Attach additional context to events
        beforeSendTransaction(event: { tags?: Record<string, string> }) {
          // Add custom tags for all transactions
          event.tags = {
            ...event.tags,
            app: 'dealflow-web',
          };
          return event;
        },

        // Debug mode for development
        debug: process.env.NODE_ENV === 'development',

        // Tunnel requests through your own domain to avoid ad blockers
        // tunnel: '/api/sentry-tunnel',
      });
    })
    .catch(() => {
      // @sentry/nextjs not installed - Sentry disabled
      console.info('[Sentry] @sentry/nextjs not installed. Run: npm install @sentry/nextjs');
    });
}

// Export for type safety
export {};

/**
 * Sentry Server Configuration for DealFlow AI
 *
 * This file configures Sentry for the server side (API routes, SSR).
 * It is automatically loaded by @sentry/nextjs.
 *
 * Installation:
 *   npm install @sentry/nextjs
 *   npx @sentry/wizard@latest -i nextjs
 *
 * Environment Variables (set in .env):
 *   SENTRY_DSN - Your Sentry DSN
 *   SENTRY_ENVIRONMENT - Environment name (optional)
 *   SENTRY_RELEASE - Release version (optional)
 *
 * After running the wizard, you may need to:
 *   1. Update next.config.js to include withSentryConfig wrapper
 *   2. Add sentry.properties file with org/project info
 *   3. Configure source maps upload in CI/CD
 */

const SENTRY_DSN = process.env.SENTRY_DSN;

// Only initialize Sentry if DSN is configured and package is installed
if (SENTRY_DSN) {
  // Dynamic import to avoid build errors when @sentry/nextjs is not installed
  // @ts-expect-error - @sentry/nextjs may not be installed
  import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,

        // Environment configuration
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

        // Release version
        // release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,

        // Sample rate for error events (1.0 = 100%)
        sampleRate: 1.0,

        // Performance monitoring sample rate
        // Lower in production for high-traffic APIs
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

        // Profile sample rate (requires tracing)
        // profilesSampleRate: 0.1,

        // Integrations
        integrations: [
          // Database query monitoring
          Sentry.nativeNodeFetchIntegration(),
          // HTTP request tracing
          Sentry.httpIntegration(),
        ],

        // Filter out noisy errors
        beforeSend(event: { tags?: Record<string, string> }, hint: { originalException?: unknown }) {
          const error = hint.originalException;

          // Ignore expected errors
          if (error instanceof Error) {
            const message = error.message.toLowerCase();

            // Ignore auth-related expected errors
            if (
              message.includes('unauthorized') ||
              message.includes('session expired') ||
              message.includes('not authenticated')
            ) {
              // Still log but don't send to Sentry
              console.warn('[Expected Auth Error]', error.message);
              return null;
            }

            // Ignore rate limit errors (expected behavior)
            if (message.includes('rate limit') || message.includes('too many requests')) {
              return null;
            }

            // Ignore connection reset errors (client disconnected)
            if (message.includes('econnreset') || message.includes('socket hang up')) {
              return null;
            }
          }

          return event;
        },

        // Attach additional context to events
        beforeSendTransaction(event: { tags?: Record<string, string> }) {
          // Add custom tags for all transactions
          event.tags = {
            ...event.tags,
            app: 'dealflow-api',
            runtime: 'nodejs',
          };
          return event;
        },

        // Ignore specific transactions
        ignoreTransactions: [
          // Health check endpoints
          '/api/health',
          '/api/healthz',
          '/_next/static/*',
        ],

        // Debug mode for development
        debug: process.env.NODE_ENV === 'development',
      });
    })
    .catch(() => {
      // @sentry/nextjs not installed - Sentry disabled
      console.info('[Sentry] @sentry/nextjs not installed. Run: npm install @sentry/nextjs');
    });
}

// Export for type safety
export {};

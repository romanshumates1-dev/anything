/**
 * Sentry Edge Configuration for DealFlow AI
 *
 * This file configures Sentry for Edge Runtime (middleware, edge API routes).
 * It is automatically loaded by @sentry/nextjs for edge functions.
 *
 * Installation:
 *   npm install @sentry/nextjs
 *   npx @sentry/wizard@latest -i nextjs
 *
 * Environment Variables:
 *   SENTRY_DSN - Your Sentry DSN
 *   SENTRY_ENVIRONMENT - Environment name (optional)
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

        // Sample rate for error events
        sampleRate: 1.0,

        // Performance monitoring sample rate
        // Edge functions are often high-volume, keep low
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0.5,

        // Filter out noisy errors
        beforeSend(event: { tags?: Record<string, string> }, hint: { originalException?: unknown }) {
          const error = hint.originalException;

          if (error instanceof Error) {
            const message = error.message.toLowerCase();

            // Ignore middleware redirect/rewrite errors
            if (message.includes('redirect') || message.includes('rewrite')) {
              return null;
            }
          }

          return event;
        },

        // Attach edge-specific context
        beforeSendTransaction(event: { tags?: Record<string, string> }) {
          event.tags = {
            ...event.tags,
            app: 'dealflow-edge',
            runtime: 'edge',
          };
          return event;
        },

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

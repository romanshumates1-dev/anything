/**
 * Sentry Integration for DealFlow AI
 *
 * Installation:
 *   npm install @sentry/nextjs
 *   npx @sentry/wizard@latest -i nextjs
 *
 * Environment Variables:
 *   SENTRY_DSN - Your Sentry DSN (required to enable Sentry)
 *   SENTRY_ENVIRONMENT - Environment name (defaults to NODE_ENV)
 *   SENTRY_RELEASE - Release version (optional, auto-detected by Sentry)
 *
 * Usage:
 *   import { captureError, captureMessage, setUser, startTransaction } from '@/app/api/utils/sentry';
 *
 *   // Capture an error with context
 *   captureError(error, { userId: '123', action: 'lead_import' });
 *
 *   // Set user context for subsequent events
 *   setUser('user-123', 'user@example.com');
 *
 *   // Performance monitoring
 *   const transaction = startTransaction('import_leads', 'task');
 *   // ... do work ...
 *   transaction?.finish();
 */

// Sentry types for the lazy-loaded module
interface SentryModule {
  captureException: (error: unknown, options?: { extra?: Record<string, unknown> }) => string | undefined;
  captureMessage: (message: string, options?: { level?: string; extra?: Record<string, unknown> }) => string | undefined;
  setUser: (user: { id?: string; email?: string; [key: string]: string | undefined } | null) => void;
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
  addBreadcrumb: (breadcrumb: { message?: string; category?: string; level?: string; data?: Record<string, unknown> }) => void;
  startInactiveSpan: (options: { name: string; op: string; forceTransaction?: boolean }) => { end: () => void; setAttribute: (key: string, value: string) => void } | null;
  setMeasurement: (name: string, value: number, unit: string) => void;
  withScope: <T>(callback: (scope: { setTag: (key: string, value: string) => void; setExtra: (key: string, value: unknown) => void; setUser: (user: { id?: string; email?: string } | null) => void }) => T) => T;
  flush: (timeout: number) => Promise<boolean>;
  close: (timeout: number) => Promise<boolean>;
}

// Lazy import to avoid bundling Sentry when not configured
let Sentry: SentryModule | null = null;

const SENTRY_DSN = process.env.SENTRY_DSN;
const IS_ENABLED = !!SENTRY_DSN;

/**
 * Initialize Sentry lazily on first use
 */
async function getSentry(): Promise<SentryModule | null> {
  if (!IS_ENABLED) return null;
  if (Sentry) return Sentry;

  try {
    // @ts-expect-error - @sentry/nextjs may not be installed
    Sentry = await import('@sentry/nextjs') as SentryModule;
    return Sentry;
  } catch {
    console.warn('[Sentry] @sentry/nextjs not installed. Run: npm install @sentry/nextjs');
    return null;
  }
}

// Synchronous access for already-loaded Sentry
function getSentrySync(): SentryModule | null {
  return Sentry;
}

export type SentryContext = Record<string, unknown>;

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

export interface TransactionHandle {
  finish: () => void;
  setMeasurement: (name: string, value: number, unit?: string) => void;
  setTag: (key: string, value: string) => void;
  setData: (key: string, value: unknown) => void;
}

/**
 * Capture an exception with optional context
 */
export async function captureError(
  error: Error | unknown,
  context?: SentryContext
): Promise<string | undefined> {
  const sentry = await getSentry();
  if (!sentry) {
    console.error('[DealFlow Error]', error, context);
    return undefined;
  }

  return sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Synchronous error capture (use when async is not possible)
 * Note: Call initSentry() early in app lifecycle for this to work
 */
export function captureErrorSync(
  error: Error | unknown,
  context?: SentryContext
): string | undefined {
  const sentry = getSentrySync();
  if (!sentry) {
    console.error('[DealFlow Error]', error, context);
    return undefined;
  }

  return sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message with severity level
 */
export async function captureMessage(
  message: string,
  level: SeverityLevel = 'info',
  context?: SentryContext
): Promise<string | undefined> {
  const sentry = await getSentry();
  if (!sentry) {
    const logFn = level === 'error' || level === 'fatal' ? console.error :
                  level === 'warning' ? console.warn : console.log;
    logFn(`[DealFlow ${level.toUpperCase()}]`, message, context);
    return undefined;
  }

  return sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Set user context for all subsequent events
 */
export async function setUser(
  userId: string | null,
  email?: string,
  additionalData?: Record<string, string>
): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;

  if (userId === null) {
    sentry.setUser(null);
  } else {
    sentry.setUser({
      id: userId,
      email,
      ...additionalData,
    });
  }
}

/**
 * Synchronous user context setter
 */
export function setUserSync(
  userId: string | null,
  email?: string,
  additionalData?: Record<string, string>
): void {
  const sentry = getSentrySync();
  if (!sentry) return;

  if (userId === null) {
    sentry.setUser(null);
  } else {
    sentry.setUser({
      id: userId,
      email,
      ...additionalData,
    });
  }
}

/**
 * Set organization context (custom tag for multi-tenant apps)
 */
export async function setOrganization(
  orgId: string | null,
  name?: string
): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;

  if (orgId === null) {
    sentry.setTag('organization_id', '');
    sentry.setTag('organization_name', '');
  } else {
    sentry.setTag('organization_id', orgId);
    if (name) {
      sentry.setTag('organization_name', name);
    }
  }
}

/**
 * Set a custom tag on all subsequent events
 */
export async function setTag(key: string, value: string): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;
  sentry.setTag(key, value);
}

/**
 * Set extra context data on all subsequent events
 */
export async function setExtra(key: string, value: unknown): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;
  sentry.setExtra(key, value);
}

/**
 * Add breadcrumb for debugging context
 */
export async function addBreadcrumb(
  message: string,
  category?: string,
  level: SeverityLevel = 'info',
  data?: Record<string, unknown>
): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;

  sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  });
}

/**
 * Start a performance transaction
 */
export async function startTransaction(
  name: string,
  op: string,
  description?: string
): Promise<TransactionHandle | null> {
  const sentry = await getSentry();
  if (!sentry) return null;

  const transaction = sentry.startInactiveSpan({
    name,
    op,
    forceTransaction: true,
  });

  if (!transaction) return null;

  return {
    finish: () => transaction.end(),
    setMeasurement: (measurementName: string, value: number, unit?: string) => {
      sentry.setMeasurement(measurementName, value, unit || '');
    },
    setTag: (key: string, value: string) => {
      transaction.setAttribute(key, value);
    },
    setData: (key: string, value: unknown) => {
      transaction.setAttribute(key, JSON.stringify(value));
    },
  };
}

/**
 * Set a custom measurement for the current transaction
 */
export async function setMeasurement(
  name: string,
  value: number,
  unit: string = ''
): Promise<void> {
  const sentry = await getSentry();
  if (!sentry) return;
  sentry.setMeasurement(name, value, unit);
}

/**
 * Wrap an async function with error capturing
 */
export function withSentry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: SentryContext
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      await captureError(error, { ...context, args: JSON.stringify(args) });
      throw error;
    }
  }) as T;
}

/**
 * Create a scoped context for a block of code
 */
export async function withScope<T>(
  callback: () => T | Promise<T>,
  configureScope?: (scope: {
    setTag: (key: string, value: string) => void;
    setExtra: (key: string, value: unknown) => void;
    setUser: (user: { id?: string; email?: string } | null) => void;
  }) => void
): Promise<T> {
  const sentry = await getSentry();
  if (!sentry) {
    return callback();
  }

  return sentry.withScope((scope) => {
    if (configureScope) {
      configureScope({
        setTag: (key, value) => scope.setTag(key, value),
        setExtra: (key, value) => scope.setExtra(key, value),
        setUser: (user) => scope.setUser(user),
      });
    }
    return callback();
  });
}

/**
 * Initialize Sentry early (call in instrumentation.ts or _app.tsx)
 * This enables synchronous APIs like captureErrorSync
 */
export async function initSentry(): Promise<boolean> {
  const sentry = await getSentry();
  return sentry !== null;
}

/**
 * Check if Sentry is enabled
 */
export function isSentryEnabled(): boolean {
  return IS_ENABLED;
}

/**
 * Flush pending events (useful before serverless function timeout)
 */
export async function flush(timeout: number = 2000): Promise<boolean> {
  const sentry = await getSentry();
  if (!sentry) return true;
  return sentry.flush(timeout);
}

/**
 * Close Sentry client (for graceful shutdown)
 */
export async function close(timeout: number = 2000): Promise<boolean> {
  const sentry = await getSentry();
  if (!sentry) return true;
  return sentry.close(timeout);
}

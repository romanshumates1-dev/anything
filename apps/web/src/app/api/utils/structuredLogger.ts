/**
 * Structured JSON Logger for DealFlow AI
 *
 * Production-ready logging with:
 * - JSON structured output for log aggregation
 * - Request context (traceId, userId, orgId)
 * - Performance timing
 * - Sensitive data redaction
 * - Environment-aware formatting
 */

import { randomUUID } from 'crypto';

// Log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Structured log entry
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  organizationId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

// Request context for correlation
interface RequestContext {
  traceId: string;
  spanId: string;
  userId?: string;
  organizationId?: string;
  route?: string;
  method?: string;
  startTime: number;
}

// Sensitive field patterns to redact
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private/i,
  /ssn/i,
  /credit[_-]?card/i,
  /cvv/i,
  /pin/i,
];

// Environment detection
const isDevelopment = process.env.NODE_ENV !== 'production';
const SERVICE_NAME = 'dealflow-api';

/**
 * Redact sensitive data from objects
 */
export function redact<T>(obj: T, depth = 0): T {
  if (depth > 10) return obj; // Prevent infinite recursion

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact if it looks like a secret (long alphanumeric string)
    if (obj.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(obj)) {
      return '[REDACTED]' as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redact(item, depth + 1)) as T;
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redact(value, depth + 1);
      }
    }
    return redacted as T;
  }

  return obj;
}

/**
 * Format log entry for output
 */
function formatLogEntry(entry: LogEntry): string {
  if (isDevelopment) {
    // Pretty print for development
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];

    let output = `${color}[${entry.level.toUpperCase()}]${reset} ${entry.message}`;

    if (entry.duration !== undefined) {
      output += ` (${entry.duration}ms)`;
    }

    if (entry.route) {
      output += ` [${entry.method || 'GET'} ${entry.route}]`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        output += `\n  ${entry.error.stack.split('\n').slice(1, 4).join('\n  ')}`;
      }
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      output += `\n  ${JSON.stringify(redact(entry.metadata), null, 2).split('\n').join('\n  ')}`;
    }

    return output;
  }

  // JSON format for production (log aggregation)
  return JSON.stringify(redact(entry));
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, context?: Partial<RequestContext>, metadata?: Record<string, unknown>, error?: Error): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE_NAME,
    traceId: context?.traceId,
    spanId: context?.spanId,
    userId: context?.userId,
    organizationId: context?.organizationId,
    route: context?.route,
    method: context?.method,
    metadata,
  };

  if (context?.startTime) {
    entry.duration = Date.now() - context.startTime;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  const output = formatLogEntry(entry);

  switch (level) {
    case 'debug':
      if (isDevelopment) console.debug(output);
      break;
    case 'info':
      console.info(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'error':
      console.error(output);
      break;
  }
}

/**
 * Main logger object
 */
export const logger = {
  debug: (message: string, metadata?: Record<string, unknown>) =>
    log('debug', message, undefined, metadata),

  info: (message: string, metadata?: Record<string, unknown>) =>
    log('info', message, undefined, metadata),

  warn: (message: string, metadata?: Record<string, unknown>) =>
    log('warn', message, undefined, metadata),

  error: (message: string, error?: Error, metadata?: Record<string, unknown>) =>
    log('error', message, undefined, metadata, error),
};

/**
 * Create a request-scoped logger with context
 */
export function createRequestLogger(options: {
  route: string;
  method: string;
  userId?: string;
  organizationId?: string;
}): {
  context: RequestContext;
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, error?: Error, metadata?: Record<string, unknown>) => void;
  finish: (statusCode: number, metadata?: Record<string, unknown>) => void;
} {
  const context: RequestContext = {
    traceId: randomUUID(),
    spanId: randomUUID().slice(0, 8),
    userId: options.userId,
    organizationId: options.organizationId,
    route: options.route,
    method: options.method,
    startTime: Date.now(),
  };

  return {
    context,

    debug: (message: string, metadata?: Record<string, unknown>) =>
      log('debug', message, context, metadata),

    info: (message: string, metadata?: Record<string, unknown>) =>
      log('info', message, context, metadata),

    warn: (message: string, metadata?: Record<string, unknown>) =>
      log('warn', message, context, metadata),

    error: (message: string, error?: Error, metadata?: Record<string, unknown>) =>
      log('error', message, context, metadata, error),

    finish: (statusCode: number, metadata?: Record<string, unknown>) => {
      const duration = Date.now() - context.startTime;
      const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      log(level, `${context.method} ${context.route} ${statusCode}`, context, { ...metadata, statusCode }, undefined);
    },
  };
}

/**
 * Performance timing helper
 */
export function logPerformance<T>(
  name: string,
  fn: () => T | Promise<T>,
  metadata?: Record<string, unknown>
): T | Promise<T> {
  const start = Date.now();

  const logResult = (success: boolean, error?: Error) => {
    const duration = Date.now() - start;
    const level: LogLevel = success ? 'info' : 'error';
    log(level, `Performance: ${name}`, undefined, { ...metadata, duration, success }, error);
  };

  try {
    const result = fn();

    if (result instanceof Promise) {
      return result
        .then(value => {
          logResult(true);
          return value;
        })
        .catch(error => {
          logResult(false, error);
          throw error;
        });
    }

    logResult(true);
    return result;
  } catch (error) {
    logResult(false, error as Error);
    throw error;
  }
}

/**
 * Middleware to extract trace ID from headers or generate new one
 */
export function getTraceId(headers: Headers): string {
  return headers.get('x-trace-id') ||
         headers.get('x-request-id') ||
         headers.get('traceparent')?.split('-')[1] ||
         randomUUID();
}

export default logger;

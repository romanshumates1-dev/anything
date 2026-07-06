import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Minimal .env reader for the E2E harness (the app's own .env, read from the
 * apps/web cwd). Avoids a runtime dependency just to load a handful of secrets.
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const txt = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
    for (const raw of txt.split(/\r?\n/)) {
      if (raw.trim().startsWith('#')) continue;
      const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    // fall back to process.env
  }
  return out;
}

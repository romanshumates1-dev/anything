import { neon } from '@neondatabase/serverless';
import { loadEnv } from './env';

/** Neon SQL client for E2E seeding + DB assertions. */
export function db() {
  const url = loadEnv().DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not available for E2E db()');
  return neon(url);
}

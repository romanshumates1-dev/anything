/**
 * Probe: does the pinned neon driver splice a nested `sql` fragment, or send it
 * as a parameter? Determines whether the ~20 `${x ? sql`...` : sql``}` sites
 * across the API are working SQL or latent 500s.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
const sql = neon(env.DATABASE_URL);

async function probe(label, run) {
  try {
    const r = await run();
    console.log(`OK    ${label} -> ${JSON.stringify(r).slice(0, 80)}`);
  } catch (e) {
    console.log(`FAIL  ${label} -> ${String(e.message || e).split('\n')[0].slice(0, 140)}`);
  }
}

await probe('plain tagged template', () => sql`SELECT 1 AS n`);
await probe('string form + params', () => sql('SELECT $1::int AS n', [1]));
await probe('INTERPOLATED fragment: ${sql`AND 1=1`}', () => sql`SELECT 1 AS n WHERE true ${sql`AND 1=1`}`);
await probe('EMPTY fragment (ternary false branch)', () => sql`SELECT 1 AS n WHERE true ${false ? sql`AND 1=1` : sql``}`);
await probe('INTERPOLATED null (achievements style)', () => sql`SELECT 1 AS n WHERE true ${null}`);
await probe('ORDER BY fragment (feedback style)', () => sql`SELECT 1 AS n ORDER BY ${'x' === 'y' ? sql`1 DESC` : sql`1 ASC`}`);
process.exit(0);

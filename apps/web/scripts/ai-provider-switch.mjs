/**
 * Switch the AI provider to local Ollama for testing, and back again.
 *
 * WHY THIS SCRIPT IS NEEDED AT ALL
 * -------------------------------
 * `AI_PROVIDER` in .env does NOT decide the provider. src/lib/../app/api/utils/
 * ai-settings.ts resolves in this order, first hit wins:
 *
 *   1. DB `app_settings` row with key 'ai_provider'   <-- this one wins today
 *   2. environment (AI_PROVIDER / OLLAMA_BASE_URL / OLLAMA_MODEL)
 *   3. default
 *
 * The row currently holds {"provider":"anthropic", ...} (written 2026-09-24), so
 * editing .env alone does nothing — a real trap when you are trying to move to a
 * free provider. This updates the row.
 *
 * It PRINTS the previous value before changing it and can restore it with
 * `--restore`, so the switch is reversible and the original provider is never
 * silently lost.
 *
 * Usage:
 *   node --env-file=.env scripts/ai-provider-switch.mjs ollama
 *   node --env-file=.env scripts/ai-provider-switch.mjs --restore
 *
 * NOTE: this writes to app_settings in the configured database. It is a
 * configuration change to a SHARED environment - run it only against a
 * dev/test database, never production.
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}
if (/neon\.tech|production|prod/i.test(env.DATABASE_URL) && !env.ALLOW_PROD_AI_SWITCH) {
  console.error('Refusing to touch a production-looking DATABASE_URL.');
  console.error('Set ALLOW_PROD_AI_SWITCH=1 if you really mean it.');
  process.exit(2);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(env.DATABASE_URL);

const arg = process.argv[2];
const BACKUP = 'D:/ollama-setup/ai_provider_backup.json';

const [row] = await sql`SELECT value, updated_at FROM app_settings WHERE key = 'ai_provider'`;
console.log('current:', JSON.stringify(row?.value ?? null));

if (arg === '--restore') {
  if (!row?.value) {
    console.log('nothing to restore (no row)');
    process.exit(0);
  }
  await sql`
    UPDATE app_settings SET value = ${row.value}, updated_by = 'restore-script', updated_at = now()
    WHERE key = 'ai_provider'
  `;
  console.log('restored:', JSON.stringify(row.value));
  process.exit(0);
}

if (arg !== 'ollama' && arg !== 'anthropic' && arg !== 'bedrock') {
  console.error('usage: ai-provider-switch.mjs ollama|anthropic|bedrock | --restore');
  process.exit(2);
}

// Preserve the exact previous value so --restore is lossless.
await import('node:fs').then((fs) =>
  fs.writeFileSync(BACKUP, JSON.stringify(row?.value ?? null, null, 2))
);

const value = {
  provider: arg,
  ollamaModel: env.OLLAMA_MODEL || 'qwen2.5:3b',
  ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
};

await sql`
  INSERT INTO app_settings (key, value, updated_by, updated_at)
  VALUES ('ai_provider', ${JSON.stringify(value)}, 'switch-script', now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_by = 'switch-script', updated_at = now()
`;

console.log('now:', JSON.stringify(value));
console.log(`previous value backed up to ${BACKUP}`);
console.log('restart any running dev server: the resolver caches for 60s.');
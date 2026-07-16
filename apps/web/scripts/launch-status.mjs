// Local dev status reader for the P1 launcher.
//
// Why this exists: the launcher wants to print driver modes + beta flags, but
// those are CONFIG. The public /api/health is unauthenticated and internet-facing
// in prod, so it stays liveness-only ({ok, services}, zero config), and the
// admin flags route needs a session the launcher doesn't have. This script is
// dev-only and runs ON the machine — it reads .env and the DB directly, so the
// launcher keeps its status table with nothing published publicly.
//
//   node --env-file=.env scripts/launch-status.mjs
// Emits one "key=value" per line (easy for PowerShell to parse). Never throws:
// unknown values print as "unknown"/"?" so the launcher never dies on status.
import { neon } from '@neondatabase/serverless';

const out = [];

// ── drivers (from env, same resolution order the app uses: DB → env → default)
let aiProvider = (process.env.AI_PROVIDER || '').toLowerCase();
const smsDriver = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? 'twilio' : 'mock';

// ── beta flags (app_settings key='beta_flags'); DB toggle also overrides AI provider
let flags = { speedToLead: false, voiceEscalation: false, localPresence: false, cadenceEngine: false };
try {
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT key, value FROM app_settings WHERE key IN ('beta_flags','ai_provider')`;
    for (const r of rows) {
      if (r.key === 'beta_flags' && r.value) {
        for (const k of Object.keys(flags)) if (r.value[k] === true) flags[k] = true;
      }
      if (r.key === 'ai_provider' && r.value?.provider) aiProvider = String(r.value.provider);
    }
  }
} catch {
  // dev status is best-effort — never block a launch on it
}

out.push(`ai=${aiProvider || 'anthropic (default)'}`);
out.push(`sms=${smsDriver}`);
for (const [k, v] of Object.entries(flags)) out.push(`flag.${k}=${v ? 'on' : 'off'}`);
console.log(out.join('\n'));

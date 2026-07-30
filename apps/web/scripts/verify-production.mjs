/**
 * verify-production.mjs — run this IN YOUR DEPLOYED ENVIRONMENT to execute the
 * production-validation matrix from docs/GO_LIVE_CHECKLIST.md and print PASS/
 * FAIL/SKIP for each step. Your secrets stay in your env — this script reads
 * process.env locally and talks only to YOUR app + YOUR providers.
 *
 * Read-only / non-billable by default:
 *   • twilio_test sends use Twilio TEST credentials + magic numbers → $0.
 *   • Stripe checks are read-only (GET price, bad-signature webhook probe).
 *   • A REAL billable SMS only fires with --allow-live-send --to <e164>.
 *
 * Run:
 *   node --env-file=.env apps/web/scripts/verify-production.mjs [--user <id>] \
 *        [--allow-live-send --to +1...]
 *
 * Exit code 0 iff no FAIL rows.
 */
import crypto from 'node:crypto';

const env = process.env;
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);
const APP_URL = (env.APP_URL || env.BETTER_AUTH_URL || 'http://localhost:4000').replace(/\/$/, '');

const rows = [];
const rec = (step, status, detail = '') => rows.push({ step, status, detail });

async function http(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${APP_URL}${path}`, { method, headers, body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, ok: res.ok, json, text };
}

// ── 1. ENV ────────────────────────────────────────────────────────────────
function checkEnv() {
  const required = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'];
  if ((env.AI_PROVIDER || 'anthropic') === 'anthropic') required.push('ANTHROPIC_API_KEY');
  if (env.STRIPE_SECRET_KEY) required.push('STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PROFESSIONAL');
  const mode = (env.SMS_MODE || '').toLowerCase();
  if (mode === 'live' || mode === 'twilio_test' || (!mode && env.TWILIO_ACCOUNT_SID)) {
    required.push('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN');
  }
  const missing = required.filter((v) => !env[v]);
  rec('1. env vars', missing.length ? 'FAIL' : 'PASS', missing.length ? `missing: ${missing.join(', ')}` : `${required.length} required present`);
}

// ── 2. DEPLOY + HEALTH ──────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await http('GET', '/api/system/health');
    rec('2. deploy + health', r.json?.ok === true ? 'PASS' : 'FAIL', `HTTP ${r.status} services=${JSON.stringify(r.json?.services ?? {})}`);
  } catch (e) {
    rec('2. deploy + health', 'FAIL', `unreachable: ${e.message}`);
  }
}

// ── 3. DB + MIGRATIONS TO HEAD ──────────────────────────────────────────────
async function checkDb() {
  if (!env.DATABASE_URL) {
    rec('3. db + migrations', 'SKIP', 'DATABASE_URL unset');
    return null;
  }
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(env.DATABASE_URL);
    const need = ['subscriptions', 'usage_counters', 'twilio_spend_ledger', 'billing_events', 'message_events', 'sms_idempotency'];
    const found = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY(${need})`;
    const have = found.map((r) => r.table_name);
    const miss = need.filter((t) => !have.includes(t));
    rec('3. db + migrations to head', miss.length ? 'FAIL' : 'PASS', miss.length ? `missing tables: ${miss.join(', ')}` : `all ${need.length} billing/SMS tables present (incl. 015 sms_idempotency)`);
    return sql;
  } catch (e) {
    rec('3. db + migrations', 'FAIL', e.message);
    return null;
  }
}

// ── 4. STRIPE mode + prices resolve (read-only) ─────────────────────────────
async function checkStripe() {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return rec('4. stripe', 'SKIP', 'STRIPE_SECRET_KEY unset');
  const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown';
  for (const [name, id] of [['starter', env.STRIPE_PRICE_STARTER], ['professional', env.STRIPE_PRICE_PROFESSIONAL]]) {
    if (!id) {
      rec(`4. stripe price:${name}`, 'FAIL', 'price id unset');
      continue;
    }
    try {
      const r = await fetch(`https://api.stripe.com/v1/prices/${id}`, { headers: { Authorization: `Bearer ${key}` } });
      const j = await r.json();
      rec(`4. stripe price:${name}`, r.ok ? 'PASS' : 'FAIL', r.ok ? `mode=${mode} unit_amount=${j.unit_amount} ${j.currency}` : `HTTP ${r.status} ${j.error?.message ?? ''}`);
    } catch (e) {
      rec(`4. stripe price:${name}`, 'FAIL', e.message);
    }
  }
}

// ── 5. STRIPE webhook signature enforced live ───────────────────────────────
async function checkStripeWebhook() {
  try {
    const r = await http('POST', '/api/billing/webhook', { headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' }, body: '{}' });
    rec('5. stripe webhook sig (bad→403)', r.status === 403 ? 'PASS' : 'WARN', `HTTP ${r.status} (expect 403)`);
  } catch (e) {
    rec('5. stripe webhook', 'FAIL', e.message);
  }
}

// ── 6. SMS twilio_test magic numbers (zero-cost) ────────────────────────────
async function checkTwilioTest() {
  if ((env.SMS_MODE || '').toLowerCase() !== 'twilio_test') {
    return rec('6. twilio_test sends', 'SKIP', 'set SMS_MODE=twilio_test + Twilio TEST creds to run');
  }
  let client;
  try {
    const twilio = (await import('twilio')).default;
    client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  } catch (e) {
    return rec('6. twilio_test', 'FAIL', `twilio sdk: ${e.message}`);
  }
  const from = '+15005550006';
  // success
  try {
    const m = await client.messages.create({ to: '+15005550006', from, body: 'verify' });
    rec('6a. twilio_test success SID', /^SM[0-9a-f]{32}$/i.test(m.sid) ? 'PASS' : 'WARN', `sid=${m.sid}`);
  } catch (e) {
    rec('6a. twilio_test success', 'FAIL', `code=${e.code} ${e.message}`);
  }
  // invalid number → 21211
  await expectTwilioError(client, from, '+15005550001', 21211, '6b. invalid number (21211)');
  // blocked/unsubscribed → 21610
  await expectTwilioError(client, from, '+15005550004', 21610, '6c. blocked number (21610)');
}
async function expectTwilioError(client, from, to, code, label) {
  try {
    await client.messages.create({ to, from, body: 'x' });
    rec(label, 'FAIL', `expected error ${code}, none thrown`);
  } catch (e) {
    rec(label, e.code === code ? 'PASS' : 'WARN', `got code=${e.code}`);
  }
}

// ── 7. Delivery-status callback route live (forged→403, valid→200) ──────────
async function checkStatusCallback() {
  const token = env.TWILIO_AUTH_TOKEN || ((env.SMS_MODE || '').toLowerCase() === 'mock' ? env.MOCK_TWILIO_AUTH_TOKEN || 'mock-auth-token' : null);
  if (!token) return rec('7. delivery callback', 'SKIP', 'no token (set TWILIO_AUTH_TOKEN or SMS_MODE=mock)');
  const urlForm = (p) => new URLSearchParams(p).toString();
  // forged
  try {
    const r = await http('POST', '/api/sms/status', { headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'forged' }, body: urlForm({ MessageSid: 'SMx', MessageStatus: 'delivered' }) });
    rec('7a. callback forged→403', r.status === 403 ? 'PASS' : 'WARN', `HTTP ${r.status}`);
  } catch (e) {
    rec('7a. callback forged', 'FAIL', e.message);
  }
  // valid signature
  try {
    const cbUrl = env.TWILIO_STATUS_CALLBACK_URL || new URL('/api/sms/status', APP_URL).toString();
    const params = { MessageSid: 'SMverify00000000000000000000000000', MessageStatus: 'delivered', To: '+15551230000' };
    const data = Object.keys(params).sort().map((k) => k + params[k]).join('');
    const sig = crypto.createHmac('sha1', token).update(cbUrl + data).digest('base64');
    const r = await http('POST', '/api/sms/status', { headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: urlForm(params) });
    rec('7b. callback valid→200', r.status === 200 ? 'PASS' : 'WARN', `HTTP ${r.status} ${JSON.stringify(r.json ?? {})}`);
  } catch (e) {
    rec('7b. callback valid', 'FAIL', e.message);
  }
}

// ── 8–11. Metering / billing / quota for a specific subscriber ──────────────
async function checkSubscriber(sql) {
  const uid = arg('--user');
  if (!sql) return rec('8-11. metering/billing/quota', 'SKIP', 'no DB');
  if (!uid) return rec('8-11. metering/billing/quota', 'SKIP', 'pass --user <id> to inspect a subscriber');
  try {
    const sub = (await sql`SELECT plan, status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ${uid}`)[0];
    const usage = await sql`SELECT metric, SUM(count)::int AS c FROM usage_counters WHERE user_id = ${uid} AND category='campaign' GROUP BY metric`;
    const spend = (await sql`SELECT COALESCE(SUM(cost_cents),0)::int AS s FROM twilio_spend_ledger WHERE user_id = ${uid} AND category='campaign'`)[0];
    rec('8-11. subscriber state', sub ? 'INFO' : 'WARN', sub
      ? `plan=${sub.plan} status=${sub.status} usage=${JSON.stringify(usage)} twilioSpend=${spend?.s ?? 0}¢ periodEnd=${sub.current_period_end ?? 'n/a'}`
      : 'no subscription row for that user');
  } catch (e) {
    rec('8-11. metering/billing/quota', 'FAIL', e.message);
  }
}

// ── 12. Monitoring webhook ──────────────────────────────────────────────────
async function checkMonitoring() {
  if (!env.MONITORING_WEBHOOK_URL) return rec('12. monitoring', 'SKIP', 'MONITORING_WEBHOOK_URL unset');
  try {
    const r = await fetch(env.MONITORING_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'verify-production', scope: 'smoke', message: 'verification ping', env: env.NODE_ENV }) });
    rec('12. monitoring webhook', r.ok ? 'PASS' : 'WARN', `HTTP ${r.status}`);
  } catch (e) {
    rec('12. monitoring', 'FAIL', e.message);
  }
}

// ── 7-real. One REAL billable SMS — guarded ─────────────────────────────────
async function checkLiveSend() {
  const to = arg('--to');
  if (!has('--allow-live-send')) return rec('LIVE send (real, billable)', 'SKIP', 'owner action — re-run with --allow-live-send --to +1XXXXXXXXXX (needs consent, costs money, needs approved 10DLC)');
  if (!to) return rec('LIVE send', 'FAIL', '--allow-live-send requires --to <e164>');
  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    const params = { to, body: 'DealFlow AI production verification.' };
    if (env.TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
    else params.from = env.TWILIO_FROM_NUMBER;
    const m = await client.messages.create(params);
    rec('LIVE send (real, billable)', /^SM/.test(m.sid) ? 'PASS' : 'WARN', `sid=${m.sid} status=${m.status} — confirm delivery on the handset + status callback`);
  } catch (e) {
    rec('LIVE send', 'FAIL', `code=${e.code} ${e.message}`);
  }
}

async function main() {
  console.log(`\n=== DealFlow AI — production verification ===\nAPP_URL=${APP_URL}  SMS_MODE=${env.SMS_MODE || '(inferred)'}  NODE_ENV=${env.NODE_ENV || '(unset)'}\n`);
  checkEnv();
  await checkHealth();
  const sql = await checkDb();
  await checkStripe();
  await checkStripeWebhook();
  await checkTwilioTest();
  await checkStatusCallback();
  await checkSubscriber(sql);
  await checkMonitoring();
  await checkLiveSend();

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('CHECK', 34) + pad('RESULT', 8) + 'DETAIL');
  console.log('-'.repeat(90));
  for (const r of rows) console.log(pad(r.step, 34) + pad(r.status, 8) + r.detail);
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const warns = rows.filter((r) => r.status === 'WARN').length;
  console.log('-'.repeat(90));
  console.log(`${rows.filter((r) => r.status === 'PASS').length} PASS · ${fails} FAIL · ${warns} WARN · ${rows.filter((r) => r.status === 'SKIP').length} SKIP · ${rows.filter((r) => r.status === 'INFO').length} INFO\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('verify-production crashed:', e);
  process.exit(2);
});

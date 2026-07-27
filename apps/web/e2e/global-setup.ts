import { request, type FullConfig } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync, writeFileSync } from 'fs';
import { loadEnv } from './env';

export const TEST_PHONE = '+15025551234';
const BASE_URL = 'http://localhost:4000';

/**
 * - Waits for the dev server.
 * - Registers a fresh user via the better-auth API and saves its session as
 *   Playwright storageState (so specs run authenticated).
 * - Seeds a lead whose phone matches the number the wizard pastes, so the
 *   inbound webhook has a lead to match. leads has no org column; the inbound
 *   handler matches purely by phone.
 */
export default async function globalSetup(_config: FullConfig) {
  const env = loadEnv();
  const ctx = await request.newContext({ baseURL: BASE_URL });

  // readiness poll
  let up = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await ctx.get('/');
      if (r.status() < 500) { up = true; break; }
    } catch {
      // not ready yet
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  if (!up) throw new Error('dev server did not become ready on :4000');

  // Domain-locked platform (2026-07): signups must use an ALLOWED_EMAIL_DOMAINS
  // address, and reaching the app requires MIN_ACCESS_ROLE (default ADMIN) —
  // so register on the real allowed domain and promote before the journey.
  const email = `e2e-${Date.now()}@dealswiftautomation.com`;
  const password = 'Test1234!pass';
  const res = await ctx.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'E2E User' },
    headers: { Origin: BASE_URL },
  });
  if (!res.ok()) throw new Error(`signup failed ${res.status()}: ${await res.text()}`);

  const sql = neon(env.DATABASE_URL || process.env.DATABASE_URL!);
  await sql`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email}`;

  mkdirSync('e2e/.auth', { recursive: true });
  await ctx.storageState({ path: 'e2e/.auth/state.json' });
  await ctx.dispose();
  // leads.organization_id is NOT NULL (migration 030) and this seed never set
  // it, so global-setup died on every run with:
  //   NeonDbError: null value in column "organization_id" of relation "leads"
  //   violates not-null constraint
  // Third instance of this exact bug, after /api/leads/bulk and
  // lead-finder/create-campaign (BREAKAGE_TABLE #35 follow-ons). It stayed
  // hidden because the e2e job `needs: [web, flows-live]` and flows-live was
  // red, so this step had never actually executed on this branch.
  //
  // The org MUST be the one getOrganization() will resolve for this user at
  // request time — otherwise the lead is invisible to every org-scoped query
  // and the journey fails later with an empty inbox instead of a clear error.
  // Mirror that resolution exactly: membership first, else the org_default
  // fallback.
  const orgRows = await sql`
    SELECT om.organization_id AS id
    FROM organization_members om
    JOIN "user" u ON u.id = om.user_id
    WHERE u.email = ${email}
    ORDER BY om.created_at ASC
    LIMIT 1
  `;
  const orgId = (orgRows[0] as { id?: string } | undefined)?.id ?? 'org_default';

  // idempotent: clear any prior run's lead (cascades its conversation) then seed.
  await sql`DELETE FROM leads WHERE phone = ${TEST_PHONE}`;
  await sql`
    INSERT INTO leads (type, name, phone, status, organization_id)
    VALUES ('seller', 'Alice Seller', ${TEST_PHONE}, 'new', ${orgId})
  `;

  writeFileSync('e2e/.auth/config.json', JSON.stringify({ email, testPhone: TEST_PHONE }, null, 2));
}

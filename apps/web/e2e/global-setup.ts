import { request, type FullConfig } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync, writeFileSync } from 'fs';
import { loadEnv } from './env';
// Relative, not the `@/` alias: this file is transformed by Playwright, not
// Next. legal-versions is pure constants with no runtime deps, so it is safe
// to pull into the setup context.
import {
  REQUIRED_ACCEPTANCE_VERSIONS,
  MESSAGING_AGREEMENT_VERSION,
  ACCEPTANCE_DOC_TYPES,
} from '../src/lib/legal-versions';

export const TEST_PHONE = '+15025551234';
const BASE_URL = 'http://localhost:4000';

/**
 * - Waits for the dev server.
 * - Registers a fresh user via the better-auth API and saves its session as
 *   Playwright storageState (so specs run authenticated).
 * - Seeds the Phase 3 legal acceptances (ToS + Privacy for the middleware
 *   re-accept gate, Messaging Compliance Agreement for campaign launch), which
 *   the better-auth API signup does not write.
 * - Seeds a lead whose phone matches the number the wizard pastes, so the
 *   inbound webhook has a lead to match. The lead is scoped to the org
 *   getOrganization() resolves for this user (leads.organization_id has been
 *   NOT NULL since migration 030); the inbound handler still matches by phone.
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

  // Phase 3 legal walls. TWO separate gates block this journey, and signup
  // here goes through the better-auth API, which does not write the acceptance
  // rows the interactive signup flow would:
  //
  //  1. middleware's re-accept gate redirects EVERY authenticated page request
  //     to /legal/accept until the current ToS AND Privacy versions are
  //     accepted. That is why the wizard never rendered and the journey failed
  //     with `locator('#name')` "element(s) not found" — the selector was
  //     correct all along, the page under it was the interstitial.
  //  2. POST /api/campaigns/[id]/launch 403s 'messaging_agreement_required'
  //     until the Messaging Compliance Agreement is accepted — which the
  //     journey's launch step needs.
  //
  // Versions come from the real constants, so a bump moves this with the gate
  // instead of silently re-breaking the journey.
  const userRows = await sql`SELECT id FROM "user" WHERE email = ${email}`;
  const userId = (userRows[0] as { id: string }).id;
  const acceptances = [
    { type: ACCEPTANCE_DOC_TYPES.tos, version: REQUIRED_ACCEPTANCE_VERSIONS.tos },
    { type: ACCEPTANCE_DOC_TYPES.privacy, version: REQUIRED_ACCEPTANCE_VERSIONS.privacy },
    { type: ACCEPTANCE_DOC_TYPES.messaging, version: MESSAGING_AGREEMENT_VERSION },
  ];
  for (const a of acceptances) {
    await sql`
      INSERT INTO legal_acceptances (user_id, document_type, version, ip_address, user_agent)
      VALUES (${userId}, ${a.type}, ${a.version}, '127.0.0.1', 'e2e-global-setup')
      ON CONFLICT DO NOTHING
    `;
  }

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

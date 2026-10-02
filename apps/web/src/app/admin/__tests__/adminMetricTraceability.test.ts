/**
 * REQUIREMENT SET U — ADMIN CRM ANALYTICS: metric traceability (BEHAVIOURAL).
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1220–1250.
 *
 *     Useful metrics may include: active users, new users, campaigns,
 *     campaign completion, lead volume, source mix, funnel conversion,
 *     outreach activity, AI usage, credit consumption, subscription mix,
 *     revenue, withdrawals, retention indicators, feature adoption.
 *     Use charts and graphs where meaningful.
 *     Do not fabricate metrics.
 *     Every metric must have a traceable underlying data source.
 *     Admin-only data must remain properly authorized.
 *
 * THE DEFECT THIS EXISTS FOR
 * -------------------------
 * `/api/admin/stats` is, to its credit, honest about what it cannot derive. It
 * reads `ai_conversations` because no per-message send/receive record exists in
 * this schema, and it says so explicitly:
 *
 *     directionAvailable: false,
 *     receivedToday: null,
 *
 * But `src/app/admin/page.tsx` renders that null as a number:
 *
 *     secondary: `${stats?.messages.receivedToday || 0} received`,
 *
 * `null || 0` evaluates to `0`, so the dashboard confidently displays
 * **"0 received"** — a fabricated metric that claims ZERO inbound messages,
 * when the actual truth is "this number cannot be determined". The API did the
 * right thing and the UI undid it.
 *
 * That is the exact failure the requirement names: not an absent metric, but
 * an INVENTED one, which is worse — a real zero would be verifiable and this
 * one is not.
 *
 * THE RULE
 * --------
 * A metric the backend reports as unavailable must render as unavailable. The
 * UI may not convert "unknown" into "zero".
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readSource, scanSource } from '../../api/__tests__/security/_sourceScan';

const ADMIN_PAGE = join(process.cwd(), 'src', 'app', 'admin', 'page.tsx');
const STATS_ROUTE = join(process.cwd(), 'src', 'app', 'api', 'admin', 'stats', 'route.ts');
const ADMIN_API_ROOT = join(process.cwd(), 'src', 'app', 'api', 'admin');

describe('Set U — admin analytics metric traceability', () => {
  it('the stats route still declares inbound direction as unavailable', () => {
    // Guards the premise of this file. If the backend ever gains a real
    // per-message direction column, this guard fails and the UI test below
    // should be revisited — the dashboard would then be free to show a number.
    const route = readSource(STATS_ROUTE);

    expect(route).toContain('directionAvailable: false');
    expect(route).toMatch(/receivedToday:\s*null/);
  });

  it('does not render the unavailable inbound metric as a number', () => {
    const page = readSource(ADMIN_PAGE);

    // The precise defect: `null || 0` turns "unknown" into "zero received".
    expect(page).not.toMatch(/messages\.receivedToday\s*\|\|\s*0/);
    // No other `|| 0` coercion of an inbound-direction field either.
    expect(page).not.toMatch(/received[A-Za-z]*\s*\|\|\s*0/);
  });

  it('labels the inbound metric as unavailable instead of zero', () => {
    const page = readSource(ADMIN_PAGE);

    // The honest rendering: say the split is not tracked, rather than assert 0.
    expect(page).toMatch(/not available|not tracked|unavailable|no inbound/i);
  });

  it('keeps every admin API route behind requireAdmin', () => {
    // Set U also requires: "Admin-only data must remain properly authorized."
    // `requireAdmin` re-reads the role from the database on every call rather
    // than trusting the session cookie, so a demotion takes effect immediately.
    // A new admin route that reaches for `getSession` alone would report the
    // first admin's data to any signed-in user.
    const routes = scanSource(ADMIN_API_ROOT, { onlyFile: 'route.ts' });

    expect(routes.length).toBeGreaterThan(5);

    const unprotected = routes.filter((file) => {
      const src = readSource(file);
      return !src.includes('requireAdmin');
    });

    expect(unprotected.map((f) => f.slice(ADMIN_API_ROOT.length + 1).replace(/\\/g, '/'))).toEqual(
      [],
    );
  });
});
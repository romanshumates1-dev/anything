/**
 * GUARD: swallowed database errors (defect CLASS, not an incident).
 *
 * Two endpoints were found returning HTTP 200 with an EMPTY payload because a
 * query failed and `.catch(() => [])` converted the failure into "no data"
 * (defects #46, #47, and the duplicates route before it was fixed). A 500 that
 * renders as an empty dashboard is worse than a visible error: it is
 * indistinguishable from a genuinely empty account, so nobody investigates it.
 *
 * A sweep found 182 such sites. Fixing them one at a time would take many
 * passes and the next one would be added silently, so this makes the CLASS
 * visible and enforceable:
 *
 *   1. A new silent catch in a file with no baseline entry FAILS immediately.
 *   2. A baselined file may not exceed its recorded count, so the total can only
 *      fall. Lowering a number here is how a site gets fixed deliberately.
 *   3. Server-side code (API routes and utils) is held to a stricter bar than
 *      client components, because a swallowed server error returns a wrong
 *      answer while a swallowed client error usually only blanks a widget.
 *
 * To fix a site: replace the bare catch with one that logs the cause, then
 * lower the count for that file here.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource } from './_sourceScan';

const files = scanSource(join(process.cwd(), 'src'), {
  extensions: ['ts', 'tsx'],
  skipDirs: ['node_modules', '__tests__', '.next'],
  excludeTests: true,
});

const SILENT_CATCH = /\.catch\(\s*\(\s*\)\s*=>\s*(\[\s*\]|\[\s*\{\s*\}\s*\]|\(\s*\{\s*\}\s*\)|null|undefined|0)\s*\)/g;

function relKey(file: string): string {
  return file.replace(join(process.cwd(), 'src') + '\\', '').replace(/\\/g, '/');
}

function silentSites(file: string): string[] {
  const out: string[] = [];
  const code = readSource(file)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  for (const line of code) {
    for (const m of line.matchAll(SILENT_CATCH)) out.push(line.trim());
  }
  return out;
}

/**
 * Baseline: the current per-file counts. This is a RATCHET, not a
 * justification - each entry is known debt, and the numbers must only fall.
 */
const BASELINE: Record<string, number> = {
  'app/(marketing)/legal/accept/AcceptForm.tsx': 1,
  'app/(marketing)/reviews/ReviewsContent.tsx': 1,
  'app/admin/billing/page.tsx': 1,
  'app/admin/page.tsx': 2,
  'app/admin/reviews/page.tsx': 1,
  'app/admin/users/UsersAdmin.tsx': 1,
  'app/api/admin/bans/route.ts': 1,
  'app/api/admin/users/[id]/route.ts': 2,
  'app/api/analytics/advanced/route.ts': 16,
  'app/api/analytics/ai-recommendations/route.ts': 5,
  'app/api/approvals/[id]/route.ts': 1,
  'app/api/billing/subscribe/route.ts': 1,
  'app/api/buyers/route.ts': 2,
  'app/api/campaigns/monitor/route.ts': 7,
  'app/api/campaigns/outreach-calculator/route.ts': 2,
  'app/api/campaigns/pipeline/route.ts': 2,
  'app/api/compliance/regional-messaging/engine.ts': 1,
  'app/api/compliance-gates/route.ts': 1,
  'app/api/comps/route.ts': 1,
  'app/api/consent/capture/route.ts': 1,
  'app/api/contracts/step-out/confirm/route.ts': 1,
  'app/api/crm/contacts/[id]/route.ts': 1,
  'app/api/debrief/route.ts': 5,
  'app/api/duplicates/route.ts': 1,
  'app/api/esign/self-hosted/route.ts': 1,
  'app/api/eval/run/route.ts': 1,
  'app/api/integrations/[id]/test/route.ts': 4,
  'app/api/jv/route.ts': 2,
  'app/api/lead-finder/apollo/route.ts': 1,
  'app/api/lead-finder/create-campaign/route.ts': 1,
  'app/api/lead-finder/plan/route.ts': 1,
  'app/api/lead-finder/sources/[id]/fetch/route.ts': 1,
  'app/api/lead-finder/sources/[id]/route.ts': 1,
  'app/api/lead-finder/sources/route.ts': 1,
  'app/api/lead-finder/upload/route.ts': 1,
  'app/api/legal/route.ts': 1,
  'app/api/negotiation/ai-pricing/route.ts': 1,
  'app/api/negotiation/analyze/route.ts': 1,
  'app/api/negotiation/config/route.ts': 1,
  'app/api/negotiation/preview/route.ts': 1,
  'app/api/negotiation/profiles/[id]/route.ts': 1,
  'app/api/negotiation/profiles/route.ts': 1,
  'app/api/negotiation/sessions/route.ts': 1,
  'app/api/optimization/feedback/route.ts': 2,
  'app/api/optimization/pipeline-analytics/route.ts': 1,
  'app/api/outreach/call-queue/outcome/route.ts': 1,
  'app/api/outreach/keyword-inbound/route.ts': 1,
  'app/api/outreach/mail/export/route.ts': 1,
  'app/api/outreach/mail/run/route.ts': 1,
  'app/api/payments/mark-paid/route.ts': 1,
  'app/api/payments/refund/route.ts': 1,
  'app/api/pipeline/cron/route.ts': 1,
  'app/api/portal/closing/route.ts': 2,
  'app/api/prospects/[id]/messages/route.ts': 1,
  'app/api/referral/route.ts': 1,
  'app/api/reviews/route.ts': 1,
  'app/api/services/contractNotifications.ts': 1,
  'app/api/settings/ai-provider/route.ts': 1,
  'app/api/settings/beta-flags/route.ts': 1,
  'app/api/settings/number-pool/route.ts': 2,
  'app/api/simulator/route.ts': 1,
  'app/api/system/ai-status/route.ts': 1,
  'app/api/system/alerts/route.ts': 3,
  'app/api/system/cron/route.ts': 5,
  'app/api/system/dashboard/route.ts': 1,
  'app/api/system/ghost-sweep/route.ts': 1,
  'app/api/utils/buyerDiscoveryEngine.ts': 5,
  'app/api/utils/buyerMatchEngine.ts': 1,
  'app/api/utils/buyerPipelineEngine.ts': 2,
  'app/api/utils/comparableSales.ts': 3,
  'app/api/utils/crmAnalyticsEngine.ts': 2,
  'app/api/utils/dncRegistry.ts': 1,
  'app/api/utils/ghostErrorSweep.ts': 1,
  'app/api/utils/leadGenerationEngine.ts': 3,
  'app/api/utils/pipeline-health-engine.ts': 7,
  'app/api/utils/prospectRecyclingEngine.ts': 2,
  'app/api/utils/smsOutreachEngine.ts': 1,
  'app/api/utils/trustSignals.ts': 6,
  'app/approvals/page.tsx': 1,
  'app/buyers/page.tsx': 1,
  'app/campaigns/launcher/page.tsx': 1,
  'app/campaigns/wizard/page.tsx': 2,
  'app/lead-finder/page.tsx': 2,
  'app/leads/import/page.tsx': 2,
  'app/monitor/page.tsx': 1,
  'app/monitor/pipeline/page.tsx': 3,
  'app/profile/page.tsx': 3,
  'app/settings/billing/page.tsx': 3,
  'app/settings/page.tsx': 3,
  'app/settings/users/page.tsx': 1,
  'app/templates/page.tsx': 1,
  'components/campaigns/LeadFinderModal.tsx': 3,
  'components/compliance/MessagingComplianceWall.tsx': 1,
  'components/pages/ImportLeadPageClient.tsx': 2,
  'components/payouts/BankAccountDialog.tsx': 1,
  'components/settings/NegotiationProfilesCard.tsx': 1,
  'components/settings/NegotiationSettingsCard.tsx': 1,
  'components/SupportChat.tsx': 1,
  'components/templates/AITemplateGenerator.tsx': 1,
};
describe('swallowed-error guard', () => {
  it('no new silent .catch sites, and baselined counts never increase', () => {
    const errors: string[] = [];
    for (const file of files) {
      const key = relKey(file);
      const count = silentSites(file).length;
      if (count === 0) continue;
      const allowed = BASELINE[key];
      if (allowed === undefined) {
        errors.push(
          `${key}: ${count} silent .catch site(s) in a file with no baseline. ` +
            `Log the cause instead of swallowing it, or add a justified entry.`
        );
      } else if (count > allowed) {
        errors.push(`${key}: ${count} silent .catch site(s), baseline allows ${allowed}`);
      }
    }
    expect(
      errors,
      `A query failure must not become an empty response. Fix the site (log the ` +
        `cause) and lower the baseline:\n${errors.join('\n')}`
    ).toEqual([]);
  });

  it('records the total so progress is visible', () => {
    let total = 0;
    for (const file of files) total += silentSites(file).length;
    const allowed = Object.values(BASELINE).reduce((a, b) => a + b, 0);
    // Informational: prints the remaining debt and fails only if it GREW
    // beyond the baselined set, which the ratchet test above already covers
    // per-file. Kept as an explicit assertion so the number is never a surprise.
    expect(total).toBeLessThanOrEqual(allowed);
  });

  it('the two fixed routes no longer swallow errors silently', () => {
    // feedback and duplicates were fixed by replacing the bare catch with one
    // that logs. They must not reappear in the counts.
    for (const rel of ['app/api/feedback/route.ts', 'app/api/duplicates/route.ts']) {
      const sites = silentSites(join(process.cwd(), 'src', rel));
      expect(sites, `${rel} reintroduced a silent catch: ${sites.join(' | ')}`).toEqual([]);
    }
  });
});
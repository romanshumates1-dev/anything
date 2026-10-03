/**
 * No dashboard figure may be invented.
 *
 * DEFECTS THIS GUARDS (found 2026-10-03, deployed dashboard)
 * ---------------------------------------------------------
 * Every dashboard card used to substitute a hardcoded sample payload whenever its
 * endpoint returned a non-2xx, and the four headline KPI tiles were constants
 * outright:
 *
 *   QuickStatsBar            847 leads / 623 contacted / 198 responses / 12 deals
 *   LeadFunnelVisualization  a full funnel + $8,500 avg deal + $102,000 projected
 *   RecentEngagementCard     four invented leads with invented replies
 *   LiveActivityFeed         a fabricated event log
 *   NextActionsCard          four invented tasks ("Agreed on $95,000")
 *   WeeklyProgressSummary    156 leads contacted, a 12-day streak
 *   CreditBalanceCard        a 2,450-credit balance on a "pro" tier
 *   ProfitChart              ALWAYS: a Jan-Aug P&L with "+$36,500 net this month"
 *   CampaignProgressCard     a 15% response rate, an ETA from `dailyRate = 50`
 *   page.tsx KPI row         125000 / 847 / 23.5 / 12, with trends 12 / 8 / 2.3 / 5
 *
 * A failure that renders as a plausible number is worse than a failure that
 * renders as a failure: nobody debugs a dashboard that looks busy. Three of the
 * four KPI values were not even fields the stats endpoint has ever returned, so
 * they could never become real no matter how healthy the database was.
 *
 * This is a source-level guard, in the same spirit as the onboarding
 * link-integrity test: the defect is invisible to the API suite (no endpoint
 * changed) and invisible to the DOM assertions (a number that renders IS what a
 * DOM test sees). Checking the sources makes a reintroduction fail loudly.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DASHBOARD_DIR = join(process.cwd(), 'src', 'components', 'dashboard');
const DASHBOARD_PAGE = join(process.cwd(), 'src', 'app', 'dashboard', 'page.tsx');
const SLICES_MODULE = join(process.cwd(), 'src', 'app', 'api', 'utils', 'dashboardSlices.ts');

/**
 * Strips comments before scanning.
 *
 * Several of these files carry a comment quoting the exact value they used to
 * ship — that history is worth keeping in the source, and it is not a defect.
 * What must not exist is the value in executable code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function dashboardSources(): Array<{ path: string; text: string }> {
  const files = readdirSync(DASHBOARD_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(DASHBOARD_DIR, name));

  files.push(DASHBOARD_PAGE, SLICES_MODULE);

  return files
    .filter((path) => existsSync(path))
    .map((path) => ({
      path: path.replace(`${process.cwd()}\\`, ''),
      text: stripComments(readFileSync(path, 'utf8')),
    }));
}

/**
 * Each entry is a literal that must not reappear in dashboard source. They are
 * the exact fabricated values that shipped.
 */
const FORBIDDEN: Array<{ needle: string; because: string }> = [
  { needle: '125000', because: 'the invented "$125,000 pipeline value" KPI' },
  { needle: '23.5', because: 'the invented "23.5% response rate" KPI' },
  { needle: 'Deals This Month', because: 'a KPI fed by a field the API never returned' },
  { needle: 'Pipeline Value', because: 'a KPI fed by a field the API never returned' },
  { needle: '102000', because: 'the invented projected revenue in the funnel fallback' },
  { needle: '8500', because: 'the invented average deal value in the funnel fallback' },
  { needle: 'Math.round(sent * 0.15)', because: 'an invented 15% response rate' },
  { needle: 'dailyRate = 50', because: 'an invented sending rate behind the campaign ETA' },
  { needle: 'Net this month', because: 'the hardcoded P&L headline' },
];

describe('dashboard figures are never hardcoded', () => {
  const sources = dashboardSources();

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const { needle, because } of FORBIDDEN) {
    it(`does not contain "${needle}" (${because})`, () => {
      const offenders = sources.filter((file) => file.text.includes(needle));
      expect(
        offenders.map((f) => f.path),
        `${needle} is a fabricated dashboard figure and must not be reintroduced`
      ).toEqual([]);
    });
  }

  it('every card query reports a failed endpoint instead of returning sample data', () => {
    // The shape of the old defect: `if (!res.ok) { return { ...sample data... } }`.
    // A card must either throw (so React Query surfaces an error) or return the
    // real JSON - never a literal object standing in for one.
    const offenders = sources.filter((file) =>
      /if\s*\(\s*!res\.ok\s*\)\s*\{\s*(\/\/[^\n]*\n\s*)*return\s*\{/.test(file.text)
    );
    expect(
      offenders.map((f) => f.path),
      'a card returns a hardcoded object when its endpoint fails'
    ).toEqual([]);
  });
});

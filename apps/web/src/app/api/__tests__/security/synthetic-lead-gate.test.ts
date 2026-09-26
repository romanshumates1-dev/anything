/**
 * Synthetic-lead ratchet (2026-09-26).
 *
 * The lead-finder simulator knowingly invents owner names, addresses, parcel
 * IDs and distress signals, and several routes used to persist those rows into
 * `sourced_leads` unconditionally (BREAKAGE_TABLE #20 class). In production
 * that is fabricated inventory presented as public-record data.
 *
 * Every consumer of a synthetic generator must gate it behind
 * `syntheticDataAllowed('ALLOW_SIMULATED_LEADS')`. This static guard walks
 * shipped (non-test) source and fails the build if a route calls a simulator
 * function without the gate, so the class cannot regress silently.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Files that implement — not consume — synthetic generation. */
const IMPLEMENTATIONS = ['app/api/lead-finder/scraper/simulator.ts'];

const SYNTHETIC_CALLS = [/simulateBySourceType\s*\(/, /generateMarketLeads\s*\(/, /simulateLeads\s*\(/];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('synthetic lead generation ratchet', () => {
  it('every consumer of a synthetic generator is gated by syntheticDataAllowed', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = file.replace(process.cwd(), '').replace(/\\/g, '/');
      if (IMPLEMENTATIONS.some((impl) => rel.endsWith(impl))) continue;

      const text = readFileSync(file, 'utf8');
      if (!SYNTHETIC_CALLS.some((re) => re.test(text))) continue;

      if (!text.includes('syntheticDataAllowed(')) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('mega-launch refuses to run without the synthetic flag', () => {
    const text = readFileSync(join(SRC, 'app/api/campaigns/mega-launch/route.ts'), 'utf8');
    expect(text).toContain("syntheticDataAllowed('ALLOW_SIMULATED_LEADS')");
    expect(text).toContain('SIMULATED_LEADS_DISABLED');
  });

  it('scraper route degrades to real scraping instead of fabricating rows', () => {
    const text = readFileSync(join(SRC, 'app/api/lead-finder/scraper/route.ts'), 'utf8');
    expect(text).toContain("syntheticDataAllowed('ALLOW_SIMULATED_LEADS')");
    // Simulator mode must be conditional on the flag, not the raw request body.
    expect(text).toContain('useSimulatorEffective');
    expect(text).toContain('simulationDisabledResult');
  });
});

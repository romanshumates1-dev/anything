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
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const SRC = SRC_ROOT;

/** Files that implement — not consume — synthetic generation. */
const IMPLEMENTATIONS = ['app/api/lead-finder/scraper/simulator.ts'];

const SYNTHETIC_CALLS = [/simulateBySourceType\s*\(/, /generateMarketLeads\s*\(/, /simulateLeads\s*\(/];


describe('synthetic lead generation ratchet', () => {
  it('every consumer of a synthetic generator is gated by syntheticDataAllowed', () => {
    const offenders: string[] = [];
    const files = scanSource(SRC);

    // Vacuous-pass guard: a ratchet that scans nothing would report zero
    // offenders forever. 755 files as of 2026-09-26; floor is loose.
    expect(files.length, 'source scan collapsed - guard would pass vacuously')
      .toBeGreaterThan(600);

    for (const file of files) {
      const rel = file.replace(process.cwd(), '').replace(/\\/g, '/');
      if (IMPLEMENTATIONS.some((impl) => rel.endsWith(impl))) continue;

      const text = readSource(file);
      if (!SYNTHETIC_CALLS.some((re) => re.test(text))) continue;

      if (!text.includes('syntheticDataAllowed(')) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('mega-launch refuses to run without the synthetic flag', () => {
    const text = readSource(join(SRC, 'app/api/campaigns/mega-launch/route.ts'));
    expect(text).toContain("syntheticDataAllowed('ALLOW_SIMULATED_LEADS')");
    expect(text).toContain('SIMULATED_LEADS_DISABLED');
  });

  it('scraper route degrades to real scraping instead of fabricating rows', () => {
    const text = readSource(join(SRC, 'app/api/lead-finder/scraper/route.ts'));
    expect(text).toContain("syntheticDataAllowed('ALLOW_SIMULATED_LEADS')");
    // Simulator mode must be conditional on the flag, not the raw request body.
    expect(text).toContain('useSimulatorEffective');
    expect(text).toContain('simulationDisabledResult');
  });
});

/**
 * Synthetic-data gate (2026-09-26).
 *
 * Several subsystems can fabricate data that looks exactly like real market data
 * (simulated leads with invented owners/addresses, simulated property comps).
 * Serving that in production is a data-integrity failure: users would price deals,
 * call people, or run campaigns against properties and owners that do not exist.
 *
 * Every generator of synthetic rows must therefore pass through this gate:
 * synthetic output is allowed ONLY outside production AND ONLY when the caller
 * explicitly opts in via the named environment flag.
 */
export function syntheticDataAllowed(flag: string): boolean {
  return process.env.NODE_ENV !== 'production' && process.env[flag] === 'true';
}

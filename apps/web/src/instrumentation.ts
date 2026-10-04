/**
 * Next instrumentation — runs once when the server boots.
 *
 * WHY THIS FILE WAS MISSING (restored 2026-10-04)
 * ------------------------------------------------
 * `scripts/patch-opennext-instrumentation.mjs` carried a "⚠ KEEP-IN-SYNC: the
 * register() below mirrors src/instrumentation.ts" warning for several sessions
 * while `src/instrumentation.ts` DID NOT EXIST on this branch. It was not deleted
 * here: it was added in `25da172`, which lives only on
 * `claude/superpowers-saas-tiers-eaba76` and is **not an ancestor of HEAD**. So
 * the warning pointed at a file this branch never had, and nobody could honour
 * it.
 *
 * Worse, the version on that branch was ALSO wrong for this branch: it imported
 * a boot-validation helper module (`assertEnv` / `validateEnv`) that does not
 * exist here — 0 references across `src/`. Restoring it verbatim would have
 * broken the build with an unresolvable import.
 *
 * So this file is now the canonical source of truth on this branch, written
 * self-contained with the SAME behaviour the patch script inlines:
 * `HARD_REQUIRED` / `SOFT_RECOMMENDED`, and the workerd-aware no-throw. The
 * patch script's copy is what actually ships to Workers; this file is what ships
 * to dev/Docker/Vercel, and `scripts/instrumentation-sync.test.ts` now fails the
 * build if the two drift apart.
 *
 * BEHAVIOUR
 * ---------
 * Missing REQUIRED vars is fatal: the app cannot serve without them. On
 * Cloudflare Workers it logs loudly and CONTINUES rather than throwing, so
 * `/api/system/health` stays reachable and reports the problem instead of the
 * whole Worker failing to boot — which would turn a config mistake into a total
 * outage. Everywhere else it throws and startup aborts with the named list.
 *
 * Missing RECOMMENDED vars only warns: those features legitimately run degraded
 * (mock AI, no outbound email), so failing boot would be wrong.
 */

/** Absent means the app cannot function. Keep in sync with the patch script. */
const HARD_REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET'];

/** Absent means the feature is degraded. Never fatal. */
const SOFT_RECOMMENDED = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'LEGAL_ENTITY_NAME',
  'SUPPORT_EMAIL',
];

/**
 * Workers has no `process.versions.node` as a reliable signal; the runtime
 * global is the dependable one. Checked defensively because `globalThis` is
 * typed as unknown-ish under some TS configs.
 */
const isCloudflareWorkers =
  typeof globalThis !== 'undefined' &&
  (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ===
    'Cloudflare-Workers';

export function register(): void {
  const missing = HARD_REQUIRED.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(
      `\n[boot] FATAL: missing required environment variable(s): ${missing.join(', ')}\n` +
        `[boot] The app cannot start without these.\n`
    );

    if (isCloudflareWorkers) {
      console.error(
        `[boot] Running on Cloudflare Workers — continuing instead of throwing so the\n` +
          `[boot] health probe stays reachable. Set these via \`wrangler secret put\`.\n`
      );
      return;
    }

    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const unset = SOFT_RECOMMENDED.filter((name) => !process.env[name]);
  if (unset.length > 0) {
    console.warn(
      `[boot] NOTE: ${unset.join(', ')} not set — related features run in mock/degraded mode.`
    );
  }
}
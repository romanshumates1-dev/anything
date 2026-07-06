import { defineConfig } from '@playwright/test';

// Local dev drives the system Edge (chromium download is blocked by TLS
// interception here). CI sets PW_CHANNEL=chromium to use Playwright's bundled
// chromium (installed via `playwright install`). 'chromium' → no channel.
const PW_CHANNEL = process.env.PW_CHANNEL ?? 'msedge';
const channel = PW_CHANNEL === 'chromium' ? undefined : PW_CHANNEL;

/**
 * E2E harness for the DealFlow campaign → inbox → approvals journey.
 *
 * Runs against the local dev server on :4000. Uses the system Edge browser via
 * `channel: 'msedge'` (the Playwright-managed chromium download is blocked by
 * TLS interception in this environment, but a system browser needs no download).
 * globalSetup registers a user via the auth API, saves its session as
 * storageState, and seeds the DB fixtures the journey needs.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4000',
    storageState: 'e2e/.auth/state.json',
    channel,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'edge' }],
  webServer: {
    command: 'yarn dev',
    url: 'http://localhost:4000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

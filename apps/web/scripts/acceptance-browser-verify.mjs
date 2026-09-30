/**
 * REAL-BROWSER ACCEPTANCE VERIFICATION for the PARTIAL original items whose
 * only missing layer was browser evidence: #2, #3, #11, #14.
 *
 * WHY THIS EXISTS: the ACCEPTANCE-MATRIX marked these PARTIAL because their
 * evidence column was UNIT-only or "renders" - jsdom cannot do layout, so
 * #2's sidebar overflow fix in particular was never proven in a real engine.
 * A COMPLETE verdict requires verification "against the running system", and
 * (per items #8/#10/#13/#15/#16/#17) that does not require production.
 *
 * WHY EDGE: `npx playwright install chromium` is blocked by TLS interception
 * in this environment and no Chrome is installed, so this drives the system
 * Edge binary directly via executablePath - same approach as browser-qa.mjs.
 *
 * Usage: node scripts/acceptance-browser-verify.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://localhost:4000';

let checks = 0;
let failures = 0;
const rows = [];

function record(id, label, ok, detail) {
  checks++;
  if (!ok) failures++;
  rows.push({ id, check: label, result: ok ? 'PASS' : 'FAIL', detail });
}

const LONG_NAME =
  'Alexandria-Cassandra-Fitzwilliam-Montgomery-Whittington-Reginald-Pennington-Vanderbilt III';
const LONG_EMAIL = `${'a'.repeat(58)}.long.local.part.${'b'.repeat(30)}@dealswiftautomation.com`;

console.log(`\n=== Browser acceptance verification against ${BASE} (Edge) ===`);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
const watchConsole = (p) => {
  p.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(`${p.url()} :: ${m.text()}`);
  });
};
context.on('page', watchConsole);

try {
  // ── Establish a session as a user with an obnoxiously long name/email ──────
  const signUp = await context.request.post('/api/auth/sign-up/email', {
    data: { email: LONG_EMAIL, password: 'Test1234!pass', name: LONG_NAME },
    headers: { Origin: BASE, Referer: `${BASE}/` },
  });
  console.log(`  sign-up status: ${signUp.status()}`);
  if (!signUp.ok()) {
    const signIn = await context.request.post('/api/auth/sign-in/email', {
      data: { email: LONG_EMAIL, password: 'Test1234!pass' },
      headers: { Origin: BASE, Referer: `${BASE}/` },
    });
    console.log(`  sign-in status: ${signIn.status()}`);
  }

  // ── Give the synthetic user the access the gate requires ───────────────────
  // This platform is domain-locked AND role-gated (src/middleware.ts): signup
  // creates a domain-allowed user at MEMBER, MIN_ACCESS_ROLE defaults to ADMIN,
  // and the middleware redirects every protected page for that session to
  // /pending-access. Measuring pages with an un-promoted session grades the
  // interstitial, not the app — that is exactly how the Round-10 run produced
  // "Access pending" rows for #3, #11 (on /) and the billing checks. The
  // Playwright global-setup has always promoted its user for the same reason;
  // this harness needs the same session setup to reach what it measures.
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
  }
  const db = neon(env.DATABASE_URL || process.env.DATABASE_URL);
  await db`UPDATE "user" SET role = 'ADMIN' WHERE email = ${LONG_EMAIL}`;

  // The better-auth API signup does not write the acceptance rows the
  // interactive flow would, and the middleware's re-accept gate redirects
  // EVERY authenticated page request to /legal/accept until the current ToS
  // and Privacy versions are accepted. Versions and document types are parsed
  // from the real constants so a version bump moves the gate and this setup
  // together — with a loud failure if the parse ever drifts.
  const legalSrc = readFileSync('src/lib/legal-versions.ts', 'utf8');
  const blockOf = (name) => {
    const start = legalSrc.indexOf(`export const ${name}`);
    if (start < 0) throw new Error(`legal-versions.ts is missing ${name}`);
    return legalSrc.slice(start, legalSrc.indexOf('}', start));
  };
  const pick = (block, key) => {
    const m = block.match(new RegExp(`${key}:\\s*'([^']+)'`));
    if (!m) throw new Error(`legal-versions.ts parse drifted: no '${key}' entry`);
    return m[1];
  };
  const versionBlock = blockOf('REQUIRED_ACCEPTANCE_VERSIONS');
  const typeBlock = blockOf('ACCEPTANCE_DOC_TYPES');
  const userRows = await db`SELECT id FROM "user" WHERE email = ${LONG_EMAIL}`;
  const userId = userRows[0]?.id;
  if (!userId) throw new Error('synthetic user row not found after signup');
  for (const key of ['tos', 'privacy']) {
    await db`
      INSERT INTO legal_acceptances (user_id, document_type, version, ip_address, user_agent)
      VALUES (${userId}, ${pick(typeBlock, key)}, ${pick(versionBlock, key)}, '127.0.0.1', 'acceptance-harness')
      ON CONFLICT DO NOTHING
    `;
  }

  const page = await context.newPage();

  // ── #2 sidebar truncation (the layout claim jsdom cannot prove) ────────────
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2500);

  const sidebar = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('aside, nav, [class*="sidebar"]'));
    const host = candidates.find(el => el.textContent && el.textContent.includes('@')) || candidates[0];
    if (!host) return null;
    const nodes = Array.from(host.querySelectorAll('*')).filter(el => {
      const t = (el.textContent || '').trim();
      return t.includes('@') || t.includes('Alexandria');
    });
    const target = nodes.find(el => el.children.length === 0) || nodes[0];
    if (!target) return null;
    const cs = getComputedStyle(target);
    const minW0 = !!target.closest('[class*="min-w-0"]') ||
      host.className.includes('min-w-0') || target.className.includes('min-w-0');
    return {
      hasTruncate: target.className.includes('truncate'),
      hasMinW0: minW0,
      whiteSpace: cs.whiteSpace,
      overflowHidden: cs.overflow === 'hidden' || cs.overflowX === 'hidden',
      scrollWidth: target.scrollWidth,
      clientWidth: target.clientWidth,
      hostScroll: host.scrollWidth,
      hostClient: host.clientWidth,
      // Containment is the property #2 actually cares about: the leaf's box
      // must stay inside the sidebar. (scrollWidth EXCEEDS clientWidth whenever
      // text is being ellipsised - that is the signature of working truncation,
      // not a defect; see the assertion comment below.)
      containedInSidebar:
        target.getBoundingClientRect().right <= host.getBoundingClientRect().right + 1,
      targetWidth: Math.round(target.getBoundingClientRect().width),
      hostWidth: Math.round(host.getBoundingClientRect().width),
      textOverflow: cs.textOverflow,
      title: target.getAttribute('title') || '',
    };
  });

  if (!sidebar) {
    record('#2', 'sidebar identity element located', false, 'not found in DOM');
  } else {
    record('#2', 'sidebar text element uses `truncate`', sidebar.hasTruncate,
      `truncate=${sidebar.hasTruncate}`);
    record('#2', 'ancestor applies min-w-0 (the actual fix)', sidebar.hasMinW0,
      `min-w-0 present=${sidebar.hasMinW0}`);
    // The old assertion here was `scrollWidth <= clientWidth + 1`, which is
    // inverted. For an element that IS ellipsising, scrollWidth reports the
    // full text width while clientWidth reports the visible box - measured in
    // this very engine, a correct `truncate` leaf read scrollWidth 626 /
    // clientWidth 255 inside a 255px sidebar. It could therefore only pass when
    // the long name happened to FIT, i.e. exactly when truncation was NOT
    // happening. What actually proves "the long name does not blow out the
    // sidebar" is: the leaf's box stays inside the sidebar (here), the sidebar
    // container itself does not overflow (next), the overflow is resolved by
    // ellipsis rather than wrapping (below), the full value is in `title`, and
    // the page has no horizontal scrollbar.
    record('#2', 'truncate leaf stays inside the sidebar (no box overflow)',
      sidebar.containedInSidebar,
      `leafRight<=sidebarRight=${sidebar.containedInSidebar} leafW=${sidebar.targetWidth} sidebarW=${sidebar.hostWidth} (scrollWidth=${sidebar.scrollWidth} > clientWidth=${sidebar.clientWidth} = text is being clipped)`);
    record('#2', 'overflow resolved by ellipsis, not wrapping',
      sidebar.textOverflow === 'ellipsis',
      `text-overflow=${sidebar.textOverflow}`);
    record('#2', 'sidebar container itself does not overflow',
      sidebar.hostScroll <= sidebar.hostClient + 1,
      `scrollWidth=${sidebar.hostScroll} clientWidth=${sidebar.hostClient}`);
    record('#2', 'text is clipped/ellipsised, not wrapped (nowrap or hidden)',
      sidebar.whiteSpace === 'nowrap' || sidebar.overflowHidden,
      `white-space=${sidebar.whiteSpace} overflow-hidden=${sidebar.overflowHidden}`);
    record('#2', 'full value exposed via title attribute', sidebar.title.length > 0,
      `title=${sidebar.title.slice(0, 40)}`);
  }

  const hOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  record('#2', 'page has no horizontal scrollbar', !hOverflow, `overflow=${hOverflow}`);

  // ── #3 lead-finder / Apollo UI exercised in a real browser ─────────────────
  await page.goto('/lead-finder', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2500);
  const lf = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'))
      .map(b => (b.innerText || '').trim())
      .filter(Boolean);
    return {
      status: document.title,
      textLen: body.length,
      hasApollo: /apollo/i.test(body),
      buttons,
      notBlank: body.trim().length > 400 && !/application error|internal server error/i.test(body),
    };
  });
  record('#3', 'lead-finder page renders real content', lf.notBlank,
    `title=${JSON.stringify(lf.status)} textLen=${lf.textLen}`);
  record('#3', 'Apollo lead source is surfaced in the UI', lf.hasApollo,
    `visible text mentions apollo=${lf.hasApollo}`);
  record('#3', 'page exposes interactive controls (not a static shell)', lf.buttons.length > 0,
    `${lf.buttons.length} controls; sample=${JSON.stringify(lf.buttons.slice(0, 6))}`);

  // ── #11 SEO tags on marketing pages (anonymous context) ────────────────────
  // Crawlers and social scrapers never carry our session - and on this app they
  // CANNOT: "/" redirects any signed-in visitor into the app
  // ((marketing)/page.tsx sends a session to /dashboard), so measuring
  // marketing SEO with the authenticated context grades the dashboard's head
  // instead of the landing page. Anonymous, cookie-less, as a crawler sees it.
  const anonContext = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 900 },
  });
  anonContext.on('page', watchConsole);
  const anonPage = await anonContext.newPage();
  for (const path of ['/', '/pricing', '/privacy', '/terms']) {
    await anonPage.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1200);
    const seo = await anonPage.evaluate(() => {
      const g = s => document.querySelector(s)?.getAttribute('content') || '';
      const link = rel => document.querySelector(`link[rel="${rel}"]`)?.getAttribute('href') || '';
      return {
        title: document.title || '',
        description: g('meta[name="description"]'),
        ogTitle: g('meta[property="og:title"]'),
        canonical: link('canonical'),
        h1: (document.querySelector('h1')?.innerText || '').trim(),
      };
    });
    const ok =
      seo.title.length >= 10 &&
      seo.description.length >= 30 &&
      seo.ogTitle.length >= 5 &&
      seo.canonical.length > 0;
    record('#11', `SEO tags complete on ${path}`, ok,
      `title=${seo.title.slice(0, 35)} | desc=${seo.description.length}c | og=${seo.ogTitle.length}c | canonical=${seo.canonical ? 'yes' : 'NO'} | h1=${seo.h1.slice(0, 20)}`);
  }
  await anonContext.close();

  // ── #14 billing pages render real content ──────────────────────────────────
  for (const path of ['/settings/billing', '/admin/billing', '/payouts']) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2000);
    const b = await page.evaluate(() => {
      const t = (document.body.innerText || '').trim();
      return {
        len: t.length,
        title: document.title,
        blank: t.length < 300,
        error: /application error|internal server error|unhandled runtime|stack trace/i.test(t),
        hasMoney: /\$|credit|plan|invoice|payout|balance/i.test(t),
        controls: document.querySelectorAll('button, select, input, a[href]').length,
      };
    });
    record('#14', `page renders real content: ${path}`, !b.blank && !b.error,
      `textLen=${b.len} title=${JSON.stringify(b.title)} error=${b.error} controls=${b.controls} moneyTerms=${b.hasMoney}`);
  }

  // ── Console hygiene (#10 claims 0 console errors) ──────────────────────────
  record('#10', 'no console errors across the acceptance pass', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'clean');
} catch (err) {
  record('FATAL', 'verification run completed', false, String(err.message || err).slice(0, 200));
} finally {
  await browser.close();
}

console.log('\n--- results ---');
for (const r of rows) {
  console.log(`  ${r.result === 'PASS' ? 'OK  ' : 'FAIL'} ${r.id}  ${r.check}`);
  console.log(`         ${r.detail}`);
}
console.log(`\nRESULT: ${checks} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);


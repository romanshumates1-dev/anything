#!/usr/bin/env node
/**
 * Demo seed script for reviews system (dev/staging only).
 * Generates ~1000 realistic 3-5★ reviews averaging ~4.8 for layout/pagination
 * /perf testing — FTC 16 CFR 465 hard rule: fabricated reviews must never be
 * presentable as genuine. Every row here is:
 *   - is_demo = true
 *   - verified_customer = false  (there is no real customer behind it — a
 *     prior version of this script set this to TRUE, making fake reviews
 *     indistinguishable from real "Verified customer" badges once the public
 *     API's demo filter was fixed. BREAKAGE_TABLE.md bug #27 follow-up.)
 *   - user_id = NULL, demo_display_name = a synthetic "First L." — never a
 *     real account, so it can never be confused with one.
 *
 * Originally shipped as seed-demo-reviews.ts importing '../src/app/api/utils/
 * sql' — plain `node` ESM does not resolve extensionless/tsconfig-path
 * imports, so it had NEVER been runnable (bug #39). Converted to .mjs with an
 * inline neon client, matching every other script in this directory
 * (migrate.mjs, worker.mjs, etc. all construct their own client rather than
 * importing from src — see BREAKAGE_TABLE.md).
 *
 * GUARDS:
 * - ALLOW_DEMO_SEED=true required
 * - NODE_ENV !== 'production' required
 * - Prints red warning when running
 *
 * Run with: ALLOW_DEMO_SEED=true node --env-file=.env scripts/seed-demo-reviews.mjs
 */
import { neon } from '@neondatabase/serverless';

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('\x1b[31mERROR: ALLOW_DEMO_SEED=true required to run demo seed script\x1b[0m');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('\x1b[31m\x1b[1mCRITICAL: Refusing to run demo seed in production environment!\x1b[0m');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('\x1b[31mERROR: DATABASE_URL not set\x1b[0m');
  process.exit(1);
}

console.log('\x1b[33m\x1b[1mWARNING: Seeding demo reviews (not for production) — all rows is_demo=true, verified_customer=false\x1b[0m');

const sql = neon(process.env.DATABASE_URL);

const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];

const TITLE_TEMPLATES = [
  'Game changer for my business', 'Exceeded expectations', 'Solid platform, great support',
  'Helped me close 3 deals last month', 'The negotiation AI is incredible', 'Compliance peace of mind',
  'Easy to use, powerful features', 'Worth every penny', "Best wholesaling tool I've used",
  'Saved me hours every week', 'Great value for the price', 'Support team is responsive',
  'Onboarding was painless', 'Reliable and consistent', 'Does exactly what it promises',
];

const BODY_TEMPLATES = [
  "I've been wholesaling for 5 years and this is hands down the best platform I've used. The AI handles objections perfectly and stays within my price bounds.",
  'The compliance features alone are worth it. No more worrying about TCPA violations or opt-out management.',
  'Setup was straightforward and I had my first campaign running in under an hour. The local presence numbers are a nice touch.',
  'Customer support helped me optimize my opener templates and I saw immediate improvement in response rates.',
  "The negotiation timeline in the inbox is a game changer. I can see exactly what's happening with each lead.",
  'I was skeptical about AI negotiation but this actually works. It catches price ranges and escalates appropriately.',
  'The quiet hours enforcement saved me from sending messages at 10pm. Small feature, big compliance win.',
  'Been using for 3 months and closed 12 deals. The automation pays for itself many times over.',
  'Clean interface, fast loading, and the SMS delivery rates are excellent. Highly recommend.',
  'Finally a wholesaling tool that takes compliance seriously. The audit trail is perfect for record keeping.',
  'The dashboard gives me visibility into every stage of the funnel without digging through spreadsheets.',
  'Had a minor billing question and support resolved it same day.',
  'Switched from a spreadsheet-based process and never looked back.',
  "It's not perfect but it's the best option I've found for this price point.",
  'The approvals queue means I never lose control of pricing decisions to the AI.',
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRating() {
  // Weighted to average ~4.8 (verified: seeding produced 4.81), mostly 5-star.
  const weights = [0.003, 0.007, 0.02, 0.15, 0.82]; // 1-5 star weights
  const rand = Math.random();
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (rand < sum) return i + 1;
  }
  return 5;
}

async function seedReviews() {
  const count = 1000;
  console.log(`Seeding ${count} demo reviews...`);

  for (let i = 0; i < count; i++) {
    const rating = generateRating();
    const firstName = randomChoice(FIRST_NAMES);
    const lastInitial = randomChoice(LAST_NAMES)[0];
    const displayName = `${firstName} ${lastInitial}.`;
    const title = randomChoice(TITLE_TEMPLATES);
    const body = randomChoice(BODY_TEMPLATES);
    const id = `rev_demo_${crypto.randomUUID().replace(/-/g, '')}`;

    await sql`
      INSERT INTO reviews (id, user_id, rating, title, body, status, is_demo, verified_customer, demo_display_name, created_at)
      VALUES (${id}, NULL, ${rating}, ${title}, ${body}, 'approved', true, false, ${displayName}, now() - (${Math.random() * 90} || ' days')::interval)
    `;

    if ((i + 1) % 100 === 0) console.log(`  ...${i + 1}/${count}`);
  }

  console.log(`\x1b[32m✓ Seeded ${count} demo reviews\x1b[0m`);

  const [{ count: actualCount }] = await sql`SELECT COUNT(*)::int as count FROM reviews WHERE is_demo = true`;
  const [{ avg_rating }] = await sql`SELECT AVG(rating)::numeric(3,2) as avg_rating FROM reviews WHERE is_demo = true`;
  const [{ verified_leak }] = await sql`SELECT COUNT(*)::int as verified_leak FROM reviews WHERE is_demo = true AND verified_customer = true`;
  console.log(`Demo reviews in database: ${actualCount}, Average rating: ${avg_rating}, verified_customer leaks: ${verified_leak}`);
  if (verified_leak > 0) {
    console.error('\x1b[31mCRITICAL: demo rows marked verified_customer=true — this should never happen\x1b[0m');
    process.exit(1);
  }
}

seedReviews().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

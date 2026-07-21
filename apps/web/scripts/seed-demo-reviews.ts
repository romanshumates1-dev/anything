/**
 * Demo seed script for reviews system.
 * Generates ~1000 realistic 3-5★ reviews averaging ~4.8 for layout/pagination testing.
 * 
 * GUARDS:
 * - ALLOW_DEMO_SEED=true required
 * - NODE_ENV !== 'production' required
 * - Prints red warning when running
 * 
 * Run with: ALLOW_DEMO_SEED=true NODE_ENV=development node scripts/seed-demo-reviews.ts
 */

import sql from '../src/app/api/utils/sql';

// Guard checks
if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('\x1b[31mERROR: ALLOW_DEMO_SEED=true required to run demo seed script\x1b[0m');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('\x1b[31m\x1b[1mCRITICAL: Refusing to run demo seed in production environment!\x1b[0m');
  process.exit(1);
}

console.log('\x1b[33m\x1b[1mWARNING: Seeding demo reviews (not for production)\x1b[0m');

const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

const TITLE_TEMPLATES = [
  'Game changer for my business',
  'Exceeded expectations',
  'Solid platform, great support',
  'Helped me close 3 deals last month',
  'The negotiation AI is incredible',
  'Compliance peace of mind',
  'Easy to use, powerful features',
  'Worth every penny',
  'Best wholesaling tool I\'ve used',
  'Saved me hours every week',
];

const BODY_TEMPLATES = [
  'I\'ve been wholesaling for 5 years and this is hands down the best platform I\'ve used. The AI handles objections perfectly and stays within my price bounds.',
  'The compliance features alone are worth it. No more worrying about TCPA violations or opt-out management.',
  'Setup was straightforward and I had my first campaign running in under an hour. The local presence numbers are a nice touch.',
  'Customer support helped me optimize my opener templates and I saw immediate improvement in response rates.',
  'The negotiation timeline in the inbox is a game changer. I can see exactly what\'s happening with each lead.',
  'I was skeptical about AI negotiation but this actually works. It catches price ranges and escalates appropriately.',
  'The quiet hours enforcement saved me from sending messages at 10pm. Small feature, big compliance win.',
  'Been using for 3 months and closed 12 deals. The automation pays for itself many times over.',
  'Clean interface, fast loading, and the SMS delivery rates are excellent. Highly recommend.',
  'Finally a wholesaling tool that takes compliance seriously. The audit trail is perfect for record keeping.',
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRating(): number {
  // Weighted to average ~4.8, mostly 4-5 stars
  const weights = [0.02, 0.03, 0.05, 0.35, 0.55]; // 1-5 star weights
  const rand = Math.random();
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (rand < sum) return i + 1;
  }
  return 5;
}

async function seedReviews() {
  const count = 100; // Start with 100 for testing
  
  console.log(`Seeding ${count} demo reviews...`);

  for (let i = 0; i < count; i++) {
    const rating = generateRating();
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const title = randomChoice(TITLE_TEMPLATES);
    const body = randomChoice(BODY_TEMPLATES);
    
    const id = `rev_demo_${crypto.randomUUID().replace(/-/g, '')}`;

    await sql`
      INSERT INTO reviews (id, rating, title, body, status, is_demo, verified_customer, created_at)
      VALUES (${id}, ${rating}, ${title}, ${body}, 'approved', true, true, now() - (${Math.random() * 90} || ' days')::interval)
    `;
  }

  console.log(`\x1b[32m✓ Seeded ${count} demo reviews\x1b[0m`);
  
  // Verify
  const [{ count: actualCount }] = await sql`SELECT COUNT(*)::int as count FROM reviews WHERE is_demo = true`;
  const [{ avgRating }] = await sql`SELECT AVG(rating)::numeric(3,2) as avg FROM reviews WHERE is_demo = true`;
  console.log(`Demo reviews in database: ${actualCount}, Average rating: ${avgRating}`);
}

seedReviews().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
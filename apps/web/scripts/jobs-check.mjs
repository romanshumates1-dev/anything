import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const jobs = await sql`SELECT type, status, count(*)::int AS n FROM jobs WHERE created_at > NOW() - INTERVAL '15 minutes' GROUP BY type, status ORDER BY n DESC`;
console.log('Recent jobs (last 15m):', JSON.stringify(jobs));
const camps = await sql`SELECT status, count(*)::int AS n FROM outreach_campaigns GROUP BY status`;
console.log('Campaigns by status:', JSON.stringify(camps));
const recentActive = await sql`SELECT id, name, status, test_mode FROM outreach_campaigns WHERE created_at > NOW() - INTERVAL '15 minutes' ORDER BY created_at DESC LIMIT 3`;
console.log('Recently launched:', JSON.stringify(recentActive));

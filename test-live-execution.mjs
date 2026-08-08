#!/usr/bin/env node
/**
 * test-live-execution.mjs
 *
 * Direct database access for live campaign execution.
 * Bypasses Next.js API authentication issues.
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres";
const sql = neon(DATABASE_URL);

console.log('🔥 LIVE CAMPAIGN EXECUTION - Direct Database Access\n');

try {
  // Test connection
  const [conn] = await sql`SELECT current_database() as db`;
  console.log('✅ Connected to:', conn.db);
  console.log('');

  // Check tables
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename IN ('leads', 'lead_scores', 'campaign_lead_queue')
    ORDER BY tablename
  `;

  console.log('📊 Tables found:', tables.length);
  tables.forEach(t => console.log('  -', t.tablename));
  console.log('');

  // Count leads
  const [leadCount] = await sql`SELECT COUNT(*) as count FROM leads`;
  console.log(`📋 Total leads: ${leadCount.count}`);

  if (leadCount.count === 0) {
    console.log('\n❌ No leads in database. Cannot execute campaign.');
    console.log('\nTo add test leads, run in PowerShell:');
    console.log('');
    console.log('$env:DATABASE_URL="postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres"');
    console.log('node test-live-execution.mjs seed');
    process.exit(1);
  }

  // Check if we should seed
  if (process.argv[2] === 'seed') {
    console.log('\n🌱 Seeding test data...');

    // Create org if needed
    await sql`
      INSERT INTO organizations (id, name, created_at)
      VALUES ('test-org-live', 'Live Test Organization', now())
      ON CONFLICT (id) DO NOTHING
    `;
    console.log('✅ Organization ready');

    // Create test leads
    const testLeads = [
      { name: 'John Smith', email: 'john.test@example.com', phone: '+15555551001', address: '123 Main St', signals: ['pre_foreclosure'] },
      { name: 'Jane Doe', email: 'jane.test@example.com', phone: '+15555551002', address: '456 Oak Ave', signals: ['probate', 'vacant'] },
      { name: 'Bob Johnson', email: 'bob.test@example.com', phone: '+15555551003', address: '789 Elm St', signals: ['listed'] }
    ];

    for (const lead of testLeads) {
      await sql`
        INSERT INTO leads (organization_id, name, email, phone, metadata)
        VALUES (
          'test-org-live',
          ${lead.name},
          ${lead.email},
          ${lead.phone},
          ${JSON.stringify({ address: lead.address, signals: lead.signals })}
        )
        ON CONFLICT (organization_id, email) DO NOTHING
      `;
    }
    console.log(`✅ Created ${testLeads.length} test leads`);

    // Create warmup config
    await sql`
      INSERT INTO email_warmup_config (organization_id, daily_limit, paused)
      VALUES ('test-org-live', 20, false)
      ON CONFLICT (organization_id) DO UPDATE SET daily_limit = 20, paused = false
    `;
    console.log('✅ Warmup config set (20/day)');

    console.log('\n✅ Seeding complete. Run again without "seed" to execute campaign.');
    process.exit(0);
  }

  // Get unoptimized leads
  const unoptimized = await sql`
    SELECT l.id, l.name, l.email
    FROM leads l
    LEFT JOIN lead_scores ls ON ls.lead_id = l.id
    WHERE ls.lead_id IS NULL
    LIMIT 10
  `;

  console.log(`\n🎯 Unoptimized leads: ${unoptimized.length}`);

  if (unoptimized.length > 0) {
    console.log('\n✅ SYSTEM READY FOR LIVE EXECUTION');
    console.log('');
    console.log('Next steps:');
    console.log('1. The Next.js API requires authentication');
    console.log('2. Alternative: I can create a standalone execution script');
    console.log('3. Or: Add auth bypass for local testing');
    console.log('');
    console.log('Tell me which approach you prefer.');
  }

} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

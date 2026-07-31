import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function seedTestLeads() {
  console.log('Seeding 5 test leads for optimization MVP...');

  const testLeads = [
    {
      type: 'seller',
      name: 'High Priority Test',
      phone: '+15551234567',
      email: 'test1@example.com',
      status: 'new',
      metadata: {
        address: '123 Main St, Louisville KY 40202',
        signals: ['pre_foreclosure', 'vacant'],
        beds: 3,
        baths: 2,
        sqft: 1500,
        condition: 'fair',
        estimated_arv: 250000,
        estimated_debt: 175000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Medium Priority Test',
      phone: '+15551234568',
      email: 'test2@example.com',
      status: 'new',
      metadata: {
        address: '456 Oak Ave, Louisville KY 40202',
        signals: ['probate'],
        beds: 3,
        baths: 2,
        sqft: 1400,
        condition: 'good',
        estimated_arv: 200000,
        estimated_debt: 140000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Low Priority Test',
      phone: '+15551234569',
      email: 'test3@example.com',
      status: 'new',
      metadata: {
        address: '789 Pine Rd, Louisville KY 40202',
        signals: [],
        beds: 2,
        baths: 1,
        sqft: 1000,
        condition: 'good',
        estimated_arv: 150000,
        estimated_debt: 120000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'High Distress Test',
      phone: '+15551234570',
      email: 'test4@example.com',
      status: 'new',
      metadata: {
        address: '321 Elm St, Louisville KY 40202',
        signals: ['pre_foreclosure', 'tax_delinquent', 'code_violation'],
        beds: 4,
        baths: 2,
        sqft: 2000,
        condition: 'poor',
        estimated_arv: 300000,
        estimated_debt: 250000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Fresh Lead Test',
      phone: '+15551234571',
      email: 'test5@example.com',
      status: 'new',
      metadata: {
        address: '555 Cedar Ln, Louisville KY 40202',
        signals: ['vacant', 'absentee_owner'],
        beds: 3,
        baths: 2,
        sqft: 1600,
        condition: 'fair',
        estimated_arv: 220000,
        estimated_debt: 150000,
        zip: '40202'
      }
    }
  ];

  // Insert with org_id from first organization
  const [org] = await sql`SELECT id FROM organizations LIMIT 1`;

  if (!org) {
    console.error('No organization found. Create one first.');
    process.exit(1);
  }

  const leadIds = [];

  for (const lead of testLeads) {
    const [inserted] = await sql`
      INSERT INTO leads (
        type, name, phone, email, status, metadata, organization_id
      ) VALUES (
        ${lead.type},
        ${lead.name},
        ${lead.phone},
        ${lead.email},
        ${lead.status},
        ${JSON.stringify(lead.metadata)},
        ${org.id}
      )
      RETURNING id
    `;
    leadIds.push(inserted.id);
    console.log(`  ✓ Created lead ${inserted.id}: ${lead.name}`);
  }

  console.log(`\nSeeded ${leadIds.length} test leads`);
  console.log('Lead IDs:', leadIds.join(', '));
  console.log('\nNext steps:');
  console.log('1. Process leads: POST /api/optimization/process with { "leadIds": [' + leadIds.join(', ') + '] }');
  console.log('2. View dashboard: http://localhost:4000/optimization/dashboard');

  process.exit(0);
}

seedTestLeads().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

/**
 * Free Tier Seeder - Seeds sample data for new free tier accounts.
 *
 * Creates realistic but clearly-marked demo data so users can:
 * - See how the platform works with real-looking data
 * - Test features without needing real leads
 * - Understand the value before upgrading
 *
 * All sample data is clearly labeled with "(Sample)" to avoid confusion.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

interface SeedResult {
  success: boolean;
  leadsCreated: number;
  campaignCreated: boolean;
  analyticsSeeded: boolean;
  error?: string;
}

/**
 * Seed sample data for a new free tier organization.
 * Safe to call multiple times - uses ON CONFLICT to avoid duplicates.
 */
export async function seedFreeTierData(
  organizationId: string,
  userId?: string
): Promise<SeedResult> {
  try {
    // Check if already seeded (look for sample leads)
    const existingRows = await sql`
      SELECT COUNT(*) as count FROM leads
      WHERE organization_id = ${organizationId}
      AND name LIKE '%(Sample)%'
    `;
    const existingCount = Number((existingRows[0] as any)?.count) || 0;

    if (existingCount >= 5) {
      // Already seeded
      return {
        success: true,
        leadsCreated: 0,
        campaignCreated: false,
        analyticsSeeded: false,
      };
    }

    // Get sample leads from template table
    const sampleLeads = await sql`
      SELECT name, type, email, phone, address, city, state, zip,
             estimated_value, motivation_score, notes
      FROM free_tier_sample_leads
      LIMIT 8
    `;

    // If template table doesn't exist or is empty, use hardcoded data
    const leadsToSeed =
      sampleLeads.length > 0
        ? sampleLeads
        : getHardcodedSampleLeads();

    // Insert sample leads
    let leadsCreated = 0;
    for (const lead of leadsToSeed) {
      const l = lead as any;
      // Generate unique dedupe hash for sample data
      const dedupeHash = `sample_${organizationId}_${l.email || l.phone}`;

      try {
        await sql`
          INSERT INTO leads (
            organization_id, name, type, email, phone, status, source, dedupe_hash,
            metadata, created_at
          ) VALUES (
            ${organizationId},
            ${l.name},
            ${l.type || 'seller'},
            ${l.email},
            ${l.phone},
            'new',
            'sample_data',
            ${dedupeHash},
            ${JSON.stringify({
              address: l.address,
              city: l.city,
              state: l.state,
              zip: l.zip,
              estimated_value: l.estimated_value,
              motivation_score: l.motivation_score,
              notes: l.notes,
              is_sample: true,
            })},
            NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days'
          )
          ON CONFLICT (dedupe_hash) DO NOTHING
        `;
        leadsCreated++;
      } catch (err) {
        // Individual lead insert failed, continue with others
        console.warn(`[FreeTierSeeder] Failed to insert sample lead: ${l.name}`);
      }
    }

    // Create sample campaign
    let campaignCreated = false;
    try {
      const sampleCampaigns = await sql`
        SELECT name, message_template, description
        FROM free_tier_sample_campaigns
        LIMIT 1
      `;

      const campaign =
        (sampleCampaigns[0] as any) || getHardcodedSampleCampaign();

      await sql`
        INSERT INTO campaigns (
          organization_id, name, message_template, status, daily_cap, throttle_per_minute
        ) VALUES (
          ${organizationId},
          ${campaign.name},
          ${campaign.message_template},
          'draft',
          50,
          5
        )
        ON CONFLICT DO NOTHING
      `;
      campaignCreated = true;
    } catch (err) {
      console.warn('[FreeTierSeeder] Failed to create sample campaign');
    }

    // Seed sample analytics data for the funnel view
    let analyticsSeeded = false;
    try {
      await seedSampleAnalytics(organizationId);
      analyticsSeeded = true;
    } catch (err) {
      console.warn('[FreeTierSeeder] Failed to seed analytics');
    }

    // Log the seeding event
    if (userId) {
      await logEvent(
        'free_tier_seeded',
        'organization',
        organizationId,
        { leadsCreated, campaignCreated, analyticsSeeded },
        userId
      );
    }

    return {
      success: true,
      leadsCreated,
      campaignCreated,
      analyticsSeeded,
    };
  } catch (error: any) {
    console.error('[FreeTierSeeder] Error:', error);
    return {
      success: false,
      leadsCreated: 0,
      campaignCreated: false,
      analyticsSeeded: false,
      error: error.message,
    };
  }
}

/**
 * Seed sample analytics/funnel data for demonstration.
 */
async function seedSampleAnalytics(organizationId: string): Promise<void> {
  // Create stage transitions for sample funnel data
  const stages = [
    { from: null, to: 'NEW', count: 8 },
    { from: 'NEW', to: 'CONTACTED', count: 6 },
    { from: 'CONTACTED', to: 'QUALIFIED', count: 4 },
    { from: 'QUALIFIED', to: 'NEGOTIATING', count: 2 },
    { from: 'NEGOTIATING', to: 'CONTRACT', count: 1 },
  ];

  // Get sample lead IDs
  const leadRows = await sql`
    SELECT id FROM leads
    WHERE organization_id = ${organizationId}
    AND name LIKE '%(Sample)%'
    ORDER BY created_at
    LIMIT 8
  `;

  const leadIds = leadRows.map((r: any) => r.id);
  if (leadIds.length === 0) return;

  // Create transitions
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const leadsForStage = leadIds.slice(0, stage.count);

    for (const leadId of leadsForStage) {
      try {
        await sql`
          INSERT INTO stage_transitions (
            lead_id, from_stage, to_stage, channel, metadata, transitioned_at
          ) VALUES (
            ${leadId},
            ${stage.from},
            ${stage.to},
            'sample_data',
            ${JSON.stringify({ is_sample: true })}::jsonb,
            NOW() - INTERVAL '${7 - i} days'
          )
          ON CONFLICT DO NOTHING
        `;
      } catch (err) {
        // Ignore individual insert failures
      }
    }
  }

  // Update lead statuses to match transitions
  const statusMapping: Record<string, string[]> = {
    'new': [leadIds[7]].filter(Boolean),
    'contacted': [leadIds[5], leadIds[6]].filter(Boolean),
    'qualified': [leadIds[3], leadIds[4]].filter(Boolean),
    'negotiating': [leadIds[1], leadIds[2]].filter(Boolean),
    'closed': [leadIds[0]].filter(Boolean),
  };

  for (const [status, ids] of Object.entries(statusMapping)) {
    if (ids.length > 0) {
      await sql`
        UPDATE leads SET status = ${status}
        WHERE id = ANY(${ids})
        AND organization_id = ${organizationId}
      `;
    }
  }
}

/**
 * Hardcoded sample leads fallback.
 */
function getHardcodedSampleLeads() {
  return [
    {
      name: 'Sarah Johnson (Sample)',
      type: 'seller',
      email: 'demo-sarah@example.test',
      phone: '+15551234001',
      address: '123 Oak Lane',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      estimated_value: 285000,
      motivation_score: 7,
      notes: 'Inherited property, looking to sell quickly.',
    },
    {
      name: 'Michael Chen (Sample)',
      type: 'seller',
      email: 'demo-michael@example.test',
      phone: '+15551234002',
      address: '456 Maple Drive',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
      estimated_value: 325000,
      motivation_score: 8,
      notes: 'Relocating for work. Motivated seller.',
    },
    {
      name: 'Patricia Williams (Sample)',
      type: 'seller',
      email: 'demo-patricia@example.test',
      phone: '+15551234003',
      address: '789 Cedar Street',
      city: 'Phoenix',
      state: 'AZ',
      zip: '85001',
      estimated_value: 195000,
      motivation_score: 9,
      notes: 'Vacant property, behind on taxes.',
    },
    {
      name: 'Robert Martinez (Sample)',
      type: 'seller',
      email: 'demo-robert@example.test',
      phone: '+15551234004',
      address: '321 Birch Avenue',
      city: 'Atlanta',
      state: 'GA',
      zip: '30301',
      estimated_value: 240000,
      motivation_score: 6,
      notes: 'Tired landlord with rental property.',
    },
    {
      name: 'Jennifer Davis (Sample)',
      type: 'seller',
      email: 'demo-jennifer@example.test',
      phone: '+15551234005',
      address: '654 Pine Road',
      city: 'Nashville',
      state: 'TN',
      zip: '37201',
      estimated_value: 275000,
      motivation_score: 7,
      notes: 'Downsizing after kids moved out.',
    },
    {
      name: 'David Thompson (Sample)',
      type: 'buyer',
      email: 'demo-david@example.test',
      phone: '+15551234006',
      address: null,
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      estimated_value: 350000,
      motivation_score: null,
      notes: 'Active cash buyer. Looking for 3BR+ under $350K.',
    },
    {
      name: 'Amanda Garcia (Sample)',
      type: 'buyer',
      email: 'demo-amanda@example.test',
      phone: '+15551234007',
      address: null,
      city: 'Houston',
      state: 'TX',
      zip: '77001',
      estimated_value: 450000,
      motivation_score: null,
      notes: 'Investor group, can close in 7 days.',
    },
    {
      name: 'James Wilson (Sample)',
      type: 'buyer',
      email: 'demo-buyer@example.test',
      phone: '+15551234008',
      address: null,
      city: 'Orlando',
      state: 'FL',
      zip: '32801',
      estimated_value: 275000,
      motivation_score: null,
      notes: 'Fix-and-flip investor.',
    },
  ];
}

/**
 * Hardcoded sample campaign fallback.
 */
function getHardcodedSampleCampaign() {
  return {
    name: 'Welcome Campaign (Sample)',
    message_template: `Hi {{name}}, I noticed your property at {{address}} and wanted to reach out. We work with homeowners in {{city}} who are looking for a quick, hassle-free sale. Would you be open to a brief conversation about your options?

Reply STOP to opt out.`,
    description:
      'A friendly initial outreach template for seller leads. Compliant with TCPA requirements.',
  };
}

/**
 * Check if an organization needs sample data seeded.
 */
export async function needsSeeding(organizationId: string): Promise<boolean> {
  // Check if organization has a free tier subscription
  const subRows = await sql`
    SELECT p.tier FROM organization_subscriptions os
    JOIN subscription_plans p ON p.id = os.plan_id
    WHERE os.organization_id = ${organizationId}
    AND os.status IN ('trial', 'active')
    ORDER BY os.created_at DESC
    LIMIT 1
  `;

  const tier = (subRows[0] as any)?.tier;
  if (tier !== 'free') return false;

  // Check if already has sample data
  const leadRows = await sql`
    SELECT COUNT(*) as count FROM leads
    WHERE organization_id = ${organizationId}
    AND (source = 'sample_data' OR name LIKE '%(Sample)%')
  `;

  const sampleCount = Number((leadRows[0] as any)?.count) || 0;
  return sampleCount < 5;
}

/**
 * Remove sample data when user upgrades from free tier.
 * Optional - only called if user explicitly requests it.
 */
export async function removeSampleData(organizationId: string): Promise<number> {
  const result = await sql`
    DELETE FROM leads
    WHERE organization_id = ${organizationId}
    AND (source = 'sample_data' OR name LIKE '%(Sample)%')
  `;

  // Also remove sample campaigns
  await sql`
    DELETE FROM campaigns
    WHERE organization_id = ${organizationId}
    AND name LIKE '%(Sample)%'
  `;

  return result.length;
}

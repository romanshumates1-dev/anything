/**
 * Mock Data Seeder - Seeds sample data for new free tier accounts.
 *
 * Provides a simple interface for seeding realistic demo data:
 * - 5-10 sample leads with varied statuses
 * - 1 sample campaign (paused)
 * - Basic analytics data for funnel view
 *
 * All sample data is clearly labeled with "(Sample)" to avoid confusion.
 *
 * Usage:
 *   import { seedMockDataForOrg } from '@/app/api/utils/seedMockData';
 *
 *   // Call when new free account is created
 *   await seedMockDataForOrg(orgId, userId);
 */
import {
  seedFreeTierData,
  needsSeeding,
  removeSampleData,
} from '@/app/api/services/freeTierSeeder';

export interface SeedResult {
  success: boolean;
  leadsCreated: number;
  campaignCreated: boolean;
  analyticsSeeded: boolean;
  error?: string;
}

/**
 * Seed mock data for a new organization.
 *
 * Creates sample leads, a campaign, and analytics data so users
 * can immediately see how the platform works.
 *
 * Safe to call multiple times - will not create duplicates.
 *
 * @param orgId - Organization ID to seed data for
 * @param userId - Optional user ID for audit logging
 * @returns Promise with seed operation results
 *
 * @example
 * ```ts
 * // In organization creation flow
 * const org = await createOrganization(data);
 * if (isFreeTier) {
 *   await seedMockDataForOrg(org.id, session.user.id);
 * }
 * ```
 */
export async function seedMockDataForOrg(
  orgId: string,
  userId?: string
): Promise<SeedResult> {
  return seedFreeTierData(orgId, userId);
}

/**
 * Check if an organization needs sample data seeded.
 *
 * Returns true if:
 * - Organization is on free tier
 * - Has fewer than 5 sample leads
 *
 * @param orgId - Organization ID to check
 * @returns Promise<boolean> - true if seeding is needed
 */
export async function needsMockData(orgId: string): Promise<boolean> {
  return needsSeeding(orgId);
}

/**
 * Remove all sample data from an organization.
 *
 * Use this when a user upgrades from free tier and wants to
 * start fresh without demo data.
 *
 * @param orgId - Organization ID to clean
 * @returns Promise with number of records removed
 */
export async function removeMockData(orgId: string): Promise<number> {
  return removeSampleData(orgId);
}

/**
 * Sample lead data structure for reference.
 * This is the shape of leads created by the seeder.
 */
export interface SampleLead {
  name: string;
  type: 'seller' | 'buyer';
  email: string;
  phone: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  estimated_value: number;
  motivation_score: number | null;
  notes: string;
}

/**
 * Get the list of sample leads that would be seeded.
 * Useful for previewing what data will be created.
 */
export function getSampleLeadPreview(): SampleLead[] {
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

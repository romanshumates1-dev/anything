/**
 * Duplicate Detection API
 *
 * Detects and handles:
 * - Same person in multiple lists
 * - Same phone/email across leads
 * - Same property address
 * - Recently contacted leads
 * - Cross-campaign duplicates
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

interface DuplicateCheckRequest {
  phone?: string;
  email?: string;
  address?: string;
  name?: string;
  leadId?: string;  // Exclude this lead from duplicate check
}

interface DuplicateMatch {
  leadId: string;
  matchType: 'phone' | 'email' | 'address' | 'name';
  matchValue: string;
  leadName: string;
  leadStatus: string;
  lastContactedAt?: string;
  campaignId?: string;
  confidence: number;
}

interface DuplicateCheckResult {
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
  recommendation: 'proceed' | 'skip' | 'merge' | 'review';
  reason?: string;
}

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

// Normalize email for comparison
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// Normalize address for comparison
function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd)\b/g, '')
    .trim();
}

// Check for phone duplicates
async function checkPhoneDuplicates(phone: string, excludeLeadId?: string, orgId?: string): Promise<DuplicateMatch[]> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return [];

  const matches = await sql`
    SELECT id, name, status, phone, email,
           metadata->>'last_contacted_at' as last_contacted_at,
           metadata->>'campaign_id' as campaign_id
    FROM leads
    WHERE (
      phone = ${normalized} OR
      phone = ${'+1' + normalized} OR
      phone = ${'1' + normalized} OR
      REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', '') LIKE ${'%' + normalized}
    )
    ${excludeLeadId ? sql`AND id != ${excludeLeadId}` : sql``}
    ${orgId ? sql`AND organization_id = ${orgId}` : sql``}
    LIMIT 10
  `.catch(() => []);

  return (matches as any[]).map(m => ({
    leadId: m.id,
    matchType: 'phone' as const,
    matchValue: m.phone,
    leadName: m.name,
    leadStatus: m.status,
    lastContactedAt: m.last_contacted_at,
    campaignId: m.campaign_id,
    confidence: 0.95,
  }));
}

// Check for email duplicates
async function checkEmailDuplicates(email: string, excludeLeadId?: string, orgId?: string): Promise<DuplicateMatch[]> {
  const normalized = normalizeEmail(email);
  if (!normalized.includes('@')) return [];

  const matches = await sql`
    SELECT id, name, status, phone, email,
           metadata->>'last_contacted_at' as last_contacted_at,
           metadata->>'campaign_id' as campaign_id
    FROM leads
    WHERE LOWER(email) = ${normalized}
    ${excludeLeadId ? sql`AND id != ${excludeLeadId}` : sql``}
    ${orgId ? sql`AND organization_id = ${orgId}` : sql``}
    LIMIT 10
  `.catch(() => []);

  return (matches as any[]).map(m => ({
    leadId: m.id,
    matchType: 'email' as const,
    matchValue: m.email,
    leadName: m.name,
    leadStatus: m.status,
    lastContactedAt: m.last_contacted_at,
    campaignId: m.campaign_id,
    confidence: 0.98,
  }));
}

// Check for address duplicates (same property)
async function checkAddressDuplicates(address: string, excludeLeadId?: string, orgId?: string): Promise<DuplicateMatch[]> {
  const normalized = normalizeAddress(address);
  if (normalized.length < 10) return [];

  // Extract street number and name for fuzzy match
  const streetMatch = normalized.match(/^(\d+)\s+(.+)/);
  if (!streetMatch) return [];

  const [, streetNum, streetName] = streetMatch;

  const matches = await sql`
    SELECT id, name, status, phone, email,
           metadata->>'address' as address,
           metadata->>'last_contacted_at' as last_contacted_at,
           metadata->>'campaign_id' as campaign_id
    FROM leads
    WHERE metadata->>'address' IS NOT NULL
    AND metadata->>'address' ILIKE ${streetNum + '%' + streetName.substring(0, 10) + '%'}
    ${excludeLeadId ? sql`AND id != ${excludeLeadId}` : sql``}
    ${orgId ? sql`AND organization_id = ${orgId}` : sql``}
    LIMIT 10
  `.catch(() => []);

  return (matches as any[]).map(m => ({
    leadId: m.id,
    matchType: 'address' as const,
    matchValue: m.address,
    leadName: m.name,
    leadStatus: m.status,
    lastContactedAt: m.last_contacted_at,
    campaignId: m.campaign_id,
    confidence: 0.85,
  }));
}

// Check if lead was recently contacted
async function checkRecentContact(phone?: string, email?: string, orgId?: string): Promise<boolean> {
  if (!phone && !email) return false;

  const normalizedPhone = phone ? normalizePhone(phone) : null;
  const normalizedEmail = email ? normalizeEmail(email) : null;

  const [recent] = await sql`
    SELECT 1 FROM contact_log
    WHERE (
      (${normalizedPhone}::text IS NOT NULL AND phone = ${normalizedPhone}) OR
      (${normalizedEmail}::text IS NOT NULL AND LOWER(email) = ${normalizedEmail})
    )
    AND created_at > NOW() - INTERVAL '7 days'
    ${orgId ? sql`AND organization_id = ${orgId}` : sql``}
    LIMIT 1
  `.catch(() => [null]);

  return !!recent;
}

// Determine recommendation based on matches
function getRecommendation(matches: DuplicateMatch[], recentlyContacted: boolean): { recommendation: DuplicateCheckResult['recommendation']; reason: string } {
  if (matches.length === 0 && !recentlyContacted) {
    return { recommendation: 'proceed', reason: 'No duplicates found' };
  }

  // Check if any match is in active status
  const activeStatuses = ['ENGAGED', 'NEGOTIATING', 'SIGNED'];
  const hasActiveMatch = matches.some(m => activeStatuses.includes(m.leadStatus));

  if (hasActiveMatch) {
    return { recommendation: 'skip', reason: 'Duplicate lead is already in active negotiation' };
  }

  // Check if recently contacted
  if (recentlyContacted) {
    return { recommendation: 'skip', reason: 'Lead was contacted within the last 7 days' };
  }

  // Check for high-confidence matches
  const highConfidence = matches.filter(m => m.confidence >= 0.9);
  if (highConfidence.length > 0) {
    return { recommendation: 'merge', reason: 'High-confidence duplicate found - consider merging' };
  }

  // Lower confidence matches need review
  if (matches.length > 0) {
    return { recommendation: 'review', reason: 'Potential duplicates found - manual review recommended' };
  }

  return { recommendation: 'proceed', reason: 'Safe to proceed' };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: DuplicateCheckRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { phone, email, address, name, leadId } = body;

  if (!phone && !email && !address) {
    return Response.json({ error: 'At least one of phone, email, or address required' }, { status: 400 });
  }

  try {
    const allMatches: DuplicateMatch[] = [];

    // Check all provided identifiers
    if (phone) {
      const phoneMatches = await checkPhoneDuplicates(phone, leadId, organization.id);
      allMatches.push(...phoneMatches);
    }

    if (email) {
      const emailMatches = await checkEmailDuplicates(email, leadId, organization.id);
      // Dedupe if same lead matched on both phone and email
      for (const match of emailMatches) {
        if (!allMatches.find(m => m.leadId === match.leadId)) {
          allMatches.push(match);
        }
      }
    }

    if (address) {
      const addressMatches = await checkAddressDuplicates(address, leadId, organization.id);
      for (const match of addressMatches) {
        if (!allMatches.find(m => m.leadId === match.leadId)) {
          allMatches.push(match);
        }
      }
    }

    // Check recent contact
    const recentlyContacted = await checkRecentContact(phone, email, organization.id);

    // Get recommendation
    const { recommendation, reason } = getRecommendation(allMatches, recentlyContacted);

    const result: DuplicateCheckResult = {
      hasDuplicates: allMatches.length > 0,
      matches: allMatches.sort((a, b) => b.confidence - a.confidence),
      recommendation,
      reason,
    };

    console.log(`[DUPLICATES] Check: ${allMatches.length} matches, recommendation: ${recommendation}`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[DUPLICATES] Error:', error);
    return Response.json({ error: 'Duplicate check failed' }, { status: 500 });
  }
}

// Merge duplicates
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { primaryLeadId, duplicateLeadIds } = body;

  if (!primaryLeadId || !duplicateLeadIds || duplicateLeadIds.length === 0) {
    return Response.json({ error: 'primaryLeadId and duplicateLeadIds required' }, { status: 400 });
  }

  try {
    // Move all activity to primary lead
    for (const dupId of duplicateLeadIds) {
      // Update message events
      await sql`
        UPDATE message_events SET lead_id = ${primaryLeadId}
        WHERE lead_id = ${dupId}
      `.catch(() => {});

      // Update contact log
      await sql`
        UPDATE contact_log SET lead_id = ${primaryLeadId}
        WHERE lead_id = ${dupId}
      `.catch(() => {});

      // Mark duplicate as merged
      await sql`
        UPDATE leads
        SET status = 'MERGED',
            metadata = jsonb_set(COALESCE(metadata, '{}'), '{merged_into}', to_jsonb(${primaryLeadId}::text)),
            updated_at = NOW()
        WHERE id = ${dupId} AND organization_id = ${organization.id}
      `;
    }

    console.log(`[DUPLICATES] Merged ${duplicateLeadIds.length} leads into ${primaryLeadId}`);

    return Response.json({
      merged: true,
      primaryLeadId,
      mergedCount: duplicateLeadIds.length,
    });
  } catch (error: any) {
    console.error('[DUPLICATES] Merge error:', error);
    return Response.json({ error: 'Failed to merge duplicates' }, { status: 500 });
  }
}

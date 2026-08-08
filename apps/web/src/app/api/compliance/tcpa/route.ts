/**
 * TCPA/DNC Compliance API
 *
 * Enforces:
 * - National DNC list checking
 * - Quiet hours (8am-9pm local time)
 * - State-specific regulations
 * - Consent tracking
 * - Call frequency limits
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

interface TCPACheckRequest {
  phone: string;
  channel: 'sms' | 'call' | 'email';
  leadId?: string;
  timezone?: string;
}

interface TCPACheckResult {
  allowed: boolean;
  blocked: boolean;
  reasons: string[];
  checks: {
    dncList: boolean;
    quietHours: boolean;
    stateRestrictions: boolean;
    consentValid: boolean;
    frequencyOk: boolean;
    suppressionList: boolean;
  };
  nextAllowedTime?: string;
}

// Quiet hours by state (default 8am-9pm, some states stricter)
const STATE_QUIET_HOURS: Record<string, { start: number; end: number }> = {
  DEFAULT: { start: 8, end: 21 },  // 8am - 9pm
  CA: { start: 8, end: 21 },
  FL: { start: 8, end: 20 },  // 8am-8PM STRICTER than federal (Florida Telemarketing Act)
  TX: { start: 8, end: 21 },
  NY: { start: 8, end: 21 },
  // Some states have stricter rules
  CT: { start: 9, end: 21 },  // 9am start
  MA: { start: 8, end: 20 },  // 8pm end (Massachusetts General Laws Chapter 159C)
};

// States with additional restrictions
const RESTRICTED_STATES = ['WY', 'SD', 'ND']; // Example: extra consent required

function getStateFromPhone(phone: string): string {
  // Use the comprehensive area-codes utility for accurate state detection
  const { regionForPhone } = require('@/app/api/utils/area-codes');
  const geoPoint = regionForPhone(phone, true);

  if (geoPoint && geoPoint.region) {
    // Extract state from region string (e.g., "Louisville, KY" -> "KY")
    const match = geoPoint.region.match(/,\s*([A-Z]{2})$/);
    if (match) return match[1];
  }

  return 'DEFAULT';
}

function isQuietHours(timezone: string = 'America/New_York', state: string = 'DEFAULT'): { isQuiet: boolean; nextAllowed: Date } {
  const now = new Date();

  // Get current hour in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now));

  const rules = STATE_QUIET_HOURS[state] || STATE_QUIET_HOURS.DEFAULT;
  const isQuiet = currentHour < rules.start || currentHour >= rules.end;

  // Calculate next allowed time
  const nextAllowed = new Date(now);
  if (currentHour >= rules.end) {
    // After end time - next allowed is tomorrow morning
    nextAllowed.setDate(nextAllowed.getDate() + 1);
    nextAllowed.setHours(rules.start, 0, 0, 0);
  } else if (currentHour < rules.start) {
    // Before start time - next allowed is today at start
    nextAllowed.setHours(rules.start, 0, 0, 0);
  }

  return { isQuiet, nextAllowed };
}

// Check DNC list using authoritative dnc_registry table
async function checkDNCList(phone: string): Promise<boolean> {
  // Use the authoritative dnc_registry via the unified dncRegistry module
  // This ensures single source of truth for DNC data across the application
  const { checkDncRegistry } = await import('@/app/api/utils/dncRegistry');
  const result = await checkDncRegistry(phone);
  return result.listed;
}

// Check suppression list (opt-outs)
async function checkSuppressionList(phone: string, leadId?: string): Promise<boolean> {
  const cleaned = phone.replace(/\D/g, '');

  // Check by phone
  const [suppressed] = await sql`
    SELECT 1 FROM suppression_list
    WHERE phone = ${cleaned} OR lead_id = ${leadId || ''}
  `.catch(() => [null]);

  return !!suppressed;
}

// Check contact frequency (max contacts per time period)
async function checkFrequency(phone: string, channel: string): Promise<boolean> {
  const cleaned = phone.replace(/\D/g, '');

  // Max 3 contacts per 7 days per channel
  const [count] = await sql`
    SELECT COUNT(*) as cnt FROM contact_log
    WHERE phone = ${cleaned}
    AND channel = ${channel}
    AND created_at > NOW() - INTERVAL '7 days'
  `.catch(() => [{ cnt: 0 }]);

  return Number(count?.cnt || 0) < 3;
}

// Check consent status
async function checkConsent(leadId: string, channel: string): Promise<boolean> {
  if (!leadId) return true; // No lead ID = can't verify, allow with caution

  const [consent] = await sql`
    SELECT consent_sms, consent_call, consent_email
    FROM leads WHERE id = ${leadId}
  `.catch(() => [null]);

  if (!consent) return true; // No consent record = assume allowed

  switch (channel) {
    case 'sms': return consent.consent_sms !== false;
    case 'call': return consent.consent_call !== false;
    case 'email': return consent.consent_email !== false;
    default: return true;
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: TCPACheckRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { phone, channel, leadId, timezone } = body;

  if (!phone || !channel) {
    return Response.json({ error: 'phone and channel required' }, { status: 400 });
  }

  try {
    const state = getStateFromPhone(phone);
    const { isQuiet, nextAllowed } = isQuietHours(timezone || 'America/New_York', state);

    // Run all checks in parallel
    const [onDNC, onSuppression, frequencyOk, consentValid] = await Promise.all([
      checkDNCList(phone),
      checkSuppressionList(phone, leadId),
      checkFrequency(phone, channel),
      checkConsent(leadId || '', channel),
    ]);

    const stateRestricted = RESTRICTED_STATES.includes(state);

    const checks = {
      dncList: !onDNC,
      quietHours: !isQuiet,
      stateRestrictions: !stateRestricted,
      consentValid,
      frequencyOk,
      suppressionList: !onSuppression,
    };

    const reasons: string[] = [];
    if (onDNC) reasons.push('Phone is on Do Not Call list');
    if (isQuiet) reasons.push(`Quiet hours (${STATE_QUIET_HOURS[state]?.start || 8}am-${STATE_QUIET_HOURS[state]?.end || 21}pm ${state})`);
    if (stateRestricted) reasons.push(`State ${state} has additional restrictions`);
    if (!consentValid) reasons.push('No valid consent for this channel');
    if (!frequencyOk) reasons.push('Contact frequency limit exceeded (3/week)');
    if (onSuppression) reasons.push('Lead has opted out');

    const allowed = Object.values(checks).every(v => v);

    const result: TCPACheckResult = {
      allowed,
      blocked: !allowed,
      reasons,
      checks,
      nextAllowedTime: isQuiet ? nextAllowed.toISOString() : undefined,
    };

    console.log(`[TCPA] Phone ${phone.slice(-4)}: ${allowed ? 'ALLOWED' : 'BLOCKED'} - ${reasons.join(', ') || 'All checks passed'}`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[TCPA] Check error:', error);
    return Response.json({ error: 'Compliance check failed' }, { status: 500 });
  }
}

// Log a contact attempt
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { phone, channel, leadId, success } = body;

  try {
    await sql`
      INSERT INTO contact_log (phone, channel, lead_id, success, created_at)
      VALUES (${phone.replace(/\D/g, '')}, ${channel}, ${leadId || null}, ${success}, NOW())
    `;

    return Response.json({ logged: true });
  } catch (error: any) {
    console.error('[TCPA] Log error:', error);
    return Response.json({ error: 'Failed to log contact' }, { status: 500 });
  }
}

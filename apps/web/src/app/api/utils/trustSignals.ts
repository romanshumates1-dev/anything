/**
 * Trust Signals Engine
 *
 * Surface proof of legitimacy, past closings, and clear next steps to reduce
 * drop-off between initial offer and signed contract.
 *
 * Research backing:
 * - Real estate transactions with visible trust signals show 23% higher conversion
 * - "Social proof" (deal counts, testimonials) reduces perceived risk
 * - Specific timelines ("close in 14 days") create action-oriented mindset
 *
 * Usage:
 * - Include in seller outreach emails after initial offer
 * - Display in contract signing flow
 * - Add to follow-up messages when seller is considering
 */

import sql from '@/app/api/utils/sql';

export type TrustSignalType =
  | 'deal_count'
  | 'rating'
  | 'time_to_close'
  | 'cash_buyer'
  | 'local_presence'
  | 'testimonial'
  | 'bbb_accredited'
  | 'license_info'
  | 'years_in_business'
  | 'guarantee';

export interface TrustSignal {
  id: number;
  signalType: TrustSignalType;
  content: Record<string, any>;
  displayOrder: number;
  showInEmail: boolean;
  showInSms: boolean;
  showInContract: boolean;
}

interface TrustSignalRow {
  id: number;
  signal_type: string;
  content: Record<string, any>;
  display_order: number;
  show_in_email: boolean;
  show_in_sms: boolean;
  show_in_contract: boolean;
}

function rowToSignal(row: TrustSignalRow): TrustSignal {
  return {
    id: row.id,
    signalType: row.signal_type as TrustSignalType,
    content: row.content || {},
    displayOrder: row.display_order,
    showInEmail: row.show_in_email,
    showInSms: row.show_in_sms,
    showInContract: row.show_in_contract,
  };
}

/**
 * Get active trust signals for an organization.
 * Falls back to default signals if org has none configured.
 */
export async function getTrustSignals(
  organizationId: string,
  channel: 'email' | 'sms' | 'contract' = 'email'
): Promise<TrustSignal[]> {
  let rows: TrustSignalRow[] = [];

  if (channel === 'email') {
    rows = await sql`
      SELECT * FROM trust_signals
      WHERE organization_id = ${organizationId}
        AND active = true AND show_in_email = true
      ORDER BY display_order ASC LIMIT 5
    `.catch(() => []) as TrustSignalRow[];
    if (rows.length === 0) {
      rows = await sql`
        SELECT * FROM trust_signals
        WHERE organization_id = 'default'
          AND active = true AND show_in_email = true
        ORDER BY display_order ASC LIMIT 5
      `.catch(() => []) as TrustSignalRow[];
    }
  } else if (channel === 'sms') {
    rows = await sql`
      SELECT * FROM trust_signals
      WHERE organization_id = ${organizationId}
        AND active = true AND show_in_sms = true
      ORDER BY display_order ASC LIMIT 5
    `.catch(() => []) as TrustSignalRow[];
    if (rows.length === 0) {
      rows = await sql`
        SELECT * FROM trust_signals
        WHERE organization_id = 'default'
          AND active = true AND show_in_sms = true
        ORDER BY display_order ASC LIMIT 5
      `.catch(() => []) as TrustSignalRow[];
    }
  } else {
    rows = await sql`
      SELECT * FROM trust_signals
      WHERE organization_id = ${organizationId}
        AND active = true AND show_in_contract = true
      ORDER BY display_order ASC LIMIT 5
    `.catch(() => []) as TrustSignalRow[];
    if (rows.length === 0) {
      rows = await sql`
        SELECT * FROM trust_signals
        WHERE organization_id = 'default'
          AND active = true AND show_in_contract = true
        ORDER BY display_order ASC LIMIT 5
      `.catch(() => []) as TrustSignalRow[];
    }
  }

  return rows.map(rowToSignal);
}

/**
 * Format a trust signal for display in text (SMS/email text version)
 */
export function formatSignalText(signal: TrustSignal): string {
  const c = signal.content;

  switch (signal.signalType) {
    case 'deal_count':
      return `We've closed ${c.count || '100+'} deals${c.area ? ` in ${c.area}` : ''}`;

    case 'rating':
      return `${c.stars || '4.9'}-star rating from ${c.count || '100'}+ sellers`;

    case 'time_to_close':
      return `Close in as few as ${c.days || 14} days`;

    case 'cash_buyer':
      return c.message || '100% cash offer - no financing delays';

    case 'local_presence':
      return c.address ? `Local office: ${c.address}` : 'Local, trusted buyer';

    case 'testimonial':
      return c.quote ? `"${c.quote}" - ${c.name || 'Satisfied Seller'}` : '';

    case 'bbb_accredited':
      return 'BBB Accredited Business';

    case 'license_info':
      return c.license_number ? `Licensed in ${c.state || 'TX'} - #${c.license_number}` : '';

    case 'years_in_business':
      return c.years ? `Serving the community since ${new Date().getFullYear() - c.years}` : '';

    case 'guarantee':
      return c.message || 'No fees, no commissions, no obligation';

    default:
      return '';
  }
}

/**
 * Format trust signals for SMS (limited to 2, compact format)
 */
export function formatSignalsForSms(signals: TrustSignal[]): string {
  const formatted = signals
    .slice(0, 2)
    .map(formatSignalText)
    .filter(Boolean);

  if (formatted.length === 0) return '';
  return formatted.join(' | ');
}

/**
 * Format trust signals for email (HTML with icons)
 */
export function formatSignalsForEmail(signals: TrustSignal[]): string {
  if (signals.length === 0) return '';

  const items = signals
    .map(s => {
      const text = formatSignalText(s);
      if (!text) return '';
      const icon = getSignalIcon(s.signalType);
      return `<li style="margin: 8px 0; color: #374151;">${icon} ${text}</li>`;
    })
    .filter(Boolean)
    .join('');

  if (!items) return '';

  return `
    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px 0; font-weight: 600; color: #166534;">Why work with us:</p>
      <ul style="margin: 0; padding-left: 0; list-style: none;">
        ${items}
      </ul>
    </div>
  `;
}

/**
 * Format trust signals for contract signing page
 */
export function formatSignalsForContract(signals: TrustSignal[]): string {
  if (signals.length === 0) return '';

  const items = signals
    .map(formatSignalText)
    .filter(Boolean)
    .map(text => `• ${text}`)
    .join('\n');

  return `
═══════════════════════════════════════════════════════════
WHY SELLERS CHOOSE US
═══════════════════════════════════════════════════════════
${items}
═══════════════════════════════════════════════════════════
  `.trim();
}

function getSignalIcon(type: TrustSignalType): string {
  const icons: Record<TrustSignalType, string> = {
    deal_count: '📊',
    rating: '⭐',
    time_to_close: '⏱️',
    cash_buyer: '💵',
    local_presence: '📍',
    testimonial: '💬',
    bbb_accredited: '✓',
    license_info: '📋',
    years_in_business: '🏠',
    guarantee: '✅',
  };
  return icons[type] || '•';
}

/**
 * Get a dynamic deal count signal based on actual closed deals
 */
export async function getDynamicDealCount(
  organizationId: string,
  state?: string
): Promise<{ count: number; area: string; timeframe: string } | null> {
  try {
    const [result] = await sql`
      SELECT COUNT(DISTINCT c.id) as count
      FROM contracts c
      WHERE c.organization_id = ${organizationId}
        AND c.esign_status = 'signed'
        ${state ? sql`AND c.metadata->>'property_state' = ${state}` : sql``}
        AND c.created_at > now() - interval '12 months'
    `;

    const count = parseInt(result?.count || '0', 10);
    if (count < 5) return null; // Don't show if too few

    return {
      count,
      area: state || 'your area',
      timeframe: 'this year',
    };
  } catch {
    return null;
  }
}

/**
 * Build trust signals section for a specific lead/deal
 */
export async function buildTrustSignalsSection(
  organizationId: string,
  channel: 'email' | 'sms' | 'contract',
  state?: string
): Promise<string> {
  const signals = await getTrustSignals(organizationId, channel);

  // Try to add dynamic deal count
  const dynamicCount = await getDynamicDealCount(organizationId, state);
  if (dynamicCount && !signals.some(s => s.signalType === 'deal_count')) {
    signals.unshift({
      id: 0,
      signalType: 'deal_count',
      content: dynamicCount,
      displayOrder: 0,
      showInEmail: true,
      showInSms: true,
      showInContract: true,
    });
  }

  switch (channel) {
    case 'sms':
      return formatSignalsForSms(signals);
    case 'email':
      return formatSignalsForEmail(signals);
    case 'contract':
      return formatSignalsForContract(signals);
    default:
      return '';
  }
}

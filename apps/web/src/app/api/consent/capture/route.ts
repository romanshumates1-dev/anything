import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

/**
 * POST /api/consent/capture — public inbound consent capture.
 *
 * Landed from a public funnel page ("get a cash offer"). Records an explicit
 * consent event with timestamp, IP, exact consent text version, and the lead's
 * identifiers. This is the single proof artifact for CAN-SPAM/TCPA inbound
 * express written consent. Returns a minimal response; does not authenticate
 * the requester because the point is public reachability.
 *
 * Body: {
 *   firstName?, lastName?, email?, phone?, propertyAddress?, mailingAddress?,
 *   consentTextVersion, consentMethod, source?, metadata?
 * }
 */

export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      null;

    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : null;
    const phone = typeof b.phone === 'string' ? b.phone.trim() : null;
    const consentTextVersion = typeof b.consentTextVersion === 'string' ? b.consentTextVersion.trim() : null;
    const consentMethod = typeof b.consentMethod === 'string' ? b.consentMethod.trim() : 'web_form';
    const source = typeof b.source === 'string' ? b.source.trim() : 'landing_page';
    const metadata: Record<string, unknown> = b.metadata && typeof b.metadata === 'object' ? (b.metadata as Record<string, unknown>) : {};

    if (!consentTextVersion) {
      return Response.json({ error: 'consentTextVersion is required' }, { status: 400 });
    }

    const leadId = await ensureLead({
      firstName: typeof b.firstName === 'string' ? b.firstName.trim() : null,
      lastName: typeof b.lastName === 'string' ? b.lastName.trim() : null,
      email,
      phone,
      propertyAddress: typeof b.propertyAddress === 'string' ? b.propertyAddress.trim() : null,
      mailingAddress: typeof b.mailingAddress === 'string' ? b.mailingAddress.trim() : null,
      metadata,
    });

    const [row] = await sql`
      INSERT INTO compliance_records
        (target, type, channel, metadata)
      VALUES (
        ${email || phone || 'unknown'},
        'consent',
        'email',
        ${JSON.stringify({
          leadId,
          email,
          phone,
          consentTextVersion,
          consentMethod,
          source,
          ip,
          userAgent: request.headers.get('user-agent') || null,
          createdAt: new Date().toISOString(),
          ...metadata,
        })}
      )
      RETURNING id, target, created_at
    `;

    await logEvent('consent_captured', 'compliance', String(leadId), {
      leadId,
      email,
      phone,
      consentTextVersion,
      consentMethod,
      source,
      ip,
    });

    return Response.json({ ok: true, leadId, complianceRecordId: row.id, at: row.created_at }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/consent/capture error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function ensureLead(opts: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  propertyAddress: string | null;
  mailingAddress: string | null;
  metadata: Record<string, unknown>;
}) {
  // Upsert by email or phone. Prefer email when both are present.
  const key = opts.email ? { email: opts.email } : opts.phone ? { phone: opts.phone } : null;
  if (!key) {
    const [inserted] = await sql`
      INSERT INTO leads (first_name, last_name, email, phone, metadata, source, status)
      VALUES (${opts.firstName}, ${opts.lastName}, ${opts.email}, ${opts.phone}, ${JSON.stringify(opts.metadata)}, 'consent_capture', 'new')
      RETURNING id
    `;
    return inserted.id as number;
  }

  const [existing] = await sql`
    SELECT id FROM leads
    WHERE ${key.email ? sql`LOWER(email) = ${opts.email!.toLowerCase()}` : sql`1=1`}
      ${key.phone ? sql`AND phone = ${opts.phone}` : sql`AND 1=1`}
    ORDER BY id DESC
    LIMIT 1
  `;

  if (existing?.id) {
    await sql`
      UPDATE leads
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
        ...opts.metadata,
        property_address: opts.propertyAddress ?? undefined,
        mailing_address: opts.mailingAddress ?? undefined,
      })}
      WHERE id = ${existing.id}
    `;
    return existing.id as number;
  }

  const [inserted] = await sql`
    INSERT INTO leads (first_name, last_name, email, phone, metadata, source, status)
    VALUES (${opts.firstName}, ${opts.lastName}, ${opts.email}, ${opts.phone}, ${JSON.stringify(opts.metadata)}, 'consent_capture', 'new')
    RETURNING id
  `;
  return inserted.id as number;
}
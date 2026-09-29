import sql from '@/app/api/utils/sql';
import { buildWhere } from '@/app/api/utils/sqlFragments';
import { logEvent } from '@/app/api/utils/logger';
import { resolvePlatformOrganizationId } from '@/app/api/utils/platformOrg';
import { getClientIp } from '@/app/api/utils/clientIp';

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

// NOTE: `export const runtime = 'edge'` was removed here. The OpenNext Cloudflare
// adapter does not support Next.js's Edge runtime — the whole app runs on the
// Node.js runtime under workerd, which is what gives us full Node API access.
// See https://opennext.js.org/cloudflare/get-started (step 9).

export async function POST(request: Request) {
  try {
    // Proxy-resolved client IP. The previous leftmost-x-forwarded-for read
    // let the caller choose the value recorded in this consent audit row.
    const ip = getClientIp(request);

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

    // ORGANIZATION ATTRIBUTION (2026-09-26): leads.organization_id is NOT NULL
    // (migration 030), so the previous unattributed INSERT threw and the public
    // "cash offer" form 500'd on every submission (same class as BREAKAGE_TABLE
    // #35). A public funnel cannot resolve a session, so captures belong to the
    // platform's primary organization — the same resolution
    // lib/organization-context.ts falls back to.
    const organizationId = await resolvePlatformOrganizationId();
    if (!organizationId) {
      return Response.json({ error: 'Platform organization not configured' }, { status: 503 });
    }

    const leadId = await ensureLead(
      {
        firstName: typeof b.firstName === 'string' ? b.firstName.trim() : null,
        lastName: typeof b.lastName === 'string' ? b.lastName.trim() : null,
        email,
        phone,
        propertyAddress: typeof b.propertyAddress === 'string' ? b.propertyAddress.trim() : null,
        mailingAddress: typeof b.mailingAddress === 'string' ? b.mailingAddress.trim() : null,
        metadata,
      },
      organizationId
    );

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
}, organizationId: string) {
  // Upsert by email or phone, WITHIN the funnel organization. Prefer email when
  // both are present.
  const key = opts.email ? { email: opts.email } : opts.phone ? { phone: opts.phone } : null;
  if (!key) {
    const [inserted] = await sql`
      INSERT INTO leads (first_name, last_name, email, phone, metadata, source, status, organization_id)
      VALUES (${opts.firstName}, ${opts.lastName}, ${opts.email}, ${opts.phone}, ${JSON.stringify(opts.metadata)}, 'consent_capture', 'new', ${organizationId})
      RETURNING id
    `;
    return inserted.id as number;
  }

  // Defect #32, fifth wave: both ternary branches are boolean-position
  // fragments, so this 500'd for any caller that passed an email or a phone -
  // i.e. the normal path. Consent capture is the GDPR record, so failing
  // silently is worse than failing loudly: the capture was never recorded.
  const identity = buildWhere(1)
    .when(key.email, (w) => w.expr('LOWER(email) = ?', opts.email!.toLowerCase()))
    .when(key.phone, (w) => w.eq('phone', opts.phone))
    .build();

  const [existing] = await sql(
    `SELECT id FROM leads
     WHERE organization_id = $1
       AND ${identity.text}
     ORDER BY id DESC
     LIMIT 1`,
    [organizationId, ...identity.params] as never[]
  );

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
    INSERT INTO leads (first_name, last_name, email, phone, metadata, source, status, organization_id)
    VALUES (${opts.firstName}, ${opts.lastName}, ${opts.email}, ${opts.phone}, ${JSON.stringify(opts.metadata)}, 'consent_capture', 'new', ${organizationId})
    RETURNING id
  `;
  return inserted.id as number;
}
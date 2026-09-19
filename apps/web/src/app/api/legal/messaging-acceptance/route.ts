/**
 * Messaging Compliance Acceptance API
 *
 * GET  /api/legal/messaging-acceptance — check if current user has accepted
 * POST /api/legal/messaging-acceptance — record acceptance of messaging compliance
 *
 * This is a specialized endpoint for the MessagingComplianceWall component
 * that tracks TCPA, CAN-SPAM, DNC, and liability acknowledgments.
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { currentVersionFor } from '@/lib/legal';

const MESSAGING_DOC_TYPE = 'messaging_compliance';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [acceptance] = await sql`
      SELECT id, accepted_at, version
      FROM legal_acceptances
      WHERE user_id = ${session.user.id}
        AND document_type = ${MESSAGING_DOC_TYPE}
      ORDER BY accepted_at DESC
      LIMIT 1
    `;

    if (acceptance) {
      return Response.json({
        accepted: true,
        acceptedAt: acceptance.accepted_at,
        version: acceptance.version,
      });
    }

    return Response.json({ accepted: false });
  } catch (error) {
    console.error('GET /api/legal/messaging-acceptance error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

interface AcceptanceBody {
  acceptedTerms?: {
    tcpa_acknowledged?: boolean;
    canspam_acknowledged?: boolean;
    dnc_acknowledged?: boolean;
    liability_acknowledged?: boolean;
  };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: AcceptanceBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { acceptedTerms } = body;

  // Validate that all required acknowledgments are present
  if (!acceptedTerms) {
    return Response.json({ error: 'acceptedTerms required' }, { status: 400 });
  }

  const required = [
    'tcpa_acknowledged',
    'canspam_acknowledged',
    'dnc_acknowledged',
    'liability_acknowledged',
  ] as const;

  const missing = required.filter((key) => acceptedTerms[key] !== true);
  if (missing.length > 0) {
    return Response.json({
      error: `Missing required acknowledgments: ${missing.join(', ')}`,
    }, { status: 400 });
  }

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = hdrs.get('user-agent') || null;
  const version = currentVersionFor('messaging');

  try {
    const id = `accept_${crypto.randomUUID().replace(/-/g, '')}`;

    await sql`
      INSERT INTO legal_acceptances (
        id,
        user_id,
        document_type,
        version,
        ip_address,
        user_agent,
        metadata
      )
      VALUES (
        ${id},
        ${session.user.id},
        ${MESSAGING_DOC_TYPE},
        ${version},
        ${ip},
        ${userAgent},
        ${JSON.stringify({
          tcpa_acknowledged: true,
          canspam_acknowledged: true,
          dnc_acknowledged: true,
          liability_acknowledged: true,
          accepted_via: 'messaging_compliance_wall',
        })}
      )
      ON CONFLICT (user_id, document_type, version) DO UPDATE SET
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        metadata = EXCLUDED.metadata,
        accepted_at = now()
    `;

    return Response.json({
      success: true,
      acceptanceId: id,
      version,
    });
  } catch (error) {
    console.error('POST /api/legal/messaging-acceptance error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

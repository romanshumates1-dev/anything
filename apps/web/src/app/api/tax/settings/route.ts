/**
 * Seller tax-withholding settings.
 *
 * GET  -> current preference (never another seller's; org is resolved from the
 *         session, never from the request body or a query parameter)
 * PUT  -> upsert the preference
 *
 * SECURITY
 * - The organization comes from the authenticated session context only. There is
 *   no `organizationId` in the body or query, so there is nothing for a caller to
 *   tamper with. This is the property that prevents a cross-tenant rate edit.
 * - The rate is validated as an integer in 0..10000 basis points and normalized
 *   before it is stored; an out-of-range value is rejected with 400 rather than
 *   clamped, so a client bug is visible instead of silently changing a payout.
 * - This is a per-seller PLATFORM withholding preference. It is not a tax
 *   election, not advice, and does not determine any actual tax liability.
 */
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { isValidRateBps, DISCLAIMER } from '@/app/api/utils/taxWithholding';
import {
  getWithholdingSettings,
  saveWithholdingSettings,
  getWithheldBalance,
} from '@/app/api/utils/taxWithholdingStore';

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const settings = await getWithholdingSettings(session.user.id, organization.id);
    const heldCents = await getWithheldBalance(session.user.id, organization.id);

    return Response.json({
      // A seller who never configured anything is DISABLED, not erroring.
      settings: settings ?? { enabled: false, rateBps: 0, jurisdiction: null },
      currentlyHeldCents: heldCents,
      disclaimer: DISCLAIMER,
    });
  } catch (error) {
    console.error('GET /api/tax/settings error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Mass-assignment guard: only these three fields are ever read. A body
    // carrying `user_id` or `organization_id` is ignored, not honoured.
    const enabled = body?.enabled === true;
    const rateBps = body?.rateBps;
    const jurisdiction =
      typeof body?.jurisdiction === 'string' && body.jurisdiction.trim().length > 0
        ? body.jurisdiction.trim().slice(0, 64)
        : null;

    if (!isValidRateBps(rateBps)) {
      return Response.json(
        {
          error:
            'rateBps must be an integer between 0 and 10000 (0% to 100%, in basis points)',
        },
        { status: 400 }
      );
    }

    const saved = await saveWithholdingSettings(session.user.id, organization.id, {
      enabled,
      rateBps,
      jurisdiction,
    });

    return Response.json({ settings: saved, disclaimer: DISCLAIMER });
  } catch (error) {
    console.error('PUT /api/tax/settings error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

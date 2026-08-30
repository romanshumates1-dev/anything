import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { isWithinQuietHours } from '@/app/api/utils/dispatchGate';
import { timezonesForPhone } from '@/app/api/utils/area-codes';
import { getOrGenerateBrief } from './brief';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';

/**
 * GET /api/outreach/call-queue — the manual-dial list.
 *
 * WHY MANUAL DIALING AND NOT AI VOICE
 * Prerecorded/artificial-voice calls to cell phones require prior express
 * written consent under the TCPA, and ringless voicemail has been treated as a
 * "call" by courts. Neither is a safe A2P workaround. A HUMAN dialing a
 * non-DNC number is legal, so this endpoint assists the human — it never
 * dials, never speaks, and returns no automation hook. The AI's role is to
 * prepare the caller, not to place the call.
 *
 * THE COMPLIANCE GUARANTEE IS EXCLUSION, ENFORCED IN THE QUERY.
 * A suppressed or DNC-listed number must be structurally unable to appear
 * here. Filtering in application code after the fetch would leave the row on
 * the wire and one `if` away from being dialed; the NOT EXISTS clauses below
 * mean the database never returns it at all. Both stores are checked because
 * they mean different things:
 *   compliance_records -> this person told US to stop (any channel)
 *   dnc_registry       -> federal/state Do-Not-Call listing
 *
 * Quiet hours are advertised per row rather than filtered on. A human may
 * legitimately review the list at 6am and call at 10am, so removing rows would
 * hide work; `callableNow` tells the caller what is dialable this minute
 * without deciding for them.
 *
 * Query: ?limit=50
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));

    const maxAttempts = Number(process.env.MAX_CALL_ATTEMPTS) || 5;

    const rows = await sql`
      SELECT
        l.id,
        l.name,
        l.phone,
        l.metadata,
        COALESCE((l.metadata->>'distress_score')::int, 0) AS score,
        COALESCE(ca.attempt_count, 0) AS attempts,
        ca.last_attempt_at,
        ca.last_outcome
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS attempt_count,
          MAX(attempted_at) AS last_attempt_at,
          (ARRAY_AGG(outcome ORDER BY attempted_at DESC))[1] AS last_outcome
        FROM call_attempts
        WHERE lead_id = l.id AND organization_id = ${organization.id}
      ) ca ON true
      WHERE l.organization_id = ${organization.id}
        AND l.phone IS NOT NULL
        AND l.phone <> ''
        AND l.status NOT IN ('dead', 'converted')
        -- Opted out on ANY channel: absolute, permanent.
        AND NOT EXISTS (
          SELECT 1 FROM compliance_records cr
          WHERE cr.target = l.phone AND cr.type = 'opt-out'
        )
        -- Federal/state Do-Not-Call listing.
        AND NOT EXISTS (
          SELECT 1 FROM dnc_registry d WHERE d.phone = l.phone
        )
        -- Exclude leads that have reached max attempts
        AND COALESCE(ca.attempt_count, 0) < ${maxAttempts}
      ORDER BY score DESC, l.id ASC
      LIMIT ${limit}
    `;

    const now = new Date();
    const callQueueOn = await isBetaFlagOn('callQueue');

    const queue = await Promise.all((rows as Array<any>).map(async (r) => {
      const tzs = timezonesForPhone(r.phone);
      const meta = r.metadata ?? {};
      const cachedBrief = meta.call_brief;
      let callBrief: string | null = cachedBrief?.text ?? null;

      if (callQueueOn && !callBrief) {
        const brief = await getOrGenerateBrief(r.id, organization.id);
        if (brief) callBrief = brief.brief;
      }

      return {
        leadId: r.id,
        name: r.name,
        phone: r.phone,
        score: r.score,
        signals: Array.isArray(meta.signals) ? meta.signals : [],
        propertyAddress: meta.property_address ?? null,
        county: meta.county ?? null,
        timezones: tzs,
        callableNow: isWithinQuietHours(tzs, now),
        attempts: Number(r.attempts),
        lastAttemptAt: r.last_attempt_at ?? null,
        lastOutcome: r.last_outcome ?? null,
        callBrief,
      };
    }));

    return Response.json({
      queue,
      count: queue.length,
      callableNow: queue.filter((q) => q.callableNow).length,
      disclaimer:
        'MANUAL DIAL ONLY. No auto-dialing and no AI voice: prerecorded/artificial-voice calls to cell phones require prior express written consent (TCPA). Numbers opted out or on a DNC registry are excluded by the query, not by client-side filtering.',
    });
  } catch (error: any) {
    console.error('GET /api/outreach/call-queue error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

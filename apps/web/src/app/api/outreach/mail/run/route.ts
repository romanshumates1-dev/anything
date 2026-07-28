import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { sendMail, estimateMailCampaign, DEFAULT_UNIT_COST_CENTS, type MailPiece } from '@/app/api/utils/mailDriver';
import { resolveContacts } from '@/app/api/utils/contactResolution';
import { recordStageTransition } from '@/app/api/services/stageTransitionRecorder';

/**
 * POST /api/outreach/mail/run — dispatch a direct-mail run.
 *
 * Closes the loop on the registration-free pipeline:
 *   fetch inventory -> size from a deal target -> hand off to leads -> MAIL.
 *
 * No 10DLC, no A2P, no campaign approval, no skip-trace: the postal address
 * rides in leads.metadata.mailing_address, straight from the public record.
 *
 * DRY RUN IS THE DEFAULT, AND THAT IS DELIBERATE.
 * Mail is the only channel where a single request converts directly into money
 * — ~55c the instant a piece is accepted by the provider, unrecallable. A
 * 10,000-piece run is $5,500. Every other send path in this codebase defaults
 * to doing the thing; this one defaults to PRICING the thing, because the cost
 * of an accidental real run is not an apology, it is a bill. Spending requires
 * `dryRun: false` explicitly.
 *
 * Body: { limit?, dryRun?, unitCostCents?, body, returnAddress, campaignId? }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const orgId = organization.id;

    const b = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
      dryRun?: unknown;
      unitCostCents?: unknown;
      body?: unknown;
      returnAddress?: unknown;
      campaignId?: unknown;
    };

    // Explicit opt-in to spend. Anything other than a literal false is a dry
    // run — `dryRun: "false"` from a form post must NOT start billing.
    const dryRun = b.dryRun !== false;
    const limit = Math.min(10000, Math.max(1, Number(b.limit) || 100));
    const unitCostCents = Number(b.unitCostCents) || DEFAULT_UNIT_COST_CENTS;
    const copy = typeof b.body === 'string' ? b.body : '';
    const returnAddress = typeof b.returnAddress === 'string' ? b.returnAddress : '';

    if (!copy.trim()) {
      return Response.json({ error: 'body (mail copy) is required' }, { status: 400 });
    }
    if (!returnAddress.trim()) {
      return Response.json(
        { error: 'returnAddress is required (USPS and every provider mandate it)' },
        { status: 400 }
      );
    }

    // Org-scoped by construction — leads is multi-tenant (migration 030).
    const leads = await sql`
      SELECT id, name, metadata
      FROM leads
      WHERE organization_id = ${orgId}
        AND source = 'lead-finder'
        AND status = 'new'
      ORDER BY id ASC
      LIMIT ${limit}
    `;

    // Resolve a postal contact per lead using the FREE resolver only. allowPaid
    // is deliberately never set here: this endpoint's whole premise is that mail
    // needs no paid enrichment.
    const pieces: Array<MailPiece & { leadId: number }> = [];
    let unresolved = 0;
    for (const lead of leads as Array<{ id: number; name: string; metadata: any }>) {
      const meta = lead.metadata ?? {};
      const resolved = resolveContacts(
        {
          mailing_address: meta.mailing_address ?? null,
          property_address: meta.property_address ?? null,
          owner_name: lead.name ?? null,
        },
        { allowedChannels: ['mail'] }
      );
      const mailContact = resolved.contacts.find((c) => c.channel === 'mail');
      if (!mailContact) {
        unresolved++;
        continue;
      }
      pieces.push({
        leadId: lead.id,
        to: mailContact.value,
        toName: lead.name ?? null,
        body: copy,
        returnAddress,
        organizationId: orgId,
        campaignId: typeof b.campaignId === 'string' ? b.campaignId : null,
        unitCostCents,
      });
    }

    const estimate = estimateMailCampaign(pieces, unitCostCents);

    if (dryRun) {
      return Response.json({
        dryRun: true,
        candidates: leads.length,
        unresolved,
        ...estimate,
        note: 'No mail was sent and no money was committed. Re-send with dryRun:false to dispatch.',
      });
    }

    // ── REAL SPEND from here.
    let dispatched = 0;
    let suppressed = 0;
    let blocked = 0;
    let failed = 0;
    let spentCents = 0;
    const failures: Array<{ leadId: number; reason: string }> = [];

    for (const piece of pieces) {
      const result = await sendMail(piece);
      switch (result.status) {
        case 'dispatched':
          dispatched++;
          spentCents += result.costCents;
          // A dispatched piece IS the first touch — record it so the funnel
          // reflects mail, not just SMS.
          await recordStageTransition({
            leadId: piece.leadId,
            fromStage: 'NEW',
            toStage: 'CONTACTED',
            campaignId: piece.campaignId ?? undefined,
            channel: 'mail',
          });
          break;
        case 'suppressed':
          suppressed++;
          break;
        case 'blocked':
          blocked++;
          failures.push({ leadId: piece.leadId, reason: result.reason });
          break;
        case 'failed':
          failed++;
          failures.push({ leadId: piece.leadId, reason: result.errorMessage });
          break;
      }
    }

    await logEvent(
      'mail_run_dispatched',
      'campaign',
      String(b.campaignId ?? 'ad-hoc'),
      { dispatched, suppressed, blocked, failed, spentCents, unresolved },
      admin.userId
    );

    return Response.json({
      dryRun: false,
      candidates: leads.length,
      unresolved,
      dispatched,
      suppressed,
      blocked,
      failed,
      spentCents,
      spentUsd: Math.round(spentCents) / 100,
      // Capped so one bad run cannot return a 10,000-entry payload.
      failures: failures.slice(0, 50),
    });
  } catch (error: any) {
    console.error('POST /api/outreach/mail/run error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

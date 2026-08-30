import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getOrganization } from '@/lib/organization-context';
import {
  generateTrackingCode,
  buildMailCsv,
  summarizeBatch,
  type MailPieceRow,
} from '@/app/api/utils/mailExport';
import { mailAddressGuard, DEFAULT_UNIT_COST_CENTS } from '@/app/api/utils/mailDriver';
import { resolveContacts } from '@/app/api/utils/contactResolution';

/**
 * POST /api/outreach/mail/export — generate a print-ready mail batch with a
 * unique tracking code per piece, persisting each to mail_pieces so an inbound
 * response quoting the code attributes back to the exact piece + lead.
 *
 * This is the artifact a print vendor (or the owner's local printer) consumes.
 * It does NOT send anything and commits no spend — it produces the file and the
 * tracking rows. Actual mailing happens at the vendor; delivery of the file is
 * a download, not a dispatch.
 *
 * DRY-RUN default, same discipline as /mail/run: generating tracking rows is a
 * side effect (it burns codes and creates DB records), so `commit:true` is
 * required to persist. A dry run returns the summary + a sample so the operator
 * sees the batch before it becomes real.
 *
 * Body: { limit?, campaignId?, unitCostCents?, ctaTemplate?, commit? }
 */

/** Guards against an unlikely but non-zero code collision under the UNIQUE index. */
const MAX_CODE_ATTEMPTS = 5;

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
      campaignId?: unknown;
      unitCostCents?: unknown;
      ctaTemplate?: unknown;
      commit?: unknown;
    };

    const commit = b.commit === true;
    const limit = Math.min(10000, Math.max(1, Number(b.limit) || 50));
    const unitCostCents = Number(b.unitCostCents) || DEFAULT_UNIT_COST_CENTS;
    const campaignId = typeof b.campaignId === 'string' ? b.campaignId : null;
    const ctaTemplate = typeof b.ctaTemplate === 'string' ? b.ctaTemplate : undefined;

    // Top-scored lead-finder leads for this org that don't already have a piece.
    // Highest distress score first — direct mail is the most expensive channel
    // per piece, so it is reserved for the best odds (Phase 4 ladder).
    const leads = await sql`
      SELECT l.id, l.name, l.metadata, COALESCE((l.metadata->>'distress_score')::int, 0) AS score
      FROM leads l
      WHERE l.organization_id = ${orgId}
        AND l.source = 'lead-finder'
        AND l.status = 'new'
        AND NOT EXISTS (
          SELECT 1 FROM mail_pieces mp WHERE mp.lead_id = l.id
        )
      ORDER BY score DESC, l.id ASC
      LIMIT ${limit}
    `;

    const rows: MailPieceRow[] = [];
    let unmailable = 0;
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
      const mail = resolved.contacts.find((c) => c.channel === 'mail');
      if (!mail || !mailAddressGuard({ to: mail.value, body: 'x', returnAddress: 'x' }).ok) {
        unmailable++;
        continue;
      }
      rows.push({
        trackingCode: '', // assigned below with collision-retry
        recipientName: lead.name ?? '',
        mailingAddress: mail.value,
        leadId: lead.id,
        unitCostCents,
      });
    }

    // Assign codes. Uniqueness is enforced by the DB index, not by this loop —
    // we retry on the (rare) conflict rather than trusting the generator.
    if (commit) {
      for (const row of rows) {
        let inserted = false;
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !inserted; attempt++) {
          const code = generateTrackingCode();
          const res = await sql`
            INSERT INTO mail_pieces
              (organization_id, tracking_code, lead_id, campaign_id, mailing_address, recipient_name, unit_cost_cents, created_by)
            VALUES (${orgId}, ${code}, ${row.leadId}, ${campaignId}, ${row.mailingAddress}, ${row.recipientName}, ${row.unitCostCents}, ${admin.userId})
            ON CONFLICT (tracking_code) DO NOTHING
            RETURNING tracking_code
          `;
          if (res.length > 0) {
            row.trackingCode = (res[0] as { tracking_code: string }).tracking_code;
            inserted = true;
          }
        }
        if (!inserted) {
          // 5 collisions in a 244M space means something is wrong (a broken RNG,
          // a re-run against a full table) — fail loud rather than ship a piece
          // with no code.
          return Response.json(
            { error: 'code_generation_failed', message: 'could not assign a unique tracking code after retries' },
            { status: 500 }
          );
        }
      }
    } else {
      // Dry run: assign in-memory codes so the sample is representative, but
      // persist nothing.
      for (const row of rows) row.trackingCode = generateTrackingCode();
    }

    const summary = summarizeBatch(rows);
    const csv = buildMailCsv(rows, { ctaTemplate });

    await logEvent(
      'mail_batch_exported',
      'campaign',
      String(campaignId ?? 'ad-hoc'),
      { commit, pieces: summary.pieces, unmailable, totalCostCents: summary.totalCostCents },
      admin.userId
    );

    if (!commit) {
      return Response.json({
        commit: false,
        candidates: leads.length,
        unmailable,
        ...summary,
        sampleCsv: csv.split('\n').slice(0, 4).join('\n'),
        note: 'Dry run — no tracking codes persisted, no file is authoritative. Re-send with commit:true to generate the real batch.',
      });
    }

    // Committed: return the CSV as a downloadable file.
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mail-batch-${campaignId ?? 'adhoc'}-${summary.pieces}.csv"`,
        'X-Batch-Pieces': String(summary.pieces),
        'X-Batch-Cost-Cents': String(summary.totalCostCents),
        'X-Batch-Unmailable': String(unmailable),
      },
    });
  } catch (error: any) {
    console.error('POST /api/outreach/mail/export error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

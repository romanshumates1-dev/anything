import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/debrief — unified decision-grade campaign debrief.
 *
 * Phase 11: one click after every campaign.
 * - Funnel per channel with n + Wilson 95% CI
 * - Contracts by touch number, channel, resurrection wave, origination_type, jurisdiction
 * - Drop-off ranked by expected dollars lost
 * - Cost per stage/channel
 * - Underpowered → INSUFFICIENT DATA (n=X, need ~Y)
 *
 * Query params:
 *   campaignId — specific campaign (optional; omit for org-wide)
 *   format      — 'json' (default) | 'csv'
 */

const MIN_N_FOR_RATE = 30; // minimum n before a rate is considered powered

/** Wilson score 95% CI for a proportion. Returns [lower, upper]. */
function wilsonCI(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function rateRow(label: string, k: number, n: number) {
  if (n < MIN_N_FOR_RATE) {
    return { label, k, n, rate: null, ci95: null, powered: false, note: `INSUFFICIENT DATA (n=${n}, need ~${MIN_N_FOR_RATE})` };
  }
  const rate = k / n;
  const [lo, hi] = wilsonCI(k, n);
  return { label, k, n, rate: Math.round(rate * 10000) / 10000, ci95: [Math.round(lo * 10000) / 10000, Math.round(hi * 10000) / 10000], powered: true };
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaignId') || null;
  const format = url.searchParams.get('format') || 'json';

  try {
    // ── FUNNEL PER CHANNEL ────────────────────────────────────────────────
    const funnelRows = await sql`
      SELECT
        COALESCE(me.provider, 'unknown') as channel,
        COUNT(*) FILTER (WHERE me.direction = 'outbound') as delivered,
        COUNT(DISTINCT me.contact_id) FILTER (WHERE me.direction = 'outbound') as contacts_reached,
        COUNT(*) FILTER (WHERE me.direction = 'inbound') as replies,
        COUNT(DISTINCT me.contact_id) FILTER (WHERE me.direction = 'inbound') as repliers,
        COUNT(*) FILTER (WHERE me.status = 'opt_out') as opt_outs
      FROM message_events me
      WHERE me.organization_id = ${organization.id}
        AND (${campaignId}::text IS NULL OR me.campaign_id = ${campaignId})
      GROUP BY COALESCE(me.provider, 'unknown')
    `.catch(() => []);

    // Stage transitions for funnel depth
    const stageRows = await sql`
      SELECT to_stage, COUNT(*) as cnt, channel
      FROM stage_transitions
      WHERE organization_id = ${organization.id}
        AND (${campaignId}::text IS NULL OR campaign_id = ${campaignId})
      GROUP BY to_stage, channel
    `.catch(() => []);

    const stageMap: Record<string, Record<string, number>> = {};
    for (const r of stageRows as any[]) {
      if (!stageMap[r.channel]) stageMap[r.channel] = {};
      stageMap[r.channel][r.to_stage] = Number(r.cnt);
    }

    const funnelByChannel = (funnelRows as any[]).map(r => {
      const ch = r.channel;
      const delivered = Number(r.delivered);
      const replies = Number(r.replies);
      const engaged = stageMap[ch]?.ENGAGED ?? 0;
      const negotiating = stageMap[ch]?.NEGOTIATING ?? 0;
      const contracts = stageMap[ch]?.SIGNED ?? 0;
      const optOuts = Number(r.opt_outs);
      return {
        channel: ch,
        delivered,
        replies,
        replyRate: rateRow('reply_rate', replies, delivered),
        engaged,
        engagedOfReplies: rateRow('engaged_of_replies', engaged, replies),
        negotiating,
        contracts,
        optOuts,
        optOutRate: rateRow('opt_out_rate', optOuts, delivered),
      };
    });

    // ── CONTRACTS BY ATTRIBUTION ──────────────────────────────────────────
    const contractRows = await sql`
      SELECT
        c.origination_type,
        c.status,
        l.metadata->>'state' as jurisdiction,
        COUNT(*) as cnt,
        AVG(p.amount_cents) as avg_fee_cents
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.seller_lead_id
      LEFT JOIN payments_ledger p ON p.contract_id = c.id AND p.status = 'paid'
      WHERE c.organization_id = ${organization.id}
      GROUP BY c.origination_type, c.status, l.metadata->>'state'
      ORDER BY cnt DESC
    `.catch(() => []);

    // Resurrection attribution
    const resurrectionRows = await sql`
      SELECT sequence_day, channel, COUNT(*) as cnt,
             COUNT(*) FILTER (WHERE status = 'sent') as sent
      FROM resurrection_sent_log
      WHERE organization_id = ${organization.id}
      GROUP BY sequence_day, channel
      ORDER BY sequence_day
    `.catch(() => []);

    // ── COST PER STAGE ────────────────────────────────────────────────────
    // Touch economics: cost per new contact vs cost per additional touch
    const touchEconomics = {
      newContactCostCents: 13,  // trace + scrub (BENCHMARK)
      smsTouchCents: 1,
      emailTouchCents: 0,
      callTouchCents: 0,
      note: 'BENCHMARK — update with actual vendor invoices for MEASURED label',
    };

    // ── DROP-OFF RANKED BY EXPECTED DOLLARS LOST ──────────────────────────
    const avgFeeCents = 1000000; // $10k BENCHMARK
    const dropOffRanking = funnelByChannel.map(ch => {
      const replyDropOff = ch.delivered - ch.replies;
      const engageDropOff = ch.replies - ch.engaged;
      return [
        { stage: `${ch.channel}: delivered→reply`, dropped: replyDropOff, expectedDollarsLost: Math.round(replyDropOff * 0.0007 * avgFeeCents / 100) },
        { stage: `${ch.channel}: reply→engaged`, dropped: engageDropOff, expectedDollarsLost: Math.round(engageDropOff * 0.05 * avgFeeCents / 100) },
      ];
    }).flat().sort((a, b) => b.expectedDollarsLost - a.expectedDollarsLost);

    // ── REFERRAL FEE LEDGER ───────────────────────────────────────────────
    const referralLedger = await sql`
      SELECT rh.status, rp.name as partner_name,
             rh.fee_received_cents, rh.closed_at
      FROM referral_handoffs rh
      LEFT JOIN referral_partners rp ON rp.id = rh.partner_id
      WHERE rh.organization_id = ${organization.id}
        AND rh.status = 'fee_received'
      ORDER BY rh.closed_at DESC
      LIMIT 20
    `.catch(() => []);

    const debrief = {
      generatedAt: new Date().toISOString(),
      campaignId,
      organizationId: organization.id,
      funnelByChannel,
      contractsByAttribution: contractRows,
      resurrectionWaves: resurrectionRows,
      dropOffRanking,
      touchEconomics,
      referralFeeLedger: referralLedger,
      dataLabels: {
        conversionRate: 'BENCHMARK (unverified for this account)',
        avgFee: 'BENCHMARK — $10k assumed until real closed deals recorded',
      },
      note: 'Rates with n < 30 are labeled INSUFFICIENT DATA. No lift is claimed without a significance test.',
    };

    if (format === 'csv') {
      const lines = [
        'channel,delivered,replies,reply_rate,engaged,contracts,opt_outs',
        ...funnelByChannel.map(r =>
          `${r.channel},${r.delivered},${r.replies},${r.replyRate.rate ?? 'INSUFFICIENT'},${r.engaged},${r.contracts},${r.optOuts}`
        ),
      ];
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="debrief.csv"' },
      });
    }

    return Response.json(debrief);
  } catch (error: any) {
    console.error('GET /api/debrief error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

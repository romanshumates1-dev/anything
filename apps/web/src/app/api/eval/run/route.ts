import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { runSweep, type PromptVariant, type EvalTranscript } from '@/app/api/utils/evalHarness';

/**
 * POST /api/eval/run — offline prompt-variant sweep against real transcripts.
 *
 * The loop that improves the negotiator while carrier registration is pending:
 * no A2P, no campaign approval, no recipient. Every comparison runs against
 * conversations already in the database.
 *
 * DEFAULTS ARE THE CHEAP ONES. hardOnly defaults TRUE, so an accidental call
 * runs the free compliance pass and spends nothing on the judge. Paying
 * requires asking. This mirrors the mail run's dry-run default for the same
 * reason: the expensive mode should never be the one you get by forgetting a
 * parameter.
 *
 * Body: {
 *   variants:      [{ id, system }],   required, >= 2 to be a comparison
 *   transcriptLimit?: number,          how many real conversations to replay
 *   hardOnly?:     boolean,            default true (free)
 *   maxJudgeCalls?: number,            spend ceiling when hardOnly is false
 *   isFirstTouch?, channel?, approvedOfferCents?   rubric context
 * }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const b = (await request.json().catch(() => ({}))) as {
      variants?: unknown;
      transcriptLimit?: unknown;
      hardOnly?: unknown;
      maxJudgeCalls?: unknown;
      isFirstTouch?: unknown;
      channel?: unknown;
      approvedOfferCents?: unknown;
    };

    const rawVariants = Array.isArray(b.variants) ? b.variants : [];
    const variants: PromptVariant[] = rawVariants
      .filter(
        (v: any) => v && typeof v.id === 'string' && typeof v.system === 'string' && v.system.trim()
      )
      .map((v: any) => ({ id: v.id, system: v.system }));

    if (variants.length < 2) {
      return Response.json(
        { error: 'at least 2 valid variants are required — a sweep with one arm compares nothing' },
        { status: 400 }
      );
    }
    const ids = new Set(variants.map((v) => v.id));
    if (ids.size !== variants.length) {
      // Duplicate ids would silently merge two arms in the summary and report a
      // blended result as if it were one variant.
      return Response.json({ error: 'variant ids must be unique' }, { status: 400 });
    }

    const transcriptLimit = Math.min(500, Math.max(1, Number(b.transcriptLimit) || 25));

    // Real conversations, org-scoped through the lead that owns them.
    const rows = await sql`
      SELECT c.id, c.history
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE l.organization_id = ${organization.id}
        AND jsonb_array_length(COALESCE(c.history, '[]'::jsonb)) > 0
      ORDER BY c.id DESC
      LIMIT ${transcriptLimit}
    `;

    const transcripts: EvalTranscript[] = (rows as Array<{ id: number; history: any }>).
      map((r) => ({
        id: String(r.id),
        history: (Array.isArray(r.history) ? r.history : [])
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      }))
      .filter((t) => t.history.length > 0);

    if (transcripts.length === 0) {
      return Response.json(
        {
          error: 'no usable transcripts',
          message:
            'No ai_conversations with history exist for this organization yet. Run a campaign (or seed a conversation) before sweeping.',
        },
        { status: 400 }
      );
    }

    // Free unless explicitly told otherwise.
    const hardOnly = b.hardOnly !== false;

    const report = await runSweep(variants, transcripts, {
      hardOnly,
      maxJudgeCalls: Number(b.maxJudgeCalls) || undefined,
      isFirstTouch: b.isFirstTouch === true,
      channel: b.channel === 'sms' || b.channel === 'email' || b.channel === 'mail' ? b.channel : undefined,
      approvedOfferCents: Number.isFinite(Number(b.approvedOfferCents))
        ? Number(b.approvedOfferCents)
        : undefined,
    });

    await logEvent(
      'eval_sweep_run',
      'eval',
      'sweep',
      {
        variants: variants.length,
        transcripts: transcripts.length,
        candidates: report.candidates,
        judged: report.judged,
        judgeCallsSaved: report.judgeCallsSaved,
        hardOnly,
        winner: report.winner,
      },
      admin.userId
    );

    return Response.json({
      ...report,
      transcripts: transcripts.length,
      hardOnly,
      note: hardOnly
        ? 'Compliance-only sweep — no judge calls, no spend. Re-send with hardOnly:false to score quality.'
        : undefined,
    });
  } catch (error: any) {
    console.error('POST /api/eval/run error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

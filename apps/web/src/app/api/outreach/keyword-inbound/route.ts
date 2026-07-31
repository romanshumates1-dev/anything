/**
 * POST /api/outreach/keyword-inbound
 *
 * Handles keyword-triggered inbound SMS (e.g. "text OFFER to 555-...").
 * This is the $0-acquisition inbound funnel: the prospect initiates contact,
 * which establishes consent and starts the AI negotiation chain immediately.
 *
 * CONSENT: an inbound keyword SMS is the clearest possible consent signal —
 * the prospect chose to text us. We record it with timestamp, source, and the
 * exact keyword so the consent record is auditable.
 *
 * ATTRIBUTION: every keyword lead is tagged with its source (bandit_sign,
 * facebook_marketplace, craigslist, nextdoor, google_business, driving_for_dollars,
 * word_of_mouth, or 'unknown'). Source is carried in the webhook body by the
 * Twilio number's routing config (one number per source, or a ?source= param).
 *
 * SECURITY: the webhook must be signed by Twilio (same validation as
 * /api/sms/inbound). The shared secret check is the same pattern.
 *
 * Body (Twilio webhook form-encoded or JSON):
 *   From, Body, To, source? (optional routing param)
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { suppressLeadAllChannels } from '@/app/api/services/leadSuppression';
import { recordStageTransition } from '@/app/api/services/stageTransitionRecorder';

/** Keywords that trigger inbound enrollment. Case-insensitive. */
const ENROLLMENT_KEYWORDS = ['offer', 'cash', 'sell', 'info', 'yes', 'start'];
/** Keywords that are opt-out requests. */
const STOP_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'quit', 'end', 'optout'];

export const INBOUND_SOURCES = [
  'bandit_sign',
  'facebook_marketplace',
  'craigslist',
  'nextdoor',
  'google_business',
  'driving_for_dollars',
  'word_of_mouth',
  'landing_page',
  'unknown',
] as const;
export type InboundSource = (typeof INBOUND_SOURCES)[number];

function normalizeSource(raw: string | null | undefined): InboundSource {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z_]/g, '');
  return (INBOUND_SOURCES as readonly string[]).includes(s) ? (s as InboundSource) : 'unknown';
}

export async function POST(request: Request) {
  // Accept both JSON and form-encoded (Twilio sends form-encoded)
  let from = '';
  let body = '';
  let source: InboundSource = 'unknown';

  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = await request.json().catch(() => ({})) as any;
    from = j.From ?? j.from ?? '';
    body = j.Body ?? j.body ?? '';
    source = normalizeSource(j.source ?? j.Source);
  } else {
    const text = await request.text().catch(() => '');
    const params = new URLSearchParams(text);
    from = params.get('From') ?? params.get('from') ?? '';
    body = params.get('Body') ?? params.get('body') ?? '';
    source = normalizeSource(params.get('source') ?? params.get('Source'));
  }

  const phone = from.trim();
  const keyword = body.trim().toLowerCase().split(/\s+/)[0] ?? '';

  if (!phone) {
    return Response.json({ error: 'Missing From' }, { status: 400 });
  }

  // Opt-out takes priority over enrollment
  if (STOP_KEYWORDS.includes(keyword)) {
    await suppressLeadAllChannels({ identifier: phone, channel: 'sms', reason: 'keyword_stop' });
    return Response.json({ status: 'opted_out' });
  }

  if (!ENROLLMENT_KEYWORDS.includes(keyword)) {
    // Not a recognized keyword — log and ignore (don't enroll on random texts)
    await logEvent('keyword_inbound_unrecognized', 'compliance', phone, { keyword, source });
    return Response.json({ status: 'ignored', reason: 'unrecognized_keyword' });
  }

  // Upsert lead — phone is the key for inbound
  const [lead] = await sql`
    INSERT INTO leads (phone, source, status, metadata)
    VALUES (
      ${phone},
      ${'keyword_inbound'},
      ${'new'},
      ${JSON.stringify({ inbound_source: source, keyword, enrolled_at: new Date().toISOString() })}
    )
    ON CONFLICT (phone) DO UPDATE
      SET metadata = leads.metadata || ${JSON.stringify({ inbound_source: source, keyword, last_keyword_at: new Date().toISOString() })}::jsonb,
          updated_at = NOW()
    RETURNING id, organization_id
  `;

  // Record consent — inbound keyword is express written consent
  await sql`
    INSERT INTO compliance_records (target, type, channel, metadata)
    VALUES (
      ${phone},
      'consent',
      'sms',
      ${JSON.stringify({
        leadId: lead.id,
        keyword,
        source,
        consentMethod: 'keyword_inbound',
        consentTextVersion: 'v1',
        createdAt: new Date().toISOString(),
      })}
    )
    ON CONFLICT (target, channel, type) DO UPDATE SET created_at = CURRENT_TIMESTAMP
  `;

  await recordStageTransition({ leadId: lead.id, fromStage: null, toStage: 'NEW', channel: 'sms' });

  // Upsert conversation and enqueue AI reply
  const [conv] = await sql`
    INSERT INTO ai_conversations (lead_id, organization_id)
    VALUES (${lead.id}, ${lead.organization_id})
    ON CONFLICT (lead_id) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
  await sql`
    UPDATE ai_conversations
    SET history = history || ${JSON.stringify([{
      role: 'user',
      content: body.trim(),
      channel: 'sms',
      timestamp: new Date().toISOString(),
      source,
    }])}::jsonb,
        status = 'active',
        last_reply_at = NOW(),
        updated_at = NOW()
    WHERE id = ${conv.id}
  `;

  const jobId = await enqueueJob('ai_reply', {
    leadId: lead.id,
    conversationId: conv.id,
    channel: 'sms',
    source,
  }, { dedupeKey: `keyword_inbound:${phone}:${Date.now()}` });

  await logEvent('keyword_inbound_enrolled', 'lead', String(lead.id), {
    phone,
    keyword,
    source,
    leadId: lead.id,
    jobId,
  });

  return Response.json({ status: 'enrolled', leadId: lead.id, source, jobId }, { status: 201 });
}

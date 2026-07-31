/**
 * POST /api/email/inbound
 *
 * This webhook receives inbound emails (e.g., from Mailgun, SendGrid, or a
 * custom forwarder). It finds the corresponding lead, handles unsubscribes,
 * and threads the reply into the same AI conversation pipeline as SMS.
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { registerOptOut } from '@/app/api/utils/compliance';
import { logEvent } from '@/app/api/utils/logger';

const EMAIL_QUOTE_HEADER_REGEX = /On .*wrote:/;
const UNSUBSCRIBE_KEYWORDS = ['unsubscribe', 'stop', 'remove me', 'opt out'];

/**
 * Strips quoted reply text from an email body.
 */
function stripQuotedText(text: string): string {
  const match = text.match(EMAIL_QUOTE_HEADER_REGEX);
  if (match && match.index) {
    return text.substring(0, match.index).trim();
  }
  return text.trim();
}

/**
 * Checks if the email body contains an unsubscribe request.
 * It avoids matching our own quoted footer.
 */
function isUnsubscribe(text: string): boolean {
  const firstLine = text.split('\n')[0].trim().toLowerCase();
  return UNSUBSCRIBE_KEYWORDS.some((kw) => firstLine === kw);
}

export async function POST(req: NextRequest) {
  // Gate 1: Security. The webhook must be called with a shared secret.
  const secret = req.nextUrl.searchParams.get('s');
  if (secret !== process.env.SMS_INBOUND_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { from, text } = body;

  if (!from || typeof from !== 'string' || !from.includes('@')) {
    return NextResponse.json({ error: 'Missing or invalid "from" address' }, { status: 400 });
  }

  const fromEmail = from.toLowerCase().trim();
  const originalText = (text || '').trim();

  // Gate 2: Unsubscribe. This runs before any lead lookup.
  if (isUnsubscribe(originalText)) {
    await registerOptOut(fromEmail, 'email', {
      reason: 'email_unsubscribe_reply',
      rawText: originalText,
    });
    return NextResponse.json({ status: 'opted_out' });
  }

  // Find the lead associated with this email address. We only consider active leads.
  const [lead] = await sql`
    SELECT id, organization_id, ai_paused
    FROM leads
    WHERE lower(email) = ${fromEmail}
      AND status NOT IN ('CLOSED_WON', 'CLOSED_LOST', 'ARCHIVED')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!lead) {
    return NextResponse.json({ status: 'ignored', reason: 'no_matching_lead' });
  }

  const cleanText = stripQuotedText(originalText);
  if (!cleanText) {
    return NextResponse.json({ status: 'ignored', reason: 'empty_after_quote_strip' });
  }

  // This logic mirrors the SMS inbound route to ensure convergence.
  const [conversation] = await sql`
    INSERT INTO ai_conversations (lead_id, channel, history)
    VALUES (${lead.id}, 'email', '[]'::jsonb)
    ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
    RETURNING *
  `;

  await sql`
    UPDATE ai_conversations
    SET history = history || ${JSON.stringify([{ role: 'user', content: cleanText }])}::jsonb,
        status = 'needs_review',
        requires_human = true,
        last_message_at = NOW()
    WHERE id = ${conversation.id}
  `;

  await logEvent({
    type: 'inbound_message_received',
    targetType: 'lead',
    targetId: lead.id,
    payload: { channel: 'email', from: fromEmail, text: cleanText },
  });

  // If the lead's AI is paused, we park the message but don't queue a reply.
  if (lead.ai_paused) {
    return NextResponse.json({ status: 'recorded', aiQueued: false });
  }

  // Enqueue the SAME job as the SMS path.
  const jobId = await enqueueJob('ai_reply', {
    leadId: lead.id,
    conversationId: conversation.id,
  });

  return NextResponse.json({
    status: 'recorded',
    aiQueued: true,
    jobId,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await context.params;
    const prospectId = parseInt(resolvedParams.id);

    if (isNaN(prospectId)) {
      return NextResponse.json({ error: 'Invalid prospect ID' }, { status: 400 });
    }

    // Get outbound messages from jobs table
    const outboundJobs = await sql`
      SELECT
        id,
        "type",
        status,
        payload,
        created_at,
        updated_at
      FROM jobs
      WHERE "type" IN ('send_email', 'send_message')
        AND status = 'completed'
        AND (
          payload->>'leadId' = ${prospectId.toString()}
          OR payload->>'lead_id' = ${prospectId.toString()}
        )
      ORDER BY created_at ASC
      LIMIT 50
    `;

    // Get AI reply jobs (contain inbound context)
    const aiReplyJobs = await sql`
      SELECT
        id,
        "type",
        status,
        payload,
        created_at,
        updated_at
      FROM jobs
      WHERE "type" = 'ai_reply'
        AND (
          payload->>'leadId' = ${prospectId.toString()}
          OR payload->>'lead_id' = ${prospectId.toString()}
        )
      ORDER BY created_at ASC
      LIMIT 50
    `;

    // Get message_events - note: this table uses direction instead of type, and contact_id instead of lead_id
    const events = await sql`
      SELECT
        id,
        direction,
        status,
        metadata,
        created_at
      FROM message_events
      WHERE contact_id = ${prospectId}
      ORDER BY created_at ASC
      LIMIT 100
    `.catch(() => []);

    // Get lead info
    const [lead] = await sql`
      SELECT l.name, l.email, l.metadata, clq.touch_number, clq.status as queue_status, clq.expected_value
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.id = ${prospectId}
    `;

    // Build messages array
    const messages: Array<{
      id: string;
      type: 'outbound' | 'inbound';
      subject?: string;
      content: string;
      status: string;
      sentAt: string;
      channel: string;
    }> = [];

    // Add outbound messages from jobs
    for (const msg of outboundJobs) {
      const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : (msg.payload || {});
      messages.push({
        id: `job-${msg.id}`,
        type: 'outbound',
        subject: payload.subject || 'Property Inquiry',
        content: payload.body || payload.content || `Hi ${lead?.name?.split(' ')[0] || 'there'},\n\nI noticed your property and wanted to reach out. I'm a local real estate investor and I help homeowners like yourself who might be looking for a quick, hassle-free sale.\n\nWould you be interested in receiving a no-obligation cash offer?\n\nBest regards,\nDealFlow AI`,
        status: msg.status === 'completed' ? 'delivered' : 'pending',
        sentAt: msg.created_at,
        channel: 'email',
      });
    }

    // Add inbound messages from AI reply jobs
    for (const msg of aiReplyJobs) {
      const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : (msg.payload || {});
      if (payload.message || payload.content) {
        messages.push({
          id: `inbound-${msg.id}`,
          type: 'inbound',
          content: payload.message || payload.content,
          status: 'received',
          sentAt: new Date(new Date(msg.created_at).getTime() - 3600000).toISOString(),
          channel: 'email',
        });
      }
    }

    // Add events from message_events
    for (const evt of events) {
      const meta = typeof evt.metadata === 'string' ? JSON.parse(evt.metadata) : (evt.metadata || {});

      if (evt.direction === 'outbound' && evt.status === 'sent') {
        if (!messages.find(m => m.sentAt === evt.created_at)) {
          messages.push({
            id: `evt-${evt.id}`,
            type: 'outbound',
            subject: meta.subject || 'Property Inquiry',
            content: meta.body || meta.content || 'Email sent',
            status: 'delivered',
            sentAt: evt.created_at,
            channel: 'email',
          });
        }
      } else if (evt.direction === 'inbound') {
        messages.push({
          id: `evt-${evt.id}`,
          type: 'inbound',
          content: meta.content || meta.body || meta.message || 'Reply received',
          status: 'received',
          sentAt: evt.created_at,
          channel: meta.channel || 'email',
        });
      }
    }

    // Sort by date
    messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

    // Dedupe
    const deduped = messages.filter((msg, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr[idx - 1];
      const timeDiff = Math.abs(new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime());
      if (timeDiff < 300000 && msg.type === prev.type && msg.content === prev.content) {
        return false;
      }
      return true;
    });

    return NextResponse.json({
      prospectId,
      prospectName: lead?.name || 'Unknown',
      prospectEmail: lead?.email,
      touchCount: lead?.touch_number || deduped.filter(m => m.type === 'outbound').length,
      queueStatus: lead?.queue_status,
      expectedValue: lead?.expected_value,
      messages: deduped,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching prospect messages:', errorMessage, error);
    return NextResponse.json({ error: 'Failed to fetch messages', details: errorMessage }, { status: 500 });
  }
}

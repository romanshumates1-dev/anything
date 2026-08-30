import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';

const CONTACT_RATE_LIMIT = 5; // 5 submissions per hour

export async function POST(request: Request) {
  try {
    // Rate limiting
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateCheck = await rateLimitByUser(clientIp, 'contact', CONTACT_RATE_LIMIT);
    if (!rateCheck.allowed) {
      return Response.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name, email, company, subject, message } = body;

    // Zod validation
    if (!name || typeof name !== 'string' || name.length > 100) {
      return Response.json(
        { error: { code: 'INVALID_INPUT', message: 'Name is required and must be under 100 characters' } },
        { status: 400 }
      );
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { error: { code: 'INVALID_INPUT', message: 'Valid email is required' } },
        { status: 400 }
      );
    }
    if (!subject || typeof subject !== 'string' || subject.length > 200) {
      return Response.json(
        { error: { code: 'INVALID_INPUT', message: 'Subject is required and must be under 200 characters' } },
        { status: 400 }
      );
    }
    if (!message || typeof message !== 'string' || message.length > 5000) {
      return Response.json(
        { error: { code: 'INVALID_INPUT', message: 'Message is required and must be under 5000 characters' } },
        { status: 400 }
      );
    }

    // Store to DB
    const id = `contact_${crypto.randomUUID().replace(/-/g, '')}`;
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await sql`
      INSERT INTO contact_messages (id, name, email, company, subject, message, ip_address, user_agent)
      VALUES (${id}, ${name}, ${email}, ${company || null}, ${subject}, ${message}, ${clientIp}, ${userAgent})
    `;

    await logEvent('contact_message_received', 'contact_message', id, {
      name,
      email,
      subject,
    });

    // Operator notification — two channels, both reusing existing surfaces:
    // 1) human_approvals row -> shows in the owner's /approvals inbox + count
    //    badge (same queue as owner-range/contract approvals; org 'default'
    //    matches the approvals view's session fallback).
    // 2) optional webhook POST when CONTACT_NOTIFY_WEBHOOK_URL is set (Slack/
    //    Zapier-style). Failures are logged, never surfaced to the visitor.
    try {
      await sql`
        INSERT INTO human_approvals (id, organization_id, type, context, status)
        VALUES (${crypto.randomUUID()}, 'default', 'contact_message',
                ${JSON.stringify({ contact_id: id, name, email, subject })}, 'PENDING')
      `;
    } catch (notifyErr) {
      console.error('contact: approvals-inbox notification failed', notifyErr);
    }
    const webhookUrl = process.env.CONTACT_NOTIFY_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: `New contact message from ${name} <${email}>: ${subject}`,
            contact_id: id,
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (webhookErr) {
        console.error('contact: operator webhook failed', webhookErr);
      }
    }

    return Response.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/contact error', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to process contact message' } },
      { status: 500 }
    );
  }
}
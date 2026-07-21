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

    // TODO: Send notification email/webhook to operator
    // Will be implemented via SUPPORT_EMAIL webhook in Phase 1 completion

    return Response.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/contact error', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to process contact message' } },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { processInboundSms } from '@/app/api/services/inboundSms';
import { withContactLock } from '@/app/api/utils/contactLock';

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { from, to, message } = body as { from: string; to: string; message: string };
    const organizationId = (session.user as any).organizationId || 'default';

    if (!from || !message) {
      return NextResponse.json({ error: 'Missing from or message' }, { status: 400 });
    }

    // Process inbound (opt-out check, routing, etc.)
    const result = await processInboundSms({ from, to, body: message, organizationId });

    // If it's a contact reply, wrap in a contact lock to prevent double-processing
    if (result.action === 'contact_reply') {
      await withContactLock(result.contactId, async () => {
        // In production: classify intent, negotiate, etc.
        // For now, just mark as ENGAGED if reply is affirmative
        if (/^(yes|yeah|yep|i am|interested|selling|sell it|i'm in|let'?s talk)$/i.test(message.trim())) {
          await sql`
            UPDATE campaign_contacts
            SET status = 'ENGAGED', updated_at = now()
            WHERE id = ${result.contactId}
          `;
        }
      });
    }

    await logEvent('inbound_sms', 'sms', from, { to, action: result.action, messageLength: message.length }, organizationId);

    return NextResponse.json({ received: true, action: result.action });
  } catch (error: any) {
    console.error('POST /api/outreach/inbound error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}
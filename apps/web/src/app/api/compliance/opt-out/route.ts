import { registerOptOut } from '../../utils/compliance';
import { logEvent } from '../../utils/logger';

export async function POST(request: Request) {
  // SECURITY: opt-outs are provider/"STOP"-driven webhooks. Secret-gate them
  // (same pattern as /api/sms/inbound) so they can't be triggered anonymously
  // to suppress arbitrary numbers.
  const secret = process.env.SMS_INBOUND_SECRET;
  const provided = request.headers.get('x-sms-secret');
  if (!secret || provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { target, channel, reason } = await request.json();

    if (!target || !channel) {
      return Response.json({ error: 'Target and Channel required' }, { status: 400 });
    }

    await registerOptOut(target, channel, { reason });
    await logEvent('compliance_opt_out_received', 'compliance', target, { channel, reason });

    return Response.json({ success: true, message: 'Opt-out recorded' });
  } catch (error: any) {
    console.error('POST /api/compliance/opt-out error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

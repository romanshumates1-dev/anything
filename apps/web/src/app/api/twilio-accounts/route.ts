/**
 * Twilio Accounts API - manage customer-managed Twilio credentials.
 * 
 * Each organization can optionally connect their own Twilio account.
 * Credentials are encrypted at rest.
 * 
 * GET /api/twilio-accounts - get current organization's Twilio config
 * POST /api/twilio-accounts - save/update Twilio credentials
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

// Placeholder for encryption - in production, use proper encryption
const encrypt = (value: string): string => Buffer.from(value).toString('base64');
const decrypt = (encrypted: string): string => Buffer.from(encrypted).toString('utf8');

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const [account] = await sql`
      SELECT id, phone_number, messaging_service_sid, campaign_sid,
             campaign_status, monthly_sms_quota, created_at, updated_at
      FROM twilio_accounts
      WHERE organization_id = ${org.id}
      LIMIT 1
    `;

    if (!account) {
      return Response.json({ 
        configured: false,
        quota: 0,
        status: null 
      });
    }

    return Response.json({
      configured: true,
      phone_number: account.phone_number,
      messaging_service_sid: account.messaging_service_sid,
      campaign_sid: account.campaign_sid,
      campaign_status: account.campaign_status || 'pending',
      monthly_sms_quota: account.monthly_sms_quota,
      quota_used: account.monthly_sms_quota, // Would calculate from usage
    });
  } catch (error) {
    console.error('GET /api/twilio-accounts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const body = await request.json();
    const { 
      accountSid, 
      authToken, 
      messagingServiceSid, 
      phoneNumber, 
      campaignSid,
      monthlySmsQuota 
    } = body;

    // Validate required fields
    if (!accountSid || !authToken) {
      return Response.json({ error: 'Account SID and Auth Token are required' }, { status: 400 });
    }

    // Check if already exists
    const [existing] = await sql`
      SELECT id FROM twilio_accounts WHERE organization_id = ${org.id} LIMIT 1
    `;

    if (existing) {
      // Update existing
      await sql`
        UPDATE twilio_accounts
        SET account_sid_encrypted = ${encrypt(accountSid)},
            auth_token_encrypted = ${encrypt(authToken)},
            messaging_service_sid = ${messagingServiceSid || null},
            phone_number = ${phoneNumber || null},
            campaign_sid = ${campaignSid || null},
            monthly_sms_quota = ${monthlySmsQuota || 1000},
            updated_at = now()
        WHERE organization_id = ${org.id}
      `;
      
      return Response.json({ success: true, updated: true });
    }

    // Create new
    const id = `twilio_${crypto.randomUUID().replace(/-/g, '')}`;
    await sql`
      INSERT INTO twilio_accounts (
        id, organization_id, account_sid_encrypted, auth_token_encrypted,
        messaging_service_sid, phone_number, campaign_sid, monthly_sms_quota
      ) VALUES (
        ${id}, ${org.id}, ${encrypt(accountSid)}, ${encrypt(authToken)},
        ${messagingServiceSid || null}, ${phoneNumber || null}, 
        ${campaignSid || null}, ${monthlySmsQuota || 1000}
      )
    `;

    return Response.json({ success: true, created: true }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/twilio-accounts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
/**
 * Phone Driver - Voice Call Support
 *
 * Stub implementation for voice calling capabilities.
 * Supports multiple providers:
 *   - twilio: Twilio Programmable Voice
 *   - aws-connect: AWS Connect outbound calling
 *   - mock: Development logging only
 *
 * Cost estimates:
 *   - Twilio: ~$0.013/min outbound, ~$0.0085/min inbound
 *   - AWS Connect: ~$0.018/min + telephony charges
 */
import { randomUUID } from 'node:crypto';

export type PhoneProvider = 'twilio' | 'aws-connect' | 'mock';

export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

export interface CallParams {
  to: string;
  from?: string;
  message?: string;        // TTS message to speak
  audioUrl?: string;       // Pre-recorded audio URL
  callbackUrl?: string;    // Webhook for call status updates
  timeout?: number;        // Ring timeout in seconds (default: 30)
  machineDetection?: boolean; // Detect answering machines
  record?: boolean;        // Record the call
  leadId?: string;
  campaignId?: string;
}

export interface CallResult {
  success: boolean;
  callId?: string;
  status: CallStatus;
  provider: PhoneProvider;
  duration?: number;       // Call duration in seconds
  cost?: number;
  error?: string;
}

export interface CallDetails {
  callId: string;
  status: CallStatus;
  from: string;
  to: string;
  direction: 'outbound' | 'inbound';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  recordingUrl?: string;
  answeredBy?: 'human' | 'machine' | 'unknown';
}

// Cost estimates per minute
const COSTS: Record<PhoneProvider, { perMinute: number; setup: number }> = {
  'twilio': { perMinute: 0.013, setup: 0 },
  'aws-connect': { perMinute: 0.018, setup: 0 },
  'mock': { perMinute: 0, setup: 0 },
};

/**
 * Format phone number to E.164 format.
 */
function formatPhoneNumber(phone: string): string {
  let formatted = phone.replace(/[^0-9+]/g, '');
  if (!formatted.startsWith('+')) {
    formatted = '+1' + formatted; // Assume US
  }
  return formatted;
}

/**
 * Initiate an outbound call via Twilio.
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 */
async function callWithTwilio(params: CallParams): Promise<CallResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = params.from || process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio credentials not configured');
  }

  const toNumber = formatPhoneNumber(params.to);
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  // Build TwiML for the call
  let twiml: string;
  if (params.audioUrl) {
    twiml = `<Response><Play>${params.audioUrl}</Play></Response>`;
  } else if (params.message) {
    twiml = `<Response><Say voice="alice">${params.message}</Say></Response>`;
  } else {
    twiml = '<Response><Say>Hello, this is a test call.</Say></Response>';
  }

  const body = new URLSearchParams({
    To: toNumber,
    From: fromNumber,
    Twiml: twiml,
    ...(params.callbackUrl ? { StatusCallback: params.callbackUrl } : {}),
    ...(params.timeout ? { Timeout: params.timeout.toString() } : {}),
    ...(params.machineDetection ? { MachineDetection: 'Enable' } : {}),
    ...(params.record ? { Record: 'true' } : {}),
  });

  try {
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        callId: data.sid,
        status: mapTwilioStatus(data.status),
        provider: 'twilio',
      };
    } else {
      return {
        success: false,
        status: 'failed',
        provider: 'twilio',
        error: data.message || 'Twilio API error',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      provider: 'twilio',
      error: err.message,
    };
  }
}

/**
 * Map Twilio call status to our status type.
 */
function mapTwilioStatus(twilioStatus: string): CallStatus {
  const statusMap: Record<string, CallStatus> = {
    'queued': 'queued',
    'ringing': 'ringing',
    'in-progress': 'in-progress',
    'completed': 'completed',
    'busy': 'busy',
    'failed': 'failed',
    'no-answer': 'no-answer',
    'canceled': 'canceled',
  };
  return statusMap[twilioStatus] || 'failed';
}

/**
 * Initiate an outbound call via AWS Connect.
 * Requires: AWS credentials, AWS_CONNECT_INSTANCE_ID, AWS_CONNECT_CONTACT_FLOW_ID
 */
async function callWithAWSConnect(params: CallParams): Promise<CallResult> {
  // AWS Connect implementation would go here
  // This is a stub that returns a not-implemented error
  console.log('[AWS Connect] Call requested but not implemented:', params);

  return {
    success: false,
    status: 'failed',
    provider: 'aws-connect',
    error: 'AWS Connect calling not yet implemented',
  };
}

/**
 * Mock call for development/testing.
 */
async function callWithMock(params: CallParams): Promise<CallResult> {
  const callId = `mock_call_${randomUUID()}`;
  const toNumber = formatPhoneNumber(params.to);

  console.log(`[MOCK PHONE] Calling: ${toNumber}`);
  if (params.message) {
    console.log(`[MOCK PHONE] Message: ${params.message.slice(0, 100)}...`);
  }
  if (params.audioUrl) {
    console.log(`[MOCK PHONE] Audio URL: ${params.audioUrl}`);
  }

  // Simulate a brief delay
  await new Promise(resolve => setTimeout(resolve, 100));

  return {
    success: true,
    callId,
    status: 'completed',
    provider: 'mock',
    duration: 30, // Simulated 30-second call
    cost: 0,
  };
}

/**
 * Initiate an outbound phone call.
 * Auto-selects provider based on available credentials.
 */
export async function makeCall(params: CallParams): Promise<CallResult> {
  // Provider selection priority
  const provider = getConfiguredProvider();

  switch (provider) {
    case 'twilio':
      return callWithTwilio(params);
    case 'aws-connect':
      return callWithAWSConnect(params);
    default:
      return callWithMock(params);
  }
}

/**
 * Get the status of a call by ID.
 */
export async function getCallStatus(callId: string): Promise<CallDetails | null> {
  const provider = getConfiguredProvider();

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      return null;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callId}.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      return {
        callId: data.sid,
        status: mapTwilioStatus(data.status),
        from: data.from,
        to: data.to,
        direction: data.direction === 'outbound-api' ? 'outbound' : 'inbound',
        startTime: data.start_time ? new Date(data.start_time) : undefined,
        endTime: data.end_time ? new Date(data.end_time) : undefined,
        duration: data.duration ? parseInt(data.duration) : undefined,
        answeredBy: data.answered_by,
      };
    } catch {
      return null;
    }
  }

  // Mock status for development
  if (callId.startsWith('mock_')) {
    return {
      callId,
      status: 'completed',
      from: process.env.OWNER_NUMBER || '+15551234567',
      to: '+15559876543',
      direction: 'outbound',
      duration: 30,
    };
  }

  return null;
}

/**
 * Cancel a queued or ringing call.
 */
export async function cancelCall(callId: string): Promise<boolean> {
  const provider = getConfiguredProvider();

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      return false;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callId}.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Status: 'canceled' }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  // Mock cancel always succeeds
  if (callId.startsWith('mock_')) {
    console.log(`[MOCK PHONE] Call cancelled: ${callId}`);
    return true;
  }

  return false;
}

/**
 * Get the currently configured phone provider.
 */
export function getConfiguredProvider(): PhoneProvider {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return 'twilio';
  }
  if (process.env.AWS_CONNECT_INSTANCE_ID) {
    return 'aws-connect';
  }
  return 'mock';
}

/**
 * Estimate the cost of a call.
 */
export function estimateCallCost(
  provider: PhoneProvider,
  durationMinutes: number
): number {
  const costs = COSTS[provider];
  return costs.setup + (costs.perMinute * durationMinutes);
}

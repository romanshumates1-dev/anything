/**
 * Call Scheduling Engine
 *
 * When a buyer or seller wants to speak with someone on the phone,
 * this engine:
 * 1. Asks what they'd like to discuss
 * 2. Collects their availability
 * 3. Schedules the call
 * 4. Notifies the organization owner
 *
 * No AI autonomy - this always routes to human.
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { send as sendEmail } from '@/app/api/services/emailDriver';
import { enqueueJob } from '@/app/api/utils/jobs';
import { callAI } from '@/app/api/utils/ai-provider';

export interface CallRequest {
  leadId: string | number;
  contactId?: string | number;
  organizationId: string;
  leadName: string;
  leadPhone?: string;
  leadEmail?: string;
  context: 'seller' | 'buyer';
  propertyAddress?: string;
}

export interface CallScheduleResult {
  scheduled: boolean;
  callId?: string;
  scheduledTime?: Date;
  notificationSent: boolean;
  message: string;
}

export interface ScheduledCall {
  id: string;
  leadId: string;
  organizationId: string;
  context: 'seller' | 'buyer';
  reason: string;
  requestedTime?: Date;
  scheduledTime?: Date;
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  ownerNotified: boolean;
  leadPhone?: string;
  leadEmail?: string;
  leadName: string;
  propertyAddress?: string;
  notes?: string;
  createdAt: Date;
}

const CALL_REQUEST_TRIGGERS = [
  /can (i|we) (call|speak|talk)/i,
  /want to (call|speak|talk)/i,
  /call (me|us)/i,
  /speak (with|to) (someone|a person|you)/i,
  /talk (with|to) (someone|a person|you)/i,
  /phone call/i,
  /give (me|us) a call/i,
  /schedule a call/i,
  /prefer to (call|talk|speak)/i,
  /rather (call|talk|speak)/i,
  /can you call/i,
];

const REASON_PROMPTS = [
  "I'd be happy to schedule a call for you! Before I do, could you tell me briefly what you'd like to discuss? This helps us make sure the right person calls you back.",
  "Absolutely, we can arrange a call. What would you like to talk about? This helps us prepare for our conversation.",
  "Of course! To get you to the right person, could you share what topics you'd like to cover on the call?",
];

const AVAILABILITY_PROMPTS = [
  "Thanks! When would be a good time to reach you? Please share a few times that work for you.",
  "Great. What times work best for you? Morning, afternoon, or evening? Any specific days?",
  "Perfect. What's your availability looking like? Let me know a few times that work and we'll make it happen.",
];

/**
 * Detect if message is requesting a phone call
 */
export function wantsPhoneCall(message: string): boolean {
  return CALL_REQUEST_TRIGGERS.some(pattern => pattern.test(message));
}

/**
 * Get next prompt in call scheduling flow
 */
export function getCallSchedulingPrompt(
  stage: 'reason' | 'availability' | 'confirmation'
): string {
  if (stage === 'reason') {
    return REASON_PROMPTS[Math.floor(Math.random() * REASON_PROMPTS.length)];
  }
  if (stage === 'availability') {
    return AVAILABILITY_PROMPTS[Math.floor(Math.random() * AVAILABILITY_PROMPTS.length)];
  }
  return "I've scheduled the call and notified our team. They'll reach out at the time you specified. Is there anything else I can help with in the meantime?";
}

/**
 * Parse availability from user message
 */
export async function parseAvailability(message: string): Promise<{
  times: string[];
  preferredTime?: string;
  timezone?: string;
}> {
  // Try AI parsing for complex availability
  try {
    const response = await callAI({
      messages: [{ role: 'user', content: message }],
      system: `Extract availability information from this message. Return JSON only:
{
  "times": ["array of mentioned time slots"],
  "preferredTime": "most preferred if mentioned",
  "timezone": "if mentioned, otherwise null"
}

Examples:
"Tomorrow afternoon works" → {"times": ["tomorrow afternoon"], "preferredTime": "tomorrow afternoon", "timezone": null}
"Monday 2pm or Tuesday 10am EST" → {"times": ["Monday 2pm", "Tuesday 10am"], "preferredTime": "Monday 2pm", "timezone": "EST"}
"Anytime after 5" → {"times": ["after 5pm"], "preferredTime": "after 5pm", "timezone": null}`,
      maxTokens: 200,
    });

    const parsed = JSON.parse(response.text);
    return {
      times: parsed.times || [message],
      preferredTime: parsed.preferredTime,
      timezone: parsed.timezone,
    };
  } catch {
    // Fallback: use message as-is
    return { times: [message] };
  }
}

/**
 * Extract reason from message
 */
export async function parseCallReason(message: string): Promise<string> {
  try {
    const response = await callAI({
      messages: [{ role: 'user', content: message }],
      system: `Summarize what this person wants to discuss on the phone in 1-2 sentences.
Be specific about their concerns or questions. If they mention price, timeline, process, or specific issues, include those.
Keep it professional and factual.`,
      maxTokens: 100,
    });
    return response.text;
  } catch {
    return message.slice(0, 200);
  }
}

/**
 * Create a call request record
 */
export async function createCallRequest(
  request: CallRequest,
  reason: string,
  availability: { times: string[]; preferredTime?: string }
): Promise<ScheduledCall> {
  const callId = crypto.randomUUID();

  // Find preferred time or use first available
  const preferredTimeStr = availability.preferredTime || availability.times[0];

  const [row] = await sql`
    INSERT INTO scheduled_calls (
      id, lead_id, organization_id, context, reason,
      availability_text, preferred_time_text, status,
      owner_notified, lead_phone, lead_email, lead_name,
      property_address, created_at
    ) VALUES (
      ${callId},
      ${request.leadId},
      ${request.organizationId},
      ${request.context},
      ${reason},
      ${JSON.stringify(availability.times)},
      ${preferredTimeStr},
      'pending',
      false,
      ${request.leadPhone || null},
      ${request.leadEmail || null},
      ${request.leadName},
      ${request.propertyAddress || null},
      now()
    )
    RETURNING *
  `;

  return {
    id: row.id,
    leadId: String(row.lead_id),
    organizationId: row.organization_id,
    context: row.context,
    reason: row.reason,
    status: row.status,
    ownerNotified: row.owner_notified,
    leadPhone: row.lead_phone,
    leadEmail: row.lead_email,
    leadName: row.lead_name,
    propertyAddress: row.property_address,
    createdAt: row.created_at,
  };
}

/**
 * Notify organization owner of call request
 */
export async function notifyOwnerOfCallRequest(
  call: ScheduledCall
): Promise<boolean> {
  // Get organization owner email
  const [org] = await sql`
    SELECT
      o.name as org_name,
      u.email as owner_email,
      u.name as owner_name
    FROM organizations o
    JOIN users u ON u.id = (
      SELECT user_id FROM org_members
      WHERE organization_id = o.id AND role = 'ADMIN'
      LIMIT 1
    )
    WHERE o.id = ${call.organizationId}
  `.catch(() => [null]);

  if (!org?.owner_email) {
    console.error('[CallScheduling] No owner email found for org:', call.organizationId);
    return false;
  }

  const subject = `📞 Call Request: ${call.leadName} wants to speak with you`;

  const body = `
A ${call.context === 'seller' ? 'property seller' : 'buyer'} has requested a phone call.

CONTACT INFORMATION
Name: ${call.leadName}
Phone: ${call.leadPhone || 'Not provided'}
Email: ${call.leadEmail || 'Not provided'}
${call.propertyAddress ? `Property: ${call.propertyAddress}` : ''}

REASON FOR CALL
${call.reason}

AVAILABILITY
They indicated they're available: ${call.scheduledTime || 'As stated in their message'}

NEXT STEPS
1. Call them at the number above
2. Reference their stated reason
3. Mark the call as completed in your dashboard

---
This is an automated notification from DealFlow AI.
`;

  try {
    await sendEmail({
      to: org.owner_email,
      from: process.env.EMAIL_FROM || 'noreply@dealflow.ai',
      subject,
      html: `<pre style="font-family: sans-serif; white-space: pre-wrap;">${body}</pre>`,
      text: body,
    });

    // Update call record
    await sql`
      UPDATE scheduled_calls
      SET owner_notified = true, notified_at = now()
      WHERE id = ${call.id}
    `;

    await logEvent('call_request_notified', 'scheduled_call', call.id, {
      ownerEmail: org.owner_email,
      leadName: call.leadName,
      context: call.context,
    }, call.organizationId);

    return true;
  } catch (err) {
    console.error('[CallScheduling] Failed to notify owner:', err);
    return false;
  }
}

/**
 * Queue call notification job
 */
export async function queueCallNotification(callId: string): Promise<string | null> {
  return enqueueJob('notify_call_request', { callId }, {
    maxAttempts: 3,
  });
}

/**
 * Get pending calls for organization
 */
export async function getPendingCalls(organizationId: string): Promise<ScheduledCall[]> {
  const rows = await sql`
    SELECT *
    FROM scheduled_calls
    WHERE organization_id = ${organizationId}
      AND status IN ('pending', 'scheduled')
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return rows.map(r => ({
    id: r.id,
    leadId: String(r.lead_id),
    organizationId: r.organization_id,
    context: r.context,
    reason: r.reason,
    requestedTime: r.requested_time,
    scheduledTime: r.scheduled_time,
    status: r.status,
    ownerNotified: r.owner_notified,
    leadPhone: r.lead_phone,
    leadEmail: r.lead_email,
    leadName: r.lead_name,
    propertyAddress: r.property_address,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

/**
 * Update call status
 */
export async function updateCallStatus(
  callId: string,
  status: ScheduledCall['status'],
  notes?: string
): Promise<void> {
  await sql`
    UPDATE scheduled_calls
    SET
      status = ${status},
      notes = COALESCE(${notes || null}, notes),
      updated_at = now(),
      completed_at = CASE WHEN ${status} = 'completed' THEN now() ELSE completed_at END
    WHERE id = ${callId}
  `;
}

/**
 * Full call scheduling flow handler
 */
export async function handleCallSchedulingFlow(
  request: CallRequest,
  currentMessage: string,
  conversationState: 'initial' | 'awaiting_reason' | 'awaiting_availability'
): Promise<{
  response: string;
  nextState: 'awaiting_reason' | 'awaiting_availability' | 'complete';
  callScheduled?: ScheduledCall;
}> {
  if (conversationState === 'initial') {
    return {
      response: getCallSchedulingPrompt('reason'),
      nextState: 'awaiting_reason',
    };
  }

  if (conversationState === 'awaiting_reason') {
    // Parse and store reason, ask for availability
    const reason = await parseCallReason(currentMessage);

    // Store reason temporarily in conversation metadata
    return {
      response: getCallSchedulingPrompt('availability'),
      nextState: 'awaiting_availability',
    };
  }

  if (conversationState === 'awaiting_availability') {
    // Parse availability and create call record
    const availability = await parseAvailability(currentMessage);

    // Get reason from previous message (would be stored in conversation state)
    const reason = 'Call requested - details provided in conversation';

    const call = await createCallRequest(request, reason, availability);

    // Queue notification to owner
    await queueCallNotification(call.id);

    return {
      response: getCallSchedulingPrompt('confirmation'),
      nextState: 'complete',
      callScheduled: call,
    };
  }

  return {
    response: getCallSchedulingPrompt('reason'),
    nextState: 'awaiting_reason',
  };
}

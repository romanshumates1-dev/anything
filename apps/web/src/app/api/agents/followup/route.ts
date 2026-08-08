/**
 * Follow-Up Optimization Agent
 * Revives and converts inactive leads
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

interface FollowUpRequest {
  leadId: string;
  daysSinceLastContact: number;
  previousMessages?: string[];
  sellerMotivation?: 'speed' | 'price' | 'convenience' | 'unknown';
  pressureLevel?: 'low' | 'medium' | 'high';
}

interface FollowUpResponse {
  message: string;
  tone: string;
  sequenceDay: number;
  isLastAttempt: boolean;
  confidence: number;
}

const FOLLOW_UP_SEQUENCE = [
  { day: 1, template: "Just circling back — still considering offers on the property?" },
  { day: 3, template: "I can adjust terms if needed — what's most important to you right now?" },
  { day: 5, template: "Still interested, or should I close this out on my end?" },
  { day: 7, template: "If timing was the issue, I can be flexible. Let me know either way." },
  { day: 10, template: "Last check-in — are you still looking to sell, or has something changed?" },
];

function getSequenceMessage(days: number, previousMessages: string[] = []): { message: string; sequenceDay: number; isLast: boolean } {
  // Find the appropriate sequence step
  let selectedStep = FOLLOW_UP_SEQUENCE[0];
  let stepIndex = 0;

  for (let i = 0; i < FOLLOW_UP_SEQUENCE.length; i++) {
    if (days >= FOLLOW_UP_SEQUENCE[i].day) {
      selectedStep = FOLLOW_UP_SEQUENCE[i];
      stepIndex = i;
    }
  }

  // Make sure we don't repeat the same message
  let message = selectedStep.template;
  if (previousMessages.includes(message) && stepIndex < FOLLOW_UP_SEQUENCE.length - 1) {
    selectedStep = FOLLOW_UP_SEQUENCE[stepIndex + 1];
    message = selectedStep.template;
  }

  return {
    message,
    sequenceDay: selectedStep.day,
    isLast: stepIndex >= FOLLOW_UP_SEQUENCE.length - 1,
  };
}

function adjustTone(
  baseMessage: string,
  motivation: string,
  pressureLevel: string
): { message: string; tone: string } {
  let tone = 'neutral';
  let message = baseMessage;

  if (pressureLevel === 'high') {
    tone = 'empathetic + urgent';
    message = message.replace(
      "Just circling back",
      "I know things can move fast — just wanted to check in"
    );
  }

  if (motivation === 'speed') {
    tone = 'action-oriented';
    message += " I can close within 2 weeks if that helps.";
  } else if (motivation === 'price') {
    tone = 'value-focused';
    message += " Happy to discuss numbers if that's what's holding things up.";
  } else if (motivation === 'convenience') {
    tone = 'ease-focused';
    message += " I handle everything — no stress on your end.";
  }

  return { message, tone };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: FollowUpRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    leadId,
    daysSinceLastContact,
    previousMessages = [],
    sellerMotivation = 'unknown',
    pressureLevel = 'medium'
  } = body;

  if (!leadId || daysSinceLastContact === undefined) {
    return Response.json({ error: 'leadId and daysSinceLastContact required' }, { status: 400 });
  }

  try {
    const { message: baseMessage, sequenceDay, isLast } = getSequenceMessage(daysSinceLastContact, previousMessages);
    const { message, tone } = adjustTone(baseMessage, sellerMotivation, pressureLevel);

    // Calculate confidence based on sequence position and days
    let confidence = 0.40;
    if (daysSinceLastContact <= 3) confidence = 0.50;
    else if (daysSinceLastContact <= 7) confidence = 0.35;
    else confidence = 0.20;

    if (pressureLevel === 'high') confidence += 0.15;

    const result: FollowUpResponse = {
      message,
      tone,
      sequenceDay,
      isLastAttempt: isLast,
      confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
    };

    console.log(`[FOLLOW-UP] Lead ${leadId}: Day ${sequenceDay}, ${tone}, ${Math.round(confidence * 100)}% confidence`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[FOLLOW-UP] Error:', error);
    return Response.json({ error: 'Follow-up generation failed' }, { status: 500 });
  }
}

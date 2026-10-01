import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { callAI } from '@/app/api/utils/ai-provider';
import { authorizeAiRequest } from '@/app/api/utils/aiCreditGate';
import { providerFailureResponse } from '@/app/api/utils/providerFailureResponse';
import { checkRateLimit } from '@/app/api/services/rateLimiter';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

/**
 * AI INPUT BOUNDS.
 *
 * User-controlled text that reaches the model (and is stored) must have an
 * explicit ceiling, not just a floor: an unbounded prompt is simultaneously a
 * provider-cost amplifier, a latency/timeout risk, and a database-growth
 * vector. `prompt` is the description being generated from; the two aux fields
 * are short labels.
 */
const MAX_PROMPT_CHARS = 2000;
const MAX_AUX_CHARS = 500;

/**
 * POST /api/templates/generate
 *
 * AI-powered template generation endpoint.
 * Takes a natural language description and generates campaign templates.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  // Rate limit AI generation requests
  const rateLimitResult = await checkRateLimit(session.user.id, organization.id, 'ai_request');
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: rateLimitResult.message || 'Rate limit exceeded. Please try again later.', resetsAt: rateLimitResult.resetsAt },
      { status: 429 }
    );
  }

  const startTime = Date.now();
  // Phase 11 credit gate: set once a credit is consumed so the catch below can
  // compensate (idempotently) if the provider call or persistence fails — a
  // failed request must never silently burn the customer's credits.
  let releaseAiCredit: (() => Promise<void>) | null = null;

  // A MALFORMED BODY IS A 400, NOT A 500. This sits outside the main try so a
  // broken payload can never be misreported as a server-side failure (and never
  // reaches the credit gate).
  let body: {
    prompt: string;
    campaignGoal?: string;
    targetAudience?: string;
    tone?: 'professional' | 'friendly' | 'direct' | 'empathetic';
    channel?: 'sms' | 'email';
    includeFollowUps?: boolean;
    numberOfFollowUps?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    prompt,
    campaignGoal,
    targetAudience,
    tone = 'professional',
    channel = 'sms',
    includeFollowUps = true,
    numberOfFollowUps = 2,
  } = body;

  // ---- VALIDATION — ALL BEFORE THE CREDIT GATE ----
  //
  // Ordering is load-bearing and was previously violated: the input-bounds
  // checks ran AFTER `authorizeAiRequest`, so an over-long prompt consumed a
  // credit and then returned 400 without ever handing it back — a paid
  // rejection. Every rule here matches the documented invariant "an invalid
  // request must not be charged".
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
    return NextResponse.json(
      { error: 'Please provide a description of at least 10 characters' },
      { status: 400 }
    );
  }

  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { error: `Description must be at most ${MAX_PROMPT_CHARS} characters` },
      { status: 400 }
    );
  }

  for (const [name, value] of [
    ['Campaign goal', campaignGoal],
    ['Target audience', targetAudience],
  ] as const) {
    if (value !== undefined && String(value).length > MAX_AUX_CHARS) {
      return NextResponse.json(
        { error: `${name} must be at most ${MAX_AUX_CHARS} characters` },
        { status: 400 }
      );
    }
  }

  // `channel` and `tone` are interpolated into the SYSTEM prompt (see
  // buildSystemPrompt) and persisted. They arrive as untyped JSON, so without
  // an allowlist here a caller could push arbitrary-length, arbitrary-content
  // text past every ceiling above and straight into the provider request —
  // both a prompt-injection vector and a cost amplifier. Enums, not slices.
  if (channel !== 'sms' && channel !== 'email') {
    return NextResponse.json(
      { error: "channel must be 'sms' or 'email'" },
      { status: 400 }
    );
  }
  if (!['professional', 'friendly', 'direct', 'empathetic'].includes(tone)) {
    return NextResponse.json({ error: 'Unknown tone' }, { status: 400 });
  }
  if (
    numberOfFollowUps !== undefined &&
    (!Number.isInteger(numberOfFollowUps) || numberOfFollowUps < 0 || numberOfFollowUps > 5)
  ) {
    return NextResponse.json(
      { error: 'numberOfFollowUps must be an integer between 0 and 5' },
      { status: 400 }
    );
  }

  // Phase 11 credit gate — AFTER validation (an invalid request is never
  // charged) and BEFORE any provider call. INCLUDED plan credits are capped
  // per UTC day/week/month; purchased credits fall through and are never
  // capped. Denial is a 402 with nothing charged.
  const authorization = await authorizeAiRequest(organization.id);
  if (!authorization.ok) {
    return NextResponse.json(
      {
        error: authorization.message,
        reason: authorization.reason,
        code: 'INSUFFICIENT_CREDITS',
      },
      { status: 402 }
    );
  }
  releaseAiCredit = authorization.release;

  try {
    // Build the system prompt for template generation
    const systemPrompt = buildSystemPrompt(channel, tone);
    const userPrompt = buildUserPrompt(
      prompt,
      campaignGoal ? String(campaignGoal) : campaignGoal,
      targetAudience ? String(targetAudience) : targetAudience,
      channel,
      includeFollowUps,
      numberOfFollowUps
    );

    // Call AI to generate the template. A provider failure (billing,
    // credentials, outage) is NOT a 500: it is upstream of this service, so it
    // gets an actionable 502 with the credit handed back — the same treatment
    // negotiation/analyze and conversations/message now give it.
    let aiResponse: Awaited<ReturnType<typeof callAI>>;
    try {
      aiResponse = await callAI({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 1500,
      });
    } catch (error) {
      let creditReleased = false;
      if (releaseAiCredit) {
        try {
          await releaseAiCredit();
          creditReleased = true;
        } catch (releaseError) {
          console.error('POST /api/templates/generate credit release failed', releaseError);
        }
      }
      return providerFailureResponse(error, {
        context: 'templates/generate',
        creditReleased,
      });
    }

    // Parse the AI response
    const parsed = parseAIResponse(aiResponse.text, channel, includeFollowUps);

    const generationId = crypto.randomUUID();
    const generationTimeMs = Date.now() - startTime;

    // Store the generation for analytics and learning
    await sql`
      INSERT INTO ai_template_generations (
        id, organization_id, user_id, prompt, campaign_goal, target_audience,
        tone, channel, generated_subject, generated_body, generated_follow_ups,
        variables_used, model_used, tokens_used, generation_time_ms
      ) VALUES (
        ${generationId},
        ${organization.id},
        ${session.user.id},
        ${prompt},
        ${campaignGoal || null},
        ${targetAudience || null},
        ${tone},
        ${channel},
        ${parsed.subject || null},
        ${parsed.body},
        ${JSON.stringify(parsed.followUps)},
        ${parsed.variables},
        ${aiResponse.model || 'unknown'},
        ${aiResponse.usage?.input_tokens + aiResponse.usage?.output_tokens || 0},
        ${generationTimeMs}
      )
    `;

    return NextResponse.json({
      id: generationId,
      subject: parsed.subject,
      body: parsed.body,
      followUps: parsed.followUps,
      variables: parsed.variables,
      channel,
      tone,
      generationTimeMs,
    });
  } catch (error: any) {
    // Compensate a consumed credit when the request ultimately failed.
    if (releaseAiCredit) {
      try {
        await releaseAiCredit();
      } catch (releaseError) {
        console.error('POST /api/templates/generate credit release failed', releaseError);
      }
    }
    console.error('POST /api/templates/generate error', error);
    return NextResponse.json(
      { error: 'Failed to generate template. Please try again.' },
      { status: 500 }
    );
  }
}

function buildSystemPrompt(channel: string, tone: string): string {
  const toneDescriptions: Record<string, string> = {
    professional: 'professional and business-like, yet approachable',
    friendly: 'warm, conversational, and personable',
    direct: 'straightforward and to-the-point, respecting the recipient\'s time',
    empathetic: 'understanding and compassionate, acknowledging potential challenges',
  };

  const toneDesc = toneDescriptions[tone] || toneDescriptions.professional;

  return `You are an expert real estate marketing copywriter who specializes in creating high-converting ${channel.toUpperCase()} templates for real estate wholesalers and investors.

Your templates should be:
- ${toneDesc}
- Compliant with SMS/email marketing best practices
- Personalized using merge variables
- Concise yet compelling
- Designed to generate responses, not just opens

Available merge variables (use exactly as shown):
- {{firstName}} - The recipient's first name
- {{lastName}} - The recipient's last name
- {{propertyAddress}} - The property street address
- {{city}} - The property city
- {{state}} - The property state
- {{propertyType}} - Type of property (single-family, multi-family, etc.)

${channel === 'sms' ? `
SMS Guidelines:
- Keep the opening message under 160 characters when possible (1 segment = lower cost)
- If longer is needed, stay under 320 characters (2 segments max)
- Start with a personal greeting using {{firstName}}
- Include a clear call-to-action
- Avoid spam trigger words
- No URLs in cold outreach
` : `
Email Guidelines:
- Write a compelling subject line (under 50 characters)
- Keep the body concise but informative
- Include a clear value proposition
- End with a soft call-to-action
- Be personable, avoid corporate jargon
`}

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  ${channel === 'email' ? '"subject": "Your subject line here",' : ''}
  "body": "Your main message template here",
  "followUps": [
    { "body": "First follow-up message", "delayHours": 24 },
    { "body": "Second follow-up message", "delayHours": 48 }
  ],
  "variables": ["{{firstName}}", "{{propertyAddress}}"]
}

Do not include any text outside the JSON object.`;
}

function buildUserPrompt(
  prompt: string,
  campaignGoal?: string,
  targetAudience?: string,
  channel?: string,
  includeFollowUps?: boolean,
  numberOfFollowUps?: number
): string {
  let userPrompt = `Create a ${channel} template based on this description:\n\n"${prompt}"`;

  if (campaignGoal) {
    userPrompt += `\n\nCampaign Goal: ${campaignGoal}`;
  }

  if (targetAudience) {
    userPrompt += `\n\nTarget Audience: ${targetAudience}`;
  }

  if (includeFollowUps && numberOfFollowUps && numberOfFollowUps > 0) {
    userPrompt += `\n\nAlso create ${numberOfFollowUps} follow-up message(s) for non-responders.`;
  } else {
    userPrompt += '\n\nDo not include follow-up messages (return an empty followUps array).';
  }

  return userPrompt;
}

function parseAIResponse(
  text: string,
  channel: string,
  includeFollowUps: boolean
): {
  subject?: string;
  body: string;
  followUps: Array<{ body: string; delayHours: number }>;
  variables: string[];
} {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Extract variables from the body and follow-ups
    const variablePattern = /\{\{[a-zA-Z]+\}\}/g;
    const allText = [
      parsed.body || '',
      parsed.subject || '',
      ...(parsed.followUps || []).map((f: any) => f.body || ''),
    ].join(' ');

    const variables = [...new Set(allText.match(variablePattern) || [])];

    return {
      subject: channel === 'email' ? parsed.subject : undefined,
      body: parsed.body || text.trim(),
      followUps: includeFollowUps ? (parsed.followUps || []) : [],
      variables: variables.length > 0 ? variables : ['{{firstName}}', '{{propertyAddress}}'],
    };
  } catch {
    // If JSON parsing fails, use the raw text as the body
    return {
      body: text.trim(),
      followUps: [],
      variables: ['{{firstName}}', '{{propertyAddress}}'],
    };
  }
}

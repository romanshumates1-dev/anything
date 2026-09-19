import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { callAI } from '@/app/api/utils/ai-provider';
import { checkRateLimit } from '@/app/api/services/rateLimiter';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

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

  try {
    const body = await request.json();
    const {
      prompt,
      campaignGoal,
      targetAudience,
      tone = 'professional',
      channel = 'sms',
      includeFollowUps = true,
      numberOfFollowUps = 2,
    } = body as {
      prompt: string;
      campaignGoal?: string;
      targetAudience?: string;
      tone?: 'professional' | 'friendly' | 'direct' | 'empathetic';
      channel?: 'sms' | 'email';
      includeFollowUps?: boolean;
      numberOfFollowUps?: number;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return NextResponse.json(
        { error: 'Please provide a description of at least 10 characters' },
        { status: 400 }
      );
    }

    // Build the system prompt for template generation
    const systemPrompt = buildSystemPrompt(channel, tone);
    const userPrompt = buildUserPrompt(prompt, campaignGoal, targetAudience, channel, includeFollowUps, numberOfFollowUps);

    // Call AI to generate the template
    const aiResponse = await callAI({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1500,
    });

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

/**
 * Support Chat API Route
 *
 * Handles AI-powered support chat messages using the existing AI provider infrastructure.
 * Uses a specialized system prompt with DealFlow AI product knowledge.
 */
import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { callAI, type AnthropicMessage } from '@/app/api/utils/ai-provider';
import { checkRateLimit } from '@/app/api/services/rateLimiter';

const SUPPORT_SYSTEM_PROMPT = `You are the DealFlow AI support assistant - a helpful, knowledgeable guide for users of the DealFlow AI real estate wholesaling platform.

## About DealFlow AI
DealFlow AI is a comprehensive real estate wholesaling automation platform that helps investors find motivated sellers, manage outreach campaigns, negotiate deals, and close contracts faster using AI.

## Core Features
1. **Lead Finder**: Discover motivated sellers through multiple data sources (tax records, probate, pre-foreclosure, absentee owners, vacant properties)
2. **AI Campaigns**: Multi-touch outreach sequences via SMS, email, and direct mail with AI-generated personalized messages
3. **CRM & Contacts**: Manage all your leads, track interactions, and organize by status/stage
4. **Inbox**: Unified conversation view for all SMS and email communications
5. **AI Negotiation**: Get AI-powered negotiation guidance based on property data, comps, and seller motivation
6. **Contracts**: Generate, track, and manage wholesale contracts with inspection timelines
7. **Payouts**: Track assignment fees and profit from closed deals
8. **Analytics**: Campaign performance, funnel metrics, and ROI tracking
9. **Leaderboard & Achievements**: Gamified progress tracking

## Common Tasks - How To Help
- **Creating Campaigns**: Guide users to Campaigns > Launch Campaign. They can select leads, choose channels (SMS/email), set sequences, and schedule.
- **Importing Leads**: Direct to Lead Finder > Import, or drag-and-drop CSV files
- **Understanding Analytics**: Explain the dashboard metrics, campaign stats, and funnel visualization
- **Compliance**: Explain 10DLC SMS requirements, opt-out handling, and TCPA compliance features
- **Pricing/Plans**: Refer them to Settings > Subscription or the pricing page. Plans include Free (limited), Pro ($99/mo), and Enterprise (custom)
- **AI Features**: Explain negotiation analysis, message generation, lead scoring, and sentiment analysis

## Support Guidelines
1. Be concise but thorough - real estate investors are busy
2. Use specific navigation paths (e.g., "Go to Settings > Number Pool")
3. If you don't know something specific, say so and suggest contacting human support
4. For billing issues, account problems, or complex technical issues, recommend escalating to human support
5. Never make up features that don't exist
6. Be encouraging - wholesaling is challenging and users appreciate support

## Tone
Professional but friendly. You understand the real estate investing world. Avoid jargon unless the user seems experienced. Be patient with beginners.

## Limitations
- You cannot access user data, make changes to their account, or perform actions on their behalf
- For sensitive operations (password reset, billing changes, data deletion), always direct to human support
- If unsure about a specific feature or pricing detail, recommend checking the documentation or contacting support`;

interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'Organization not found' }, { status: 403 });
  }

  // Rate limit support chat
  const rateLimitResult = await checkRateLimit(session.userId, organization.id, 'ai_request');
  if (!rateLimitResult.allowed) {
    return Response.json(
      { error: rateLimitResult.message || 'Rate limit exceeded. Please try again later.', resetsAt: rateLimitResult.resetsAt },
      { status: 429 }
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 });
  }

  // Validate and sanitize messages
  const messages: AnthropicMessage[] = body.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: String(m.content).slice(0, 2000), // Limit message length
    }));

  // Keep only the last 10 messages to manage context window
  const recentMessages = messages.slice(-10);

  // Ensure the last message is from the user
  if (recentMessages.length === 0 || recentMessages[recentMessages.length - 1].role !== 'user') {
    return Response.json({ error: 'Last message must be from user' }, { status: 400 });
  }

  try {
    const response = await callAI({
      system: SUPPORT_SYSTEM_PROMPT,
      messages: recentMessages,
      maxTokens: 500, // Keep responses concise for chat
    });

    // Log for analytics (optional - could be expanded)
    if (session) {
      console.log(`[Support Chat] User ${session.userId} received response`);
    }

    return Response.json({
      content: response.text,
      model: response.model,
    });
  } catch (error) {
    console.error('[Support Chat] AI error:', error);

    // Return a graceful error message
    return Response.json(
      {
        error: 'Unable to process your message right now',
        content:
          "I'm sorry, I'm having trouble connecting to my systems right now. Please try again in a moment, or contact our support team directly at support@dealflow.ai for immediate assistance.",
      },
      { status: 503 }
    );
  }
}

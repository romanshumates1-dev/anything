/**
 * Simplifier/Support Engine
 *
 * When a buyer or seller asks for help understanding something,
 * this engine provides simpler, more comprehensible explanations.
 *
 * Triggers:
 * - "I don't understand"
 * - "Can you explain?"
 * - "What does that mean?"
 * - "I'm confused"
 * - "Help" / "Support"
 *
 * The bot will break down complex concepts into simple terms.
 */

import { callAI } from '@/app/api/utils/ai-provider';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export interface SimplifyRequest {
  leadId: string | number;
  organizationId: string;
  originalMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  context: 'seller' | 'buyer';
  topic?: string;
}

export interface SimplifyResult {
  simplifiedResponse: string;
  detectedTopic: string;
  complexityLevel: 'basic' | 'intermediate' | 'advanced';
  followUpQuestions: string[];
  success: boolean;
}

const SUPPORT_TRIGGERS = [
  /i don'?t understand/i,
  /can you explain/i,
  /what does (that|this|it) mean/i,
  /i'?m confused/i,
  /help me understand/i,
  /explain (this|that|it)/i,
  /what is (a |an |the )?[\w\s]+\?/i,
  /^help$/i,
  /^support$/i,
  /too complicated/i,
  /simpler/i,
  /in simple terms/i,
  /eli5/i,
  /break it down/i,
];

/**
 * Detect if message is asking for support/simplification
 */
export function needsSimplification(message: string): boolean {
  return SUPPORT_TRIGGERS.some(pattern => pattern.test(message));
}

/**
 * Detect what topic they're asking about
 */
function detectTopic(message: string, history: Array<{ role: string; content: string }>): string {
  const topics: Record<string, RegExp[]> = {
    'assignment_contract': [/assignment/i, /contract/i, /fee/i, /wholesal/i],
    'purchase_price': [/price/i, /offer/i, /how much/i, /cost/i],
    'inspection_period': [/inspection/i, /due diligence/i, /days/i, /period/i],
    'closing_process': [/closing/i, /title/i, /escrow/i, /settlement/i],
    'earnest_money': [/earnest/i, /deposit/i, /emd/i],
    'as_is_sale': [/as.?is/i, /repairs/i, /condition/i],
    'timeline': [/when/i, /how long/i, /timeline/i, /fast/i],
    'proof_of_funds': [/proof/i, /funds/i, /pof/i, /cash/i, /financing/i],
    'general': [],
  };

  const combined = message + ' ' + history.slice(-3).map(h => h.content).join(' ');

  for (const [topic, patterns] of Object.entries(topics)) {
    if (patterns.some(p => p.test(combined))) {
      return topic;
    }
  }

  return 'general';
}

/**
 * Get simplified explanation for a topic
 */
const SIMPLE_EXPLANATIONS: Record<string, string> = {
  assignment_contract: `Here's how it works in simple terms:

We have a contract to buy your property. Instead of us buying it directly, we find another buyer who pays us a small fee for passing the deal to them.

For you, nothing changes - you still get your agreed price, and you still close on the same date. You just sign papers with the new buyer instead of us.

Think of it like this: If you were selling a concert ticket, you could sell it directly to someone, or sell it to a ticket reseller who then finds the final buyer. You still get your money either way.`,

  purchase_price: `The purchase price is simply what you'll receive for your property.

This is the amount we've agreed to pay you - it goes directly to you (minus any existing mortgage you need to pay off).

No hidden fees on your end. No agent commissions. No closing costs for you to pay. Just the agreed amount.`,

  inspection_period: `The inspection period is just a window of time (usually 10-14 days) where we can:

- Look at the property more closely
- Make sure everything is as expected
- Finalize our paperwork

During this time, you don't have to do anything. Just continue living normally. We'll handle everything.

After this period ends, we move toward closing.`,

  closing_process: `Closing is the final step where:

1. You sign the papers (usually takes 30-60 minutes)
2. The title company transfers ownership
3. You get your money (same day or next day wire/check)

That's it! The title company handles all the complicated legal stuff. You just show up, sign, and get paid.`,

  earnest_money: `Earnest money is like a security deposit we put down to show we're serious about buying.

This money goes to the title company (not to you directly), and it gets applied toward the purchase at closing.

If we back out for no good reason, you keep this money. It protects you.`,

  as_is_sale: `"As-is" means you don't have to fix anything before selling.

- No repairs needed
- No cleaning required
- No inspections you have to pass
- Leave anything you don't want

We buy the property in its current condition. Whatever state it's in right now is fine with us.`,

  timeline: `Here's the typical timeline:

1. Today: We agree on price
2. Days 1-3: We send you the contract to sign
3. Days 3-14: Inspection period (you do nothing)
4. Days 14-21: Title company prepares closing
5. Day 21-30: Closing day - you sign and get paid

We can often close faster if needed. Some deals close in as few as 7-10 days.`,

  proof_of_funds: `Proof of funds just means we can show we have the money to buy.

For you as a seller, this is good news - it means we're not depending on a bank loan that could fall through.

Cash buyers (like us) can close faster and more reliably than buyers who need mortgage approval.`,

  general: `I'm happy to help explain anything about this process.

The main things to know:
- We make you a cash offer
- You don't pay any fees or commissions
- We buy as-is (no repairs needed)
- We can close quickly (often 2-3 weeks)
- You get your money at closing

What specifically would you like me to explain better?`,
};

/**
 * Generate simplified response using AI for custom questions
 */
async function generateSimplifiedResponse(
  request: SimplifyRequest,
  topic: string
): Promise<string> {
  // If we have a canned simple explanation, use it
  if (SIMPLE_EXPLANATIONS[topic] && topic !== 'general') {
    return SIMPLE_EXPLANATIONS[topic];
  }

  // Otherwise, use AI to simplify
  const systemPrompt = `You are a friendly real estate assistant helping ${request.context === 'seller' ? 'a property seller' : 'a property buyer'} understand something.

RULES:
1. Use 5th grade reading level
2. No jargon - if you must use a term, explain it immediately
3. Use analogies to everyday things
4. Keep paragraphs to 2-3 sentences max
5. Use bullet points for lists
6. Be warm and reassuring
7. End with "Does that make sense?" or offer to explain more

The person just said: "${request.originalMessage}"

Recent conversation for context:
${request.conversationHistory.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')}`;

  try {
    const response = await callAI({
      messages: [{ role: 'user', content: 'Please explain this simply.' }],
      system: systemPrompt,
      maxTokens: 500,
    });

    return response.text;
  } catch (err) {
    // Fallback to general explanation
    return SIMPLE_EXPLANATIONS.general;
  }
}

/**
 * Main simplifier function
 */
export async function simplifyForCustomer(request: SimplifyRequest): Promise<SimplifyResult> {
  const topic = detectTopic(request.originalMessage, request.conversationHistory);

  const simplifiedResponse = await generateSimplifiedResponse(request, topic);

  // Log the support interaction
  await logEvent('support_simplification', 'lead', String(request.leadId), {
    topic,
    originalMessage: request.originalMessage.slice(0, 200),
    context: request.context,
  }, request.organizationId).catch(() => {});

  // Record in support_interactions table
  await sql`
    INSERT INTO support_interactions (
      lead_id, organization_id, topic, original_question,
      simplified_response, context, created_at
    ) VALUES (
      ${request.leadId},
      ${request.organizationId},
      ${topic},
      ${request.originalMessage},
      ${simplifiedResponse},
      ${request.context},
      now()
    )
  `.catch(() => {});

  return {
    simplifiedResponse,
    detectedTopic: topic,
    complexityLevel: 'basic',
    followUpQuestions: [
      'Does that make sense?',
      'Would you like me to explain anything else?',
      'Do you have any other questions?',
    ],
    success: true,
  };
}

/**
 * Get common questions for proactive support
 */
export function getCommonQuestions(context: 'seller' | 'buyer'): string[] {
  if (context === 'seller') {
    return [
      'How does the selling process work?',
      'What is an assignment contract?',
      'How fast can you close?',
      'Do I need to make any repairs?',
      'Are there any fees I need to pay?',
    ];
  } else {
    return [
      'How do I submit proof of funds?',
      'What is the assignment fee?',
      'How long is the inspection period?',
      'Can I see the property before buying?',
      'What happens at closing?',
    ];
  }
}

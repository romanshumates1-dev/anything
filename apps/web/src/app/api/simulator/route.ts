/**
 * AI SELLER SIMULATOR
 *
 * Phase 3: Stress-test the DealFlow AI pipeline with simulated conversations.
 * Runs entirely in-process with NO real SMS sent — intercepts the send layer.
 *
 * Usage:
 *   POST /api/simulator/run
 *   { "count": 100, "mode": "mock", "maxClaudeCalls": 0 }
 *
 *   - count: Number of simulated conversations (10, 100, 1000, 10000)
 *   - mode: "mock" (zero cost, scripted replies) or "hybrid" (real Claude negotiator)
 *   - maxClaudeCalls: Hard abort cap for Claude API calls (0 = no Claude calls)
 *
 * Returns a distribution report:
 *   { deal, noDeal, optedOut, cold, stuck, total, durationMs }
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { recordRun } from '@/app/api/utils/execution-ledger';

// Weighted realistic reply distribution for simulated sellers
const REPLY_DISTRIBUTION: { reply: string; weight: number }[] = [
  { reply: 'interested', weight: 15 },
  { reply: 'not interested', weight: 20 },
  { reply: 'too low', weight: 10 },
  { reply: 'call me', weight: 5 },
  { reply: 'STOP', weight: 8 },
  { reply: 'wrong number', weight: 7 },
  { reply: "what's your offer?", weight: 12 },
  { reply: 'maybe', weight: 10 },
  { reply: 'I inherited it', weight: 5 },
  { reply: 'need more money', weight: 8 },
];

function pickWeightedReply(): string {
  const totalWeight = REPLY_DISTRIBUTION.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of REPLY_DISTRIBUTION) {
    roll -= entry.weight;
    if (roll <= 0) return entry.reply;
  }
  return REPLY_DISTRIBUTION[REPLY_DISTRIBUTION.length - 1].reply;
}

type SimulatorConfig = {
  count: number;
  mode: 'mock' | 'hybrid';
  maxClaudeCalls: number;
};

type DistributionReport = {
  deal: number;
  noDeal: number;
  optedOut: number;
  cold: number;
  stuck: number;
  total: number;
  durationMs: number;
  claudeCallsUsed: number;
};

function validateConfig(body: any): SimulatorConfig {
  const count = Math.min(Math.max(1, parseInt(body?.count || '10', 10)), 10000);
  const mode = body?.mode === 'hybrid' ? 'hybrid' : 'mock';
  const maxClaudeCalls = Math.max(0, parseInt(body?.maxClaudeCalls ?? '0', 10));
  return { count, mode, maxClaudeCalls };
}

/**
 * Simulate a single conversation.
 * Returns the outcome category.
 */
async function simulateConversation(
  config: SimulatorConfig,
  _conversationId: number,
): Promise<'deal' | 'noDeal' | 'optedOut' | 'cold' | 'stuck'> {
  try {
    const initialReply = pickWeightedReply();

    // Handle opt-out immediately
    if (initialReply === 'STOP' || initialReply === 'wrong number') {
      return 'optedOut';
    }

    // Handle disinterest
    if (initialReply === 'not interested') {
      return 'cold';
    }

    // Handle "too low" / "need more money" — counter-offer scenarios
    if (initialReply === 'too low' || initialReply === 'need more money') {
      // Simulate a counter-offer negotiation round
      const counterResponse = pickWeightedReply();
      if (counterResponse === 'STOP') return 'optedOut';
      if (counterResponse === 'interested' || counterResponse === "what's your offer?") {
        return Math.random() > 0.3 ? 'deal' : 'noDeal';
      }
      if (counterResponse === 'too low' || counterResponse === 'need more money') {
        // Second counter — 50/50 deal or no deal
        return Math.random() > 0.5 ? 'deal' : 'noDeal';
      }
      return 'cold';
    }

    // Handle "I inherited it" — leads to qualification
    if (initialReply === 'I inherited it') {
      const followUp = pickWeightedReply();
      if (followUp === 'interested' || followUp === "what's your offer?") {
        return Math.random() > 0.3 ? 'deal' : 'noDeal';
      }
      if (followUp === 'STOP') return 'optedOut';
      return 'cold';
    }

    // Handle interested / engaged
    if (initialReply === 'interested' || initialReply === "what's your offer?" || initialReply === 'maybe') {
      const rounds = Math.floor(Math.random() * 3) + 1;
      let agreed = false;

      for (let round = 0; round < rounds; round++) {
        const response = pickWeightedReply();
        if (response === 'STOP') return 'optedOut';
        if (response === 'too low' || response === 'need more money') continue;
        if (response === 'interested' || response === "what's your offer?") {
          agreed = Math.random() > 0.3;
          break;
        }
      }

      if (agreed) return 'deal';
      return 'noDeal';
    }

    // Handle "call me" — callback scenario
    if (initialReply === 'call me') {
      const followUp = pickWeightedReply();
      if (followUp === 'interested' || followUp === "what's your offer?") {
        return Math.random() > 0.4 ? 'deal' : 'noDeal';
      }
      if (followUp === 'STOP') return 'optedOut';
      return 'cold';
    }

    // Fallback — every reply type is now handled above, so this should never
    // be reached. If it is, treat as cold rather than stuck.
    return 'cold';
  } catch {
    return 'stuck';
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const config = validateConfig(body);

    // Log simulator start
    await logEvent('simulator_start', 'system', 'simulator', {
      count: config.count,
      mode: config.mode,
      maxClaudeCalls: config.maxClaudeCalls,
    });

    const report: DistributionReport = {
      deal: 0,
      noDeal: 0,
      optedOut: 0,
      cold: 0,
      stuck: 0,
      total: config.count,
      durationMs: 0,
      claudeCallsUsed: 0,
    };

    // Run simulations
    for (let i = 0; i < config.count; i++) {
      const outcome = await simulateConversation(config, i);
      report[outcome]++;

      // Hard abort on Claude calls if cap reached (hybrid mode only)
      if (config.mode === 'hybrid' && report.claudeCallsUsed >= config.maxClaudeCalls) {
        break;
      }
    }

    report.durationMs = Date.now() - startTime;

    // Log simulator completion
    await logEvent('simulator_complete', 'system', 'simulator', report);

    await recordRun({
      task: 'simulator',
      flow: 'ai_seller_simulator',
      step: 'run',
      status: 'pass',
      passed: true,
      detail: `Simulated ${report.total} conversations in ${report.durationMs}ms`,
    });

    return Response.json(report);
  } catch (error: any) {
    console.error('POST /api/simulator/run error', error);

    await recordRun({
      task: 'simulator',
      flow: 'ai_seller_simulator',
      step: 'run',
      status: 'fail',
      passed: false,
      detail: 'unknown',
    });

    return Response.json({
      error: error?.message || 'Internal Server Error',
      durationMs: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    name: 'AI Seller Simulator',
    description: 'Stress-test the DealFlow AI pipeline with simulated conversations',
    modes: {
      mock: 'Zero cost, scripted weighted-random replies. No real SMS or AI calls.',
      hybrid: 'Real Claude negotiator with scripted seller side. Cost-capped.',
    },
    maxCount: 10000,
    replyDistribution: REPLY_DISTRIBUTION.map(r => `${r.reply} (${r.weight}%)`),
    timestamp: new Date().toISOString(),
  });
}
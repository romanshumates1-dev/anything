import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { DECISION_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, DecisionOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class DecisionAgent implements Agent<DecisionOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<DecisionOutput>> {
    // 1. Fetch probability
    const [prob] = await sql`
      SELECT p_close, expected_value
      FROM deal_probabilities
      WHERE lead_id = ${input.leadId}
    `;

    if (!prob) {
      throw new Error(`Missing probability for lead ${input.leadId}`);
    }

    const promptInput = {
      pClose: Number(prob.p_close),
      expectedValue: prob.expected_value
    };

    // 2. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${DECISION_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 3. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: DecisionOutput = JSON.parse(contentBlock.text);

    // 4. Queue action if not reject
    if (output.action !== 'reject') {
      await sql`
        INSERT INTO lead_actions (
          lead_id,
          action,
          priority,
          reason
        ) VALUES (
          ${input.leadId},
          ${output.action},
          ${output.priority},
          ${JSON.stringify({ reasoning: output.reasoning, pClose: prob.p_close })}
        )
      `;
    }

    return {
      result: output,
      confidence: promptInput.pClose
    };
  }
}

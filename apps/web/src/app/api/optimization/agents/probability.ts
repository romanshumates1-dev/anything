import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { PROBABILITY_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, ProbabilityOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class ProbabilityAgent implements Agent<ProbabilityOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<ProbabilityOutput>> {
    // 1. Fetch lead score
    const [score] = await sql`
      SELECT composite_score
      FROM lead_scores
      WHERE lead_id = ${input.leadId}
    `;

    // 2. Fetch valuation
    const [valuation] = await sql`
      SELECT arv_confidence
      FROM property_valuations
      WHERE lead_id = ${input.leadId}
    `;

    if (!score || !valuation) {
      throw new Error(`Missing score or valuation for lead ${input.leadId}`);
    }

    const promptInput = {
      compositeScore: Number(score.composite_score),
      arvConfidence: Number(valuation.arv_confidence)
    };

    // 3. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${PROBABILITY_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 4. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: ProbabilityOutput = JSON.parse(contentBlock.text);

    // 5. Persist to database
    await sql`
      INSERT INTO deal_probabilities (
        lead_id,
        p_close,
        expected_value
      ) VALUES (
        ${input.leadId},
        ${output.pClose},
        ${output.expectedValue}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        p_close = EXCLUDED.p_close,
        expected_value = EXCLUDED.expected_value,
        created_at = now()
    `;

    return {
      result: output,
      confidence: output.pClose
    };
  }
}

import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { LEAD_SCORING_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, LeadScoreOutput } from './types';

export class LeadScoringAgent implements Agent<LeadScoreOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<LeadScoreOutput>> {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || ''
    });
    // 1. Fetch lead data
    const [lead] = await sql`
      SELECT id, metadata, created_at
      FROM leads
      WHERE id = ${input.leadId}
    `;

    if (!lead) {
      throw new Error(`Lead ${input.leadId} not found`);
    }

    // 2. Extract input data for Claude
    const signals = lead.metadata?.signals || [];
    const daysAcquired = Math.floor(
      (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const estimatedArv = lead.metadata?.estimated_arv || null;
    const estimatedDebt = lead.metadata?.estimated_debt || null;
    const zip = lead.metadata?.zip || null;

    const promptInput = {
      signals,
      daysAcquired,
      estimatedArv,
      estimatedDebt,
      zip
    };

    // 3. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${LEAD_SCORING_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 4. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: LeadScoreOutput = JSON.parse(contentBlock.text);

    // 5. Persist to database
    await sql`
      INSERT INTO lead_scores (
        lead_id,
        composite_score,
        distress_score,
        recency_score,
        equity_score,
        geo_score
      ) VALUES (
        ${input.leadId},
        ${output.compositeScore},
        ${output.components.distress},
        ${output.components.recency},
        ${output.components.equity},
        ${output.components.geo}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score,
        distress_score = EXCLUDED.distress_score,
        recency_score = EXCLUDED.recency_score,
        equity_score = EXCLUDED.equity_score,
        geo_score = EXCLUDED.geo_score,
        created_at = now()
    `;

    // 6. Calculate confidence
    const confidence = this.calculateConfidence(output);

    return {
      result: output,
      confidence
    };
  }

  private calculateConfidence(output: LeadScoreOutput): number {
    // Confidence based on how many components have non-default values
    const components = [
      output.components.distress,
      output.components.recency,
      output.components.equity,
      output.components.geo
    ];

    // Count non-neutral scores (not 0.5)
    const nonNeutral = components.filter(c => Math.abs(c - 0.5) > 0.1).length;

    return Math.min(0.5 + (nonNeutral * 0.125), 1.0);
  }
}

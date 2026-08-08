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
    const estimatedRepairs = lead.metadata?.estimated_repairs || null;
    const zip = lead.metadata?.zip || null;
    const leadSource = lead.metadata?.lead_source || lead.metadata?.source || null;

    // Extract motivated seller indicators from metadata
    const motivatedSellerIndicators: string[] = [];
    if (lead.metadata?.urgent_sale) motivatedSellerIndicators.push('urgent_sale');
    if (lead.metadata?.behind_on_mortgage) motivatedSellerIndicators.push('behind_on_mortgage');
    if (lead.metadata?.property_deteriorating) motivatedSellerIndicators.push('property_deteriorating');
    if (lead.metadata?.multiple_listings) motivatedSellerIndicators.push('multiple_listings');
    if (lead.metadata?.price_drops && lead.metadata.price_drops > 0) {
      for (let i = 0; i < Math.min(lead.metadata.price_drops, 3); i++) {
        motivatedSellerIndicators.push('price_drop');
      }
    }

    const promptInput = {
      signals,
      daysAcquired,
      estimatedArv,
      estimatedDebt,
      estimatedRepairs,
      zip,
      leadSource,
      motivatedSellerIndicators
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

    let output: LeadScoreOutput;
    try {
      output = JSON.parse(contentBlock.text);
    } catch (parseError) {
      const snippet = contentBlock.text.slice(0, 200);
      throw new Error(`Failed to parse Claude response as JSON. Response snippet: ${snippet}...`);
    }

    // 5. Persist to database
    await sql`
      INSERT INTO lead_scores (
        lead_id,
        composite_score,
        distress_score,
        motivation_score,
        recency_score,
        equity_score,
        source_quality_score,
        geo_score
      ) VALUES (
        ${input.leadId},
        ${output.compositeScore},
        ${output.components.distress},
        ${output.components.motivation ?? 0.5},
        ${output.components.recency},
        ${output.components.equity},
        ${output.components.sourceQuality ?? 0.5},
        ${output.components.geo}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score,
        distress_score = EXCLUDED.distress_score,
        motivation_score = EXCLUDED.motivation_score,
        recency_score = EXCLUDED.recency_score,
        equity_score = EXCLUDED.equity_score,
        source_quality_score = EXCLUDED.source_quality_score,
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
      output.components.motivation ?? 0.5,
      output.components.recency,
      output.components.equity,
      output.components.sourceQuality ?? 0.5,
      output.components.geo
    ];

    // Count non-neutral scores (not 0.5)
    const nonNeutral = components.filter(c => Math.abs(c - 0.5) > 0.1).length;

    // More components = higher confidence cap
    return Math.min(0.5 + (nonNeutral * 0.1), 1.0);
  }
}

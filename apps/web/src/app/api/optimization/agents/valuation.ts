import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { VALUATION_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, ValuationOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class ValuationAgent implements Agent<ValuationOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<ValuationOutput>> {
    // 1. Fetch lead data
    const [lead] = await sql`
      SELECT id, metadata
      FROM leads
      WHERE id = ${input.leadId}
    `;

    if (!lead) {
      throw new Error(`Lead ${input.leadId} not found`);
    }

    // 2. Extract property data
    const property = {
      beds: lead.metadata?.beds || 3,
      baths: lead.metadata?.baths || 2,
      sqft: lead.metadata?.sqft || 1500,
      condition: lead.metadata?.condition || 'fair'
    };

    // 3. Mock comps for MVP (TODO: integrate real comp source)
    const comps = this.generateMockComps(property);

    const promptInput = { property, comps };

    // 4. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${VALUATION_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 5. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let output: ValuationOutput;
    try {
      output = JSON.parse(contentBlock.text);
    } catch (parseError) {
      const snippet = contentBlock.text.slice(0, 200);
      throw new Error(`Failed to parse Claude response as JSON. Response snippet: ${snippet}...`);
    }

    // 6. Persist to database
    await sql`
      INSERT INTO property_valuations (
        lead_id,
        arv,
        arv_confidence,
        repairs,
        offer_min,
        offer_max,
        comps_count
      ) VALUES (
        ${input.leadId},
        ${output.arv},
        ${output.arvConfidence},
        ${output.repairs},
        ${output.offerMin},
        ${output.offerMax},
        ${output.compsCount}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        arv = EXCLUDED.arv,
        arv_confidence = EXCLUDED.arv_confidence,
        repairs = EXCLUDED.repairs,
        offer_min = EXCLUDED.offer_min,
        offer_max = EXCLUDED.offer_max,
        comps_count = EXCLUDED.comps_count,
        created_at = now()
    `;

    return {
      result: output,
      confidence: output.arvConfidence
    };
  }

  private generateMockComps(property: any) {
    // Mock comps for MVP - replace with real comp source later
    const basePrice = 150 * property.sqft; // $150/sqft baseline

    return [
      {
        price: Math.round(basePrice * 1.1),
        sqft: property.sqft * 0.95,
        distanceMiles: 0.3,
        daysAgoSold: 15
      },
      {
        price: Math.round(basePrice * 0.95),
        sqft: property.sqft * 1.05,
        distanceMiles: 0.5,
        daysAgoSold: 30
      },
      {
        price: Math.round(basePrice * 1.05),
        sqft: property.sqft * 0.98,
        distanceMiles: 0.7,
        daysAgoSold: 45
      },
      {
        price: Math.round(basePrice),
        sqft: property.sqft,
        distanceMiles: 0.4,
        daysAgoSold: 20
      },
      {
        price: Math.round(basePrice * 1.08),
        sqft: property.sqft * 1.02,
        distanceMiles: 0.6,
        daysAgoSold: 35
      }
    ];
  }
}

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

    // 3. Get comparable sales data
    // Uses synthetic comps based on property characteristics when real comp source unavailable
    const comps = await this.getComparableSales(property, lead.metadata);

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

  /**
   * Get comparable sales for valuation.
   *
   * When COMP_API_URL is configured, fetches real comps from external provider.
   * Otherwise generates synthetic comps based on property characteristics and
   * regional price-per-sqft data. Synthetic comps are flagged in output.
   */
  private async getComparableSales(property: any, metadata?: any): Promise<any[]> {
    const compApiUrl = process.env.COMP_API_URL;

    // If real comp API is available, use it
    if (compApiUrl) {
      try {
        const res = await fetch(compApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sqft: property.sqft,
            beds: property.beds,
            baths: property.baths,
            zipCode: metadata?.zipCode,
            propertyType: metadata?.propertyType || 'single_family',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.comps) && data.comps.length >= 3) {
            return data.comps;
          }
        }
      } catch (e) {
        console.warn('[ValuationAgent] Comp API unavailable, using synthetic comps');
      }
    }

    // Generate synthetic comps based on property characteristics
    return this.generateSyntheticComps(property, metadata);
  }

  /**
   * Generate synthetic comparable sales based on property characteristics.
   *
   * Uses regional price-per-sqft baselines when available, otherwise
   * defaults to $150/sqft (national average for older SFH).
   *
   * IMPORTANT: These are ESTIMATES for initial offer calculation.
   * Final offers should be validated against real comps before contract.
   */
  private generateSyntheticComps(property: any, metadata?: any) {
    // Regional baseline adjustments ($/sqft for SFH in fair condition)
    const regionalBaselines: Record<string, number> = {
      TX: 130, FL: 175, CA: 350, AZ: 200, GA: 140, NC: 145, OH: 100, PA: 120,
      IL: 125, TN: 140, MI: 95, CO: 250, NV: 180, SC: 130, AL: 95,
    };

    const state = metadata?.state?.toUpperCase();
    const basePricePerSqft = state && regionalBaselines[state]
      ? regionalBaselines[state]
      : 150; // National fallback

    // Adjust for condition
    const conditionMultiplier =
      property.condition === 'good' ? 1.15 :
      property.condition === 'poor' ? 0.75 :
      property.condition === 'needs_work' ? 0.85 : 1.0;

    const basePrice = basePricePerSqft * property.sqft * conditionMultiplier;

    // Generate 5 synthetic comps with realistic variance
    return [
      {
        price: Math.round(basePrice * 1.08),
        sqft: Math.round(property.sqft * 0.95),
        distanceMiles: 0.3,
        daysAgoSold: 15,
        synthetic: true,
      },
      {
        price: Math.round(basePrice * 0.94),
        sqft: Math.round(property.sqft * 1.05),
        distanceMiles: 0.5,
        daysAgoSold: 30,
        synthetic: true,
      },
      {
        price: Math.round(basePrice * 1.03),
        sqft: Math.round(property.sqft * 0.98),
        distanceMiles: 0.7,
        daysAgoSold: 45,
        synthetic: true,
      },
      {
        price: Math.round(basePrice * 0.98),
        sqft: property.sqft,
        distanceMiles: 0.4,
        daysAgoSold: 20,
        synthetic: true,
      },
      {
        price: Math.round(basePrice * 1.06),
        sqft: Math.round(property.sqft * 1.02),
        distanceMiles: 0.6,
        daysAgoSold: 35,
        synthetic: true,
      },
    ];
  }
}

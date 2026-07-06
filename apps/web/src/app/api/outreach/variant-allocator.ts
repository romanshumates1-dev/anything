/**
 * Message Performance Ledger & A/B Testing
 * 
 * Tracks every outbound message → delivered → replied → engaged → deal outcome
 * Enables:
 * - A/B variant rotation (Thompson sampling / epsilon-greedy)
 * - Send-time optimization
 * - Objection classification + response tuning
 * - Campaign analytics (response rate, cost per engaged lead, cost per contract)
 */

import sql from '@/app/api/utils/sql';

export type MessageVariantType = 'opening' | 'followup';

export interface MessagePerformanceEntry {
  id?: number;
  campaignId: number;
  leadId: number;
  variantId: string;
  variantText: string;
  variantType: MessageVariantType;
  sentAt: Date;
  delivered: boolean;
  deliveredAt?: Date;
  replied: boolean;
  repliedAt?: Date;
  dealOutcome?: 'accepted' | 'negotiating' | 'rejected' | null;
  dealClosedAt?: Date;
  smsSegments: number; // For cost tracking
  costCents: number; // Gateway + AI cost
  metadata?: Record<string, any>;
}

export interface VariantAllocation {
  variantId: string;
  text: string;
  type: MessageVariantType;
  allocationWeight: number; // 0.0-1.0
  deliveryRate: number; // based on historical data
  replyRate: number;
  dealRate: number;
  sampleSize: number;
  confidence: number; // Wilson score lower bound
}

/**
 * Thompson Sampling-style allocation:
 * - Sample from Beta distribution for each variant based on success/failure
 * - Select variant with highest sampled mean
 * - Converges to optimal variant over time while exploring others
 */
export class VariantAllocator {
  constructor(private campaignId: number) {}

  /**
   * Calculate Thompson sampling weights for variants
   * Returns allocation probabilities for each variant
   */
  async getVariantWeights(
    variantIds: string[],
  ): Promise<Record<string, number>> {
    if (variantIds.length === 0) {
      return {};
    }

    // Query performance ledger for each variant
    const variantIdList = variantIds.map(id => `'${id}'`).join(',');
    const data = await sql`
      SELECT
        variant_id,
        COUNT(*) as total_sent,
        SUM(CASE WHEN replied THEN 1 ELSE 0 END) as total_replied
      FROM message_performance_ledger
      WHERE campaign_id = ${this.campaignId}
        AND variant_id IN (${sql`${variantIdList}`})
      GROUP BY variant_id
    `;

    // Calculate Beta parameters and sample
    const sampledMeans: Record<string, number> = {};
    const rows = data as any[];

    for (const row of rows) {
      const variantId = row.variant_id as string;
      const sent = (row.total_sent as number) || 0;
      const replied = (row.total_replied as number) || 0;

      // Beta(α=replies+1, β=non-replies+1)
      // Sample from beta distribution
      const alpha = replied + 1;
      const beta = (sent - replied) + 1;
      const sampledMean = this.sampleBeta(alpha, beta);
      sampledMeans[variantId] = sampledMean;
    }

    // Normalize to probabilities
    const total = Object.values(sampledMeans).reduce((a, b) => a + b, 0);
    const weights: Record<string, number> = {};
    for (const [variantId, mean] of Object.entries(sampledMeans)) {
      weights[variantId] = mean / total;
    }

    return weights;
  }

  /**
   * Simple beta sample using gamma variates
   * (In production, use numpy.random.beta or native implementation)
   */
  private sampleBeta(alpha: number, beta: number): number {
    const u1 = this.gammaRandom(alpha);
    const u2 = this.gammaRandom(beta);
    return u1 / (u1 + u2);
  }

  private gammaRandom(shape: number): number {
    // Approximation using exponential + uniform
    if (shape < 1) {
      return this.gammaRandom(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    let z, v, u;
    do {
      do {
        z = (Math.random() - 0.5) * 3.4641;
        v = 1 + c * z;
      } while (v <= 0);
      v = v * v * v;
      u = Math.random();
    } while (u > 1 - 0.0331 * z * z * z * z && Math.log(u) > 0.5 * z * z + d * (1 - v + Math.log(v)));
    return d * v;
  }

  /**
   * Record a message sent event
   */
  async recordSent(entry: Omit<MessagePerformanceEntry, 'id' | 'delivered' | 'replied' | 'dealOutcome'>): Promise<number> {
    const result = await sql`
      INSERT INTO message_performance_ledger (
        campaign_id, lead_id, variant_id, variant_text, variant_type,
        sent_at, delivered, replied, sms_segments, cost_cents, metadata
      ) VALUES (
        ${entry.campaignId}, ${entry.leadId}, ${entry.variantId}, ${entry.variantText},
        ${entry.variantType}, ${entry.sentAt}, false, false,
        ${entry.smsSegments}, ${entry.costCents}, ${JSON.stringify(entry.metadata || {})}
      )
      RETURNING id
    `;
    const rows = result as any[];
    return (rows[0]?.id as number) || 0;
  }

  /**
   * Record delivery, reply, and deal outcomes as they happen
   */
  async recordDelivery(performanceId: number, deliveredAt: Date): Promise<void> {
    await sql`
      UPDATE message_performance_ledger
      SET delivered = true, delivered_at = ${deliveredAt}
      WHERE id = ${performanceId}
    `;
  }

  async recordReply(performanceId: number, repliedAt: Date): Promise<void> {
    await sql`
      UPDATE message_performance_ledger
      SET replied = true, replied_at = ${repliedAt}
      WHERE id = ${performanceId}
    `;
  }

  async recordDealOutcome(performanceId: number, outcome: 'accepted' | 'negotiating' | 'rejected', closedAt: Date): Promise<void> {
    await sql`
      UPDATE message_performance_ledger
      SET deal_outcome = ${outcome}, deal_closed_at = ${closedAt}
      WHERE id = ${performanceId}
    `;
  }

  /**
   * Get variant analytics for campaign
   */
  async getVariantAnalytics(): Promise<VariantAllocation[]> {
    const data = await sql`
      SELECT
        variant_id,
        variant_text,
        variant_type,
        COUNT(*) as sample_size,
        SUM(CASE WHEN delivered THEN 1 ELSE 0 END)::float / COUNT(*) as delivery_rate,
        SUM(CASE WHEN replied THEN 1 ELSE 0 END)::float / COUNT(*) as reply_rate,
        SUM(CASE WHEN deal_outcome = 'accepted' THEN 1 ELSE 0 END)::float / COUNT(*) as deal_rate
      FROM message_performance_ledger
      WHERE campaign_id = ${this.campaignId}
      GROUP BY variant_id, variant_text, variant_type
      ORDER BY deal_rate DESC, reply_rate DESC
    `;

    const analyticRows = data as any[];
    return analyticRows.map((row: any) => ({
      variantId: row.variant_id as string,
      text: row.variant_text as string,
      type: row.variant_type as MessageVariantType,
      allocationWeight: 0, // Set by allocator
      deliveryRate: (row.delivery_rate as number) || 0,
      replyRate: (row.reply_rate as number) || 0,
      dealRate: (row.deal_rate as number) || 0,
      sampleSize: (row.sample_size as number) || 0,
      confidence: 0, // Wilson score would go here
    }));
  }
}

/**
 * Schema migration: Add message_performance_ledger table if not exists
 */
export async function ensurePerformanceLedgerSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.message_performance_ledger (
      id serial PRIMARY KEY,
      campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
      lead_id integer NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
      variant_id text NOT NULL,
      variant_text text NOT NULL,
      variant_type text NOT NULL CHECK (variant_type IN ('opening', 'followup')),
      sent_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered boolean NOT NULL DEFAULT false,
      delivered_at timestamptz,
      replied boolean NOT NULL DEFAULT false,
      replied_at timestamptz,
      deal_outcome text CHECK (deal_outcome IN ('accepted', 'negotiating', 'rejected')),
      deal_closed_at timestamptz,
      sms_segments integer NOT NULL DEFAULT 1,
      cost_cents integer NOT NULL DEFAULT 0,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_perf_campaign_variant ON public.message_performance_ledger (campaign_id, variant_id);
    CREATE INDEX IF NOT EXISTS idx_perf_lead_replied ON public.message_performance_ledger (lead_id, replied);
    CREATE INDEX IF NOT EXISTS idx_perf_deal_outcome ON public.message_performance_ledger (deal_outcome);
  `;
}

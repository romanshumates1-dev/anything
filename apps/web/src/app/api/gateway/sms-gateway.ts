/**
 * SMS Gateway Router
 * 
 * Central orchestrator for multi-provider failover with:
 * - Per-provider circuit breakers
 * - Sticky provider per conversation thread
 * - Idempotency via message UUID
 * - Failover on provider-level failure (never on recipient-level like invalid number)
 * - Compliance gates: opt-out, TCPA window, throughput caps
 * - Unified delivery state tracking
 * - Usage limit enforcement (SaaS)
 */

import { randomUUID } from 'node:crypto';
import sql from '@/app/api/utils/sql';
import { checkConsent } from '@/app/api/utils/compliance';
import { dispatchGate, type DenyCode } from '@/app/api/utils/dispatchGate';
import { isBetaFlagOn, type BetaFlagKey } from '@/app/api/utils/betaFlags';
import { pickNumber, activePoolCount } from '@/app/api/utils/numberPoolStore';
import { logEvent } from '@/app/api/utils/logger';
import { checkUsageLimit, recordUsage } from '@/app/api/services/usageTracker';
import { CircuitBreaker } from './circuit-breaker';
import { ISMSProvider, DeliveryStatus } from './providers';

export interface GatewayMessage {
  leadId: number | string;
  to: string;
  text: string;
  campaignLeadId?: number | string | null;
  conversationThread?: string; // For sticky provider routing
  messageUuid?: string; // For idempotency; auto-generated if not provided
  campaignId?: string;
  organizationId?: string;
  contactId?: string;
  /** P2.0-W: which beta integration this send belongs to (omit for core sends). */
  betaFlag?: BetaFlagKey;
  /** P2.0-W: passed through to dispatchGate (meaningful for voice/rvm callers). */
  consentBasis?: string | null;
  /** P2.0-W: cadence steps additionally snap to send windows at the gate. */
  isCadenceStep?: boolean;
  /** P2.0-W: recipient-requested send (OTP) — skips time gates only, never DNC. */
  transactional?: boolean;
  /** Phase A: bounded-negotiation numeric-guard context (bounded sends only). */
  boundedNegotiation?: {
    computedOfferCents: number;
    approvedMinCents: number;
    approvedMaxCents: number;
    /** For owner escalation on a block. */
    sessionId?: string;
  };
}

export interface GatewayDeliveryRecord {
  messageUuid: string;
  status: DeliveryStatus;
  provider: string;
  providerId?: string;
  leadId: number | string;
  to: string;
  dispatchTime: Date;
  deliveryTime?: Date;
  errorCode?: string;
  errorMessage?: string;
  /** P2.0-W: set when dispatchGate denied the send; callers branch on this. */
  gateCode?: DenyCode;
  /** P2.0-W: when the gate says "not now" (quiet hours/window), when to retry. */
  retryAt?: Date;
}

export interface GatewayConfig {
  primaryProvider: ISMSProvider;
  secondaryProviders?: ISMSProvider[];
  tertiaryProviders?: ISMSProvider[];
  circuitBreakerConfig?: {
    failureThreshold?: number;
    recoveryDelayMs?: number;
    deliveryRateThreshold?: number;
  };
  maxRetries?: number;
  complianceCheckEnabled?: boolean;
  idempotencyEnabled?: boolean;
  testModeAllowedPhones?: Set<string>; // org-level allowlist for test mode
}

/**
 * In-memory idempotency cache (for production, use Redis or similar).
 * Key: messageUuid, Value: { status, providerId }
 */
const idempotencyCache = new Map<
  string,
  { status: DeliveryStatus; providerId: string; deliveredAt: number }
>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SMSGateway {
  private circuitBreakers: Map<string, CircuitBreaker>;
  private providers: ISMSProvider[];
  private stickyRouter: Map<string, string> = new Map(); // thread -> provider name
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  constructor(private config: GatewayConfig) {
    this.providers = [
      config.primaryProvider,
      ...(config.secondaryProviders || []),
      ...(config.tertiaryProviders || []),
    ];

    this.circuitBreakers = new Map(
      this.providers.map((p) => [
        p.name,
        new CircuitBreaker(p.name, {
          failureThreshold: config.circuitBreakerConfig?.failureThreshold || 3,
          recoveryDelayMs: config.circuitBreakerConfig?.recoveryDelayMs || 30000,
          deliveryRateThreshold: config.circuitBreakerConfig?.deliveryRateThreshold || 0.9,
          halfOpenProbeTimeoutMs: 5000,
          windowSizeMs: 5 * 60 * 1000, // 5-minute window
        }),
      ]),
    );

    // Clean up cache every hour
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of idempotencyCache.entries()) {
        if (now - value.deliveredAt > CACHE_TTL_MS) {
          idempotencyCache.delete(key);
        }
      }
    }, 60 * 60 * 1000);
  }

  destroy(): void {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
  }

  async send(message: GatewayMessage): Promise<GatewayDeliveryRecord> {
    const messageUuid = message.messageUuid || randomUUID();
    const { leadId, to, text, conversationThread, campaignId, organizationId, contactId } = message;

    // 0. USAGE LIMIT CHECK (SaaS) — enforce subscription limits before any send
    if (organizationId) {
      const usageCheck = await checkUsageLimit(organizationId, 'sms', 1);
      if (!usageCheck.allowed) {
        await logEvent('message_blocked_usage_limit', 'message', String(leadId), {
          messageUuid,
          to,
          reason: usageCheck.limit.hardLimitReached ? 'hard_limit_reached' : 'soft_limit_reached',
          limit: usageCheck.limit,
        });
        return {
          messageUuid,
          status: 'failed',
          provider: 'gateway',
          leadId,
          to,
          dispatchTime: new Date(),
          errorMessage: usageCheck.message || 'Usage limit exceeded',
          gateCode: 'USAGE_LIMIT',
        };
      }
    }

    // 1. UNIVERSAL DISPATCH GATE (P2.0-W) — every SMS that leaves this system
    // passes here AT TRANSMIT TIME. A cadence step gated when its job was
    // processed can still drain minutes later; this is the check that cannot
    // go stale. Gate order (DNC ≻ flag ≻ consent ≻ quiet hours ≻ window) and
    // fail-closed behaviour live in dispatchGate itself.
    const gate = await dispatchGate({
      phone: to,
      channel: 'sms',
      betaFlag: message.betaFlag,
      consentBasis: message.consentBasis,
      isCadenceStep: message.isCadenceStep,
      transactional: message.transactional,
      boundedNegotiation: message.boundedNegotiation
        ? { text, ...message.boundedNegotiation }
        : undefined,
    });
    if (!gate.allow) {
      await logEvent(
        gate.code === 'NUMERIC_GUARD' ? 'numeric_guard_blocked' : 'message_suppressed_gateway',
        'message',
        String(leadId),
        {
          messageUuid,
          to,
          reason: gate.code,
          detail: gate.reason,
          retryAt: gate.retryAt?.toISOString(),
        }
      );
      // Phase A: a guard block is an owner-escalation event, not just a log line.
      if (gate.code === 'NUMERIC_GUARD' && organizationId) {
        await sql`
          INSERT INTO human_approvals (id, organization_id, type, context, status)
          VALUES (${randomUUID()}, ${organizationId}, 'NUMERIC_GUARD_BLOCK',
                  ${JSON.stringify({ leadId, detail: gate.reason, sessionId: message.boundedNegotiation?.sessionId })}, 'PENDING')
        `;
      }
      return {
        messageUuid,
        status: 'failed',
        provider: 'gateway',
        leadId,
        to,
        dispatchTime: new Date(),
        errorMessage: gate.code,
        gateCode: gate.code,
        retryAt: gate.retryAt,
      };
    }

    // 2. IDEMPOTENCY CHECK
    if (this.config.idempotencyEnabled !== false) {
      const cached = idempotencyCache.get(messageUuid);
      if (cached && Date.now() - cached.deliveredAt < CACHE_TTL_MS) {
        await logEvent('message_idempotent', 'message', String(leadId), {
          messageUuid,
          providerId: cached.providerId,
        });
        return {
          messageUuid,
          status: cached.status,
          provider: this.providers.find((p) =>
            p.name === cached.providerId
          )?.name || 'unknown',
          providerId: cached.providerId,
          leadId,
          to,
          dispatchTime: new Date(cached.deliveredAt - 1000),
        };
      }
    }

    // 3. COMPLIANCE GATES
    if (this.config.complianceCheckEnabled !== false) {
      const hasConsent = await checkConsent(to, 'sms');
      if (!hasConsent) {
        await logEvent('message_suppressed_gateway', 'message', String(leadId), {
          messageUuid,
          to,
          reason: 'opted_out',
        });
        return {
          messageUuid,
          status: 'failed',
          provider: 'gateway',
          leadId,
          to,
          dispatchTime: new Date(),
          errorMessage: 'opted_out',
        };
      }
    }

    // 4. TEST-MODE HARD-ABORT (safety-critical)
    // Enforcement at the last hop before provider dispatch so no upstream path can bypass it.
    if (campaignId && organizationId) {
      const [campaign] = await sql`
        SELECT test_mode FROM outreach_campaigns
        WHERE id = ${campaignId} AND organization_id = ${organizationId}
      `;
      if (campaign?.test_mode) {
        const [allowed] = await sql`
          SELECT id FROM test_phone_numbers
          WHERE organization_id = ${organizationId} AND phone = ${to} AND verified = true
        `;
        if (!allowed) {
          await logEvent('message_blocked_test_mode', 'message', String(leadId), {
            messageUuid,
            to,
            reason: 'not_in_test_allowlist',
          });
          if (contactId) {
            await sql`
              INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, status, provider, metadata)
              VALUES (${messageUuid}, ${organizationId}, ${campaignId}, ${contactId}, 'outbound', 'BLOCKED_TEST_MODE', 'gateway', ${JSON.stringify({ reason: 'not_in_test_allowlist', to })})
              ON CONFLICT (id) DO NOTHING
            `;
          }
          return {
            messageUuid,
            status: 'failed',
            provider: 'gateway',
            leadId,
            to,
            dispatchTime: new Date(),
            errorMessage: 'BLOCKED_TEST_MODE: not in verified test_phone_numbers',
          };
        }
      }
    }

    // 4.5 INT-3 LOCAL PRESENCE — pick a from-number matching the lead's area
    // code. Placed AFTER every abort-style check so a blocked send never burns
    // a pool slot (pickNumber atomically claims one against the daily cap).
    // Semantics (owner Decision 2 + null-means-don't-send):
    //   - flag OFF            → default sender, untouched behaviour
    //   - transactional (OTP) → default sender (local presence is for outreach)
    //   - pool EMPTY          → feature unconfigured: default sender + warn event
    //   - pool CAPPED         → hold the send (retry after the UTC-midnight
    //                           reset) — never "send from anything"
    let localFrom: string | undefined;
    if (!message.transactional && (await isBetaFlagOn('localPresence'))) {
      const picked = await pickNumber(to);
      if (picked) {
        localFrom = picked;
      } else if ((await activePoolCount()) > 0) {
        const retryAt = new Date(new Date().setUTCHours(24, 0, 30, 0)); // just past the daily reset
        await logEvent('local_presence_exhausted', 'message', String(leadId), {
          messageUuid,
          to,
          retryAt: retryAt.toISOString(),
        });
        return {
          messageUuid,
          status: 'failed',
          provider: 'gateway',
          leadId,
          to,
          dispatchTime: new Date(),
          errorMessage: 'LOCAL_PRESENCE_EXHAUSTED',
          gateCode: 'OUTSIDE_WINDOW', // deferrable class: jobs re-run it at retryAt
          retryAt,
        };
      } else {
        await logEvent('local_presence_unconfigured', 'message', String(leadId), {
          messageUuid,
          to,
          detail: 'localPresence flag is ON but the number pool has no active numbers',
        });
      }
    }

    // 5. SELECT PROVIDER (sticky or primary)
    let provider = this.selectProvider(conversationThread || String(leadId));

    // 6. ATTEMPT DISPATCH WITH FAILOVER
    let dispatchRecord: GatewayDeliveryRecord | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < (this.config.maxRetries || 2); attempt++) {
      const circuitBreaker = this.circuitBreakers.get(provider.name);
      if (!circuitBreaker?.canAttempt()) {
        // Provider circuit open, try next
        const nextProvider = this.getNextProvider(provider.name);
        if (!nextProvider) {
          break;
        }
        provider = nextProvider;
        continue;
      }

      try {
        const providerId = await provider.send(to, text, messageUuid, localFrom);

        // Record successful dispatch
        dispatchRecord = {
          messageUuid,
          status: 'dispatched',
          provider: provider.name,
          providerId,
          leadId,
          to,
          dispatchTime: new Date(),
        };

        circuitBreaker.recordSuccess();

        // Cache for idempotency
        idempotencyCache.set(messageUuid, {
          status: 'dispatched',
          providerId,
          deliveredAt: Date.now(),
        });

        // Record usage for successful SMS send
        if (organizationId) {
          await recordUsage(organizationId, 'sms', 1);
        }

        await logEvent('message_dispatched_gateway', 'message', String(leadId), {
          messageUuid,
          provider: provider.name,
          providerId,
        });

        return dispatchRecord;
      } catch (error: any) {
        lastError = error;
        circuitBreaker?.recordFailure();

        await logEvent('message_dispatch_failed_gateway', 'message', String(leadId), {
          messageUuid,
          provider: provider.name,
          error: error?.message,
        });

        // Try next provider
        const nextProvider = this.getNextProvider(provider.name);
        if (!nextProvider) {
          break;
        }
        provider = nextProvider;
      }
    }

    // 7. ALL PROVIDERS EXHAUSTED
    await logEvent('message_dispatch_failed_all_providers', 'message', String(leadId), {
      messageUuid,
      to,
      error: lastError?.message || 'unknown',
    });

    return {
      messageUuid,
      status: 'failed',
      provider: 'gateway',
      leadId,
      to,
      dispatchTime: new Date(),
      errorMessage: lastError?.message || 'all_providers_failed',
    };
  }

  private selectProvider(threadId: string): ISMSProvider {
    // Check if we have a sticky provider for this thread
    const stickyProviderName = this.stickyRouter.get(threadId);
    if (stickyProviderName) {
      const provider = this.providers.find((p) => p.name === stickyProviderName);
      if (provider) {
        return provider;
      }
    }

    // Select primary or first healthy provider
    const primary = this.providers[0];
    this.stickyRouter.set(threadId, primary.name);
    return primary;
  }

  private getNextProvider(currentProviderName: string): ISMSProvider | null {
    const currentIndex = this.providers.findIndex((p) => p.name === currentProviderName);
    if (currentIndex === -1) {
      return this.providers[0];
    }
    return this.providers[currentIndex + 1] || null;
  }

  getCircuitBreakerStats(): Record<
    string,
    {
      state: string;
      failureCount: number;
      successCount: number;
      deliveryRate: number;
    }
  > {
    const stats: Record<string, any> = {};
    for (const [providerName, breaker] of this.circuitBreakers) {
      const s = breaker.getStats();
      stats[providerName] = {
        state: s.state,
        failureCount: s.failureCount,
        successCount: s.successCount,
        deliveryRate: (s.deliveryRate * 100).toFixed(2) + '%',
      };
    }
    return stats;
  }

  async healthCheckAll(): Promise<
    Record<string, { healthy: boolean; latency: number; state: string }>
  > {
    const results: Record<string, any> = {};
    for (const provider of this.providers) {
      const breaker = this.circuitBreakers.get(provider.name);
      const check = await provider.healthCheck();
      results[provider.name] = {
        healthy: check.healthy,
        latency: check.latency,
        state: breaker?.getState() || 'unknown',
        details: check.details,
      };
    }
    return results;
  }
}
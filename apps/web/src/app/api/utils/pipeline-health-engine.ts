/**
 * Pipeline Health Engine — self-healing AI provider health monitoring.
 *
 * Checks AI providers at exponential intervals (1-2-4-8 hours).
 * If the primary provider (Anthropic/Bedrock) fails, automatically falls back
 * to Ollama for self-healing (local model keeps the pipeline running).
 *
 * Issues detected:
 *   - AI provider down/unreachable
 *   - Missing contract emails (esign flows stuck)
 *   - Stuck campaign contacts
 *   - Dead-lettered jobs without alerts
 *
 * Healing actions:
 *   - Switch to Ollama fallback if primary AI is down
 *   - Re-send missing contract emails
 *   - Reset stuck campaign contacts
 *   - Alert owner on issues that require human intervention
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { callOllama, type OllamaOptions } from './ollama-client';
import { callAnthropic } from './anthropic-client';
import { callBedrock, getBedrockConfig } from './bedrock-client';
import { getAiConfig, setAiConfig, type AiProvider } from './ai-settings';

export interface HealthCheckResult {
  provider: AiProvider;
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface PipelineHealthReport {
  timestamp: string;
  aiHealth: Record<AiProvider, HealthCheckResult | null>;
  activeProvider: AiProvider;
  fallbackActivated: boolean;
  issues: PipelineIssue[];
  healed: HealingAction[];
}

export interface PipelineIssue {
  type: 'ai_down' | 'missing_contracts' | 'stuck_contacts' | 'dead_jobs' | 'esign_stuck';
  severity: 'critical' | 'warning' | 'info';
  count: number;
  detail: string;
}

export interface HealingAction {
  type: string;
  success: boolean;
  detail: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 15_000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

/**
 * Exponential backoff intervals (hours) for health checks.
 * Start at 1 hour, double each time up to 8 hours.
 */
export const HEALTH_CHECK_INTERVALS_HOURS = [1, 2, 4, 8];

/**
 * Get the next check interval based on consecutive failures.
 */
export function getNextCheckIntervalMs(consecutiveFailures: number): number {
  const idx = Math.min(consecutiveFailures, HEALTH_CHECK_INTERVALS_HOURS.length - 1);
  return HEALTH_CHECK_INTERVALS_HOURS[idx] * 60 * 60 * 1000;
}

/**
 * Probe a single AI provider with a lightweight request.
 */
async function probeProvider(
  provider: AiProvider
): Promise<HealthCheckResult> {
  const start = Date.now();
  const testPrompt = 'Reply with exactly: HEALTH_OK';
  const testMessages = [{ role: 'user' as const, content: testPrompt }];

  try {
    if (provider === 'ollama') {
      await Promise.race([
        callOllama(
          { messages: testMessages, maxTokens: 16 },
          { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL }
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
    } else if (provider === 'bedrock') {
      const cfg = getBedrockConfig();
      if (!cfg) {
        return {
          provider,
          healthy: false,
          latencyMs: Date.now() - start,
          error: 'Bedrock not configured',
        };
      }
      await Promise.race([
        callBedrock({ messages: testMessages, maxTokens: 16 }, cfg),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
    } else {
      await Promise.race([
        callAnthropic({ messages: testMessages, maxTokens: 16 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
    }

    return {
      provider,
      healthy: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      provider,
      healthy: false,
      latencyMs: Date.now() - start,
      error: err?.message ?? String(err),
    };
  }
}

/**
 * Check for missing contract emails (esign flows that should have sent but didn't).
 */
async function checkMissingContractEmails(): Promise<PipelineIssue | null> {
  const rows = await sql`
    SELECT id, seller_lead_id, buyer_lead_id, created_at
    FROM contracts
    WHERE esign_status = 'pending'
      AND created_at < now() - interval '30 minutes'
      AND esign_envelope_id IS NULL
    LIMIT 50
  `.catch(() => []);

  if (rows.length === 0) return null;

  return {
    type: 'missing_contracts',
    severity: 'warning',
    count: rows.length,
    detail: `${rows.length} contracts pending >30min with no esign envelope sent`,
  };
}

/**
 * Check for stuck campaign contacts.
 */
async function checkStuckContacts(): Promise<PipelineIssue | null> {
  const rows = await sql`
    SELECT id FROM campaign_contacts
    WHERE status = 'SENDING'
      AND updated_at < now() - interval '10 minutes'
    LIMIT 100
  `.catch(() => []);

  if (rows.length === 0) return null;

  return {
    type: 'stuck_contacts',
    severity: 'warning',
    count: rows.length,
    detail: `${rows.length} campaign contacts stuck in SENDING for >10min`,
  };
}

/**
 * Check for dead jobs without alerts.
 */
async function checkDeadJobs(): Promise<PipelineIssue | null> {
  const rows = await sql`
    SELECT id FROM jobs
    WHERE status = 'dead'
      AND (payload->>'dead_alerted')::boolean IS NOT TRUE
    LIMIT 100
  `.catch(() => []);

  if (rows.length === 0) return null;

  return {
    type: 'dead_jobs',
    severity: 'critical',
    count: rows.length,
    detail: `${rows.length} dead-lettered jobs without owner alert`,
  };
}

/**
 * Check for stuck esign envelopes.
 */
async function checkStuckEsign(): Promise<PipelineIssue | null> {
  const rows = await sql`
    SELECT id FROM contracts
    WHERE esign_status = 'sent'
      AND esign_expires_at < now()
    LIMIT 50
  `.catch(() => []);

  if (rows.length === 0) return null;

  return {
    type: 'esign_stuck',
    severity: 'warning',
    count: rows.length,
    detail: `${rows.length} esign envelopes expired without completion`,
  };
}

/**
 * Heal missing contract emails by re-triggering the esign flow.
 */
async function healMissingContracts(): Promise<HealingAction> {
  const rows = await sql`
    SELECT id, seller_lead_id, buyer_lead_id, organization_id
    FROM contracts
    WHERE esign_status = 'pending'
      AND created_at < now() - interval '30 minutes'
      AND esign_envelope_id IS NULL
    LIMIT 10
  `.catch(() => []);

  if (rows.length === 0) {
    return { type: 'heal_missing_contracts', success: true, detail: 'No contracts to heal' };
  }

  let healed = 0;
  for (const contract of rows as any[]) {
    try {
      const { enqueueJob } = await import('./jobs');
      await enqueueJob('send_contract_email', {
        organizationId: contract.organization_id,
        contractId: contract.id,
        sellerId: contract.seller_lead_id,
        buyerId: contract.buyer_lead_id,
        retry: true,
      });
      healed++;
    } catch {
      // Continue with other contracts
    }
  }

  return {
    type: 'heal_missing_contracts',
    success: healed > 0,
    detail: `Queued ${healed}/${rows.length} missing contract emails for retry`,
  };
}

/**
 * Heal stuck contacts by resetting their status.
 */
async function healStuckContacts(): Promise<HealingAction> {
  const result = await sql`
    UPDATE campaign_contacts
    SET status = 'QUEUED', updated_at = now()
    WHERE status = 'SENDING'
      AND updated_at < now() - interval '10 minutes'
    RETURNING id
  `.catch(() => []);

  return {
    type: 'heal_stuck_contacts',
    success: true,
    detail: `Reset ${result.length} stuck contacts to QUEUED`,
  };
}

/**
 * Activate Ollama fallback when primary AI is down.
 */
async function activateOllamaFallback(
  systemUserId: string,
  reason: string
): Promise<HealingAction> {
  try {
    await setAiConfig(
      { provider: 'ollama', ollamaBaseUrl: OLLAMA_BASE_URL, ollamaModel: OLLAMA_MODEL },
      systemUserId
    );

    await logEvent('pipeline_fallback_activated', 'system', 'health-engine', {
      reason,
      fallbackProvider: 'ollama',
    });

    return {
      type: 'activate_ollama_fallback',
      success: true,
      detail: `Switched to Ollama fallback: ${reason}`,
    };
  } catch (err: any) {
    return {
      type: 'activate_ollama_fallback',
      success: false,
      detail: `Failed to activate Ollama: ${err?.message ?? String(err)}`,
    };
  }
}

/**
 * Run a full pipeline health check and attempt self-healing.
 */
export async function runPipelineHealthCheck(
  options: { autoHeal?: boolean; systemUserId?: string } = {}
): Promise<PipelineHealthReport> {
  const { autoHeal = true, systemUserId = 'health-engine' } = options;
  const report: PipelineHealthReport = {
    timestamp: new Date().toISOString(),
    aiHealth: { anthropic: null, ollama: null, bedrock: null },
    activeProvider: 'anthropic',
    fallbackActivated: false,
    issues: [],
    healed: [],
  };

  // 1. Check AI providers
  const currentConfig = await getAiConfig();
  report.activeProvider = currentConfig.provider;

  const providers: AiProvider[] = ['anthropic', 'ollama', 'bedrock'];
  const healthChecks = await Promise.all(providers.map(probeProvider));

  for (const check of healthChecks) {
    report.aiHealth[check.provider] = check;
  }

  // 2. Check for primary AI being down
  const primaryHealth = report.aiHealth[currentConfig.provider];
  const ollamaHealth = report.aiHealth.ollama;

  if (primaryHealth && !primaryHealth.healthy) {
    report.issues.push({
      type: 'ai_down',
      severity: 'critical',
      count: 1,
      detail: `Primary AI (${currentConfig.provider}) is down: ${primaryHealth.error}`,
    });

    // Auto-heal: switch to Ollama if it's healthy
    if (autoHeal && ollamaHealth?.healthy && currentConfig.provider !== 'ollama') {
      const healResult = await activateOllamaFallback(
        systemUserId,
        `Primary AI (${currentConfig.provider}) down: ${primaryHealth.error}`
      );
      report.healed.push(healResult);
      report.fallbackActivated = healResult.success;
    }
  }

  // 3. Check pipeline issues
  const issueChecks = await Promise.all([
    checkMissingContractEmails(),
    checkStuckContacts(),
    checkDeadJobs(),
    checkStuckEsign(),
  ]);

  for (const issue of issueChecks) {
    if (issue) report.issues.push(issue);
  }

  // 4. Auto-heal issues
  if (autoHeal) {
    const missingContractsIssue = report.issues.find((i) => i.type === 'missing_contracts');
    if (missingContractsIssue) {
      report.healed.push(await healMissingContracts());
    }

    const stuckContactsIssue = report.issues.find((i) => i.type === 'stuck_contacts');
    if (stuckContactsIssue) {
      report.healed.push(await healStuckContacts());
    }
  }

  // 5. Log the health check
  await logEvent('pipeline_health_check', 'system', 'health-engine', {
    healthy: report.issues.filter((i) => i.severity === 'critical').length === 0,
    issues: report.issues.length,
    healed: report.healed.filter((h) => h.success).length,
  }).catch(() => {});

  return report;
}

/**
 * Get stored health state (consecutive failures, last check time).
 */
export async function getHealthState(): Promise<{
  consecutiveFailures: number;
  lastCheckAt: Date | null;
  lastHealthy: boolean;
}> {
  const [row] = await sql`
    SELECT value FROM app_settings WHERE key = 'pipeline_health_state' LIMIT 1
  `.catch(() => []);

  if (!row?.value) {
    return { consecutiveFailures: 0, lastCheckAt: null, lastHealthy: true };
  }

  const v = row.value as Record<string, unknown>;
  return {
    consecutiveFailures: typeof v.consecutiveFailures === 'number' ? v.consecutiveFailures : 0,
    lastCheckAt: v.lastCheckAt ? new Date(v.lastCheckAt as string) : null,
    lastHealthy: v.lastHealthy !== false,
  };
}

/**
 * Update stored health state.
 */
export async function updateHealthState(
  healthy: boolean
): Promise<{ consecutiveFailures: number; nextCheckMs: number }> {
  const current = await getHealthState();
  const consecutiveFailures = healthy ? 0 : current.consecutiveFailures + 1;

  await sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (
      'pipeline_health_state',
      ${JSON.stringify({
        consecutiveFailures,
        lastCheckAt: new Date().toISOString(),
        lastHealthy: healthy,
      })},
      'health-engine',
      now()
    )
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `.catch(() => {});

  return {
    consecutiveFailures,
    nextCheckMs: getNextCheckIntervalMs(consecutiveFailures),
  };
}

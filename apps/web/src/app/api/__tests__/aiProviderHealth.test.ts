/**
 * AI PROVIDER HEALTH MUST BE MEASURED ON THE PROVIDER THAT ACTUALLY SERVES.
 *
 * DEFECT (found 2026-09-30 during the production-outage investigation): every AI
 * health surface inferred health from CONFIGURATION PRESENCE, and one probed the
 * wrong provider outright. That is how a total AI outage stayed invisible:
 *
 *   1. /api/system/ai-status  — the admin "test connection" ALWAYS called
 *      `callAnthropic`, even when the active provider was Bedrock, and reported
 *      `provider: 'anthropic'`.
 *   2. /api/system/health     — computed `services.ai` from
 *      `Boolean(process.env.ANTHROPIC_API_KEY)` for every non-Ollama provider, so
 *      a Bedrock deployment was judged by the Anthropic key.
 *   3. /api/admin/stats       — reported `aiProvider: healthy` whenever an
 *      `app_settings` ROW existed, i.e. a config row counted as a working
 *      provider. The dashboard read "healthy" while every AI call 400'd.
 *
 * The live failure these hid: the primary provider (Bedrock) rejected its
 * credentials (403 UnrecognizedClientException) and the last-resort provider
 * (Anthropic) had no credit (400) - so every AI call failed while all three
 * surfaces reported OK.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => ({ ok: true, admin: { userId: 'admin_1' } })));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: () => mockRequireAdmin() }));

const mockGetAiConfig = vi.hoisted(() =>
  vi.fn(async () => ({ provider: 'bedrock', ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'q', source: 'env' }))
);
vi.mock('@/app/api/utils/ai-settings', () => ({ getAiConfig: () => mockGetAiConfig() }));

const mockCallAnthropic = vi.hoisted(() =>
  vi.fn(async () => ({ text: 'ok', model: 'claude', usage: { input_tokens: 1, output_tokens: 1 } }))
);
vi.mock('@/app/api/utils/anthropic-client', () => ({
  callAnthropic: (...a: unknown[]) => mockCallAnthropic(...a),
  AnthropicClientError: class extends Error {},
}));

const mockCallBedrock = vi.hoisted(() =>
  vi.fn(async () => ({ text: 'ok', model: 'bedrock-model', usage: { input_tokens: 1, output_tokens: 1 } }))
);
const mockGetBedrockConfig = vi.hoisted(() =>
  vi.fn(() => ({ region: 'us-east-1', modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }))
);
vi.mock('@/app/api/utils/bedrock-client', () => ({
  callBedrock: (...a: unknown[]) => mockCallBedrock(...a),
  getBedrockConfig: () => mockGetBedrockConfig(),
}));

vi.mock('@/app/api/utils/ai-provider', () => ({ callAI: vi.fn(), getLastUsedProvider: () => null }));
vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig: () => ({ sid: 'AC' }) }));
// Real comparison, not a stub: `services` is intentionally released ONLY to an
// ops caller presenting CRON_SECRET, and that gating must keep working.
vi.mock('@/app/api/utils/secretCompare', () => ({
  timingSafeSecretEqual: (a: string | null, b: string | undefined) => !!a && !!b && a === b,
}));

/** SQL mock: answers the specific queries these routes make. */
const mockSql = vi.hoisted(() =>
  vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('app_settings')) return [{ value: { provider: 'bedrock' } }];
    return [];
  })
);
vi.mock('@/app/api/utils/sql', () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => mockSql(strings, ...values),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAiConfig.mockResolvedValue({
    provider: 'bedrock',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'q',
    source: 'env',
  } as never);
});

describe('AI health must reflect the provider that actually serves', () => {
  it('ai-status probes BEDROCK when Bedrock is the active provider', async () => {
    const { GET } = await import('@/app/api/system/ai-status/route');
    const res = await GET();
    const body = await res.json();

    expect(body.provider).toBe('bedrock');
    expect(mockCallBedrock).toHaveBeenCalled();
    // Testing a provider that is not in use is the whole defect.
    expect(mockCallAnthropic).not.toHaveBeenCalled();
  });

  it('ai-status reports the provider error when the active provider is broken', async () => {
    mockCallBedrock.mockRejectedValueOnce(
      Object.assign(new Error('security token invalid'), { name: 'UnrecognizedClientException' })
    );
    const { GET } = await import('@/app/api/system/ai-status/route');
    const res = await GET();
    const body = await res.json();

    expect(body.reachable).toBe(false);
    expect(String(body.detail)).toContain('security token invalid');
  });

  it('ai-status still probes Anthropic when Anthropic is the active provider', async () => {
    mockGetAiConfig.mockResolvedValue({
      provider: 'anthropic',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'q',
      source: 'env',
    } as never);
    const { GET } = await import('@/app/api/system/ai-status/route');
    const res = await GET();
    const body = await res.json();

    expect(body.provider).toBe('anthropic');
    expect(mockCallAnthropic).toHaveBeenCalled();
    expect(mockCallBedrock).not.toHaveBeenCalled();
  });

  it('system/health judges services.ai by the ACTIVE provider credentials', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevAws = process.env.AWS_ACCESS_KEY_ID;
    const prevCron = process.env.CRON_SECRET;
    // Bedrock deployment: Anthropic key absent, AWS creds present.
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLEEXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.BEDROCK_MODEL_NEGOTIATE = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    process.env.CRON_SECRET = 'ops-secret';
    try {
      const { GET } = await import('@/app/api/system/health/route');
      const res = await GET(
        new Request('http://x/api/system/health', { headers: { 'x-cron-secret': 'ops-secret' } })
      );
      const body = await res.json();
      // Must follow the Bedrock creds, not the (absent) Anthropic key.
      expect(body.services?.ai).toBe(true);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevAws !== undefined) process.env.AWS_ACCESS_KEY_ID = prevAws;
      else delete process.env.AWS_ACCESS_KEY_ID;
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
      else delete process.env.CRON_SECRET;
    }
  });

  it('system/health still withholds the services map from non-ops callers', async () => {
    const { GET } = await import('@/app/api/system/health/route');
    const res = await GET(new Request('http://x/api/system/health'));
    const body = await res.json();
    // Unauthenticated callers must not learn which integrations are configured.
    expect(body.services).toBeUndefined();
  });

  it('admin stats does not call a settings row a healthy provider', async () => {
    // A row exists (the SQL mock answers it) but no provider has credentials.
    const saved = {
      aws: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      model: process.env.BEDROCK_MODEL_NEGOTIATE,
      anthropic: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.BEDROCK_MODEL_NEGOTIATE;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { GET } = await import('@/app/api/admin/stats/route');
      const res = await GET();
      const body = await res.json();
      expect(body.systemHealth?.checks?.aiProvider?.status).not.toBe('healthy');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
      }
    }
  });
});

import { requireAdmin } from '@/app/api/utils/authz';
import { getAiConfig } from '@/app/api/utils/ai-settings';
import { callAnthropic } from '@/app/api/utils/anthropic-client';
import { callBedrock, getBedrockConfig } from '@/app/api/utils/bedrock-client';
import {
  classifyAiFailure,
  classifyAiNotConfigured,
} from '@/app/api/utils/aiFailureClassification';

/**
 * Live "test connection" for the ACTIVE AI provider (admin). Cheap + honest:
 *  - ollama    → GET {base}/api/tags (free) → reachable + is the model pulled?
 *  - anthropic → a 1-token message call → true green/red (surfaces a bad key or
 *                a $0 credit balance as the actual error).
 *  - bedrock   → a 1-token Converse call → surfaces an invalid AWS token, a
 *                model that is not enabled, or a wrong region.
 *
 * DEFECT (2026-09-30): this route ignored `cfg.provider` and ALWAYS called
 * Anthropic, so a Bedrock deployment was told "Anthropic reachable" and the
 * real Bedrock failure (403 invalid security token) was never surfaced. The
 * whole point of this route is to answer "would the next AI call work?", so it
 * must exercise the provider that would actually serve it.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const cfg = await getAiConfig();

  if (cfg.provider === 'ollama') {
    try {
      const headers: Record<string, string> = {};
      if (process.env.OLLAMA_API_KEY) headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
      const res = await fetch(`${cfg.ollamaBaseUrl}/api/tags`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const c = classifyAiFailure(`Ollama responded ${res.status}`);
        return Response.json({
          provider: 'ollama',
          model: cfg.ollamaModel,
          reachable: false,
          code: c.code,
          operatorAction: c.operatorAction,
          retryable: c.retryable,
          detail: `Ollama responded ${res.status}`,
        });
      }
      const data: any = await res.json().catch(() => ({}));
      const models: string[] = Array.isArray(data?.models) ? data.models.map((m: any) => m?.name).filter(Boolean) : [];
      const modelPresent = models.some((m) => m === cfg.ollamaModel || m.startsWith(cfg.ollamaModel.split(':')[0]));
      return Response.json({
        provider: 'ollama',
        model: cfg.ollamaModel,
        baseUrl: cfg.ollamaBaseUrl,
        reachable: true,
        modelPresent,
        installedModels: models,
        detail: modelPresent ? 'Ollama reachable; model available.' : `Ollama reachable but '${cfg.ollamaModel}' not pulled — run: ollama pull ${cfg.ollamaModel}`,
      });
    } catch (err: any) {
      const c = classifyAiFailure(err?.message);
      return Response.json({
        provider: 'ollama',
        model: cfg.ollamaModel,
        baseUrl: cfg.ollamaBaseUrl,
        reachable: false,
        code: c.code,
        operatorAction: c.operatorAction,
        retryable: c.retryable,
        detail: `Ollama not reachable at ${cfg.ollamaBaseUrl} — is \`ollama serve\` running? (${err?.message || err})`,
      });
    }
  }

  // bedrock
  if (cfg.provider === 'bedrock') {
    const bedrockCfg = getBedrockConfig();
    if (!bedrockCfg) {
      const c = classifyAiNotConfigured('Bedrock');
      return Response.json({
        provider: 'bedrock',
        reachable: false,
        code: c.code,
        operatorAction: c.operatorAction,
        retryable: c.retryable,
        detail:
          'Bedrock is the selected provider but is not configured — set BEDROCK_MODEL_NEGOTIATE, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY',
      });
    }
    try {
      const r = await callBedrock(
        { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
        bedrockCfg
      );
      return Response.json({
        provider: 'bedrock',
        model: r.model,
        reachable: true,
        detail: `Bedrock reachable (model ${r.model}).`,
      });
    } catch (err: any) {
      // The raw provider message is preserved in `detail`; `operatorAction` is
      // the translation an operator actually needs (rotate the AWS key vs. add
      // credit vs. enable the model) - see aiFailureClassification.ts.
      const c = classifyAiFailure(err?.message);
      return Response.json({
        provider: 'bedrock',
        reachable: false,
        code: c.code,
        operatorAction: c.operatorAction,
        retryable: c.retryable,
        detail: err?.message || 'Bedrock call failed',
      });
    }
  }

  // anthropic
  try {
    const r = await callAnthropic({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
    return Response.json({ provider: 'anthropic', model: r.model, reachable: true, detail: `Anthropic reachable (model ${r.model}).` });
  } catch (err: any) {
    const c = classifyAiFailure(err?.message);
    return Response.json({
      provider: 'anthropic',
      reachable: false,
      code: c.code,
      operatorAction: c.operatorAction,
      retryable: c.retryable,
      detail: err?.message || 'Anthropic call failed',
    });
  }
}

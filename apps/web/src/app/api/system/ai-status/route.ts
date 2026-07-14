import { requireAdmin } from '@/app/api/utils/authz';
import { getAiConfig } from '@/app/api/utils/ai-settings';
import { callAnthropic } from '@/app/api/utils/anthropic-client';

/**
 * Live "test connection" for the ACTIVE AI provider (admin). Cheap + honest:
 *  - ollama    → GET {base}/api/tags (free) → reachable + is the model pulled?
 *  - anthropic → a 1-token message call → true green/red (surfaces a bad key or
 *                a $0 credit balance as the actual error).
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
        return Response.json({ provider: 'ollama', model: cfg.ollamaModel, reachable: false, detail: `Ollama responded ${res.status}` });
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
      return Response.json({
        provider: 'ollama',
        model: cfg.ollamaModel,
        baseUrl: cfg.ollamaBaseUrl,
        reachable: false,
        detail: `Ollama not reachable at ${cfg.ollamaBaseUrl} — is \`ollama serve\` running? (${err?.message || err})`,
      });
    }
  }

  // anthropic
  try {
    const r = await callAnthropic({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
    return Response.json({ provider: 'anthropic', model: r.model, reachable: true, detail: `Anthropic reachable (model ${r.model}).` });
  } catch (err: any) {
    return Response.json({ provider: 'anthropic', reachable: false, detail: err?.message || 'Anthropic call failed' });
  }
}

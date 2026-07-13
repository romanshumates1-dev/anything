import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import {
  getAiConfig,
  setAiConfig,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  type AiProvider,
} from '@/app/api/utils/ai-settings';

/**
 * AI provider toggle (admin). GET returns the active config; PUT switches
 * between the Anthropic hosted API and a local Ollama model. Env/default
 * fallback means an unset config still works (Anthropic).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const cfg = await getAiConfig();
  return Response.json({ ...cfg, defaults: { ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL, ollamaModel: DEFAULT_OLLAMA_MODEL } });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = typeof b.provider === 'string' ? b.provider.toLowerCase() : '';
  if (provider !== 'anthropic' && provider !== 'ollama') {
    return Response.json({ error: "provider must be 'anthropic' or 'ollama'" }, { status: 400 });
  }
  const cfg = await setAiConfig(
    {
      provider: provider as AiProvider,
      ollamaBaseUrl: typeof b.ollamaBaseUrl === 'string' ? b.ollamaBaseUrl : undefined,
      ollamaModel: typeof b.ollamaModel === 'string' ? b.ollamaModel : undefined,
    },
    admin.userId
  );
  await logEvent('ai_provider_changed', 'app_setting', 'ai_provider', { provider: cfg.provider, model: cfg.provider === 'ollama' ? cfg.ollamaModel : undefined }, admin.userId);
  return Response.json(cfg);
}

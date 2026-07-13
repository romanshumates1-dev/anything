/**
 * Single AI entry point for the runtime. Dispatches to the configured backend
 * (Anthropic hosted API — default — or a local Ollama model) behind ONE
 * interface, so the orchestrator/negotiator never care which is active.
 *
 * The product's default + primary vendor remains Anthropic; Ollama is an
 * optional, owner-selectable local alternative (Settings → AI Provider) for
 * running without API credits. Provider is resolved per-call via ai-settings
 * (DB toggle → env → default).
 */
import { callAnthropic, type AnthropicCallOptions, type AnthropicResponse } from './anthropic-client';
import { callOllama } from './ollama-client';
import { getAiConfig, type AiConfig } from './ai-settings';

export type { AnthropicCallOptions, AnthropicResponse, AnthropicMessage } from './anthropic-client';
export { AnthropicClientError } from './anthropic-client';

/** Route one AI call to the active provider. */
export async function callAI(options: AnthropicCallOptions): Promise<AnthropicResponse> {
  const cfg = await getAiConfig();
  if (cfg.provider === 'ollama') {
    return callOllama(options, { baseUrl: cfg.ollamaBaseUrl, model: cfg.ollamaModel });
  }
  return callAnthropic(options);
}

/** Which provider/model would serve the next call (for status/UI). */
export async function activeAi(): Promise<AiConfig> {
  return getAiConfig();
}

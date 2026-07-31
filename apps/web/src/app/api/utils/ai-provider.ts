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
import { callBedrock } from './bedrock-client';
import { getAiConfig, type AiConfig } from './ai-settings';

export type { AnthropicCallOptions, AnthropicResponse, AnthropicMessage } from './anthropic-client';
export { AnthropicClientError } from './anthropic-client';

/** Route one AI call to the active provider. */
export async function callAI(options: AnthropicCallOptions): Promise<AnthropicResponse> {
  const cfg = await getAiConfig();
  if (cfg.provider === 'ollama') {
    // OLLAMA_API_KEY is a SECRET read straight from env (never from the DB
    // toggle / never returned by the settings API) — sent as a bearer to a
    // tunnel-protected remote Ollama.
    return callOllama(options, {
      baseUrl: cfg.ollamaBaseUrl,
      model: cfg.ollamaModel,
      apiKey: process.env.OLLAMA_API_KEY || undefined,
    });
  }
  if (cfg.provider === 'bedrock') {
    // Credentials + model id are read from env inside callBedrock, never from
    // the DB toggle — same rule OLLAMA_API_KEY follows. Switching the model
    // (e.g. to Fable 5 once its Bedrock entitlement propagates) is one .env
    // change with no code edit.
    return callBedrock(options);
  }
  return callAnthropic(options);
}

/** Which provider/model would serve the next call (for status/UI). */
export async function activeAi(): Promise<AiConfig> {
  return getAiConfig();
}

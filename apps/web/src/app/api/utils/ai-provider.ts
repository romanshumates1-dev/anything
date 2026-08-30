/**
 * Single AI entry point for the runtime. Dispatches to the configured backend
 * (Ollama by default for cost savings, with automatic fallback to Bedrock → Anthropic)
 * behind ONE interface, so the orchestrator/negotiator never care which is active.
 *
 * FALLBACK CHAIN (automatic on connection failure):
 *   Ollama (primary, free) → Bedrock (AWS credits) → Anthropic (paid API)
 *
 * The fallback only triggers on CONNECTION errors (unreachable, timeout, ECONNREFUSED).
 * API errors (auth, rate limits, bad request) are NOT retried on other providers
 * to avoid masking configuration problems.
 */
import { callAnthropic, type AnthropicCallOptions, type AnthropicResponse, AnthropicClientError } from './anthropic-client';
import { callOllama } from './ollama-client';
import { callBedrock, getBedrockConfig } from './bedrock-client';
import { getAiConfig, type AiConfig, type AiProvider } from './ai-settings';

export type { AnthropicCallOptions, AnthropicResponse, AnthropicMessage } from './anthropic-client';
export { AnthropicClientError } from './anthropic-client';

/** Track which provider actually served the last call (for monitoring/logging). */
let lastUsedProvider: AiProvider | null = null;
export function getLastUsedProvider(): AiProvider | null {
  return lastUsedProvider;
}

/** Check if an error is a connection/reachability issue (fallback-worthy). */
function isConnectionError(err: unknown): boolean {
  if (err instanceof AnthropicClientError) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('not reachable') ||
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('timed out') ||
      msg.includes('network') ||
      err.status === undefined // no HTTP status = connection never established
    );
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('fetch failed') ||
      msg.includes('timed out') ||
      msg.includes('network')
    );
  }
  return false;
}

/** Try calling Ollama with fallback disabled (for direct calls). */
async function tryOllama(options: AnthropicCallOptions, cfg: AiConfig): Promise<AnthropicResponse> {
  return callOllama(options, {
    baseUrl: cfg.ollamaBaseUrl,
    model: cfg.ollamaModel,
    apiKey: process.env.OLLAMA_API_KEY || undefined,
  });
}

/** Try calling Bedrock. Returns null if not configured. */
async function tryBedrock(options: AnthropicCallOptions): Promise<AnthropicResponse | null> {
  const bedrockCfg = getBedrockConfig();
  if (!bedrockCfg) return null;
  return callBedrock(options, bedrockCfg);
}

/** Try calling Anthropic. Returns null if not configured. */
async function tryAnthropic(options: AnthropicCallOptions): Promise<AnthropicResponse | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return callAnthropic(options);
}

/**
 * Route one AI call to the active provider WITH automatic fallback on connection errors.
 *
 * Fallback chain: Ollama → Bedrock → Anthropic
 * Only connection errors trigger fallback; API errors (auth, rate limit) do not.
 */
export async function callAI(options: AnthropicCallOptions): Promise<AnthropicResponse> {
  const cfg = await getAiConfig();
  const errors: Array<{ provider: AiProvider; error: Error }> = [];

  // Build the provider chain based on primary preference
  const chain: AiProvider[] = [];
  if (cfg.provider === 'ollama') {
    chain.push('ollama', 'bedrock', 'anthropic');
  } else if (cfg.provider === 'bedrock') {
    chain.push('bedrock', 'ollama', 'anthropic');
  } else {
    chain.push('anthropic', 'bedrock', 'ollama');
  }

  for (const provider of chain) {
    try {
      let result: AnthropicResponse | null = null;

      if (provider === 'ollama') {
        result = await tryOllama(options, cfg);
      } else if (provider === 'bedrock') {
        result = await tryBedrock(options);
      } else if (provider === 'anthropic') {
        result = await tryAnthropic(options);
      }

      if (result) {
        lastUsedProvider = provider;
        // Log fallback if we're not on the primary provider
        if (provider !== cfg.provider && errors.length > 0) {
          console.warn(
            `[AI-PROVIDER] Fallback activated: ${cfg.provider} → ${provider}. ` +
            `Primary errors: ${errors.map(e => `${e.provider}: ${e.error.message}`).join('; ')}`
          );
        }
        return result;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ provider, error });

      // Only fallback on connection errors - API errors should fail immediately
      if (!isConnectionError(err)) {
        throw err;
      }

      // Continue to next provider in chain
      console.warn(`[AI-PROVIDER] ${provider} connection failed, trying next: ${error.message}`);
    }
  }

  // All providers failed
  const errorSummary = errors.map(e => `${e.provider}: ${e.error.message}`).join('; ');
  throw new AnthropicClientError(
    `All AI providers failed. Errors: ${errorSummary}`,
    undefined,
    false
  );
}

/** Which provider/model would serve the next call (for status/UI). */
export async function activeAi(): Promise<AiConfig> {
  return getAiConfig();
}

/** Get fallback status for monitoring. */
export async function getFallbackStatus(): Promise<{
  primary: AiProvider;
  lastUsed: AiProvider | null;
  fallbackActive: boolean;
  available: { ollama: boolean; bedrock: boolean; anthropic: boolean };
}> {
  const cfg = await getAiConfig();
  const bedrockCfg = getBedrockConfig();
  return {
    primary: cfg.provider,
    lastUsed: lastUsedProvider,
    fallbackActive: lastUsedProvider !== null && lastUsedProvider !== cfg.provider,
    available: {
      ollama: !!cfg.ollamaBaseUrl,
      bedrock: !!bedrockCfg,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  };
}

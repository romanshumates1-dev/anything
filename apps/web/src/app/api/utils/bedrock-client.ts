/**
 * Amazon Bedrock client — Anthropic models via the AWS SDK v3 Converse API.
 *
 * WHY THE SDK NOW
 * The raw SigV4 implementation had a persistent path-encoding mismatch with
 * Bedrock's canonical request reconstruction. The SDK's @aws-sdk/client-bedrock-runtime
 * handles SigV4 correctly, including the double-encoding of ':' in model IDs.
 * 26 packages / 5.9 MiB is a reasonable cost for correct signing.
 *
 * CONVERSE, NOT INVOKEMODEL
 * Converse is the unified surface across Bedrock models: one request shape, one
 * response shape, and no per-model payload branching. InvokeModel would mean
 * re-learning a body format every time the model ID changes — exactly the
 * coupling BEDROCK_MODEL_NEGOTIATE being a single .env value is meant to avoid.
 *
 * NO FALLBACK. If Bedrock is the selected provider and the call fails, this
 * throws. A silent downgrade to another provider would make an outage look like
 * a quality regression, and a mock reply would put fabricated text in front of
 * a seller.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AnthropicClientError, type AnthropicCallOptions, type AnthropicResponse } from './anthropic-client';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Maps friendly model names to Bedrock model IDs.
 * 403 errors usually mean the model isn't enabled or the ID is wrong.
 *
 * Bedrock model ID format: anthropic.claude-{variant}-{version}-v{api}:{rev}
 * Example: anthropic.claude-3-5-sonnet-20241022-v2:0
 *
 * IMPORTANT: "Fable 5" is NOT a Bedrock model. It's only available via the
 * Anthropic API directly. Use Sonnet 4 or Haiku 4.5 on Bedrock.
 */
const MODEL_ALIASES: Record<string, string> = {
  // Friendly names -> actual Bedrock IDs
  // Note: "us." prefix = cross-region inference profile (recommended for availability)
  'claude-fable-5': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', // Fable isn't on Bedrock; fallback to Sonnet
  'fable-5': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'claude-sonnet-5': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-sonnet-4': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-haiku-4-5': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-opus-4': 'us.anthropic.claude-opus-4-20250514-v1:0',
  // Non-prefixed versions (region-specific)
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-sonnet-4-20250514-v1:0': 'anthropic.claude-sonnet-4-20250514-v1:0',
  // Already-correct Bedrock IDs (with us. prefix) pass through
};

/** Resolve a model name/alias to the correct Bedrock model ID */
function resolveModelId(input: string): string {
  // If it's already a full Bedrock ID (starts with anthropic. or us.anthropic.), use as-is
  if (input.startsWith('anthropic.') || input.startsWith('us.anthropic.')) return input;

  // Check aliases
  const alias = MODEL_ALIASES[input.toLowerCase()];
  if (alias) return alias;

  // If it looks like a bare model name, try to construct Bedrock ID
  if (input.includes('claude')) {
    // Default to haiku for cost efficiency (use us. prefix for cross-region)
    console.warn(`[Bedrock] Unknown model "${input}", defaulting to claude-haiku-4-5`);
    return 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  }

  // Pass through as-is (let Bedrock reject it with a clear error)
  return input;
}

export interface BedrockConfig {
  region: string;
  modelId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Resolve config from env. Returns null when not configured so the selector can
 * fail with a precise message rather than a signing error 40 lines deeper.
 */
export function getBedrockConfig(): BedrockConfig | null {
  const region = process.env.AWS_REGION || DEFAULT_REGION;
  const modelId = process.env.BEDROCK_MODEL_NEGOTIATE || process.env.BEDROCK_MODEL_ID;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!modelId || !accessKeyId || !secretAccessKey) return null;
  return {
    region,
    modelId,
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

/**
 * Call Bedrock Converse and return the SAME shape as callAnthropic, so the
 * orchestrator and negotiator cannot tell which provider served the call.
 */
export async function callBedrock(
  options: AnthropicCallOptions,
  cfgOverride?: BedrockConfig | null,
): Promise<AnthropicResponse> {
  const cfg = cfgOverride === undefined ? getBedrockConfig() : cfgOverride;
  if (!cfg) {
    throw new AnthropicClientError(
      'Bedrock is the selected AI provider but is not configured — set BEDROCK_MODEL_NEGOTIATE, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY',
      undefined,
      false
    );
  }

  const client = new BedrockRuntimeClient({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      sessionToken: cfg.sessionToken,
    },
    requestHandler: {
      requestTimeout: DEFAULT_TIMEOUT_MS,
    },
  });

  const { raw = false } = options;
  // Ensure there is at least one user message (mirrors callAnthropic).
  const hasUserLast = options.messages.length > 0 && options.messages[options.messages.length - 1].role === 'user';
  const allMessages = hasUserLast
    ? options.messages
    : [...options.messages, { role: 'user' as const, content: 'Please respond.' }];
  const messages = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: [{ text: m.content }],
  }));

  // Resolve model aliases (e.g., "fable-5" -> actual Bedrock ID)
  const resolvedModelId = resolveModelId(cfg.modelId);
  if (resolvedModelId !== cfg.modelId) {
    console.log(`[Bedrock] Resolved model "${cfg.modelId}" -> "${resolvedModelId}"`);
  }

  const command = new ConverseCommand({
    modelId: resolvedModelId,
    messages,
    system: options.system ? [{ text: options.system }] : undefined,
    inferenceConfig: {
      maxTokens: options.maxTokens ?? 1024,
    },
  });

  let response;
  try {
    response = await client.send(command);
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    const retryable = status === 429 || (status != null && status >= 500);
    // 403 = model not enabled, wrong region, or invalid model ID
    const hint =
      status === 403
        ? ' — check: 1) model is enabled in Bedrock console, 2) region matches, 3) IAM has bedrock:InvokeModel permission'
        : '';
    throw new AnthropicClientError(
      `Bedrock error${status ? ` [${status}]` : ''} for model ${resolvedModelId}${hint}: ${error?.message ?? String(error)}`,
      status,
      retryable,
      error,
    );
  }

  const output = response.output;
  if (!output?.message?.content?.length) {
    throw new AnthropicClientError('Bedrock returned an empty completion', undefined, false);
  }

  const blocks = output.message.content;
  const text = blocks
    .map((b: any) => (b?.text ?? ''))
    .join('')
    .trim();
  if (!text) {
    throw new AnthropicClientError('Bedrock returned an empty completion', undefined, false);
  }

  return {
    text,
    contentBlocks: raw ? blocks.filter((b: any) => typeof b?.text === 'string').map((b: any) => ({ type: 'text' as const, text: b.text! })) : [],
    stopReason: response.stopReason ?? 'end_turn',
    model: resolvedModelId,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  };
}

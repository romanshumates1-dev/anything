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

  const command = new ConverseCommand({
    modelId: cfg.modelId,
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
    throw new AnthropicClientError(
      `Bedrock error${status ? ` [${status}]` : ''} for model ${cfg.modelId}: ${error?.message ?? String(error)}`,
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
    model: cfg.modelId,
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  };
}

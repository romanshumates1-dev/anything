/**
 * Unit tests for the Bedrock client — SDK-based Converse API.
 *
 * The SDK handles SigV4 signing internally; these tests verify the
 * response mapping, error handling, and config resolution by mocking
 * the BedrockRuntimeClient at the module boundary.
 *
 * The live call proof is in scripts/verify-bedrock-live.mjs (run manually
 * with real credentials and model access enabled).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callBedrock, getBedrockConfig, type BedrockConfig } from './bedrock-client';
import { AnthropicClientError } from './anthropic-client';

// --- Mock the AWS SDK at the module boundary ---
// vi.hoisted ensures the mock fn is available inside the vi.mock factory
// (which runs before imports are evaluated).
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  ConverseCommand: vi.fn().mockImplementation((args: any) => ({
    ...args,
    __isConverseCommand: true,
  })),
}));

const TEST_CFG: BedrockConfig = {
  region: 'us-east-1',
  modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

describe('getBedrockConfig', () => {
  it('returns null when required env vars are missing', () => {
    const orig = { ...process.env };
    delete process.env.BEDROCK_MODEL_NEGOTIATE;
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(getBedrockConfig()).toBeNull();
    Object.assign(process.env, orig);
  });

  it('returns config when all required env vars are set', () => {
    const orig = { ...process.env };
    process.env.AWS_REGION = 'us-west-2';
    process.env.BEDROCK_MODEL_NEGOTIATE = 'anthropic.test-v1:0';
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secrettest';
    delete process.env.AWS_SESSION_TOKEN;
    const cfg = getBedrockConfig();
    expect(cfg).toEqual({
      region: 'us-west-2',
      modelId: 'anthropic.test-v1:0',
      accessKeyId: 'AKIATEST',
      secretAccessKey: 'secrettest',
      sessionToken: undefined,
    });
    Object.assign(process.env, orig);
  });

  it('falls back to BEDROCK_MODEL_ID when BEDROCK_MODEL_NEGOTIATE is not set', () => {
    const orig = { ...process.env };
    delete process.env.BEDROCK_MODEL_NEGOTIATE;
    process.env.BEDROCK_MODEL_ID = 'legacy-model';
    process.env.AWS_ACCESS_KEY_ID = 'a';
    process.env.AWS_SECRET_ACCESS_KEY = 'b';
    expect(getBedrockConfig()?.modelId).toBe('legacy-model');
    Object.assign(process.env, orig);
  });

  it('passes through session token when present', () => {
    const orig = { ...process.env };
    process.env.AWS_REGION = 'us-east-1';
    process.env.BEDROCK_MODEL_NEGOTIATE = 'anthropic.test-v1:0';
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secrettest';
    process.env.AWS_SESSION_TOKEN = 'session-token-123';
    const cfg = getBedrockConfig();
    expect(cfg?.sessionToken).toBe('session-token-123');
    Object.assign(process.env, orig);
  });
});

describe('callBedrock (mocked SDK)', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('throws AnthropicClientError when config is null', async () => {
    await expect(callBedrock({ messages: [{ role: 'user', content: 'hi' }] }, null)).rejects.toThrow(AnthropicClientError);
    await expect(callBedrock({ messages: [{ role: 'user', content: 'hi' }] }, null)).rejects.toThrow(/not configured/);
  });

  it('maps Converse response to AnthropicResponse shape', async () => {
    // REAL test: mock the SDK send() to return a Converse response, then
    // call callBedrock and verify the mapping. This would fail if the
    // mapping code were broken.
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: 'Hello from Bedrock' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await callBedrock(
      { messages: [{ role: 'user', content: 'Hello' }], maxTokens: 32, raw: true },
      TEST_CFG,
    );

    expect(result.text).toBe('Hello from Bedrock');
    expect(result.model).toBe(TEST_CFG.modelId);
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
    expect(result.contentBlocks).toEqual([{ type: 'text', text: 'Hello from Bedrock' }]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('passes modelId, messages, system, and maxTokens to ConverseCommand', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'OK' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await callBedrock(
      {
        messages: [{ role: 'user', content: 'hi' }],
        system: 'You are helpful',
        maxTokens: 256,
      },
      TEST_CFG,
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.modelId).toBe(TEST_CFG.modelId);
    // Messages are mapped to Converse format: content is wrapped in {text}
    expect(cmd.messages).toEqual([
      { role: 'user', content: [{ text: 'hi' }] },
    ]);
    expect(cmd.system).toEqual([{ text: 'You are helpful' }]);
    expect(cmd.inferenceConfig).toEqual({ maxTokens: 256 });
  });

  it('defaults maxTokens to 1024 when not specified', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'OK' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    );

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.inferenceConfig.maxTokens).toBe(1024);
  });

  it('appends a user message if last message is not from user', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'OK' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await callBedrock(
      { messages: [{ role: 'assistant', content: 'hi' }] },
      TEST_CFG,
    );

    const cmd = mockSend.mock.calls[0][0];
    const msgs = cmd.messages;
    expect(msgs[msgs.length - 1].role).toBe('user');
  });

  it('handles multiple content blocks by concatenating text', async () => {
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            { text: 'First part' },
            { text: ' second part' },
          ],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 3 },
    });

    const result = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }], raw: true },
      TEST_CFG,
    );

    expect(result.text).toBe('First part second part');
    expect(result.contentBlocks).toEqual([
      { type: 'text', text: 'First part' },
      { type: 'text', text: ' second part' },
    ]);
  });

  it('throws AnthropicClientError on empty completion (no content blocks)', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      callBedrock({ messages: [{ role: 'user', content: 'hi' }] }, TEST_CFG),
    ).rejects.toThrow(/empty completion/);
  });

  it('throws AnthropicClientError on whitespace-only text', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: '   ' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      callBedrock({ messages: [{ role: 'user', content: 'hi' }] }, TEST_CFG),
    ).rejects.toThrow(/empty completion/);
  });

  it('raw=false suppresses contentBlocks (matches callAnthropic)', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'Hello' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    );

    expect(result.contentBlocks).toEqual([]);
    expect(result.text).toBe('Hello');
  });

  it('raw=true populates contentBlocks', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'Hello' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }], raw: true },
      TEST_CFG,
    );

    expect(result.contentBlocks).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('marks 429 as retryable', async () => {
    mockSend.mockRejectedValue({
      $metadata: { httpStatusCode: 429 },
      message: 'Too many requests',
    });

    const err = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AnthropicClientError);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
    expect(err.message).toContain('429');
  });

  it('marks 403 as non-retryable', async () => {
    mockSend.mockRejectedValue({
      $metadata: { httpStatusCode: 403 },
      message: 'Access denied',
    });

    const err = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AnthropicClientError);
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(403);
  });

  it('marks 500 as retryable', async () => {
    mockSend.mockRejectedValue({
      $metadata: { httpStatusCode: 500 },
      message: 'Internal error',
    });

    const err = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AnthropicClientError);
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(500);
  });

  it('marks network errors (no status) as non-retryable', async () => {
    mockSend.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }] },
      TEST_CFG,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AnthropicClientError);
    expect(err.retryable).toBe(false);
  });

  it('throws on empty output object', async () => {
    mockSend.mockResolvedValue({});

    await expect(
      callBedrock({ messages: [{ role: 'user', content: 'hi' }] }, TEST_CFG),
    ).rejects.toThrow(/empty completion/);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { getAiConfig, __resetAiConfigCache } from '../ai-settings';

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
  __resetAiConfigCache();
  delete process.env.AI_PROVIDER;
  delete process.env.OLLAMA_MODEL;
});

describe('getAiConfig — DB → env → default', () => {
  it('defaults to anthropic when nothing is set', async () => {
    const cfg = await getAiConfig(1000);
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.source).toBe('default');
  });

  it('honors AI_PROVIDER=ollama from env', async () => {
    process.env.AI_PROVIDER = 'ollama';
    process.env.OLLAMA_MODEL = 'qwen2.5:7b';
    const cfg = await getAiConfig(2000);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.ollamaModel).toBe('qwen2.5:7b');
    expect(cfg.source).toBe('env');
  });

  it('DB setting overrides env', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    mockSql.mockResolvedValue([{ value: { provider: 'ollama', ollamaModel: 'mistral:7b', ollamaBaseUrl: 'http://box:11434' } }]);
    const cfg = await getAiConfig(3000);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.ollamaModel).toBe('mistral:7b');
    expect(cfg.ollamaBaseUrl).toBe('http://box:11434');
    expect(cfg.source).toBe('db');
  });

  it('ignores an invalid provider in the DB and falls back to env/default', async () => {
    mockSql.mockResolvedValue([{ value: { provider: 'gpt-4' } }]);
    const cfg = await getAiConfig(4000);
    expect(cfg.provider).toBe('anthropic');
  });

  it('falls back to env when the settings table is missing (throws)', async () => {
    mockSql.mockRejectedValue(new Error('relation "app_settings" does not exist'));
    const cfg = await getAiConfig(5000);
    expect(cfg.provider).toBe('anthropic');
  });
});

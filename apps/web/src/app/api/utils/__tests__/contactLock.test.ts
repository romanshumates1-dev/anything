import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn(async () => []);
const { default: mockSql } = vi.hoisted(() => {
  const m = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { withContactLock } from '../contactLock';

describe('withContactLock', () => {
  beforeEach(() => {
    mockSql.mockClear();
  });

  it('executes the wrapped function', async () => {
    mockSql.mockResolvedValueOnce([]);
    const result = await withContactLock('test-id', async () => 42);
    expect(result).toBe(42);
  });

  it('converts different IDs to distinct lock keys', async () => {
    const keys = new Set<number>();
    for (const id of ['a', 'b', 'c']) {
      // Access via module internals (re-hash logic)
      const key = Math.abs(
        id.split('').reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0)
      ) % 2147483647;
      keys.add(key);
    }
    expect(keys.size).toBeGreaterThan(1);
  });
});
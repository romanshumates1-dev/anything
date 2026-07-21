/**
 * INT-3 — numberPoolStore pure validation tests (no DB required).
 *
 * Input validation tested in isolation. Runtime/DB tests live in
 * numberPoolStore.test.ts (env-gated for atomic SQL semantics).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/area-codes', () => ({ areaCodeOf: vi.fn((phone: string) => phone.slice(1, 4)) }));

import * as store from '../numberPoolStore';

describe('numberPoolStore — validation (no DB)', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('rejects a nonsense rotation cap rather than storing it', async () => {
    // These are the exact assertions from the original test
    await expect(store.setRotationCap(-1)).rejects.toThrow();
    await expect(store.setRotationCap(1.5)).rejects.toThrow();
  });
});
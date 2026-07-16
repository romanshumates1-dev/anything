import { describe, it, expect } from 'vitest';

// NOTE: security.ts was removed (app uses parameterized queries via `sql`
// tagged template — the regex-based sanitizer gave a false sense of security).
// This test file remains as a placeholder so vitest config doesn't fail.
// The actual sanitizeInput function no longer exists.
describe('security (removed)', () => {
  it('placeholder - security module was intentionally removed', () => {
    expect(true).toBe(true);
  });
});

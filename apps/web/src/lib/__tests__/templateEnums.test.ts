import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CHANNELS,
  isTemplateCategory,
  isTemplateChannel,
} from '../templateEnums';

describe('template enum vocabulary', () => {
  /**
   * These lists are copied from the live Postgres enums, because an out-of-enum
   * value is not a soft validation failure - it reaches the server as
   * `invalid input value for enum "template_category"` and became a 500 on
   * GET /api/templates/library?category=EMAIL.
   *
   * The previous allowlist had only ['cold_outreach', 'follow_up'], so four
   * legitimate categories were rejected with a 400. Both failure directions are
   * pinned here.
   */
  it('covers every label of the template_category enum', () => {
    expect([...TEMPLATE_CATEGORIES].sort()).toEqual(
      ['buyer_outreach', 'closing', 'cold_outreach', 'custom', 'follow_up', 'reengagement'].sort()
    );
  });

  it('covers every label of the template_channel enum', () => {
    expect([...TEMPLATE_CHANNELS].sort()).toEqual(['both', 'email', 'sms']);
  });

  it('accepts every real value', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(isTemplateCategory(c)).toBe(true);
    for (const c of TEMPLATE_CHANNELS) expect(isTemplateChannel(c)).toBe(true);
  });

  it('rejects values that are not in the enum', () => {
    // EMAIL is a real CHANNEL used as a category by mistake - the exact request
    // that returned 500.
    expect(isTemplateCategory('EMAIL')).toBe(false);
    expect(isTemplateCategory('sms')).toBe(false);
    expect(isTemplateCategory('')).toBe(false);
    expect(isTemplateCategory('cold_outreach ')).toBe(false);
    expect(isTemplateChannel('EMAIL')).toBe(false);
    expect(isTemplateChannel('whatsapp')).toBe(false);
  });

  it('both template routes import the shared vocabulary', () => {
    // If either route reintroduces a local list, the two can drift again.
    for (const rel of ['app/api/templates/route.ts', 'app/api/templates/library/route.ts']) {
      const code = readFileSync(join(process.cwd(), 'src', rel), 'utf8');
      expect(code, `${rel} must use the shared enum vocabulary`).toMatch(
        /from '@\/lib\/templateEnums'/
      );
      expect(code, `${rel} must not redefine a local allowlist`).not.toMatch(
        /const CATEGORIES = \[/
      );
    }
  });
});
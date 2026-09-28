import { describe, it, expect } from 'vitest';
import { buildWhere, buildOrderBy, safeIdentifier, combine } from '../sqlFragments';

/**
 * The builder that replaces nested `sql` fragments. It is security-relevant:
 * it decides what ends up in the SQL TEXT (identifiers) versus what ends up
 * as a bound parameter (values), so both halves are pinned here.
 */
describe('sqlFragments builder', () => {
  it('emits ordered $n placeholders and the matching params', () => {
    const w = buildWhere()
      .eq('organization_id', 'org_1')
      .eq('is_active', true)
      .eq('category', 'sms')
      .build();
    expect(w.text).toBe('organization_id = $1 AND is_active = $2 AND category = $3');
    expect(w.params).toEqual(['org_1', true, 'sms']);
  });

  it('skips conditions when the value is falsy (optional filters)', () => {
    const w = buildWhere()
      .eq('organization_id', 'org_1')
      .when(undefined, (b) => b.eq('category', undefined))
      .when('', (b) => b.eq('channel', ''))
      .when('email', (b) => b.eq('channel', 'email'))
      .build();
    expect(w.text).toBe('organization_id = $1 AND channel = $2');
    expect(w.params).toEqual(['org_1', 'email']);
  });

  it('never puts a value into the SQL text', () => {
    const hostile = "'; DROP TABLE users; --";
    const w = buildWhere().eq('name', hostile).build();
    expect(w.text).toBe('name = $1');
    expect(w.text).not.toContain('DROP');
    expect(w.params).toEqual([hostile]);
  });

  it('rejects an identifier that is not a code-level constant', () => {
    expect(() => safeIdentifier('id; DROP TABLE users')).toThrow(/Unsafe/);
    expect(() => safeIdentifier('f.created_at')).not.toThrow();
    expect(() => buildWhere().eq('a b', 1).build()).toThrow(/Unsafe/);
  });

  it('renders IS NULL and NOT NULL without consuming a placeholder', () => {
    const w = buildWhere()
      .eq('owner_id', null)
      .neq('deleted_at', null)
      .build();
    expect(w.text).toBe('owner_id IS NULL AND deleted_at IS NOT NULL');
    expect(w.params).toEqual([]);
  });

  it('supports the optional-filter shape col IS NULL OR col = value', () => {
    const w = buildWhere().eqOrNull('campaign_id', 'c1').build();
    expect(w.text).toBe('(campaign_id IS NULL OR campaign_id = $1)');
    expect(w.params).toEqual(['c1']);

    const none = buildWhere().eqOrNull('campaign_id', null).build();
    expect(none.text).toBe('campaign_id IS NULL');
    expect(none.params).toEqual([]);
  });

  it('builds TRUE for an empty clause set so the caller can always append WHERE', () => {
    const w = buildWhere().build();
    expect(w.text).toBe('TRUE');
    expect(w.params).toEqual([]);
  });

  it('supports every comparison operator with bound values', () => {
    const w = buildWhere()
      .gt('score', 10)
      .gte('score', 10)
      .lt('created_at', 'x')
      .lte('created_at', 'x')
      .like('name', 'a%')
      .ilike('email', 'a%')
      .neq('status', 'void')
      .build();
    expect(w.text).toBe(
      'score > $1 AND score >= $2 AND created_at < $3 AND created_at <= $4 ' +
        'AND name LIKE $5 AND email ILIKE $6 AND status <> $7'
    );
    expect(w.params).toEqual([10, 10, 'x', 'x', 'a%', 'a%', 'void']);
  });

  it('builds an ORDER BY clause from validated identifiers and directions', () => {
    expect(buildOrderBy([{ column: 'f.created_at', direction: 'DESC' }], {
      column: 'f.id',
      direction: 'ASC',
    }).clause).toBe('f.created_at DESC');

    // An injected "direction" cannot survive.
    const bad = buildOrderBy(
      [{ column: 'f.created_at', direction: 'DESC; DROP TABLE x' as never }],
      { column: 'f.id', direction: 'ASC' }
    );
    expect(bad.clause).toBe('f.created_at ASC');
  });

  /**
   * Offset support. This is not hypothetical: the live-DB harness
   * (scripts/verify-sql-fixes.mjs case 7) produced
   *   "bind message supplies 2 parameters, but prepared statement requires 1"
   * for `WHERE LOWER(email) = $1 AND ${scope.text}`, because the fragment
   * restarted its own numbering at $1. The offset continues the statement's.
   */
  describe('placeholder numbering with an offset', () => {
    it('continues the enclosing numbering instead of restarting at $1', () => {
      const scope = buildWhere(1).eq('organization_id', 'org_1').build();
      expect(scope.text).toBe('organization_id = $2');
      expect(scope.params).toEqual(['org_1']);
    });

    it('numbers several predicates sequentially under an offset', () => {
      const w = buildWhere(2).eq('organization_id', 'org_1').eq('status', 'active').build();
      expect(w.text).toBe('organization_id = $3 AND status = $4');
      expect(w.params).toEqual(['org_1', 'active']);
    });

    it('expr placeholders are offset too', () => {
      const w = buildWhere(1).expr('a = ? OR b = ?', 1, 2).build();
      expect(w.text).toBe('a = $2 OR b = $3');
      expect(w.params).toEqual([1, 2]);
    });

    it('anyOf is offset too', () => {
      const w = buildWhere(3).anyOf('zip', ['33101']).build();
      expect(w.text).toBe('zip = ANY($4)');
    });

    it('eqOrNull is offset too', () => {
      const w = buildWhere(1).eqOrNull('owner', 'u1').build();
      expect(w.text).toBe('(owner IS NULL OR owner = $2)');
    });

    it('every emitted placeholder maps 1:1 onto a param, in order', () => {
      const w = buildWhere(2)
        .eq('organization_id', 'org_1')
        .when(true, (b) => b.expr('x = ? OR y = ?', 7, 8))
        .build();
      const nums = [...w.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      expect(nums).toEqual([3, 4, 5]);
      expect(nums).toHaveLength(w.params.length);
    });

    it('combine can be offset past an already-bound parameter', () => {
      const c = combine(
        [
          { text: 'l.zip = ANY($1)', params: [['33101']] },
          { text: 'l.state = ANY($1)', params: [['FL']] },
        ],
        'OR',
        1
      );
      expect(c.text).toBe('l.zip = ANY($2) OR l.state = ANY($3)');
      expect(c.params).toEqual([['33101'], ['FL']]);
    });
  });
});

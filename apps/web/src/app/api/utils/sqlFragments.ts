/**
 * Safe dynamic-SQL builders (defect #32, second wave).
 *
 * WHY THIS EXISTS
 * ---------------
 * The pinned `@neondatabase/serverless` maps EVERY template interpolation to a
 * positional `$n` parameter. Measured directly against the live database
 * (scripts/probe-fragments.mjs):
 *
 *     sql`SELECT 1 WHERE true ${sql`AND 1=1`}`   -> syntax error at or near "$1"
 *     sql`SELECT 1 WHERE true ${cond ? sql`A` : sql``}` -> syntax error at or near "$1"
 *     sql`SELECT 1 WHERE true ${null}`          -> syntax error at or near "$1"
 *     sql`SELECT 1 ORDER BY ${c ? sql`x DESC` : sql`x ASC`}` -> RUNS, but the
 *         fragment is NOT spliced: the ordering is silently wrong.
 *
 * The last line is why this was invisible for so long: some sites fail loudly
 * (500) and some fail quietly (wrong order), and every unit test mocked the
 * driver, so the composition was never executed.
 *
 * The supported form is the driver's string form, `sql(text, params)`. These
 * builders produce that pair, and bind every value as a parameter. Column and
 * direction names come from CODE, never from a request, and are validated
 * anyway so a future refactor cannot turn this into an injection point.
 *
 *     const where = buildWhere()
 *       .eq('organization_id', organization.id)
 *       .when(category, (w) => w.eq('category', category))
 *       .build();
 *     const rows = await sql(
 *       `SELECT * FROM templates WHERE ${where.text}`,
 *       where.params
 *     );
 */

/** A parameterised SQL fragment: text with `$n` holes plus its values. */
export interface Fragment {
  text: string;
  params: unknown[];
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** Throws on anything that is not a plain (optionally dotted) identifier. */
export function safeIdentifier(name: string): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Unsafe SQL identifier: ${name}. Identifiers must be code-level constants ` +
        `(letters, digits, underscore, optional single dot).`
    );
  }
  return name;
}

const OPERATORS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
} as const;

export type CompareOp = keyof typeof OPERATORS;

export class WhereBuilder {
  private readonly parts: string[] = [];
  private readonly values: unknown[] = [];

  private push(text: string, ...values: unknown[]): this {
    for (const v of values) this.values.push(v);
    this.parts.push(text);
    return this;
  }

  private add(column: string, op: CompareOp, value: unknown, prefix = ''): this {
    const col = safeIdentifier(column);
    const sqlOp = OPERATORS[op];
    if (value === null) {
      return this.push(`${prefix}${col} IS ${op === 'neq' ? 'NOT ' : ''}NULL`);
    }
    this.values.push(value);
    return this.push(`${prefix}${col} ${sqlOp} $${this.values.length}`);
  }

  eq(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'eq', value, prefix);
  }
  neq(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'neq', value, prefix);
  }
  gt(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'gt', value, prefix);
  }
  gte(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'gte', value, prefix);
  }
  lt(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'lt', value, prefix);
  }
  lte(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'lte', value, prefix);
  }
  like(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'like', value, prefix);
  }
  ilike(column: string, value: unknown, prefix = ''): this {
    return this.add(column, 'ilike', value, prefix);
  }

  /** Append a raw boolean predicate; `text` must be a static literal. */
  raw(text: string, ...values: unknown[]): this {
    return this.push(text, ...values);
  }

  /** Apply the block only when `condition` is truthy. */
  when(condition: unknown, block: (w: WhereBuilder) => void): this {
    if (condition) block(this);
    return this;
  }

  /** `column IS NULL OR column = value` — the common "optional filter" shape. */
  eqOrNull(column: string, value: unknown): this {
    const col = safeIdentifier(column);
    if (value === null || value === undefined) return this.push(`${col} IS NULL`);
    this.values.push(value);
    const n = this.values.length;
    return this.push(`(${col} IS NULL OR ${col} = $${n})`);
  }

  build(): Fragment {
    return {
      text: this.parts.length ? this.parts.join(' AND ') : 'TRUE',
      params: [...this.values],
    };
  }
}

export function buildWhere(): WhereBuilder {
  return new WhereBuilder();
}

const DIRECTIONS = new Set(['ASC', 'DESC']);

/**
 * ORDER BY from a code-level allowlist. Returns `{ clause, params }` where
 * `clause` contains only identifiers and a validated direction - the mirror
 * image of the silent-wrong-order bug above.
 */
export function buildOrderBy(
  choices: ReadonlyArray<{ column: string; direction: 'ASC' | 'DESC' }>,
  fallback: { column: string; direction: 'ASC' | 'DESC' }
): { clause: string; params: unknown[] } {
  const pick = choices.length ? choices[0] : fallback;
  const col = safeIdentifier(pick.column);
  const dir = DIRECTIONS.has(String(pick.direction).toUpperCase())
    ? String(pick.direction).toUpperCase()
    : 'ASC';
  return { clause: `${col} ${dir}`, params: [] };
}

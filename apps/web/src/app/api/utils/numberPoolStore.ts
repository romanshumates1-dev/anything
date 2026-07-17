/**
 * INT-3 — number pool storage + the rotation-cap setting.
 *
 * Split from numberPool.ts on purpose: the SELECTION ALGORITHM is pure and
 * unit-tested with no DB (numberPool.select.test.ts); this file is the thin I/O
 * layer around it. Keeping them apart is what lets the interesting logic be
 * verified without a live-DB gate.
 */
import sql from '@/app/api/utils/sql';
import {
  DEFAULT_ROTATION_CAP,
  DEFAULT_WINDOW_HOURS,
  effectiveDailyCap,
  selectNumber,
  type DailyCap,
  type PoolCandidate,
  type TrustLevel,
  type NumberPoolEntry,
} from './numberPool';
import { areaCodeOf } from './area-codes';

const ROTATION_CAP_KEY = 'number_pool';

/**
 * Rows always carry `sent_today`, computed IN SQL as
 *   CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_sent END
 * Never recompute this in JS. Postgres CURRENT_DATE is the single authority for
 * the reset boundary because the claiming UPDATE's WHERE uses it too — if the
 * read used a JS date instead, a database not in the app's timezone would let
 * the two disagree (read says "reset", UPDATE says "capped") and the pool would
 * mis-count. Found the hard way: the driver returns `date` as a JS Date, so
 * String(d).slice(0,10) yields "Wed Jul 15" and every string compare against
 * "2026-07-15" silently failed — the daily reset never fired.
 */
type PoolRow = {
  id: number;
  phone_number: string;
  area_code: string;
  number_type: NumberPoolEntry['numberType'];
  trust_level: TrustLevel;
  sent_today: number;
  active: boolean;
};

function toCandidate(row: PoolRow): PoolCandidate {
  return {
    phoneNumber: row.phone_number,
    numberType: row.number_type,
    trustLevel: row.trust_level,
    dailySent: row.sent_today,
    active: row.active,
  };
}

export async function getRotationCap(): Promise<number> {
  try {
    const [row] = await sql`SELECT value FROM app_settings WHERE key = ${ROTATION_CAP_KEY} LIMIT 1`;
    const cap = row?.value?.rotationCap;
    return typeof cap === 'number' && cap >= 0 ? cap : DEFAULT_ROTATION_CAP;
  } catch {
    // Fail SAFE-LOW: an unreadable setting must not lift the guard.
    return DEFAULT_ROTATION_CAP;
  }
}

export async function setRotationCap(cap: number, updatedBy?: string): Promise<void> {
  if (!Number.isInteger(cap) || cap < 0) throw new Error('rotationCap must be a non-negative integer');
  await sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${ROTATION_CAP_KEY}, ${JSON.stringify({ rotationCap: cap })}::jsonb, ${updatedBy ?? null}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
}

export type PoolUsageRow = {
  phoneNumber: string;
  areaCode: string;
  numberType: NumberPoolEntry['numberType'];
  trustLevel: TrustLevel;
  active: boolean;
  sentToday: number;
  cap: DailyCap;
  remaining: number;
};

/** Pool + per-number usage for the settings UI: shows BOTH the rotation guard
 *  and the carrier ceiling (owner: "both values visible per-number"). */
export async function listPoolUsage(windowHours = DEFAULT_WINDOW_HOURS): Promise<{
  rotationCap: number;
  numbers: PoolUsageRow[];
}> {
  const rotationCap = await getRotationCap();
  const rows = (await sql`
    SELECT id, phone_number, area_code, number_type, trust_level, active,
           CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_sent END AS sent_today
    FROM number_pool ORDER BY area_code, phone_number
  `) as PoolRow[];

  return {
    rotationCap,
    numbers: rows.map((r) => {
      const sent = r.sent_today;
      const cap = effectiveDailyCap(
        { numberType: r.number_type, trustLevel: r.trust_level },
        rotationCap,
        windowHours
      );
      return {
        phoneNumber: r.phone_number,
        areaCode: r.area_code,
        numberType: r.number_type,
        trustLevel: r.trust_level,
        active: r.active,
        sentToday: sent,
        cap,
        remaining: Math.max(0, cap.effective - sent),
      };
    }),
  };
}

/** Active numbers in the pool — distinguishes "unconfigured" (0) from "capped". */
export async function activePoolCount(): Promise<number> {
  const [row] = await sql`SELECT COUNT(*)::int AS c FROM number_pool WHERE active = true`;
  return row?.c ?? 0;
}

export async function addNumber(params: {
  phoneNumber: string;
  numberType?: NumberPoolEntry['numberType'];
  trustLevel?: TrustLevel;
}): Promise<void> {
  const ac = areaCodeOf(params.phoneNumber);
  if (!ac) throw new Error(`Cannot derive an area code from ${params.phoneNumber}`);
  await sql`
    INSERT INTO number_pool (phone_number, area_code, number_type, trust_level)
    VALUES (${params.phoneNumber}, ${ac}, ${params.numberType ?? '10dlc'}, ${params.trustLevel ?? 'medium'})
    ON CONFLICT (phone_number) DO NOTHING
  `;
}

/**
 * Pick a local-presence number for `leadPhone` and atomically claim one send
 * against its daily cap.
 *
 * Returns null when nothing is eligible — callers MUST treat that as "do not
 * send", never as "fall back to any number". The claim is conditional on the
 * cap in SQL, so two concurrent picks cannot both take the last slot.
 */
export async function pickNumber(
  leadPhone: string | null | undefined,
  attemptsLeft = 3
): Promise<string | null> {
  if (attemptsLeft <= 0) return null; // bounded: a contended pool degrades to "don't send"
  const rotationCap = await getRotationCap();
  const rows = (await sql`
    SELECT id, phone_number, area_code, number_type, trust_level, active,
           CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_sent END AS sent_today
    FROM number_pool WHERE active = true
  `) as PoolRow[];

  const chosen = selectNumber(rows.map(toCandidate), leadPhone, rotationCap);
  if (!chosen) return null;

  const cap = effectiveDailyCap(chosen, rotationCap).effective;

  // Claim it. The WHERE re-checks the cap against the CURRENT row (with the
  // same lazy-reset semantics) so a race cannot exceed the cap: the loser's
  // UPDATE matches 0 rows and we retry the selection without it.
  const claimed = await sql`
    UPDATE number_pool
    SET daily_sent = CASE WHEN last_reset_date < CURRENT_DATE THEN 1 ELSE daily_sent + 1 END,
        last_reset_date = CURRENT_DATE
    WHERE phone_number = ${chosen.phoneNumber}
      AND active = true
      AND (CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_sent END) < ${cap}
    RETURNING phone_number
  `;

  if (claimed.length === 0) {
    // Lost the race for the last slot on this number. Re-read and re-select:
    // the row is now at its cap, so selectNumber will skip it next pass.
    // Bounded by attemptsLeft so a pathological pool can never spin.
    return pickNumber(leadPhone, attemptsLeft - 1);
  }

  return chosen.phoneNumber;
}

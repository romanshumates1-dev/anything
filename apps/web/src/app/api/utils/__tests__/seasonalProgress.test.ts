import { describe, it, expect } from 'vitest';
/**
 * Tests for the pure seasonal-progression helpers.
 *
 * These are the rules that decide what a season IS, where a user sits on its
 * tier track, and how a standings list is ranked. They are pure so they can be
 * exercised without a database: the window boundaries and the ranking rule are
 * the parts most likely to be got subtly wrong, and a mocked `sql` would
 * happily "prove" a broken one.
 *
 * Everything here is XP and cosmetics. No test asserts anything about credits,
 * balances or payouts.
 */
import {
  activeSeason,
  competitionPhase,
  formatCountdown,
  msRemaining,
  normalizeCompetitionMetric,
  seasonPhase,
  standingsWithRanks,
  tierProgress,
  type CompetitionWindow,
  type SeasonWindow,
  type TierDefinition,
} from '@/app/api/utils/seasonalProgress';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function season(overrides: Partial<SeasonWindow> = {}): SeasonWindow {
  return {
    key: 's1',
    name: 'Season 1',
    description: '',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2026-07-01T00:00:00.000Z',
    isActive: true,
    ...overrides,
  };
}

function tier(overrides: Partial<TierDefinition> = {}): TierDefinition {
  return {
    id: 1,
    tier: 1,
    xpRequired: 0,
    label: '',
    rewardXp: 0,
    rewardCode: '',
    ...overrides,
  };
}

describe('seasonPhase - the window boundary', () => {
  it('is upcoming before starts_at', () => {
    expect(seasonPhase(season({ startsAt: '2026-06-20T00:00:00.000Z' }), NOW)).toBe('upcoming');
  });

  it('is active inside the window', () => {
    expect(seasonPhase(season(), NOW)).toBe('active');
  });

  it('is ended after ends_at', () => {
    expect(seasonPhase(season({ endsAt: '2026-06-14T23:59:59.000Z' }), NOW)).toBe('ended');
  });

  it('is ended at exactly ends_at, so the end instant is outside the window', () => {
    expect(seasonPhase(season({ endsAt: '2026-06-15T12:00:00.000Z' }), NOW)).toBe('ended');
  });

  it('is active at exactly starts_at, so the start instant counts', () => {
    expect(seasonPhase(season({ startsAt: '2026-06-15T12:00:00.000Z' }), NOW)).toBe('active');
  });

  it('is ended for a switched-off season even while its dates are current', () => {
    expect(seasonPhase(season({ isActive: false }), NOW)).toBe('ended');
  });
});

describe('activeSeason - one season at a time', () => {
  it('returns the season containing now', () => {
    const seasons = [
      season({ key: 'old', endsAt: '2026-05-01T00:00:00.000Z' }),
      season({ key: 'live' }),
      season({ key: 'next', startsAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(activeSeason(seasons, NOW)?.key).toBe('live');
  });

  it('returns null when no season covers now', () => {
    expect(activeSeason([season({ endsAt: '2026-05-01T00:00:00.000Z' })], NOW)).toBeNull();
  });

  it('skips a switched-off season rather than showing it as live', () => {
    expect(activeSeason([season({ isActive: false })], NOW)).toBeNull();
  });

  it('prefers the latest-starting match when windows overlap', () => {
    const seasons = [
      season({ key: 'early', startsAt: '2026-06-01T00:00:00.000Z' }),
      season({ key: 'later', startsAt: '2026-06-10T00:00:00.000Z' }),
    ];
    expect(activeSeason(seasons, NOW)?.key).toBe('later');
  });

  it('returns null for an empty list rather than throwing', () => {
    expect(activeSeason([], NOW)).toBeNull();
  });
});
describe('msRemaining / formatCountdown', () => {
  it('counts down to ends_at', () => {
    expect(msRemaining(season({ endsAt: '2026-06-17T12:00:00.000Z' }), NOW)).toBe(2 * 86400000);
  });

  it('clamps to zero once the season is over, never negative', () => {
    expect(msRemaining(season({ endsAt: '2026-06-01T00:00:00.000Z' }), NOW)).toBe(0);
  });

  it('clamps to zero before the season starts', () => {
    expect(msRemaining(season({ startsAt: '2026-07-01T00:00:00.000Z' }), NOW)).toBe(0);
  });

  it('formats whole days and hours', () => {
    expect(formatCountdown(2 * 86400000 + 4 * 3600000)).toBe('2d 4h');
  });

  it('drops the day segment under a day', () => {
    expect(formatCountdown(4 * 3600000 + 12 * 60000)).toBe('4h 12m');
  });

  it('drops the hour segment under an hour', () => {
    expect(formatCountdown(12 * 60000 + 30000)).toBe('12m 30s');
  });

  it('reports Ended rather than 0s when there is nothing left', () => {
    expect(formatCountdown(0)).toBe('Ended');
  });
});

describe('tierProgress - the battle pass track', () => {
  const track = [
    tier({ id: 1, tier: 1, xpRequired: 0, rewardXp: 50 }),
    tier({ id: 2, tier: 2, xpRequired: 100, rewardXp: 100 }),
    tier({ id: 3, tier: 3, xpRequired: 250, rewardXp: 200 }),
  ];

  it('points at the first tier whose threshold is not yet met', () => {
    expect(tierProgress(track, 50).next?.id).toBe(2);
  });

  it('reports no next tier once every threshold is met', () => {
    const result = tierProgress(track, 1000);
    expect(result.next).toBeNull();
    expect(result.complete).toBe(true);
  });

  it('reports how far the user is into the current gap', () => {
    // 50 of the 150 XP between tier 2 and tier 3.
    expect(tierProgress(track, 150).ratio).toBeCloseTo(50 / 150, 5);
  });

  it('reports a zero ratio at the very start of a gap', () => {
    expect(tierProgress(track, 100).ratio).toBe(0);
  });

  it('reports a full ratio when a threshold is met exactly', () => {
    expect(tierProgress(track, 250).ratio).toBe(1);
  });

  it('reports the highest threshold already cleared', () => {
    expect(tierProgress(track, 150).current?.id).toBe(2);
  });

  it('ignores unordered input rather than trusting it', () => {
    const shuffled = [tier({ id: 3, tier: 3, xpRequired: 250 }), tier({ id: 1, tier: 1, xpRequired: 0 })];
    expect(tierProgress(shuffled, 0).next?.id).toBe(1);
  });

  it('handles an empty track without dividing by zero', () => {
    const result = tierProgress([], 500);
    expect(result.next).toBeNull();
    expect(result.ratio).toBe(0);
  });
});

describe('standingsWithRanks - competition ranking', () => {
  const rows = [
    { userId: 'a', name: 'A', xp: 300 },
    { userId: 'b', name: 'B', xp: 200 },
    { userId: 'c', name: 'C', xp: 200 },
    { userId: 'd', name: 'D', xp: 100 },
  ];

  it('orders by XP descending', () => {
    expect(standingsWithRanks(rows).map((r) => r.userId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives tied users the same rank', () => {
    const ranked = standingsWithRanks(rows);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[2].rank).toBe(2);
  });

  it('skips the rank a tie consumed, so ranks stay meaningful', () => {
    const ranked = standingsWithRanks(rows);
    expect(ranked[3].rank).toBe(4);
  });

  it('never produces a rank above the number of rows', () => {
    const ranked = standingsWithRanks([{ userId: 'solo', name: 'Solo', xp: 1 }]);
    expect(ranked[0].rank).toBe(1);
  });

  it('returns an empty list for empty input', () => {
    expect(standingsWithRanks([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = rows.map((r) => ({ ...r }));
    standingsWithRanks(input);
    expect(input.map((r) => r.userId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats a missing XP value as zero rather than dropping the user', () => {
    const ranked = standingsWithRanks([
      { userId: 'x', name: 'X', xp: undefined as unknown as number },
      { userId: 'y', name: 'Y', xp: 10 },
    ]);
    expect(ranked[0].userId).toBe('y');
    expect(ranked[1].userId).toBe('x');
  });
});

describe('competitionPhase / normalizeCompetitionMetric', () => {
  function competition(overrides: Partial<CompetitionWindow> = {}): CompetitionWindow {
    return {
      key: 'weekly-xp',
      name: 'Weekly XP',
      description: '',
      metric: 'xp',
      startsAt: '2026-06-08T00:00:00.000Z',
      endsAt: '2026-06-22T00:00:00.000Z',
      isActive: true,
      ...overrides,
    };
  }

  it('is active inside the window', () => {
    expect(competitionPhase(competition(), NOW)).toBe('active');
  });

  it('is upcoming before it opens', () => {
    expect(competitionPhase(competition({ startsAt: '2026-06-20T00:00:00.000Z' }), NOW)).toBe(
      'upcoming',
    );
  });

  it('is ended once it closes', () => {
    expect(competitionPhase(competition({ endsAt: '2026-06-10T00:00:00.000Z' }), NOW)).toBe('ended');
  });

  it('defaults an unknown metric to xp instead of trusting the stored string', () => {
    expect(normalizeCompetitionMetric('revenue')).toBe('xp');
    expect(normalizeCompetitionMetric(null)).toBe('xp');
  });

  it('keeps a known metric', () => {
    expect(normalizeCompetitionMetric('xp')).toBe('xp');
  });
});


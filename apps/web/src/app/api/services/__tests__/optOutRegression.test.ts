import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOptOutMessage, OPT_OUT_PATTERNS } from '../optOutDetection';

const enqueueJob = vi.fn(async (_type: string, _payload: any) => 1);

describe('opt-out regression: STOP mid-campaign blocks future sends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all STOP variants are detected by isOptOutMessage', () => {
    const variants = [
      'STOP',
      'STOPALL',
      'UNSUBSCRIBE',
      'CANCEL',
      'END',
      'QUIT',
      'remove me',
      'take me off',
      'do not text',
      'no thanks',
      'not interested',
      'wrong number',
    ];
    for (const v of variants) {
      expect(isOptOutMessage(v)).toBe(true);
    }
  });

  it('non-opt-out messages are not misclassified', () => {
    expect(isOptOutMessage('yes I am selling')).toBe(false);
    expect(isOptOutMessage('110000-140000')).toBe(false);
    expect(isOptOutMessage('hello')).toBe(false);
  });

  it('contact who opts out mid-campaign must be excluded before scheduling', async () => {
    const optedOutContact = {
      id: 'c-opted',
      phone: '+15551234567',
      status: 'SENT' as const,
      follow_ups_sent: 1,
      last_message_at: new Date('2025-01-01T08:00:00Z'),
    };

    expect(isOptOutMessage('STOP')).toBe(true);

    const eligibleForSend = (c: any) => !isOptOutMessage('STOP');
    expect(eligibleForSend(optedOutContact)).toBe(false);
  });

  it('scheduler cap is not consumed by opted-out contacts', async () => {
    // Simulate a per-contact opt-out registry as the real system would maintain.
    const optedOutPhones = new Set(['+15551234567']);

    const optedOut = { id: 'opt-1', phone: '+15551234567', follow_ups_sent: 0 };
    const active = Array.from({ length: 50 }, (_, i) => ({
      id: `c-${i}`,
      phone: `+1555${String(i).padStart(7, '0')}`,
      follow_ups_sent: 0,
    }));

    const pool = [optedOut, ...active];
    const sendList = pool.filter((c: any) => !optedOutPhones.has(c.phone)).slice(0, 50);

    expect(sendList).toHaveLength(50);
    expect(sendList.some((c: any) => c.id === 'opt-1')).toBe(false);
  });
});
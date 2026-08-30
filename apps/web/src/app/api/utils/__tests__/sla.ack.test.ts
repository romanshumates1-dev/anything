/**
 * SLA — pure ack timing logic (no DB required).
 *
 * Extracted from sla.test.ts so these tests run without a live database.
 * The `shouldSendAck` function is a pure time-check; mocking SQL here
 * would be vacuous, but no SQL is needed for these assertions.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldSendAck,
  ANTHROPIC_ACK_THRESHOLD_MS,
} from '../sla';

describe('shouldSendAck — pure ack timing logic (no DB)', () => {
  // ───── 3. shouldSendAck ─────
  it('anthropic: does NOT ack within 45s threshold', () => {
    const received = new Date(Date.now() - 10_000); // 10s ago
    expect(shouldSendAck('anthropic', received)).toBe(false);
  });

  it('anthropic: DOES ack after 45s threshold', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS - 1);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  it('anthropic: acks exactly at 45s threshold (>=)', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  it('ollama: ALWAYS acks immediately regardless of elapsed time', () => {
    const justNow = new Date(Date.now() - 100); // 100ms ago
    expect(shouldSendAck('ollama', justNow)).toBe(true);

    const longAgo = new Date(Date.now() - 120_000); // 2min ago
    expect(shouldSendAck('ollama', longAgo)).toBe(true);
  });

  // ───── 6. dispatchAckIfNeeded pure logic ─────
  it('ollama: sends ack immediately (no latency row needed for shouldSendAck)', () => {
    const justNow = new Date(Date.now() - 100);
    expect(shouldSendAck('ollama', justNow)).toBe(true);
  });

  it('anthropic within threshold: no ack', () => {
    const received = new Date(Date.now() - 1000);
    expect(shouldSendAck('anthropic', received)).toBe(false);
  });

  it('anthropic past threshold: ack required', () => {
    const received = new Date(Date.now() - ANTHROPIC_ACK_THRESHOLD_MS - 1000);
    expect(shouldSendAck('anthropic', received)).toBe(true);
  });

  // ───── 7. Invariant: prospect never sits in silence ─────
  it('invariant: ollama always acks (50s/gen > human patience)', () => {
    // The invariant is: for ollama, ack ALWAYS fires before AI response.
    // This is enforced by shouldSendAck returning true for ollama at t=0.
    const t0 = new Date();
    expect(shouldSendAck('ollama', t0)).toBe(true);
  });

  it('invariant: anthropic acks only when threshold crossed (fast path no ack)', () => {
    // Anthropic is typically <10s, so most of the time no ack is needed.
    // The 45s threshold is a safety net for slow/failing calls.
    const t0 = new Date();
    expect(shouldSendAck('anthropic', t0)).toBe(false);
  });
});
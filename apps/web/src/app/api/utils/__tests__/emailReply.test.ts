/**
 * emailReply — quoted-reply stripping.
 *
 * The failure this prevents is silent and expensive: every compliant outbound
 * email ends with "reply STOP to opt out". Quoted back by the client, an
 * unstripped reply makes the opt-out detector fire on OUR OWN footer and
 * unsubscribe a prospect who was replying with interest.
 *
 * Second failure: our previous message becomes the prospect's conversation
 * turn, and the negotiator reasons against words it wrote itself.
 */
import { describe, it, expect } from 'vitest';
import { stripQuotedReply } from '../emailReply';

describe('the footer trap (why this module exists)', () => {
  it('removes a quoted outbound containing our STOP footer', () => {
    const reply = [
      "Yes I'm interested, what can you offer?",
      '',
      'On Mon, Jul 28, 2026 at 9:15 AM DealFlow <a@b.com> wrote:',
      '> We buy houses in your area.',
      '> Unsubscribe: https://x.test/u/abc',
      '> Reply STOP to opt out.',
    ].join('\n');
    const out = stripQuotedReply(reply);
    expect(out).toBe("Yes I'm interested, what can you offer?");
    expect(out.toUpperCase()).not.toContain('STOP');
    expect(out).not.toContain('Unsubscribe');
  });

  it('removes an Outlook-style quoted block', () => {
    const reply = [
      'Call me tomorrow.',
      '',
      '-----Original Message-----',
      'From: DealFlow <a@b.com>',
      'Reply STOP to opt out.',
    ].join('\n');
    expect(stripQuotedReply(reply)).toBe('Call me tomorrow.');
  });

  it('cuts at our own CAN-SPAM footer separator', () => {
    const reply = ['Not right now, maybe spring.', '', '---', 'Unsubscribe: https://x.test/u/1', '123 Main St'].join('\n');
    expect(stripQuotedReply(reply)).toBe('Not right now, maybe spring.');
  });
});

describe('quote characters', () => {
  it("drops every line beginning with '>'", () => {
    const reply = ['Sounds good.', '> old line one', '>old line two', 'Talk soon.'].join('\n');
    expect(stripQuotedReply(reply)).toBe('Sounds good.\nTalk soon.');
  });

  it('handles CRLF line endings', () => {
    expect(stripQuotedReply('Yes.\r\n> quoted\r\n')).toBe('Yes.');
  });
});

describe('conservative by design — under-strip beats over-strip', () => {
  it('returns text UNCHANGED when no quote marker is present', () => {
    // Deleting a real reply is worse than keeping noise.
    const plain = 'Yes I want an offer. The roof is new. Call me at your convenience.';
    expect(stripQuotedReply(plain)).toBe(plain);
  });

  it('preserves multi-paragraph replies', () => {
    const reply = 'First point.\n\nSecond point.\n\nThird point.';
    expect(stripQuotedReply(reply)).toBe(reply);
  });

  it('does not treat a mid-sentence "from:" as a header', () => {
    const reply = 'I inherited it from: my aunt last year.';
    expect(stripQuotedReply(reply)).toBe(reply);
  });

  it('keeps a reply that merely mentions stopping, without a quote block', () => {
    // Opt-out detection is a separate concern; this module must not pre-judge.
    const reply = 'Please stop by the house on Tuesday.';
    expect(stripQuotedReply(reply)).toBe(reply);
  });
});

describe('degenerate input', () => {
  it('returns empty string for null/undefined/blank', () => {
    for (const v of [null, undefined, '', '   ', '\n\n']) {
      expect(stripQuotedReply(v as any)).toBe('');
    }
  });

  it('returns empty when the message is ONLY a quote', () => {
    const onlyQuote = 'On Mon, Jul 28, 2026 at 9:15 AM DealFlow <a@b.com> wrote:\n> hello';
    expect(stripQuotedReply(onlyQuote)).toBe('');
  });

  it('collapses the blank lines a cut leaves behind', () => {
    const reply = 'Yes.\n\n\n\nOn Mon, Jul 28, 2026 at 9:15 AM X <a@b.com> wrote:\n> q';
    expect(stripQuotedReply(reply)).toBe('Yes.');
  });
});

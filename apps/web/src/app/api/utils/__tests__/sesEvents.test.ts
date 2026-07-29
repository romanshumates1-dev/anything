/**
 * sesEvents — SES bounce/complaint classification.
 *
 * The correctness that matters is the one that is easy to get wrong and
 * expensive both ways: a PERMANENT bounce must suppress (mailing a dead
 * address burns sender reputation), but a TRANSIENT bounce must NOT (a full
 * mailbox is a reachable lead, and suppressing it is a silent loss). Every
 * branch is pinned.
 */
import { describe, it, expect } from 'vitest';
import { classifySesEvent, parseSnsEnvelope } from '../sesEvents';

const permanentBounce = {
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Permanent',
    bounceSubType: 'General',
    bouncedRecipients: [{ emailAddress: 'Dead@Example.com' }],
  },
};

const transientBounce = {
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Transient',
    bounceSubType: 'MailboxFull',
    bouncedRecipients: [{ emailAddress: 'full@example.com' }],
  },
};

const complaint = {
  notificationType: 'Complaint',
  complaint: { complainedRecipients: [{ emailAddress: 'angry@example.com' }] },
};

describe('classifySesEvent — bounces', () => {
  it('SUPPRESSES a permanent bounce', () => {
    const d = classifySesEvent(permanentBounce);
    expect(d.eventType).toBe('Bounce');
    expect(d.suppress).toEqual(['dead@example.com']); // normalised lower-case
    expect(d.reason).toMatch(/permanent/i);
  });

  it('does NOT suppress a transient bounce — a full mailbox is a reachable lead', () => {
    const d = classifySesEvent(transientBounce);
    expect(d.suppress).toEqual([]);
    expect(d.spared).toEqual(['full@example.com']);
    expect(d.reason).toMatch(/not suppressed/i);
  });

  it('treats an Undetermined bounce as transient (do not suppress on uncertainty)', () => {
    const d = classifySesEvent({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Undetermined', bouncedRecipients: [{ emailAddress: 'maybe@example.com' }] },
    });
    expect(d.suppress).toEqual([]);
    expect(d.spared).toEqual(['maybe@example.com']);
  });

  it('suppresses every recipient of a multi-recipient permanent bounce', () => {
    const d = classifySesEvent({
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'a@x.com' }, { emailAddress: 'b@y.com' }],
      },
    });
    expect(d.suppress).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('classifySesEvent — complaints', () => {
  it('SUPPRESSES immediately on a complaint', () => {
    const d = classifySesEvent(complaint);
    expect(d.eventType).toBe('Complaint');
    expect(d.suppress).toEqual(['angry@example.com']);
  });
});

describe('classifySesEvent — safety on unknown shapes', () => {
  it('suppresses nothing for a Delivery event', () => {
    expect(classifySesEvent({ notificationType: 'Delivery' }).suppress).toEqual([]);
  });

  it('suppresses nothing for an unrecognised event — a new type cannot lose leads', () => {
    for (const junk of [{}, null, { notificationType: 'Reject' }, { foo: 'bar' }]) {
      const d = classifySesEvent(junk);
      expect(d.eventType).toBe('Unknown');
      expect(d.suppress).toEqual([]);
    }
  });

  it('ignores malformed recipient entries rather than throwing', () => {
    const d = classifySesEvent({
      notificationType: 'Bounce',
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ nope: 1 }, { emailAddress: 'ok@x.com' }, 'str'] },
    });
    expect(d.suppress).toEqual(['ok@x.com']);
  });

  it('accepts the eventType alias as well as notificationType', () => {
    const d = classifySesEvent({ eventType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'c@x.com' }] } });
    expect(d.suppress).toEqual(['c@x.com']);
  });
});

describe('parseSnsEnvelope', () => {
  it('parses a Notification and JSON-decodes the stringified Message', () => {
    const env = parseSnsEnvelope({ Type: 'Notification', Message: JSON.stringify(complaint) });
    expect(env.type).toBe('Notification');
    expect(env.message.notificationType).toBe('Complaint');
  });

  it('accepts an already-parsed Message object', () => {
    const env = parseSnsEnvelope({ Type: 'Notification', Message: complaint });
    expect(env.message.notificationType).toBe('Complaint');
  });

  it('surfaces the SubscribeURL but does NOT act on it (owner-confirmed)', () => {
    const env = parseSnsEnvelope({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&x=y',
    });
    expect(env.type).toBe('SubscriptionConfirmation');
    expect(env.subscribeUrl).toContain('ConfirmSubscription');
    expect(env.message).toBeNull();
  });

  it('null-safes a Message that will not JSON-parse', () => {
    const env = parseSnsEnvelope({ Type: 'Notification', Message: 'not json {' });
    expect(env.message).toBeNull();
  });

  it('reports Unknown for an unrecognised envelope', () => {
    expect(parseSnsEnvelope({ Type: 'Whatever' }).type).toBe('Unknown');
    expect(parseSnsEnvelope({}).type).toBe('Unknown');
  });
});

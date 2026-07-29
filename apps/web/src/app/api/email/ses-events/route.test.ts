/**
 * POST /api/email/ses-events — SES bounce/complaint webhook.
 *
 * Non-vacuous throughout: the suppression path is a mock spy, so "did a
 * permanent bounce suppress?" is answered by whether registerOptOut was called
 * with the right address — and "did a transient bounce spare the lead?" by
 * whether it was NOT called. A test that only checked the HTTP status would
 * pass even if suppression never happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { registerOptOut } = vi.hoisted(() => ({ registerOptOut: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/compliance', () => ({ registerOptOut }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { POST } from './route';

const SECRET = 'test-secret';
const withSecret = (body: unknown) =>
  new Request(`http://t/api/email/ses-events?s=${SECRET}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const notification = (message: unknown) => ({ Type: 'Notification', Message: JSON.stringify(message) });

const permanentBounce = {
  notificationType: 'Bounce',
  bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'dead@example.com' }] },
};
const transientBounce = {
  notificationType: 'Bounce',
  bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'full@example.com' }] },
};
const complaint = {
  notificationType: 'Complaint',
  complaint: { complainedRecipients: [{ emailAddress: 'angry@example.com' }] },
};

let savedSecret: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.SMS_INBOUND_SECRET;
  process.env.SMS_INBOUND_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SMS_INBOUND_SECRET;
  else process.env.SMS_INBOUND_SECRET = savedSecret;
});

describe('security gate', () => {
  it('401s a request with no/incorrect secret, and suppresses nothing', async () => {
    const res = await POST(
      new Request('http://t/api/email/ses-events', { method: 'POST', body: JSON.stringify(notification(complaint)) }) as any
    );
    expect(res.status).toBe(401);
    expect(registerOptOut).not.toHaveBeenCalled();
  });

  it('accepts the secret via header as well as query', async () => {
    const res = await POST(
      new Request('http://t/api/email/ses-events', {
        method: 'POST',
        headers: { 'x-sms-secret': SECRET },
        body: JSON.stringify(notification(complaint)),
      }) as any
    );
    expect(res.status).toBe(200);
  });
});

describe('suppression decisions (the whole point)', () => {
  it('suppresses a PERMANENT bounce via registerOptOut (which fans out cross-channel)', async () => {
    const res = await POST(withSecret(notification(permanentBounce)));
    const body = await res.json();
    expect(body).toMatchObject({ status: 'processed', eventType: 'Bounce', suppressed: 1 });
    expect(registerOptOut).toHaveBeenCalledWith(
      'dead@example.com',
      'email',
      expect.objectContaining({ reason: 'ses_permanent_bounce' })
    );
  });

  it('does NOT suppress a TRANSIENT bounce — the lead stays reachable', async () => {
    const res = await POST(withSecret(notification(transientBounce)));
    const body = await res.json();
    expect(body).toMatchObject({ suppressed: 0, spared: 1 });
    expect(registerOptOut).not.toHaveBeenCalled();
  });

  it('suppresses a COMPLAINT immediately', async () => {
    await POST(withSecret(notification(complaint)));
    expect(registerOptOut).toHaveBeenCalledWith(
      'angry@example.com',
      'email',
      expect.objectContaining({ reason: 'ses_complaint' })
    );
  });

  it('does nothing for a Delivery notification', async () => {
    await POST(withSecret(notification({ notificationType: 'Delivery' })));
    expect(registerOptOut).not.toHaveBeenCalled();
  });
});

describe('SNS envelope handling', () => {
  it('acknowledges SubscriptionConfirmation WITHOUT confirming it (owner action)', async () => {
    const res = await POST(
      withSecret({
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
      })
    );
    const body = await res.json();
    expect(body.status).toBe('subscription_pending_owner_confirmation');
    // Critically: no outbound fetch and no suppression happened.
    expect(registerOptOut).not.toHaveBeenCalled();
  });

  it('ignores an unrecognised envelope without erroring', async () => {
    const res = await POST(withSecret({ Type: 'UnsubscribeConfirmation' }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ignored');
  });

  it('400s on a non-JSON body', async () => {
    const res = await POST(
      new Request(`http://t/api/email/ses-events?s=${SECRET}`, { method: 'POST', body: 'not json' }) as any
    );
    expect(res.status).toBe(400);
  });
});

/**
 * emailProviders workerd guard — SMTP vs SES-HTTPS routing.
 *
 * On Cloudflare Workers outbound SMTP (ports 25/587) is blocked at the
 * platform level, so selectBestProvider() must NEVER return a nodemailer
 * transport there — only 'ses-http' (SES HTTPS API) or 'mock'.
 * On Node the full SMTP chain is preserved. sql is mocked (quota lookups);
 * fetch is stubbed for the HTTPS send path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [{ cnt: '0' }]) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { selectBestProvider, sendEmailWithProvider } from '../emailProviders';

const WORKER_UA = 'Cloudflare-Workers';

function enterWorkerd() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: WORKER_UA },
    configurable: true,
    writable: true,
  });
}

function exitWorkerd() {
  // @ts-expect-error — removing the test-only global restores plain Node
  delete globalThis.navigator;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Zero sent today → full quota remaining (50000 for ses/ses-http, 500 gmail).
  mockSql.mockResolvedValue([{ cnt: '0' }]);
  delete process.env.EMAIL_PROVIDER;
  delete process.env.AWS_SES_ACCESS_KEY;
  delete process.env.AWS_ACCESS_KEY_ID;
  fetchMock = vi.fn(async () =>
    new Response('<SendEmailResponse><SendEmailResult><MessageId>https-123</MessageId></SendEmailResult></SendEmailResponse>', { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  exitWorkerd();
  delete process.env.EMAIL_PROVIDER;
  delete process.env.AWS_SES_FROM_ADDRESS;
});

describe('emailProviders — Cloudflare Workers routing', () => {
  it('RED: on workerd with no EMAIL_PROVIDER, selects ses-http (never gmail/smtp)', async () => {
    enterWorkerd();
    const provider = await selectBestProvider('org_1');
    expect(provider).toBe('ses-http');
  });

  it('RED: on workerd EMAIL_PROVIDER=gmail still selects ses-http or mock (SMTP is undeployable)', async () => {
    enterWorkerd();
    process.env.EMAIL_PROVIDER = 'gmail';
    const provider = await selectBestProvider('org_1');
    expect(['ses-http', 'mock']).toContain(provider);
  });

  it('RED: on workerd EMAIL_PROVIDER=ses means the HTTPS API (fetch called, nodemailer untouched)', async () => {
    enterWorkerd();
    process.env.EMAIL_PROVIDER = 'ses';
    process.env.AWS_SES_ACCESS_KEY = 'AKID';
    process.env.AWS_SES_SECRET_KEY = 'SECRET';
    process.env.AWS_SES_FROM_ADDRESS = 'noreply@dealswiftautomation.com';
    const result = await sendEmailWithProvider('ses', {
      to: 'seller@example.com',
      subject: 'Cash offer',
      text: 'Hello',
    });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('email.us-east-1.amazonaws.com');
  });

  it('RED: on Node EMAIL_PROVIDER=gmail keeps the SMTP chain (unchanged behaviour)', async () => {
    // No enterWorkerd() — plain Node. gmail quota path needs SMTP_USER set.
    process.env.EMAIL_PROVIDER = 'gmail';
    const provider = await selectBestProvider('org_1');
    expect(provider).toBe('gmail');
  });
});

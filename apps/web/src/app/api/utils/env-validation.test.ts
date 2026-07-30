import { describe, it, expect } from 'vitest';

import { validateEnv, assertEnv, EnvValidationError } from './env-validation';

const fullWeb = {
  DATABASE_URL: 'postgres://x',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:4000',
  AI_PROVIDER: 'anthropic',
  ANTHROPIC_API_KEY: 'sk-ant-x',
} as NodeJS.ProcessEnv;

describe('validateEnv — web', () => {
  it('passes with the core required set', () => {
    expect(validateEnv(fullWeb, 'web')).toEqual({ ok: true, missing: [] });
  });

  it('names every missing core var', () => {
    const { ok, missing } = validateEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' } as NodeJS.ProcessEnv, 'web');
    expect(ok).toBe(false);
    const names = missing.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']));
  });

  it('requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic', () => {
    const { missing } = validateEnv({ ...fullWeb, ANTHROPIC_API_KEY: '' } as NodeJS.ProcessEnv, 'web');
    expect(missing.map((m) => m.name)).toContain('ANTHROPIC_API_KEY');
  });

  it('requires the whole Stripe set once STRIPE_SECRET_KEY is present', () => {
    const { missing } = validateEnv({ ...fullWeb, STRIPE_SECRET_KEY: 'sk_test_x' } as NodeJS.ProcessEnv, 'web');
    const names = missing.map((m) => m.name);
    expect(names).toEqual(
      expect.arrayContaining(['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PROFESSIONAL'])
    );
  });

  it('requires Twilio creds + a sender in live SMS mode', () => {
    const { missing } = validateEnv({ ...fullWeb, SMS_MODE: 'live' } as NodeJS.ProcessEnv, 'web');
    const names = missing.map((m) => m.name);
    expect(names).toContain('TWILIO_ACCOUNT_SID');
    expect(names).toContain('TWILIO_AUTH_TOKEN');
    expect(names).toContain('TWILIO_MESSAGING_SERVICE_SID|TWILIO_FROM_NUMBER');
  });

  it('requires nothing extra in mock SMS mode', () => {
    expect(validateEnv({ ...fullWeb, SMS_MODE: 'mock' } as NodeJS.ProcessEnv, 'web').ok).toBe(true);
  });
});

describe('validateEnv — worker', () => {
  it('requires JOB_RUNNER_SECRET and APP_URL', () => {
    const { missing } = validateEnv({} as NodeJS.ProcessEnv, 'worker');
    expect(missing.map((m) => m.name)).toEqual(expect.arrayContaining(['JOB_RUNNER_SECRET', 'APP_URL']));
  });
});

describe('assertEnv', () => {
  it('throws a named EnvValidationError listing missing vars', () => {
    let err: unknown;
    try {
      assertEnv('web', {} as NodeJS.ProcessEnv);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvValidationError);
    expect((err as Error).message).toContain('DATABASE_URL');
  });

  it('does not throw when the env is complete', () => {
    expect(() => assertEnv('web', fullWeb)).not.toThrow();
  });
});

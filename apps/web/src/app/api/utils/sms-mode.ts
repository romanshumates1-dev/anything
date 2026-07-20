/**
 * SMS mode resolution (Part B: SMS_MODE=mock|twilio_test|live).
 *
 * The campaign/gateway code path is byte-identical across modes — mode only
 * decides which ISMSProvider is injected and, for mock, which shared token
 * signs/verifies the simulated delivery callbacks. `twilio_test` and `live` are
 * the SAME code (TwilioAdapter); they differ only in credentials, so this module
 * never needs to distinguish them for routing.
 */
export type SmsMode = 'mock' | 'twilio_test' | 'live';

const MOCK_TOKEN_DEFAULT = 'mock-auth-token';

export function resolveSmsMode(): SmsMode {
  const explicit = process.env.SMS_MODE?.toLowerCase();
  if (explicit === 'mock' || explicit === 'twilio_test' || explicit === 'live') {
    return explicit;
  }
  // No explicit mode: infer from credentials. Creds present → real (live/test
  // are identical code); none → mock.
  const hasCreds = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return hasCreds ? 'live' : 'mock';
}

export function isMockSmsMode(): boolean {
  return resolveSmsMode() === 'mock';
}

/**
 * Token used to sign AND verify simulated delivery callbacks in mock mode. The
 * MockSmsProvider signs with it and the /api/sms/status route verifies with it,
 * so the REAL signature-verification path runs in mock mode — no bypass. Real
 * modes never use this (they use the actual Twilio auth token).
 */
export function mockSmsAuthToken(): string {
  return process.env.MOCK_TWILIO_AUTH_TOKEN || MOCK_TOKEN_DEFAULT;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTwilioClient, getTwilioConfig } from '@/app/api/utils/twilio-adapter';

describe('twilio-adapter', () => {
  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.TWILIO_NUMBER_TYPE;
    delete process.env.OWNER_NUMBER;
  });

  it('returns null when env vars are missing', () => {
    expect(getTwilioConfig()).toBeNull();
    expect(getTwilioClient()).toBeNull();
  });

  it('returns config when env vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG123';
    process.env.TWILIO_NUMBER_TYPE = '10dlc';
    process.env.OWNER_NUMBER = '+15551234567';

    const config = getTwilioConfig();
    expect(config).not.toBeNull();
    expect(config?.accountSid).toBe('AC123');
    expect(config?.messagingServiceSid).toBe('MG123');
    expect(config?.numberType).toBe('10dlc');
    expect(config?.ownerNumber).toBe('+15551234567');
  });

  it('returns a cached twilio client', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';

    const client1 = getTwilioClient();
    const client2 = getTwilioClient();
    expect(client1).toBe(client2);
  });
});
import twilio from 'twilio';

let client: twilio.Twilio | null = null;

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  if (!client) {
    client = twilio(accountSid, authToken);
  }

  return client;
}

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  fromNumber?: string;
  ownerNumber?: string;
  numberType?: '10dlc' | 'toll-free' | 'short-code';
};

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  return {
    accountSid,
    authToken,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
    fromNumber: process.env.TWILIO_FROM_NUMBER || undefined,
    ownerNumber: process.env.OWNER_NUMBER || undefined,
    numberType: (process.env.TWILIO_NUMBER_TYPE as TwilioConfig['numberType']) || undefined,
  };
}
import crypto from 'node:crypto';

export function validateTwilioSignature(input: {
  url: string;
  signature: string;
  authToken: string;
  params: Record<string, string>;
}): boolean {
  const { url, signature, authToken, params } = input;

  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const data = Object.entries(sorted)
    .map(([k, v]) => `${k}${v}`)
    .join('');

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(`${url}${data}`)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

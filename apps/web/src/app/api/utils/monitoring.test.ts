import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { reportError } from './monitoring';

describe('reportError', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    delete process.env.MONITORING_WEBHOOK_URL;
    vi.restoreAllMocks();
  });

  it('always logs a structured line and never throws', async () => {
    await expect(reportError(new Error('boom'), { scope: 'test.scope' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('POSTs to MONITORING_WEBHOOK_URL when configured', async () => {
    process.env.MONITORING_WEBHOOK_URL = 'https://collector.example/hook';
    const fetchMock = vi.fn(async () => new Response('ok'));
    globalThis.fetch = fetchMock as any;
    await reportError(new Error('boom'), { scope: 'billing.webhook', meta: { eventId: 'evt_1' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://collector.example/hook');
    expect(JSON.parse((init as any).body)).toMatchObject({ scope: 'billing.webhook', message: 'boom' });
  });

  it('swallows a webhook failure (monitoring never breaks the caller)', async () => {
    process.env.MONITORING_WEBHOOK_URL = 'https://collector.example/hook';
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;
    await expect(reportError('str error', { scope: 'jobs' })).resolves.toBeUndefined();
  });
});

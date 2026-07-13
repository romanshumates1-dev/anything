/**
 * /api/jobs/process — dual-credential secret gate (dev poller header + Vercel
 * Cron bearer), GET + POST. drainJobs is mocked; we assert auth only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { drainJobs } = vi.hoisted(() => ({ drainJobs: vi.fn(async () => 3) }));
vi.mock('../../utils/jobs', () => ({ drainJobs }));

import { GET, POST } from './route';

const OLD = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_RUNNER_SECRET = 'job-secret';
  process.env.CRON_SECRET = 'cron-secret';
});

function req(headers: Record<string, string>) {
  return new Request('http://localhost/api/jobs/process', { method: 'POST', headers });
}

describe('auth', () => {
  it('401 with no credential', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(drainJobs).not.toHaveBeenCalled();
  });

  it('401 with a wrong secret', async () => {
    expect((await POST(req({ 'x-job-runner-secret': 'nope' }))).status).toBe(401);
    expect((await POST(req({ authorization: 'Bearer nope' }))).status).toBe(401);
  });

  it('accepts the dev poller header (x-job-runner-secret)', async () => {
    const res = await POST(req({ 'x-job-runner-secret': 'job-secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 3 });
  });

  it('accepts the Vercel Cron bearer (Authorization: Bearer <CRON_SECRET>)', async () => {
    const res = await POST(req({ authorization: 'Bearer cron-secret' }));
    expect(res.status).toBe(200);
  });

  it('GET works too (Vercel Cron issues GET)', async () => {
    const res = await GET(req({ authorization: 'Bearer cron-secret' }));
    expect(res.status).toBe(200);
  });

  it('fails closed when the relevant env is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req({ authorization: 'Bearer cron-secret' }))).status).toBe(401);
    process.env = { ...OLD };
  });
});

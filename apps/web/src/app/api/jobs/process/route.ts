import { drainJobs } from '../../utils/jobs';

/**
 * Job runner trigger. Serverless has no resident worker, so this authenticated
 * endpoint drains the queue when called (dev poller, docker loop, cron, or
 * manual curl during QA). It is secret-gated, not session-gated.
 *
 * Two accepted credentials so it works with either invoker (fail closed if
 * neither env is set):
 *   - `x-job-runner-secret: <JOB_RUNNER_SECRET>`  (scripts/jobs-dev.mjs, docker)
 *   - `Authorization: Bearer <CRON_SECRET>`       (Vercel Cron — it can only
 *      send this header; see vercel.json + DEPLOY.md)
 */
function isAuthorized(request: Request): boolean {
  const jobSecret = process.env.JOB_RUNNER_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get('x-job-runner-secret');
  const bearer = request.headers.get('authorization');

  if (jobSecret && headerSecret === jobSecret) return true;
  if (cronSecret && bearer === `Bearer ${cronSecret}`) return true;
  return false;
}

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await drainJobs(25);
    return Response.json({ processed });
  } catch (error: any) {
    console.error('jobs/process error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: dev poller / docker / manual curl. GET: Vercel Cron (it issues a GET).
export const POST = handle;
export const GET = handle;

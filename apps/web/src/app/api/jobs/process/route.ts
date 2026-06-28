import { drainJobs } from '../../utils/jobs';

/**
 * Job runner trigger. Serverless has no resident worker, so this authenticated
 * endpoint drains the queue when called (by docker-compose loop, cron, or
 * manual curl during QA). It is secret-gated, not session-gated.
 */
export async function POST(request: Request) {
  const secret = process.env.JOB_RUNNER_SECRET;
  const provided = request.headers.get('x-job-runner-secret');

  if (!secret || provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const processed = await drainJobs(25);
    return Response.json({ processed });
  } catch (error: any) {
    console.error('POST /api/jobs/process error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

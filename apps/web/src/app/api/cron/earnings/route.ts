import { processMaturedEarnings } from '@/app/api/utils/earningsEscrow';

/**
 * POST /api/cron/earnings
 * Process matured earnings (move PENDING to AVAILABLE).
 * This is a fallback cron job that should run daily to catch any earnings
 * that weren't processed by their scheduled release job.
 *
 * Protected by CRON_SECRET header to prevent unauthorized access.
 */
export async function POST(request: Request) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.error('[cron/earnings] CRON_SECRET not configured');
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  if (cronSecret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const count = await processMaturedEarnings();

    return Response.json({
      success: true,
      processed: count,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[cron/earnings] Error processing matured earnings:', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * GET /api/cron/earnings
 * Health check for the cron endpoint.
 */
export async function GET() {
  return Response.json({
    status: 'ok',
    description: 'Earnings maturation cron endpoint',
    method: 'POST with x-cron-secret header',
  });
}

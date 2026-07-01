import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';

const START_TIME = Date.now();
const VERSION = process.env.APP_VERSION || '0.1.0';

export async function GET() {
  try {
    const dbStart = Date.now();
    await sql`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    const twilioConfig = getTwilioConfig();

    return Response.json({
      status: 'healthy',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: VERSION,
      database: {
        connected: true,
        latencyMs: dbLatency,
      },
      twilio: {
        configured: twilioConfig !== null,
        numberType: twilioConfig?.numberType || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return Response.json({
      status: 'degraded',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: VERSION,
      database: {
        connected: false,
        error: error?.message || 'unknown',
      },
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
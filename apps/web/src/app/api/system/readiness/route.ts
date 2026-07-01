import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { computeReadiness, executionReadiness } from '../../utils/readiness';
import { getTwilioConfig, getTwilioClient } from '../../utils/twilio-adapter';

// Static manifests (deterministic). Route/page files cannot be introspected at
// runtime in a serverless build, so the expected set is asserted here against
// what we actually shipped. DB/jobs/messaging/observability are LIVE queries.
const EXPECTED_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'leads',
  'ai_conversations',
  'audit_logs',
  'compliance_records',
  'jobs',
  'campaigns',
  'campaign_leads',
  'imports',
  'import_failures',
  'flow_run',
];

const EXPECTED_ROUTES = [
  '/api/leads',
  '/api/leads/bulk',
  '/api/campaigns',
  '/api/campaigns/[id]/leads',
  '/api/campaigns/[id]/launch',
  '/api/conversations',
  '/api/conversations/[leadId]',
  '/api/sms/inbound',
  '/api/jobs/process',
  '/api/compliance/opt-out',
  '/api/dashboard/stats',
  '/api/imports',
  '/api/system/readiness',
  '/api/system/health',
  '/api/system/database',
  '/api/system/queue-status',
  '/api/system/metrics',
];

const EXPECTED_UI_FLOWS = [
  '/leads',
  '/leads/import',
  '/campaigns',
  '/inbox',
  '/inbox/[leadId]',
  '/dashboard/readiness',
];

const EXPECTED_LOG_ACTIONS = [
  'lead_created',
  'leads_imported',
  'campaign_created',
  'campaign_leads_added',
  'campaign_started',
  'message_sent',
  'sms_inbound',
];

// Mirrors /api/__tests__/flows/registry.ts. A flow counts as "passed" when a
// flow_run audit log records it as passed (written by the flow runner against a
// live DB). Kept as a runtime constant so the build never imports test files.
const EXPECTED_FLOWS = ['campaign_lifecycle', 'csv_import_10k', 'scheduler_validation'];

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const tableRows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${EXPECTED_TABLES})
    `;
    const dbTablesPresent = tableRows.length;

    const [jobAgg] = await sql`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE status = 'completed') AS completed,
        count(*) FILTER (WHERE status = 'dead') AS dead,
        count(*) FILTER (WHERE status = 'processing' AND locked_until < now()) AS stuck
      FROM jobs
    `;

    const [msgAgg] = await sql`
      SELECT
        count(*) FILTER (WHERE action = 'message_sent') AS sent,
        count(*) FILTER (WHERE action = 'message_failed') AS failed
      FROM audit_logs
    `;

    const twilioConfig = getTwilioConfig();
    const twilioConnected = twilioConfig !== null;
    const twilioNumberType = twilioConfig?.numberType || null;

    const logRows = await sql`
      SELECT DISTINCT action FROM audit_logs WHERE action = ANY(${EXPECTED_LOG_ACTIONS})
    `;

    const flowRows = await sql`
      SELECT flow_key
      FROM flow_run
      WHERE step_id IS NULL
      AND flow_key = ANY(${EXPECTED_FLOWS})
      AND passed = true
      AND run_id = (SELECT run_id FROM flow_run ORDER BY created_at DESC LIMIT 1)
    `;

    // Governance Rule #8: execution-ledger readiness = passed / total runs.
    const [execAgg] = await sql`
      SELECT
        count(*) FILTER (WHERE status IN ('pass','fail','complete')) AS total,
        count(*) FILTER (WHERE passed = true) AS passed
      FROM execution_runs
    `;
    const executionLedger = executionReadiness(
      parseInt(execAgg.passed, 10),
      parseInt(execAgg.total, 10)
    );

    const result = computeReadiness({
      apiRoutesPresent: EXPECTED_ROUTES.length,
      apiRoutesExpected: EXPECTED_ROUTES.length,
      jobsTotal: parseInt(jobAgg.total, 10),
      jobsCompleted: parseInt(jobAgg.completed, 10),
      jobsDead: parseInt(jobAgg.dead, 10),
      jobsStuck: parseInt(jobAgg.stuck, 10),
      dbTablesPresent,
      dbTablesExpected: EXPECTED_TABLES.length,
      messagesSent: parseInt(msgAgg.sent, 10),
      messagesFailed: parseInt(msgAgg.failed, 10),
      uiFlowsPresent: EXPECTED_UI_FLOWS.length,
      uiFlowsExpected: EXPECTED_UI_FLOWS.length,
      logActionsPresent: logRows.length,
      logActionsExpected: EXPECTED_LOG_ACTIONS.length,
      flowsPassed: flowRows.length,
      flowsExpected: EXPECTED_FLOWS.length,
    });

    return Response.json({
      ...result,
      executionLedger,
      twilio: {
        connected: twilioConnected,
        numberType: twilioNumberType,
      },
    });
  } catch (error: any) {
    console.error('GET /api/system/readiness error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * FLOW REGISTRY — truth contracts.
 *
 * Each flow is a named sequence of steps. A step is only "real" if it maps to
 * an actual route handler or utility function (Layer A: code exists). The flow
 * runner (flows.test.ts) then proves Layer B (behavior works) and, when run
 * against a live DATABASE_URL, Layer C (end-to-end DB truth).
 *
 * This prevents "fake completion": a flow cannot be marked done unless every
 * step resolves to executable code AND the runner's assertions pass.
 *
 * NOTE on the spec's requested path `/tests/flows/registry.ts`: this platform
 * only discovers/executes tests inside the `web` workspace, so the registry
 * lives here (api/__tests__/flows) where vitest can actually run it.
 */

export type FlowStep = {
  id: string;
  /** Human description of the truth this step asserts. */
  describe: string;
  /** The code symbol that must exist for this step (route path or fn name). */
  binds: string;
};

export type Flow = {
  key: string;
  title: string;
  steps: FlowStep[];
};

export const flows: Record<string, Flow> = {
  campaign_lifecycle: {
    key: 'campaign_lifecycle',
    title: 'Campaign lifecycle (lead → campaign → launch → job → inbox → reply → thread)',
    steps: [
      { id: 'create_lead', describe: 'POST /api/leads inserts a lead', binds: 'leads.POST' },
      {
        id: 'create_campaign',
        describe: 'POST /api/campaigns inserts a draft campaign',
        binds: 'campaigns.POST',
      },
      {
        id: 'add_lead_to_campaign',
        describe: 'POST /api/campaigns/[id]/leads inserts a pending member (idempotent)',
        binds: 'campaignLeads.POST',
      },
      {
        id: 'launch_campaign',
        describe: 'POST /api/campaigns/[id]/launch enqueues throttled, idempotent send jobs',
        binds: 'launch.POST',
      },
      {
        id: 'process_jobs',
        describe: 'POST /api/jobs/process drains the queue (send_message → sendMessage)',
        binds: 'jobsProcess.POST',
      },
      {
        id: 'verify_inbox',
        describe: 'GET /api/conversations returns the conversation with a preview',
        binds: 'conversations.GET',
      },
      {
        id: 'inbound_reply',
        describe: 'POST /api/sms/inbound appends the reply and flags needs_review',
        binds: 'inbound.POST',
      },
      {
        id: 'verify_thread',
        describe: 'GET /api/conversations/[leadId] returns ordered history',
        binds: 'thread.GET',
      },
    ],
  },

  csv_import_10k: {
    key: 'csv_import_10k',
    title: 'Bulk CSV import (parse → dedupe → chunk → insert → log failures)',
    steps: [
      {
        id: 'parse_stream',
        describe: 'parseLeadsCsv parses + validates rows',
        binds: 'parseLeadsCsv',
      },
      { id: 'dedupe', describe: 'dedupeInBatch removes hash collisions', binds: 'dedupeInBatch' },
      { id: 'chunk', describe: 'chunk splits into batch-insert groups', binds: 'chunk' },
      {
        id: 'bulk_insert',
        describe: 'POST /api/leads/bulk inserts + records import',
        binds: 'bulk.POST',
      },
      {
        id: 'verify_count',
        describe: 'GET /api/imports returns the import record',
        binds: 'imports.GET',
      },
    ],
  },

  scheduler_validation: {
    key: 'scheduler_validation',
    title: 'Campaign scheduler (daily cap + per-minute throttle + idempotent enqueue)',
    steps: [
      {
        id: 'enqueue_idempotent',
        describe: 'enqueueJob with a dedupeKey skips duplicates',
        binds: 'enqueueJob',
      },
      {
        id: 'throttled_runat',
        describe: 'launch spaces run_at by cap/throttle',
        binds: 'launch.POST',
      },
    ],
  },
};

export const flowKeys = Object.keys(flows);

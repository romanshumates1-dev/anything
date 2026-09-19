/**
 * Pipeline API
 *
 * GET /api/pipeline - Get pipeline status and configuration
 * POST /api/pipeline - Trigger pipeline run or update config
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  getPipelineStatus,
  getPipelineConfig,
  updatePipelineConfig,
  runPipeline,
  schedulePipelineRun,
} from '@/app/api/utils/pipelineOrchestrator';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const includeConfig = searchParams.get('include_config') === 'true';

  try {
    const status = await getPipelineStatus(organization.id);

    const response: Record<string, unknown> = { status };

    if (includeConfig) {
      response.config = await getPipelineConfig(organization.id);
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('[pipeline] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, config } = body as {
      action?: 'run' | 'schedule' | 'update_config';
      config?: Record<string, unknown>;
    };

    if (action === 'run') {
      // Synchronously run the pipeline (for testing/debugging)
      const result = await runPipeline(organization.id);
      return NextResponse.json({ success: true, result });
    }

    if (action === 'schedule') {
      // Schedule a pipeline run (normal operation)
      const jobId = await schedulePipelineRun(organization.id);
      return NextResponse.json({ success: true, jobId });
    }

    if (action === 'update_config' && config) {
      // Update pipeline configuration
      const updated = await updatePipelineConfig(organization.id, config);
      return NextResponse.json({ success: true, config: updated });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: run, schedule, or update_config' },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error('[pipeline] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to execute pipeline action' },
      { status: 500 }
    );
  }
}

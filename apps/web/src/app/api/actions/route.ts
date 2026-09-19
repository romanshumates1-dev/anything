/**
 * Action Queue API
 *
 * GET /api/actions - List pending actions for the organization
 * POST /api/actions - Not used (actions are created by the pipeline)
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  getActionQueue,
  getPipelineStatus,
  type ActionType,
  type ActionStatus,
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
  const status = searchParams.get('status') as ActionStatus | null;
  const priority = searchParams.get('priority');
  const type = searchParams.get('type') as ActionType | null;
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
  const offset = Number(searchParams.get('offset')) || 0;
  const includeStatus = searchParams.get('include_status') === 'true';

  try {
    const { items, total } = await getActionQueue(organization.id, {
      status: status || 'PENDING',
      priority: priority || undefined,
      type: type || undefined,
      userId: session.user.id,
      limit,
      offset,
    });

    const response: Record<string, unknown> = {
      items,
      total,
      limit,
      offset,
    };

    // Optionally include pipeline status for dashboard
    if (includeStatus) {
      response.pipelineStatus = await getPipelineStatus(organization.id);
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('[actions] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch actions' },
      { status: 500 }
    );
  }
}

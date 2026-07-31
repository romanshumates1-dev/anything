import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { SimpleOrchestrator } from '../orchestrator';

/**
 * POST /api/optimization/process
 * Body: { leadId: number } or { leadIds: number[] }
 *
 * Processes one or more leads through the optimization pipeline
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const orchestrator = new SimpleOrchestrator();

    if (body.leadId) {
      // Single lead
      await orchestrator.processLead(body.leadId);
      return NextResponse.json({
        success: true,
        leadId: body.leadId,
        message: 'Lead processed successfully'
      });
    } else if (Array.isArray(body.leadIds)) {
      // Batch
      await orchestrator.processBatch(body.leadIds);
      return NextResponse.json({
        success: true,
        count: body.leadIds.length,
        message: `${body.leadIds.length} leads processed successfully`
      });
    } else {
      return NextResponse.json(
        { error: 'Missing leadId or leadIds in request body' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('POST /api/optimization/process error', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}

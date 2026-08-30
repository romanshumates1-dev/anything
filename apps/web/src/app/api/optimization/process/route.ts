import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { SimpleOrchestrator } from '../orchestrator';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

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
    const org = await getOrganization();

    if (!org) {
      return NextResponse.json(
        { error: 'No organization found' },
        { status: 404 }
      );
    }

    const orchestrator = new SimpleOrchestrator();

    if (body.leadId) {
      // Single lead - verify ownership
      const [lead] = await sql`
        SELECT id FROM leads WHERE id = ${body.leadId} AND organization_id = ${org.id}
      `;

      if (!lead) {
        return NextResponse.json(
          { error: 'Lead not found or access denied' },
          { status: 404 }
        );
      }

      await orchestrator.processLead(body.leadId);
      return NextResponse.json({
        success: true,
        leadId: body.leadId,
        message: 'Lead processed successfully'
      });
    } else if (Array.isArray(body.leadIds)) {
      // Batch - verify all leads belong to organization
      const leads = await sql`
        SELECT id FROM leads
        WHERE id = ANY(${body.leadIds}) AND organization_id = ${org.id}
      `;

      if (leads.length !== body.leadIds.length) {
        return NextResponse.json(
          { error: 'One or more leads not found or access denied' },
          { status: 404 }
        );
      }

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
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

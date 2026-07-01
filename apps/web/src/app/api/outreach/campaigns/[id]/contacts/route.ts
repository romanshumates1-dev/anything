import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { parseContactList, dedupeContacts } from '@/app/api/utils/contactImport';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const campaignId = params.id;
    const organizationId = (session.user as any).organizationId || 'default';

    // Verify campaign exists + is DRAFT
    const campaignRows = await sql`
      SELECT * FROM outreach_campaigns WHERE id = ${campaignId} AND organization_id = ${organizationId}
    `;
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    const campaign = campaignRows[0];
    if (campaign.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Can only import contacts into DRAFT campaigns' }, { status: 400 });
    }

    const contentType = request.headers.get('content-type') || '';
    let rawText: string;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }
      rawText = await file.text();
    } else {
      const body = await request.json();
      rawText = body.text || body.contacts || '';
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json({ error: 'Empty contact list' }, { status: 400 });
    }

    // Parse + dedupe
    const parsed = parseContactList(rawText);
    const deduped = dedupeContacts(parsed);
    const invalidRows = deduped.filter(c => !c.valid);
    const validContacts = deduped.filter(c => c.valid);

    if (validContacts.length === 0) {
      return NextResponse.json({ error: 'No valid contacts parsed', failures: invalidRows }, { status: 400 });
    }

    // Insert contacts in batches (avoid SQL injection via parameterized queries)
    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < validContacts.length; i += BATCH) {
      const batch = validContacts.slice(i, i + BATCH);
      const values: string[] = [];
      const args: any[] = [];
      batch.forEach((c, idx) => {
        const contactId = crypto.randomUUID();
        const base = idx * 4;
        args.push(contactId, campaignId, organizationId, c.name, c.phone, 'QUEUED');
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'QUEUED')`);
      });

      const placeholders = values.join(', ');
      // Build parameterized INSERT
      const paramSql = `
        INSERT INTO campaign_contacts (id, campaign_id, organization_id, name, phone, status)
        VALUES ${placeholders}
        ON CONFLICT (campaign_id, phone) DO NOTHING
      `;
      await sql.query(paramSql, args);
      inserted += batch.length;
    }

    // Count total contacts now in campaign
    const countRow = await sql`
      SELECT COUNT(*)::int AS total FROM campaign_contacts WHERE campaign_id = ${campaignId}
    `;

    await logEvent('contacts_imported', 'campaign', campaignId, { count: inserted, failures: invalidRows.length }, session.user.id);

    return NextResponse.json({
      imported: inserted,
      failures: invalidRows.length,
      failureDetails: invalidRows,
      totalInCampaign: countRow[0]?.total ?? 0,
    });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/contacts error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Lead Finder source registry. Sources are CONFIG (added/toggled as data, not
 * code). Admin-only: this is a management surface.
 *
 * GET  → list every source with record counts.
 * POST → add a source. A new source may NOT be created PERMITTED without a
 *        robots_status that records a live check (compliance: zero PERMITTED
 *        without a live check). Anything else defaults to MANUAL_ONLY.
 */
const ACCESS_METHODS = ['API', 'CSV_DOWNLOAD', 'HTML_TABLE', 'MANUAL_ONLY'];
const TERMS_STATUSES = ['PERMITTED', 'MANUAL_ONLY', 'PROHIBITED'];

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const rows = await sql`
      SELECT s.*,
        (SELECT COUNT(*)::int FROM sourced_leads sl WHERE sl.source_id = s.id) AS record_count
      FROM lead_sources s
      ORDER BY s.category, s.distress_weight DESC, s.id
    `;
    return Response.json(rows);
  } catch (error: any) {
    console.error('GET /api/lead-finder/sources error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const jurisdiction = typeof b.jurisdiction === 'string' ? b.jurisdiction.trim() : '';
    const recordType = typeof b.recordType === 'string' ? b.recordType.trim() : '';
    const category = b.category === 'buyer' ? 'buyer' : 'seller';
    const accessMethod = ACCESS_METHODS.includes(b.accessMethod as string) ? (b.accessMethod as string) : 'MANUAL_ONLY';
    const url = typeof b.url === 'string' ? b.url.trim() : null;
    const robotsStatus = typeof b.robotsStatus === 'string' ? b.robotsStatus.trim() : 'NOT_CHECKED';
    let termsStatus = TERMS_STATUSES.includes(b.termsStatus as string) ? (b.termsStatus as string) : 'MANUAL_ONLY';
    const refreshCadence = typeof b.refreshCadence === 'string' ? b.refreshCadence.trim() : null;
    const distressWeight = Number.isFinite(Number(b.distressWeight)) ? Math.max(0, Math.min(100, Math.round(Number(b.distressWeight)))) : 50;
    const notes = typeof b.notes === 'string' ? b.notes.trim() : null;

    if (!name || !jurisdiction || !recordType) {
      return Response.json({ error: 'name, jurisdiction, and recordType are required' }, { status: 400 });
    }

    // Compliance guard: cannot register PERMITTED unless a live robots check is
    // recorded (robots_status must be a real finding, not the NOT_CHECKED default).
    if (termsStatus === 'PERMITTED' && (!robotsStatus || /^NOT_CHECKED$/i.test(robotsStatus))) {
      termsStatus = 'MANUAL_ONLY';
    }

    const [row] = await sql`
      INSERT INTO lead_sources
        (name, jurisdiction, record_type, category, access_method, url, robots_status, terms_status, refresh_cadence, distress_weight, notes)
      VALUES
        (${name}, ${jurisdiction}, ${recordType}, ${category}, ${accessMethod}, ${url}, ${robotsStatus}, ${termsStatus}, ${refreshCadence}, ${distressWeight}, ${notes})
      RETURNING *
    `;
    await logEvent('lead_source_added', 'lead_source', String(row.id), { name, termsStatus, accessMethod }, admin.userId);
    return Response.json(row, { status: 201 });
  } catch (error: any) {
    if (/unique/i.test(error?.message || '')) {
      return Response.json({ error: 'A source with that name already exists' }, { status: 409 });
    }
    console.error('POST /api/lead-finder/sources error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

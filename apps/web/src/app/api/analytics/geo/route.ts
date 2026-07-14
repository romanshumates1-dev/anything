import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { regionForPhone } from '@/app/api/utils/area-codes';

/**
 * Approximate geo distribution of campaign prospects for the analytics globe.
 * Derives location ONLY from the phone's area code (region-level, no new PII).
 * Aggregates per (campaign, region) with a recent-activity flag. Admin-only.
 */
const CAMPAIGN_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const MAX_CONTACTS = 5000; // cap the scan; points are region-aggregated anyway
const ACTIVE_WINDOW_HRS = 48;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const rows = await sql`
      SELECT cc.campaign_id, cc.phone, cc.last_message_at, c.name AS campaign_name
      FROM campaign_contacts cc
      JOIN outreach_campaigns c ON c.id = cc.campaign_id
      WHERE cc.phone IS NOT NULL
      ORDER BY cc.last_message_at DESC NULLS LAST
      LIMIT ${MAX_CONTACTS}
    `;

    const now = Date.now();
    const activeMs = ACTIVE_WINDOW_HRS * 3600_000;
    // campaignId -> { name, color, regionKey -> point }
    const byCampaign = new Map<string, { id: string; name: string; color: string; points: Map<string, any> }>();
    let colorIdx = 0;

    for (const r of rows as any[]) {
      const geo = regionForPhone(r.phone);
      if (!geo) continue;
      let camp = byCampaign.get(r.campaign_id);
      if (!camp) {
        camp = { id: r.campaign_id, name: r.campaign_name, color: CAMPAIGN_COLORS[colorIdx % CAMPAIGN_COLORS.length], points: new Map() };
        byCampaign.set(r.campaign_id, camp);
        colorIdx++;
      }
      const key = geo.region;
      let pt = camp.points.get(key);
      if (!pt) {
        pt = { lat: geo.lat, lng: geo.lng, region: geo.region, count: 0, active: false };
        camp.points.set(key, pt);
      }
      pt.count++;
      const lm = r.last_message_at ? new Date(r.last_message_at).getTime() : 0;
      if (lm && now - lm < activeMs) pt.active = true;
    }

    const campaigns = Array.from(byCampaign.values()).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      points: Array.from(c.points.values()),
    }));

    return Response.json({
      campaigns,
      disclaimer: 'Locations are APPROXIMATE (derived from phone area code, region-level). Not precise addresses.',
    });
  } catch (error: any) {
    console.error('GET /api/analytics/geo error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

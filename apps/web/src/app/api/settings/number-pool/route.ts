import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import {
  listPoolUsage,
  addNumber,
  setRotationCap,
} from '@/app/api/utils/numberPoolStore';
import { areaCodeOf } from '@/app/api/utils/area-codes';

/**
 * INT-3 — local-presence number pool (admin).
 * GET   → pool usage table: per-number sentToday + BOTH caps (rotation guard vs
 *         carrier ceiling — owner Decision 2: both visible per-number).
 * POST  → add a number to the pool.
 * PATCH → set the rotationCap guard.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return Response.json(await listPoolUsage());
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
  if (!/^\+1\d{10}$/.test(phoneNumber)) {
    return Response.json({ error: 'phoneNumber must be E.164 US format (+1XXXXXXXXXX)' }, { status: 400 });
  }
  if (!areaCodeOf(phoneNumber)) {
    return Response.json({ error: 'Could not derive an area code from that number' }, { status: 400 });
  }
  const numberType = body.numberType === 'toll-free' || body.numberType === 'short-code' ? body.numberType : '10dlc';
  const trustLevel = body.trustLevel === 'low' || body.trustLevel === 'high' ? body.trustLevel : 'medium';

  await addNumber({ phoneNumber, numberType, trustLevel });
  await logEvent('number_pool_added', 'app_setting', 'number_pool', { phoneNumber, numberType, trustLevel }, admin.userId);
  return Response.json(await listPoolUsage(), { status: 201 });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cap = body.rotationCap;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > 100000) {
    return Response.json({ error: 'rotationCap must be an integer 0–100000' }, { status: 400 });
  }

  await setRotationCap(cap, admin.userId);
  await logEvent('number_pool_cap_changed', 'app_setting', 'number_pool', { rotationCap: cap }, admin.userId);
  return Response.json(await listPoolUsage());
}

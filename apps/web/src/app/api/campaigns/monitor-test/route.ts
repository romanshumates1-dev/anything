/**
 * Simple test endpoint for monitor
 */
import { requireSession } from '@/app/api/utils/authz';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  return Response.json({ ok: true, time: new Date().toISOString() });
}

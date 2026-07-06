import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';

export async function DELETE(request: Request, props: { params: { id: string } }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = props.params;
    const orgId = session.user.id;

    const [phone] = await sql`
      SELECT * FROM test_phone_numbers WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1
    `;

    if (!phone) return Response.json({ error: 'Not found' }, { status: 404 });

    await sql`DELETE FROM test_phone_numbers WHERE id = ${id} AND organization_id = ${orgId}`;

    await logEvent('test_phone_removed', 'test_phone', phone.phone, { phone }, orgId);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/test-phones error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
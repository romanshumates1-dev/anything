import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/** Import history log (most recent first). */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const imports = await sql`
      SELECT id, source, filename, total_rows, inserted_rows,
             duplicate_rows, failed_rows, status, created_at
      FROM imports
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return Response.json(imports);
  } catch (error: any) {
    console.error('GET /api/imports error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

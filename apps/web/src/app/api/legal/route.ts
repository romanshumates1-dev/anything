/**
 * Legal documents + acceptance API.
 *
 * GET  /api/legal            — list all legal docs (from markdown single source)
 * GET  /api/legal?type=terms — one doc's content + version
 * POST /api/legal            — record the CURRENT user's acceptance of one or
 *                              more acceptance keys (tos | privacy | messaging).
 *
 * The prior POST took userId from the request BODY and had no auth — any
 * anonymous caller could forge acceptance rows for arbitrary users
 * (BREAKAGE_TABLE #31). It now requires a session and derives userId +
 * ip + user_agent server-side; the accepted version comes from the markdown
 * source, never from the client.
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getLegalDoc, getAllLegalDocs, currentVersionFor, ACCEPTANCE_DOCS, type AcceptanceKey } from '@/lib/legal';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('type');

  if (slug) {
    const doc = getLegalDoc(slug);
    if (!doc) return Response.json({ error: 'Document not found' }, { status: 404 });
    return Response.json({
      slug: doc.slug,
      documentType: doc.docType,
      title: doc.title,
      version: doc.version,
      effectiveDate: doc.effectiveDate,
      requiresAcceptance: doc.requiresAcceptance,
      content: doc.body,
    });
  }

  const docs = getAllLegalDocs().map((d) => ({
    slug: d.slug,
    documentType: d.docType,
    title: d.title,
    version: d.version,
    effectiveDate: d.effectiveDate,
    requiresAcceptance: d.requiresAcceptance,
  }));
  return Response.json(docs);
}

const VALID_KEYS: AcceptanceKey[] = [...(Object.keys(ACCEPTANCE_DOCS) as (keyof typeof ACCEPTANCE_DOCS)[]), 'messaging'];

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawKeys: unknown = body?.keys ?? (body?.key ? [body.key] : null);
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
    return Response.json({ error: 'keys[] required (tos | privacy | messaging)' }, { status: 400 });
  }
  const keys = rawKeys.filter((k): k is AcceptanceKey => VALID_KEYS.includes(k as AcceptanceKey));
  if (keys.length === 0) {
    return Response.json({ error: 'no valid acceptance keys provided' }, { status: 400 });
  }

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = hdrs.get('user-agent') || null;

  try {
    for (const key of keys) {
      const documentType = key === 'messaging' ? 'messaging' : ACCEPTANCE_DOCS[key];
      const version = currentVersionFor(key);
      const id = `accept_${crypto.randomUUID().replace(/-/g, '')}`;
      await sql`
        INSERT INTO legal_acceptances (id, user_id, document_type, version, ip_address, user_agent)
        VALUES (${id}, ${session.user.id}, ${documentType}, ${version}, ${ip}, ${userAgent})
        ON CONFLICT (user_id, document_type, version) DO NOTHING
      `;
    }
    return Response.json({ success: true, accepted: keys });
  } catch (error) {
    console.error('POST /api/legal error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Legal documents API - retrieve editable templates.
 * 
 * GET /api/legal - list all active legal documents
 * GET /api/legal?type=terms_of_service - get specific document
 */
import sql from '@/app/api/utils/sql';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const documentType = searchParams.get('type');

  try {
    if (documentType) {
      const [doc] = await sql`
        SELECT id, document_type, title, content, version, requires_acceptance
        FROM legal_documents
        WHERE document_type = ${documentType}
        AND is_active = true
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (!doc) {
        return Response.json({ error: 'Document not found' }, { status: 404 });
      }

      return Response.json(doc);
    }

    // List all active documents
    const docs = await sql`
      SELECT id, document_type, title, version, requires_acceptance
      FROM legal_documents
      WHERE is_active = true
      ORDER BY document_type ASC
    `;

    return Response.json(docs);
  } catch (error) {
    console.error('GET /api/legal error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/legal/accept - record user acceptance of a document.
 * Called during registration and when documents are updated.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { documentId, userId } = body;

  if (!documentId || !userId) {
    return Response.json({ error: 'documentId and userId required' }, { status: 400 });
  }

  try {
    const [doc] = await sql`
      SELECT document_type, version FROM legal_documents WHERE id = ${documentId} LIMIT 1
    `;

    if (!doc) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    const id = `accept_${crypto.randomUUID().replace(/-/g, '')}`;
    await sql`
      INSERT INTO legal_acceptances (id, user_id, document_id, document_type, version)
      VALUES (${id}, ${userId}, ${documentId}, ${doc.document_type}, ${doc.version})
      ON CONFLICT DO NOTHING
    `;

    return Response.json({ success: true });
  } catch (error) {
    console.error('POST /api/legal error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
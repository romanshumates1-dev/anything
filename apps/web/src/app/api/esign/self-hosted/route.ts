/**
 * Self-Hosted E-Sign API
 *
 * NO third-party dependencies. Full ESIGN Act compliance.
 *
 * POST /api/esign/self-hosted - Create and send document for signing
 * GET  /api/esign/self-hosted?id=xxx - Get document status
 * PUT  /api/esign/self-hosted - Apply signature
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  createDocument,
  createSigningSession,
  applySignature,
  generateSignedDocument,
  generateAuditCertificate,
  sendSigningRequest,
  sendCompletionNotification,
  type Signer,
  type SignatureField,
  type ESignDocument,
  type SigningSession,
} from './engine';

interface CreateDocumentRequest {
  title: string;
  contractType: 'purchase_agreement' | 'assignment_contract' | 'fee_agreement';
  dealId: string;
  signers: Array<{
    name: string;
    email: string;
    role: 'seller' | 'buyer' | 'assignee';
  }>;
  contractData: {
    propertyAddress: string;
    purchasePrice: number;
    assignmentFee?: number;
    closingDate: string;
    sellerName: string;
    buyerName?: string;
  };
}

const CONTRACT_TEMPLATES: Record<string, (data: CreateDocumentRequest['contractData']) => { content: string; fields: Omit<SignatureField, 'id'>[] }> = {
  purchase_agreement: (data) => ({
    content: `
REAL ESTATE PURCHASE AGREEMENT

This Purchase Agreement ("Agreement") is entered into as of ${new Date().toLocaleDateString()}.

PARTIES:
Seller: ${data.sellerName}
Buyer: ${data.buyerName || 'TBD'}

PROPERTY:
${data.propertyAddress}

TERMS:
1. Purchase Price: $${data.purchasePrice.toLocaleString()}
2. Earnest Money: $1,000 (due within 3 business days)
3. Closing Date: ${data.closingDate}
4. Property sold AS-IS, WHERE-IS

SELLER REPRESENTATIONS:
- Seller has authority to sell the property
- No undisclosed liens or encumbrances
- Property will be vacant at closing

BUYER'S RIGHT TO ASSIGN:
Buyer may assign this contract to a third party without seller's consent.

AGREEMENT:
By signing below, the parties agree to all terms and conditions stated above.
`.trim(),
    fields: [
      { type: 'signature', label: 'Seller Signature', required: true, signerId: 'signer_1' },
      { type: 'date', label: 'Date', required: true, signerId: 'signer_1' },
      { type: 'signature', label: 'Buyer Signature', required: true, signerId: 'signer_2' },
      { type: 'date', label: 'Date', required: true, signerId: 'signer_2' },
    ],
  }),

  assignment_contract: (data) => ({
    content: `
ASSIGNMENT OF REAL ESTATE PURCHASE AGREEMENT

This Assignment ("Assignment") is made as of ${new Date().toLocaleDateString()}.

ASSIGNOR: ${data.buyerName || 'Original Buyer'} (Original Buyer)
ASSIGNEE: [End Buyer Name] (New Buyer)

PROPERTY:
${data.propertyAddress}

ASSIGNMENT:
Assignor hereby assigns all rights, title, and interest in the Purchase Agreement
to Assignee.

ASSIGNMENT FEE: $${(data.assignmentFee || 0).toLocaleString()}
(Due at closing)

TERMS:
1. Assignee assumes all obligations under the original Purchase Agreement
2. Original Purchase Price: $${data.purchasePrice.toLocaleString()}
3. Closing Date: ${data.closingDate}

AGREEMENT:
By signing below, the parties agree to this assignment and all terms stated above.
`.trim(),
    fields: [
      { type: 'signature', label: 'Assignor Signature', required: true, signerId: 'signer_1' },
      { type: 'date', label: 'Date', required: true, signerId: 'signer_1' },
      { type: 'signature', label: 'Assignee Signature', required: true, signerId: 'signer_2' },
      { type: 'date', label: 'Date', required: true, signerId: 'signer_2' },
    ],
  }),

  fee_agreement: (data) => ({
    content: `
ASSIGNMENT FEE AGREEMENT

This Fee Agreement ("Agreement") is entered into as of ${new Date().toLocaleDateString()}.

PARTIES:
Assignor: ${data.buyerName || 'Wholesaler'}
Assignee: [End Buyer Name]

RE: Property at ${data.propertyAddress}

ASSIGNMENT FEE:
Assignee agrees to pay Assignor an assignment fee of $${(data.assignmentFee || 0).toLocaleString()}
at the closing of the property referenced above.

PAYMENT TERMS:
- Fee due at closing via wire transfer or certified funds
- Fee is non-refundable once closing occurs

AGREEMENT:
By signing below, the parties agree to the payment of the assignment fee as stated above.
`.trim(),
    fields: [
      { type: 'signature', label: 'Assignee Signature', required: true, signerId: 'signer_1' },
      { type: 'date', label: 'Date', required: true, signerId: 'signer_1' },
    ],
  }),
};

// In-memory storage (in production, use database)
const documents: Map<string, ESignDocument> = new Map();
const sessions: Map<string, SigningSession> = new Map();

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: CreateDocumentRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, contractType, dealId, signers, contractData } = body;

  if (!contractType || !CONTRACT_TEMPLATES[contractType]) {
    return Response.json({ error: 'Invalid contract type' }, { status: 400 });
  }

  if (!signers || signers.length === 0) {
    return Response.json({ error: 'At least one signer required' }, { status: 400 });
  }

  try {
    // Generate contract from template
    const template = CONTRACT_TEMPLATES[contractType](contractData);

    // Create document
    const document = createDocument(
      title || `${contractType.replace(/_/g, ' ').toUpperCase()} - ${contractData.propertyAddress}`,
      template.content,
      signers,
      template.fields,
      { dealId, contractType, organizationId: organization.id }
    );

    // Store document
    documents.set(document.id, document);

    // Save to database
    await sql`
      INSERT INTO esign_envelopes (
        id, organization_id, deal_id, contract_type, provider,
        status, signers, envelope_data, created_at, expires_at
      ) VALUES (
        ${document.id},
        ${organization.id},
        ${dealId},
        ${contractType},
        'self_hosted',
        ${document.status},
        ${JSON.stringify(document.signers)},
        ${JSON.stringify(document)},
        NOW(),
        ${document.expiresAt}
      )
    `.catch(console.error);

    // Create signing sessions and send requests
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';
    const signingUrls: Record<string, string> = {};

    for (const signer of document.signers) {
      const session = createSigningSession(document, signer.id);
      sessions.set(session.token, session);

      signingUrls[signer.email] = `${baseUrl}/sign/${document.id}?token=${session.token}&signer=${signer.id}`;

      // Send signing request email
      await sendSigningRequest(document, signer, session, baseUrl);
    }

    // Update document status
    document.status = 'pending';
    document.auditTrail.push({
      timestamp: new Date().toISOString(),
      event: 'signing_requests_sent',
      actor: 'system',
      details: { recipientCount: signers.length },
    });

    return Response.json({
      success: true,
      provider: 'self_hosted',
      documentId: document.id,
      status: document.status,
      signingUrls,
      expiresAt: document.expiresAt,
      message: 'Signing requests sent to all parties',
    });
  } catch (error: any) {
    console.error('[ESIGN-SELF] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const documentId = url.searchParams.get('id');

  if (!documentId) {
    // Return overview
    const allDocs = Array.from(documents.values());
    return Response.json({
      provider: 'self_hosted',
      description: 'Self-Hosted E-Sign - No third-party dependencies',
      compliance: ['ESIGN Act', 'UETA'],
      features: [
        'Cryptographic document hashing',
        'Full audit trail',
        'IP address logging',
        'Email notifications',
        'Signature verification',
      ],
      stats: {
        totalDocuments: allDocs.length,
        pending: allDocs.filter(d => d.status === 'pending').length,
        partiallySigned: allDocs.filter(d => d.status === 'partially_signed').length,
        completed: allDocs.filter(d => d.status === 'completed').length,
      },
    });
  }

  // Get specific document
  let document = documents.get(documentId);

  if (!document) {
    // Try to load from database
    const [dbDoc] = await sql`
      SELECT envelope_data FROM esign_envelopes WHERE id = ${documentId}
    `.catch(() => [null]);

    if (dbDoc?.envelope_data) {
      document = dbDoc.envelope_data as ESignDocument;
      documents.set(documentId, document);
    }
  }

  if (!document) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  return Response.json({
    documentId: document.id,
    title: document.title,
    status: document.status,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    signers: document.signers.map(s => ({
      name: s.name,
      email: s.email,
      role: s.role,
      signed: !!s.signedAt,
      signedAt: s.signedAt,
    })),
    auditTrail: document.auditTrail,
    contentHash: document.contentHash,
  });
}

export async function PUT(req: NextRequest) {
  // Apply signature - this would be called from the signing page
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { documentId, token, signerId, fieldId, value } = body;

  if (!documentId || !token || !signerId || !fieldId) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Verify session
  const session = sessions.get(token);
  if (!session) {
    return Response.json({ error: 'Invalid or expired signing session' }, { status: 401 });
  }

  if (session.documentId !== documentId || session.signerId !== signerId) {
    return Response.json({ error: 'Session mismatch' }, { status: 401 });
  }

  if (new Date(session.expiresAt) < new Date()) {
    return Response.json({ error: 'Signing session expired' }, { status: 401 });
  }

  // Get document
  let document = documents.get(documentId);
  if (!document) {
    const [dbDoc] = await sql`
      SELECT envelope_data FROM esign_envelopes WHERE id = ${documentId}
    `.catch(() => [null]);

    if (dbDoc?.envelope_data) {
      document = dbDoc.envelope_data as ESignDocument;
    }
  }

  if (!document) {
    return Response.json({ error: 'Document not found' }, { status: 404 });
  }

  // Get IP and user agent from request
  const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // Apply signature
  const result = applySignature(document, signerId, fieldId, value, ipAddress, userAgent);

  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  // Update stored document
  documents.set(documentId, result.document);

  // Update database
  await sql`
    UPDATE esign_envelopes
    SET status = ${result.document.status},
        envelope_data = ${JSON.stringify(result.document)},
        updated_at = NOW()
    WHERE id = ${documentId}
  `.catch(console.error);

  // If completed, send notifications
  if (result.document.status === 'completed') {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';
    await sendCompletionNotification(result.document, baseUrl);

    // Update deal status
    const dealId = result.document.metadata?.dealId;
    if (dealId) {
      const newStatus = result.document.metadata?.contractType === 'purchase_agreement' ? 'SIGNED' : 'ASSIGNED';
      await sql`
        UPDATE leads SET status = ${newStatus}, updated_at = NOW()
        WHERE id = ${dealId}
      `.catch(console.error);
    }
  }

  return Response.json({
    success: true,
    status: result.document.status,
    signerCompleted: result.document.signers.find(s => s.id === signerId)?.signedAt ? true : false,
    documentCompleted: result.document.status === 'completed',
  });
}

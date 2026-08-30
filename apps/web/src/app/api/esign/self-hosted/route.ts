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
import { createHash } from 'crypto';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { enqueueJob } from '@/app/api/utils/jobs';
import { alertSellerSigned, alertBuyersMatched } from '@/app/api/alerts/notification-engine';
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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

// Database-backed storage for documents and sessions
// In-memory cache for performance (ephemeral - rehydrates from DB on access)
const documentCache: Map<string, ESignDocument> = new Map();
const sessionCache: Map<string, SigningSession> = new Map();

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

    // Store document in cache for fast access
    documentCache.set(document.id, document);

    // Save to database (primary storage)
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
      sessionCache.set(session.token, session);

      // Persist session to database
      const tokenHash = hashToken(session.token);
      await sql`
        INSERT INTO esign_sessions (token, document_id, signer_id, created_at, expires_at, used)
        VALUES (${tokenHash}, ${session.documentId}, ${session.signerId}, ${session.createdAt}, ${session.expiresAt}, ${session.used})
      `.catch(console.error);

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

  const organization = await getOrganization();
  const url = new URL(req.url);
  const documentId = url.searchParams.get('id');

  if (!documentId) {
    // Return overview from database
    const dbStats = await sql`
      SELECT status, COUNT(*)::int as count FROM esign_envelopes
      WHERE organization_id = ${organization?.id || 'system'}
      GROUP BY status
    `.catch(() => []);

    const stats = {
      totalDocuments: 0,
      pending: 0,
      partiallySigned: 0,
      completed: 0,
    };
    for (const row of dbStats) {
      stats.totalDocuments += row.count;
      if (row.status === 'pending') stats.pending = row.count;
      if (row.status === 'partially_signed') stats.partiallySigned = row.count;
      if (row.status === 'completed') stats.completed = row.count;
    }
    const allDocs = Array.from(documentCache.values());
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
      stats,
    });
  }

  // Get specific document - check cache first, then database
  // SECURITY: Must verify organization ownership to prevent IDOR
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  let document = documentCache.get(documentId);

  if (!document) {
    // Try to load from database - SECURITY: scoped to organization
    const [dbDoc] = await sql`
      SELECT envelope_data FROM esign_envelopes
      WHERE id = ${documentId} AND organization_id = ${organization.id}
    `.catch(() => [null]);

    if (dbDoc?.envelope_data) {
      document = dbDoc.envelope_data as ESignDocument;
      documentCache.set(documentId, document); // Populate cache
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

  // Verify session - check cache first, then database
  let session = sessionCache.get(token);
  if (!session) {
    const tokenHash = hashToken(token);
    const [dbSession] = await sql`
      SELECT token, document_id as "documentId", signer_id as "signerId",
             created_at as "createdAt", expires_at as "expiresAt", used
      FROM esign_sessions WHERE token = ${tokenHash}
    `.catch(() => [null]);
    if (dbSession) {
      session = dbSession as SigningSession;
      sessionCache.set(token, session);
    }
  }
  if (!session) {
    return Response.json({ error: 'Invalid or expired signing session' }, { status: 401 });
  }

  if (session.documentId !== documentId || session.signerId !== signerId) {
    return Response.json({ error: 'Session mismatch' }, { status: 401 });
  }

  if (new Date(session.expiresAt) < new Date()) {
    return Response.json({ error: 'Signing session expired' }, { status: 401 });
  }

  // Get document - check cache first, then database
  let document = documentCache.get(documentId);
  if (!document) {
    const [dbDoc] = await sql`
      SELECT envelope_data FROM esign_envelopes WHERE id = ${documentId}
    `.catch(() => [null]);

    if (dbDoc?.envelope_data) {
      document = dbDoc.envelope_data as ESignDocument;
      documentCache.set(documentId, document);
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

  // Update stored document in cache
  documentCache.set(documentId, result.document);

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

    // Update deal status and trigger buyer matching for purchase agreements
    const dealId = result.document.metadata?.dealId;
    const contractType = result.document.metadata?.contractType;
    const organizationId = result.document.metadata?.organizationId;

    if (dealId) {
      const newStatus = contractType === 'purchase_agreement' ? 'SIGNED' : 'ASSIGNED';
      await sql`
        UPDATE leads SET status = ${newStatus}, updated_at = NOW()
        WHERE id = ${dealId}
      `.catch(console.error);

      // AUTO-TRIGGER: When seller signs purchase agreement, automatically match and notify buyers
      if (contractType === 'purchase_agreement' && organizationId) {
        const contractData = result.document.metadata?.contractData || {};
        const sellerSigner = result.document.signers.find(s => s.role === 'seller');

        // Alert owner about seller signing
        await alertSellerSigned(
          String(dealId),
          sellerSigner?.name || 'Seller',
          contractData.propertyAddress || 'Property',
          contractData.purchasePrice || 0
        ).catch(console.error);

        // Queue automatic buyer matching job
        await enqueueJob('match_buyers_auto', {
          dealId: String(dealId),
          organizationId,
          propertyAddress: contractData.propertyAddress,
          purchasePrice: contractData.purchasePrice,
          notifyBuyers: true,
        }, {
          maxAttempts: 3,
          dedupeKey: `buyer_match_${dealId}`,
        }).catch(console.error);

        console.log(`[ESIGN] Purchase agreement signed for deal ${dealId} - buyer matching queued`);
      }
    }
  }

  return Response.json({
    success: true,
    status: result.document.status,
    signerCompleted: result.document.signers.find(s => s.id === signerId)?.signedAt ? true : false,
    documentCompleted: result.document.status === 'completed',
  });
}

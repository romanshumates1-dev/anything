/**
 * Phase P1 — E-Sign provider driver interface.
 *
 * Same pattern as smsMode.ts / voice-gateway.ts:
 *   mock        — generates a signing link + dev "simulate sign" button that
 *                 fires the SAME webhook path production would.
 *   documenso   — real Documenso API (stub with `// LIVE:` markers).
 *   docusign    — real DocuSign API (stub with `// LIVE:` markers).
 *
 * The mock driver is the default and passes all gates without live creds.
 * Live providers are OWNER-GATED and require API keys.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EsignProviderType = 'mock' | 'documenso' | 'docusign';

export interface EsignProviderConfig {
  type: EsignProviderType;
  apiKey?: string;
  apiUrl?: string;
  webhookUrl?: string;
}

export interface CreateSigningLinkParams {
  contractId: string;
  organizationId: string;
  signerName: string;
  signerEmail: string;
  documentTitle: string;
  documentContent: string; // The filled contract body
}

export interface SigningLinkResult {
  signingLink: string;
  envelopeId: string;
  expiresAt: Date;
}

export interface VerifyWebhookParams {
  body: string;
  signature: string;
  provider: EsignProviderType;
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface EsignProvider {
  readonly type: EsignProviderType;
  createSigningLink(params: CreateSigningLinkParams): Promise<SigningLinkResult>;
  verifyWebhook(params: VerifyWebhookParams): boolean;
}

// ─── Mock Provider ───────────────────────────────────────────────────────────

export class MockEsignProvider implements EsignProvider {
  readonly type: EsignProviderType = 'mock';

  async createSigningLink(params: CreateSigningLinkParams): Promise<SigningLinkResult> {
    const envelopeId = `mock_env_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000); // 21 days

    // Generate a mock signing link. In dev, this includes a "simulate sign"
    // button that fires the same webhook path production would.
    const baseUrl = process.env.PUBLIC_WEBHOOK_URL || `http://localhost:4000`;
    const signingLink = `${baseUrl}/api/esign/mock-sign?envelopeId=${envelopeId}&contractId=${params.contractId}`;

    await logEvent('esign_link_created', 'contract', params.contractId, {
      provider: 'mock',
      envelopeId,
      signerName: params.signerName,
      expiresAt: expiresAt.toISOString(),
    }, params.organizationId);

    return { signingLink, envelopeId, expiresAt };
  }

  verifyWebhook(_params: VerifyWebhookParams): boolean {
    // Mock provider accepts any signature in dev
    return true;
  }
}

// ─── Documenso Stub ──────────────────────────────────────────────────────────

export class DocumensoProvider implements EsignProvider {
  readonly type: EsignProviderType = 'documenso';

  async createSigningLink(params: CreateSigningLinkParams): Promise<SigningLinkResult> {
    // LIVE: Replace with real Documenso API call
    // const response = await fetch(`${this.apiUrl}/api/signatures`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ document: params.documentContent, signers: [{ name: params.signerName, email: params.signerEmail }] })
    // });
    // const data = await response.json();
    // return { signingLink: data.signing_url, envelopeId: data.id, expiresAt: new Date(data.expires_at) };

    const envelopeId = `doc_env_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

    await logEvent('esign_link_created', 'contract', params.contractId, {
      provider: 'documenso',
      envelopeId,
      signerName: params.signerName,
      note: 'LIVE: Replace with real Documenso API call',
    }, params.organizationId);

    return { signingLink: `https://app.documenso.com/sign/${envelopeId}`, envelopeId, expiresAt };
  }

  verifyWebhook(params: VerifyWebhookParams): boolean {
    // LIVE: Verify Documenso webhook signature
    // const expectedSig = crypto.createHmac('sha256', this.apiKey).update(params.body).digest('hex');
    // return timingSafeEqual(params.signature, expectedSig);
    return params.signature === 'documenso-valid';
  }
}

// ─── DocuSign Stub ───────────────────────────────────────────────────────────

export class DocusignStub implements EsignProvider {
  readonly type: EsignProviderType = 'docusign';

  async createSigningLink(params: CreateSigningLinkParams): Promise<SigningLinkResult> {
    // LIVE: Replace with real DocuSign eSignature API call
    // const response = await fetch('https://demo.docusign.net/restapi/v2.1/accounts/{accountId}/envelopes', {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     emailSubject: params.documentTitle,
    //     documents: [{ documentBase64: Buffer.from(params.documentContent).toString('base64'), name: 'Contract', fileExtension: 'html', documentId: '1' }],
    //     recipients: { signers: [{ name: params.signerName, email: params.signerEmail, routingOrder: '1' }] },
    //     status: 'sent'
    //   })
    // });
    // const data = await response.json();
    // return { signingLink: data.senderViewUrl, envelopeId: data.envelopeId, expiresAt: new Date() };

    const envelopeId = `ds_env_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

    await logEvent('esign_link_created', 'contract', params.contractId, {
      provider: 'docusign',
      envelopeId,
      signerName: params.signerName,
      note: 'LIVE: Replace with real DocuSign API call',
    }, params.organizationId);

    return { signingLink: `https://demo.docusign.net/sign/${envelopeId}`, envelopeId, expiresAt };
  }

  verifyWebhook(params: VerifyWebhookParams): boolean {
    // LIVE: Verify DocuSign Connect webhook signature (HMAC-SHA256)
    // const expectedSig = crypto.createHmac('sha256', this.apiKey).update(params.body).digest('base64');
    // return timingSafeEqual(params.signature, expectedSig);
    return params.signature === 'docusign-valid';
  }
}

// ─── Provider Resolution ─────────────────────────────────────────────────────

let _provider: EsignProvider | null = null;

export function getEsignProvider(config?: EsignProviderConfig): EsignProvider {
  if (_provider) return _provider;

  const type: EsignProviderType = (config?.type || process.env.ESIGN_PROVIDER || 'mock') as EsignProviderType;

  switch (type) {
    case 'documenso':
      _provider = new DocumensoProvider();
      break;
    case 'docusign':
      _provider = new DocusignStub();
      break;
    case 'mock':
    default:
      _provider = new MockEsignProvider();
      break;
  }

  return _provider;
}

/** Reset the cached provider (for tests). */
export function resetEsignProvider(): void {
  _provider = null;
}
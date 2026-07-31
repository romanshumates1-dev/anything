/**
 * Phase P1 — E-Sign provider tests.
 *
 * Tests the mock provider's full cycle: create signing link, verify webhook,
 * and the stub providers' contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { MockEsignProvider, DocumensoProvider, DocusignStub, resetEsignProvider, getEsignProvider } from './esignProvider';

describe('MockEsignProvider', () => {
  let provider: MockEsignProvider;

  beforeEach(() => {
    provider = new MockEsignProvider();
  });

  it('creates a signing link with mock envelope ID', async () => {
    const result = await provider.createSigningLink({
      contractId: 'contract-1',
      organizationId: 'org-1',
      signerName: 'John Buyer',
      signerEmail: 'john@example.com',
      documentTitle: 'Assignment Contract',
      documentContent: '<html><body>Contract terms...</body></html>',
    });

    expect(result.signingLink).toContain('/api/esign/mock-sign');
    expect(result.signingLink).toContain('envelopeId=mock_env_');
    expect(result.signingLink).toContain('contractId=contract-1');
    expect(result.envelopeId).toMatch(/^mock_env_/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verifyWebhook always returns true for mock', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'any', provider: 'mock' })).toBe(true);
    expect(provider.verifyWebhook({ body: '{}', signature: '', provider: 'mock' })).toBe(true);
    expect(provider.verifyWebhook({ body: 'tampered', signature: 'invalid', provider: 'mock' })).toBe(true);
  });
});

describe('DocumensoProvider', () => {
  let provider: DocumensoProvider;
  const SECRET = 'documenso-test-secret';

  beforeEach(() => {
    provider = new DocumensoProvider();
    process.env.DOCUMENSO_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.DOCUMENSO_WEBHOOK_SECRET;
  });

  it('creates a signing link with documenso envelope ID', async () => {
    const result = await provider.createSigningLink({
      contractId: 'contract-2',
      organizationId: 'org-1',
      signerName: 'Jane Seller',
      signerEmail: 'jane@example.com',
      documentTitle: 'Purchase Agreement',
      documentContent: 'Contract body',
    });

    expect(result.signingLink).toContain('app.documenso.com/sign/');
    expect(result.envelopeId).toMatch(/^doc_env_/);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('verifyWebhook accepts valid signature', () => {
    const body = '{}';
    const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(provider.verifyWebhook({ body, signature, provider: 'documenso' })).toBe(true);
  });

  it('verifyWebhook rejects invalid signature', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'invalid', provider: 'documenso' })).toBe(false);
    expect(provider.verifyWebhook({ body: '{}', signature: '', provider: 'documenso' })).toBe(false);
  });
});

describe('DocusignStub', () => {
  let provider: DocusignStub;
  const SECRET = 'docusign-test-secret';

  beforeEach(() => {
    provider = new DocusignStub();
    process.env.DOCUSIGN_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.DOCUSIGN_WEBHOOK_SECRET;
  });

  it('creates a signing link with docusign envelope ID', async () => {
    const result = await provider.createSigningLink({
      contractId: 'contract-3',
      organizationId: 'org-1',
      signerName: 'Bob Agent',
      signerEmail: 'bob@example.com',
      documentTitle: 'Disclosure',
      documentContent: 'Disclosure text',
    });

    expect(result.signingLink).toContain('demo.docusign.net/sign/');
    expect(result.envelopeId).toMatch(/^ds_env_/);
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('verifyWebhook accepts valid signature', () => {
    const body = '{}';
    const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
    expect(provider.verifyWebhook({ body, signature, provider: 'docusign' })).toBe(true);
  });

  it('verifyWebhook rejects invalid signature', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'invalid', provider: 'docusign' })).toBe(false);
  });
});

describe('getEsignProvider', () => {
  beforeEach(() => {
    resetEsignProvider();
  });

  it('returns MockEsignProvider by default', () => {
    const provider = getEsignProvider();
    expect(provider.type).toBe('mock');
    expect(provider).toBeInstanceOf(MockEsignProvider);
  });

  it('returns DocumensoProvider when configured', () => {
    const provider = getEsignProvider({ type: 'documenso' });
    expect(provider.type).toBe('documenso');
    expect(provider).toBeInstanceOf(DocumensoProvider);
  });

  it('returns DocusignStub when configured', () => {
    const provider = getEsignProvider({ type: 'docusign' });
    expect(provider.type).toBe('docusign');
    expect(provider).toBeInstanceOf(DocusignStub);
  });

  it('caches the provider instance', () => {
    const p1 = getEsignProvider({ type: 'mock' });
    const p2 = getEsignProvider({ type: 'docusign' }); // should still return mock
    expect(p1).toBe(p2);
    expect(p1.type).toBe('mock');
  });
});
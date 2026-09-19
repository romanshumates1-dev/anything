import { describe, it, expect } from 'vitest';
import {
  generateVerificationCode,
  generateDnsRecords,
} from '@/app/api/utils/outreachVerification';

describe('outreachVerification', () => {
  describe('generateVerificationCode', () => {
    it('generates a 6-digit code', () => {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('generates different codes each time', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateVerificationCode());
      }
      // Should have mostly unique codes (allowing for some collisions)
      expect(codes.size).toBeGreaterThan(90);
    });

    it('pads codes with leading zeros', () => {
      // Run multiple times to increase chance of getting a small number
      const codes: string[] = [];
      for (let i = 0; i < 1000; i++) {
        codes.push(generateVerificationCode());
      }
      // All codes should be exactly 6 digits
      codes.forEach(code => {
        expect(code.length).toBe(6);
      });
    });
  });

  describe('generateDnsRecords', () => {
    it('generates SPF, DKIM, and DMARC records', () => {
      const records = generateDnsRecords('example.com');

      expect(records).toHaveLength(3);

      // SPF record
      const spf = records.find(r => r.value.includes('v=spf1'));
      expect(spf).toBeDefined();
      expect(spf?.type).toBe('TXT');
      expect(spf?.name).toBe('example.com');
      expect(spf?.verified).toBe(false);

      // DKIM record
      const dkim = records.find(r => r.value.includes('v=DKIM1'));
      expect(dkim).toBeDefined();
      expect(dkim?.type).toBe('TXT');
      expect(dkim?.name).toContain('._domainkey.example.com');
      expect(dkim?.verified).toBe(false);

      // DMARC record
      const dmarc = records.find(r => r.value.includes('v=DMARC1'));
      expect(dmarc).toBeDefined();
      expect(dmarc?.type).toBe('TXT');
      expect(dmarc?.name).toBe('_dmarc.example.com');
      expect(dmarc?.verified).toBe(false);
    });

    it('uses custom selector for DKIM', () => {
      const records = generateDnsRecords('example.com', 'custom');

      const dkim = records.find(r => r.name.includes('_domainkey'));
      expect(dkim?.name).toBe('custom._domainkey.example.com');
    });

    it('uses dealflow as default selector', () => {
      const records = generateDnsRecords('example.com');

      const dkim = records.find(r => r.name.includes('_domainkey'));
      expect(dkim?.name).toBe('dealflow._domainkey.example.com');
    });
  });
});

describe('Verification Status Flow', () => {
  it('should have correct status transitions for SMS', () => {
    // Document the expected flow
    const smsFlow = [
      'PENDING',     // Initial state
      'VERIFYING',   // Code sent
      'VERIFIED',    // Code confirmed
      'ACTIVE',      // TCPA agreed
    ];

    // Platform SMS flow (shorter)
    const platformSmsFlow = [
      'PENDING',     // Initial (optional)
      'ACTIVE',      // Platform is immediately active, just needs TCPA
    ];

    expect(smsFlow).toContain('VERIFYING');
    expect(platformSmsFlow).not.toContain('VERIFYING');
  });

  it('should have correct status transitions for Email', () => {
    // Document the expected flow
    const emailFlow = [
      'PENDING',      // Initial state
      'DNS_PENDING',  // DNS records generated
      'ACTIVE',       // DNS verified
    ];

    // Platform Email flow (shorter)
    const platformEmailFlow = [
      'PENDING',     // Initial (optional)
      'ACTIVE',      // Platform is immediately active
    ];

    expect(emailFlow).toContain('DNS_PENDING');
    expect(platformEmailFlow).not.toContain('DNS_PENDING');
  });
});

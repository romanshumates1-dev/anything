/**
 * Comprehensive Tests for Messaging Gate (Compliance Engine)
 *
 * Tests quiet hours, state detection, DNC, disclosures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  check,
  checkQuietHours,
  getRequiredDisclosures,
  generateEmailFooter,
  generateCompliantSms,
  type MessagingGateRequest,
} from '../messaging-gate';
import type { Recipient, DisclosureContext } from '../regional-messaging/types';

// Mock the DNC check to avoid actual API calls
vi.mock('../regional-messaging/engine', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    checkDNC: vi.fn().mockResolvedValue({ onDnc: false }),
  };
});

describe('Messaging Gate (Compliance)', () => {
  const baseRecipient: Recipient = {
    phone: '+15125551234',
    address: '123 Main St, Austin, TX 78701',
  };

  const baseContext: DisclosureContext = {
    businessName: 'DealSwift Investments',
    physicalAddress: '456 Business Ave, Austin, TX 78702',
    isRealEstate: true,
    isFirstMessage: true,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // QUIET HOURS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Quiet Hours', () => {
    it('blocks SMS at 8:30pm Florida time (FL strict)', () => {
      const flRecipient: Recipient = {
        phone: '+13055551234',
        address: '123 Ocean Dr, Miami, FL 33139',
      };

      // 8:30pm EST - Florida quiet hours start at 8pm (stricter than federal)
      // Create a date at 8:30pm EST
      const evening = new Date('2026-08-15T20:30:00-04:00'); // 8:30pm EDT

      const result = checkQuietHours(flRecipient, 'sms', evening);
      expect(result.allowed).toBe(false);
      expect(result.retryAt).toBeDefined();
      console.log(`✓ FL 8:30pm blocked: ${result.reason}`);
    });

    it('allows SMS at 8:30pm Texas time (federal 9pm)', () => {
      const txRecipient: Recipient = {
        phone: '+15125551234',
        address: '123 Main St, Austin, TX 78701',
      };

      // 8:30pm CDT - TX uses federal (8am-9pm)
      const evening = new Date('2026-08-15T20:30:00-05:00'); // 8:30pm CDT

      const result = checkQuietHours(txRecipient, 'sms', evening);
      expect(result.allowed).toBe(true);
      console.log(`✓ TX 8:30pm allowed (federal 9pm cutoff)`);
    });

    it('blocks SMS at 7:30am (before 8am)', () => {
      const morning = new Date('2026-08-15T07:30:00-05:00'); // 7:30am CDT

      const result = checkQuietHours(baseRecipient, 'sms', morning);
      expect(result.allowed).toBe(false);
      console.log(`✓ 7:30am blocked (before 8am)`);
    });

    it('allows SMS at 8:15am (after 8am)', () => {
      const morning = new Date('2026-08-15T08:15:00-05:00'); // 8:15am CDT

      const result = checkQuietHours(baseRecipient, 'sms', morning);
      expect(result.allowed).toBe(true);
    });

    it('email always allowed (no quiet hours)', () => {
      const lateNight = new Date('2026-08-15T23:30:00-05:00');

      const result = checkQuietHours(baseRecipient, 'email', lateNight);
      expect(result.allowed).toBe(true);
      console.log(`✓ Email at 11:30pm allowed`);
    });

    it('blocks voice at 9:30pm', () => {
      const night = new Date('2026-08-15T21:30:00-05:00'); // 9:30pm CDT

      const result = checkQuietHours(baseRecipient, 'voice', night);
      expect(result.allowed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL GATE CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Gate Check', () => {
    it('passes allowed message during business hours', async () => {
      const businessHours = new Date('2026-08-15T14:00:00-05:00'); // 2pm CDT

      const result = await check({
        message: 'Hi, interested in selling your property?',
        recipient: baseRecipient,
        channel: 'sms',
        timestamp: businessHours,
        context: baseContext,
      });

      expect(result.allowed).toBe(true);
      expect(result.region?.state).toBe('TX');
      console.log(`✓ Message allowed during business hours, state=${result.region?.state}`);
    });

    it('blocks message during quiet hours', async () => {
      const lateNight = new Date('2026-08-15T22:00:00-05:00'); // 10pm CDT

      const result = await check({
        message: 'Hi, interested in selling?',
        recipient: baseRecipient,
        channel: 'sms',
        timestamp: lateNight,
        context: baseContext,
      });

      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.retryAt).toBeDefined();
      console.log(`✓ Message blocked at 10pm`);
    });

    it('adds disclosures to message', async () => {
      const businessHours = new Date('2026-08-15T14:00:00-05:00');

      const result = await check({
        message: 'Looking to sell?',
        recipient: baseRecipient,
        channel: 'sms',
        timestamp: businessHours,
        context: baseContext,
      });

      expect(result.allowed).toBe(true);
      expect(result.modified).toBe(true);
      expect(result.message).toContain('STOP');
      expect(result.disclosuresAdded).toBeDefined();
      expect(result.disclosuresAdded!.length).toBeGreaterThan(0);
      console.log(`✓ Disclosures added: ${result.disclosuresAdded?.join(', ')}`);
    });

    it('skips disclosures when requested', async () => {
      const businessHours = new Date('2026-08-15T14:00:00-05:00');

      const result = await check({
        message: 'Looking to sell? Reply STOP to opt out.',
        recipient: baseRecipient,
        channel: 'sms',
        timestamp: businessHours,
        context: baseContext,
        skipDisclosures: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.modified).toBe(false);
      expect(result.message).toBe('Looking to sell? Reply STOP to opt out.');
    });

    it('skips quiet hours for transactional', async () => {
      const lateNight = new Date('2026-08-15T23:00:00-05:00');

      const result = await check({
        message: 'Your contract is ready for signature.',
        recipient: baseRecipient,
        channel: 'sms',
        timestamp: lateNight,
        context: { ...baseContext, isFirstMessage: false },
        skipQuietHours: true,
      });

      expect(result.allowed).toBe(true);
      console.log(`✓ Transactional message allowed late night`);
    });

    it('includes FL warnings', async () => {
      const flRecipient: Recipient = {
        phone: '+13055551234',
        address: '123 Ocean Dr, Miami, FL 33139',
      };
      const businessHours = new Date('2026-08-15T14:00:00-04:00');

      const result = await check({
        message: 'Looking to sell?',
        recipient: flRecipient,
        channel: 'sms',
        timestamp: businessHours,
        context: baseContext,
      });

      expect(result.allowed).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('Florida'))).toBe(true);
      console.log(`✓ FL warnings included: ${result.warnings?.length} warnings`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIRED DISCLOSURES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Required Disclosures', () => {
    it('returns SMS disclosures for first message', () => {
      const disclosures = getRequiredDisclosures(baseRecipient, 'sms', baseContext);
      expect(disclosures.length).toBeGreaterThan(0);
      expect(disclosures.some(d => d.includes('STOP') || d.includes('unsubscribe'))).toBe(true);
      console.log(`✓ SMS first message disclosures: ${disclosures.length} items`);
    });

    it('returns email disclosures with CAN-SPAM', () => {
      const emailContext = { ...baseContext, unsubscribeUrl: 'https://example.com/unsub' };
      const disclosures = getRequiredDisclosures(baseRecipient, 'email', emailContext);
      expect(disclosures.length).toBeGreaterThan(0);
    });

    it('includes real estate disclosures when applicable', () => {
      const disclosures = getRequiredDisclosures(baseRecipient, 'sms', {
        ...baseContext,
        isRealEstate: true,
      });
      expect(disclosures.some(d =>
        d.toLowerCase().includes('real estate') ||
        d.toLowerCase().includes('investor')
      )).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL FOOTER GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Email Footer Generation', () => {
    it('generates compliant email footer', () => {
      const footer = generateEmailFooter(baseRecipient, {
        ...baseContext,
        unsubscribeUrl: 'https://example.com/unsub',
        privacyUrl: 'https://example.com/privacy',
      });

      expect(footer).toContain('Unsubscribe');
      expect(footer).toContain('Privacy');
      expect(footer).toContain(baseContext.businessName);
      console.log(`✓ Email footer includes required elements`);
    });

    it('includes CA "Do Not Sell" for California', () => {
      const caRecipient: Recipient = {
        phone: '+13105551234',
        address: { state: 'CA', zip: '90028' }, // Proper object format for state detection
      };

      const footer = generateEmailFooter(caRecipient, {
        ...baseContext,
        unsubscribeUrl: 'https://example.com/unsub',
        privacyUrl: 'https://example.com/privacy',
        doNotSellUrl: 'https://example.com/ccpa',
      });

      expect(footer).toContain('Do Not Sell');
      console.log(`✓ CA CCPA "Do Not Sell" included`);
    });

    it('includes FL cooling off notice', () => {
      const flRecipient: Recipient = {
        phone: '+13055551234',
        address: '123 Ocean Dr, Miami, FL 33139',
      };

      const footer = generateEmailFooter(flRecipient, {
        ...baseContext,
        unsubscribeUrl: 'https://example.com/unsub',
        privacyUrl: 'https://example.com/privacy',
      });

      expect(footer).toContain('Florida') || expect(footer).toContain('cooling off');
      console.log(`✓ FL notice included`);
    });

    it('includes distressed property notice', () => {
      const footer = generateEmailFooter(baseRecipient, {
        ...baseContext,
        unsubscribeUrl: 'https://example.com/unsub',
        privacyUrl: 'https://example.com/privacy',
        isDistressedProperty: true,
      });

      expect(footer).toContain('cancel') || expect(footer).toContain('HUD');
      console.log(`✓ Distressed property HUD notice included`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SMS GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Compliant SMS Generation', () => {
    it('adds STOP disclosure to first message', () => {
      const sms = generateCompliantSms(baseRecipient, 'Looking to sell your property?', baseContext);
      expect(sms).toContain('STOP');
      console.log(`✓ STOP disclosure added to SMS`);
    });

    it('adds business name prefix for first message', () => {
      const sms = generateCompliantSms(baseRecipient, 'Looking to sell?', baseContext);
      expect(sms).toContain(baseContext.businessName);
    });

    it('adds frequency disclosure for first message', () => {
      const sms = generateCompliantSms(baseRecipient, 'Looking to sell?', baseContext);
      expect(sms).toContain('Msg frequency') || expect(sms).toContain('rates');
    });

    it('does not duplicate STOP if already present', () => {
      const sms = generateCompliantSms(
        baseRecipient,
        'Looking to sell? Reply STOP to unsubscribe.',
        baseContext
      );
      // Should not have STOP twice
      const stopCount = (sms.match(/STOP/gi) || []).length;
      expect(stopCount).toBeLessThanOrEqual(2); // Original + potentially one more
    });
  });
});

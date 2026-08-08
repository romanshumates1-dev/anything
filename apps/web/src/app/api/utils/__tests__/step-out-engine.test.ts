/**
 * Tests for Profit-Ready Step-Out Engine
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeStepOut,
  profitWindow,
  generateCancellationNotice,
  generateStepOutConfirmationEmail,
  generateSellerCancellationConfirmedEmail,
  generateBuyerNotificationOfSellerCancellation,
  generateSellerNotificationOfBuyerCancellation,
  generateDealEndedEmail,
  type StepOutContext,
  type StepOutReason,
  type StepOutConfirmationContext,
} from '../step-out-engine';
import { FEE_FLOOR_CENTS } from '../negotiationEngine';
import { DEFAULT_FEE_FLOOR } from '../valuationEngine';

function makeContext(overrides: Partial<StepOutContext> = {}): StepOutContext {
  const now = new Date('2026-08-05T10:00:00Z');
  const contractCreated = new Date('2026-08-01T10:00:00Z'); // 4 days ago

  return {
    contractId: 'test-contract-123',
    organizationId: 'test-org-456',
    sellerName: 'John Smith',
    sellerEmail: 'john@example.com',
    propertyAddress: '123 Main St, Dallas, TX 75001',
    contractPriceCents: 20_000_000, // $200,000
    inspectionDays: 14,
    contractCreatedAt: contractCreated,
    reason: 'no_buyer_interest',
    now,
    ...overrides,
  };
}

describe('Step-Out Engine', () => {
  describe('analyzeStepOut', () => {
    it('identifies early timing on day 1-3', () => {
      const now = new Date('2026-08-03T10:00:00Z'); // Day 3
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({ now, contractCreatedAt: contractCreated });

      const decision = analyzeStepOut(ctx);
      expect(decision.timing).toBe('early');
      expect(decision.clockState.day).toBeLessThanOrEqual(3);
    });

    it('identifies final timing with 2 days remaining', () => {
      const now = new Date('2026-08-13T10:00:00Z'); // Day 13 of 14
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({ now, contractCreatedAt: contractCreated });

      const decision = analyzeStepOut(ctx);
      expect(decision.timing).toBe('final');
      expect(decision.clockState.daysRemaining).toBeLessThanOrEqual(2);
    });

    it('identifies expired timing past inspection period', () => {
      const now = new Date('2026-08-20T10:00:00Z'); // Day 20 of 14
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({ now, contractCreatedAt: contractCreated });

      const decision = analyzeStepOut(ctx);
      expect(decision.timing).toBe('expired');
      expect(decision.clockState.stage).toBe('expired');
    });

    it('calculates lowest viable ask correctly', () => {
      const ctx = makeContext({ contractPriceCents: 20_000_000 }); // $200k
      const decision = analyzeStepOut(ctx);

      // Lowest viable ask = contract price + DEFAULT_FEE_FLOOR ($3k from valuationEngine)
      // Note: step-out uses valuationEngine's $3k floor, negotiationEngine has $5k floor
      const expectedAsk = 20_000_000 + Math.round(DEFAULT_FEE_FLOOR * 100);
      expect(decision.lowestViableAskCents).toBe(expectedAsk);
      expect(decision.lowestViableAskCents).toBe(20_300_000); // $203k
    });

    it('recommends not stepping out early for no_buyer_interest', () => {
      const now = new Date('2026-08-02T10:00:00Z'); // Day 2
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({
        now,
        contractCreatedAt: contractCreated,
        reason: 'no_buyer_interest',
      });

      const decision = analyzeStepOut(ctx);
      expect(decision.shouldStepOut).toBe(false);
      expect(decision.recommendation).toContain('Consider');
    });

    it('recommends stepping out for title issues', () => {
      const ctx = makeContext({ reason: 'title_issues' });
      const decision = analyzeStepOut(ctx);

      expect(decision.shouldStepOut).toBe(true);
      expect(decision.recommendation).toContain('material');
    });

    it('recommends stepping out for inspection findings', () => {
      const ctx = makeContext({ reason: 'inspection_findings' });
      const decision = analyzeStepOut(ctx);

      expect(decision.shouldStepOut).toBe(true);
    });

    it('always steps out when expired', () => {
      const now = new Date('2026-08-20T10:00:00Z');
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({
        now,
        contractCreatedAt: contractCreated,
        reason: 'no_buyer_interest',
      });

      const decision = analyzeStepOut(ctx);
      expect(decision.shouldStepOut).toBe(true);
      expect(decision.timing).toBe('expired');
    });
  });

  describe('email generation', () => {
    const reasons: StepOutReason[] = [
      'no_buyer_interest',
      'buyer_dropped',
      'economics_changed',
      'inspection_findings',
      'title_issues',
      'seller_uncooperative',
      'financing_fell_through',
      'better_opportunity',
    ];

    for (const reason of reasons) {
      it(`generates email for reason: ${reason}`, () => {
        const ctx = makeContext({ reason });
        const decision = analyzeStepOut(ctx);

        expect(decision.email.subject).toBeTruthy();
        expect(decision.email.subject.length).toBeGreaterThan(10);
        expect(decision.email.bodyHtml).toContain(ctx.sellerName);
        expect(decision.email.bodyText).toContain(ctx.sellerName);
        expect(decision.email.bodyHtml).toContain(ctx.propertyAddress);
      });
    }

    it('uses high priority for final timing', () => {
      const now = new Date('2026-08-13T10:00:00Z'); // Final days
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({ now, contractCreatedAt: contractCreated });

      const decision = analyzeStepOut(ctx);
      expect(decision.email.priority).toBe('high');
    });

    it('uses normal priority for early timing', () => {
      const now = new Date('2026-08-02T10:00:00Z'); // Day 2
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({ now, contractCreatedAt: contractCreated });

      const decision = analyzeStepOut(ctx);
      expect(decision.email.priority).toBe('normal');
    });

    it('includes buyer name when provided', () => {
      const ctx = makeContext({
        reason: 'buyer_dropped',
        buyerName: 'Jane Investor',
      });
      const decision = analyzeStepOut(ctx);

      expect(decision.email.bodyHtml).toContain('investor');
    });

    it('includes issue detail when provided', () => {
      const ctx = makeContext({
        reason: 'inspection_findings',
        issueDetail: 'Foundation cracks requiring $30,000 in repairs',
      });
      const decision = analyzeStepOut(ctx);

      expect(decision.email.bodyHtml).toContain('Foundation cracks');
    });
  });

  describe('profitWindow', () => {
    it('calculates days to profit correctly', () => {
      const now = new Date('2026-08-05T10:00:00Z');
      const contractCreated = new Date('2026-08-01T10:00:00Z');

      const result = profitWindow(
        20_000_000, // $200k contract
        1_000_000, // $10k target fee
        14,
        contractCreated,
        now
      );

      expect(result.daysToProfit).toBeLessThanOrEqual(14);
      expect(result.daysToProfit).toBeGreaterThan(0);
    });

    it('calculates minimum buyer price correctly', () => {
      const result = profitWindow(
        20_000_000, // $200k contract
        1_000_000, // $10k target fee
        14,
        new Date(),
        new Date()
      );

      // Min buyer price = contract + $5k floor
      expect(result.minBuyerPriceCents).toBe(20_000_000 + FEE_FLOOR_CENTS);
    });

    it('identifies profitable deals', () => {
      const result = profitWindow(
        20_000_000,
        1_000_000, // $10k fee > $5k floor
        14,
        new Date(),
        new Date()
      );

      expect(result.profitable).toBe(true);
    });

    it('identifies unprofitable deals', () => {
      const result = profitWindow(
        20_000_000,
        300_000, // $3k fee < $5k floor
        14,
        new Date(),
        new Date()
      );

      expect(result.profitable).toBe(false);
    });
  });

  describe('generateCancellationNotice', () => {
    it('generates formal notice', () => {
      const ctx = makeContext();
      const notice = generateCancellationNotice(ctx);

      expect(notice).toContain('NOTICE OF CONTRACT TERMINATION');
      expect(notice).toContain(ctx.sellerName);
      expect(notice).toContain(ctx.propertyAddress);
      expect(notice).toContain('inspection contingency');
    });

    it('includes property address', () => {
      const ctx = makeContext({ propertyAddress: '456 Oak Ave, Austin, TX 78701' });
      const notice = generateCancellationNotice(ctx);

      expect(notice).toContain('456 Oak Ave, Austin, TX 78701');
    });
  });

  describe('canRenegotiate flag', () => {
    it('allows renegotiation when economics work', () => {
      const ctx = makeContext({
        contractPriceCents: 20_000_000, // Reasonable price
        reason: 'no_buyer_interest',
      });
      const decision = analyzeStepOut(ctx);

      expect(decision.canRenegotiate).toBe(true);
    });

    it('disallows renegotiation when expired', () => {
      const now = new Date('2026-08-20T10:00:00Z');
      const contractCreated = new Date('2026-08-01T10:00:00Z');
      const ctx = makeContext({
        now,
        contractCreatedAt: contractCreated,
        reason: 'no_buyer_interest',
      });

      const decision = analyzeStepOut(ctx);
      expect(decision.canRenegotiate).toBe(false);
    });
  });

  describe('email professionalism', () => {
    it('never blames the seller', () => {
      const reasons: StepOutReason[] = [
        'no_buyer_interest',
        'buyer_dropped',
        'economics_changed',
      ];

      for (const reason of reasons) {
        const ctx = makeContext({ reason });
        const decision = analyzeStepOut(ctx);

        const body = decision.email.bodyText.toLowerCase();
        expect(body).not.toContain('your fault');
        expect(body).not.toContain('you failed');
        expect(body).not.toContain('you didn\'t');
      }
    });

    it('maintains professional tone', () => {
      const ctx = makeContext({ reason: 'seller_uncooperative' });
      const decision = analyzeStepOut(ctx);

      expect(decision.email.bodyHtml).toContain('Dear');
      expect(decision.email.bodyHtml).toContain('Best regards');
    });

    it('always includes property address for clarity', () => {
      const reasons: StepOutReason[] = [
        'no_buyer_interest',
        'buyer_dropped',
        'inspection_findings',
      ];

      for (const reason of reasons) {
        const ctx = makeContext({ reason });
        const decision = analyzeStepOut(ctx);

        expect(decision.email.bodyHtml).toContain(ctx.propertyAddress);
      }
    });
  });

  describe('buyer/seller step-out confirmation flow', () => {
    const confirmationCtx: StepOutConfirmationContext = {
      organizationId: 'org-123',
      contractId: 'contract-456',
      party: 'seller',
      partyName: 'John Smith',
      partyEmail: 'john@example.com',
      propertyAddress: '123 Main St, Dallas, TX 75001',
      inspectionDaysRemaining: 5,
      confirmationToken: 'abc123token',
    };

    it('generates step-out confirmation email with confirm link', () => {
      const email = generateStepOutConfirmationEmail(confirmationCtx);

      expect(email.subject).toContain('Confirm Cancellation');
      expect(email.bodyHtml).toContain(confirmationCtx.partyName);
      expect(email.bodyHtml).toContain(confirmationCtx.propertyAddress);
      expect(email.bodyHtml).toContain(confirmationCtx.confirmationToken);
      expect(email.bodyHtml).toContain('cannot be undone');
      expect(email.priority).toBe('high');
    });

    it('generates seller cancellation confirmed email', () => {
      const email = generateSellerCancellationConfirmedEmail({
        sellerName: 'John Smith',
        propertyAddress: '123 Main St',
      });

      expect(email.subject).toContain('Terminated');
      expect(email.bodyHtml).toContain('John Smith');
      expect(email.bodyHtml).toContain('free to');
      expect(email.bodyHtml).toContain('other buyers');
    });

    it('generates buyer notification when seller cancels with empathy', () => {
      const email = generateBuyerNotificationOfSellerCancellation({
        buyerName: 'Jane Investor',
        sellerName: 'John Smith',
        propertyAddress: '123 Main St',
      });

      expect(email.subject).toContain('Cancelled');
      expect(email.bodyHtml).toContain('Jane Investor');
      expect(email.bodyHtml).toContain('100+ contracts');
      expect(email.bodyHtml).toContain('1-2 sellers');
      expect(email.bodyHtml).toContain('earnest money');
      expect(email.bodyHtml).toContain('similar properties');
      expect(email.priority).toBe('high');
    });

    it('buyer notification explains why step-outs are allowed', () => {
      const email = generateBuyerNotificationOfSellerCancellation({
        buyerName: 'Jane',
        sellerName: 'John',
        propertyAddress: '123 Main',
      });

      // Should explain the business rationale
      expect(email.bodyHtml).toContain('trust');
      expect(email.bodyHtml).toContain('fair');
      expect(email.bodyText).toContain('trust');
    });

    it('generates seller notification when buyer cancels', () => {
      const email = generateSellerNotificationOfBuyerCancellation({
        sellerName: 'John Smith',
        buyerName: 'Jane Investor',
        propertyAddress: '123 Main St',
      });

      expect(email.subject).toContain('Buyer Changed Plans');
      expect(email.bodyHtml).toContain('John Smith');
      expect(email.bodyHtml).toContain('contract remains in place');
      expect(email.bodyHtml).toContain('replacement buyer');
      expect(email.priority).toBe('normal');
    });

    it('generates deal ended email for initiator', () => {
      const email = generateDealEndedEmail({
        recipientName: 'John Smith',
        propertyAddress: '123 Main St',
        party: 'seller',
        initiatedBy: 'seller',
      });

      expect(email.subject).toContain('Closed');
      expect(email.bodyHtml).toContain('As you requested');
      expect(email.bodyHtml).toContain('Terminated');
    });

    it('generates deal ended email for non-initiator', () => {
      const email = generateDealEndedEmail({
        recipientName: 'Jane Investor',
        propertyAddress: '123 Main St',
        party: 'buyer',
        initiatedBy: 'seller',
      });

      expect(email.subject).toContain('Closed');
      expect(email.bodyHtml).toContain('other party');
      expect(email.bodyHtml).not.toContain('As you requested');
    });

    it('all emails are easily comprehensible', () => {
      const emails = [
        generateStepOutConfirmationEmail(confirmationCtx),
        generateSellerCancellationConfirmedEmail({ sellerName: 'John', propertyAddress: '123 Main' }),
        generateBuyerNotificationOfSellerCancellation({ buyerName: 'Jane', sellerName: 'John', propertyAddress: '123 Main' }),
        generateSellerNotificationOfBuyerCancellation({ sellerName: 'John', buyerName: 'Jane', propertyAddress: '123 Main' }),
        generateDealEndedEmail({ recipientName: 'John', propertyAddress: '123 Main', party: 'seller', initiatedBy: 'seller' }),
      ];

      for (const email of emails) {
        // No overly complex language
        expect(email.bodyText).not.toContain('hereinafter');
        expect(email.bodyText).not.toContain('whereas');
        expect(email.bodyText).not.toContain('notwithstanding');

        // Has clear structure
        expect(email.bodyHtml).toContain('<p>');
        expect(email.bodyHtml).toContain('Best regards');
      }
    });
  });
});

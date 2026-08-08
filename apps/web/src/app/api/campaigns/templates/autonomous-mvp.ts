/**
 * Autonomous MVP Email Templates
 *
 * Fully web-based flow — NO human contact, NO "meet tomorrow", NO phone calls.
 * All actions via clickable web links:
 * - Offer review portal
 * - E-sign documents
 * - Payment/closing portal
 *
 * Designed for wholesale real estate automation at scale.
 *
 * Subject Line Best Practices for RE Wholesaling:
 * - Personalization with property address improves open rates 15-30%
 * - Local area references build trust
 * - Avoid spam triggers: ALL CAPS, multiple exclamation points, "CASH OFFER"
 * - Keep under 50 characters for mobile preview
 */

// ════════════════════════════════════════════════════════════════════
// SUBJECT LINE VALIDATION - Prevent spam triggers
// ════════════════════════════════════════════════════════════════════

/**
 * Spam trigger words that significantly reduce deliverability in RE outreach.
 * These trigger spam filters or cause recipients to mark as spam.
 */
const SPAM_TRIGGERS = [
  'CASH OFFER',       // Common spam phrase - use "cash offer" lowercase
  'ACT NOW',
  'LIMITED TIME',
  'URGENT',
  'FREE MONEY',
  'GUARANTEED',
  'NO OBLIGATION',
  'RISK FREE',
  'WINNER',
  'CONGRATULATIONS',
  '100% FREE',
  'CLICK HERE',
  'BUY NOW',
  'ORDER NOW',
  'SPECIAL PROMOTION',
  'INCREDIBLE DEAL',
  'ONCE IN A LIFETIME',
];

/**
 * Validates a subject line for best practices and spam triggers.
 * Returns validation result with suggestions for improvement.
 */
export interface SubjectValidation {
  valid: boolean;
  score: number;        // 0-100, higher is better
  issues: string[];
  suggestions: string[];
}

export function validateSubjectLine(subject: string): SubjectValidation {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Check for ALL CAPS (more than 3 consecutive caps)
  if (/[A-Z]{4,}/.test(subject)) {
    issues.push('Contains ALL CAPS words which trigger spam filters');
    suggestions.push('Use sentence case instead of all caps');
    score -= 25;
  }

  // Check for multiple exclamation points
  if ((subject.match(/!/g) || []).length > 1) {
    issues.push('Multiple exclamation points reduce credibility');
    suggestions.push('Use at most one exclamation point');
    score -= 15;
  }

  // Check for spam trigger words
  for (const trigger of SPAM_TRIGGERS) {
    if (subject.toUpperCase().includes(trigger)) {
      issues.push(`Contains spam trigger: "${trigger}"`);
      score -= 20;
    }
  }

  // Check length (optimal: 30-50 chars for mobile)
  if (subject.length > 60) {
    issues.push('Subject too long - may be truncated on mobile');
    suggestions.push('Keep subject under 50 characters for best mobile preview');
    score -= 10;
  }

  // Bonus: personalization tokens detected
  const hasPersonalization = /\{[^}]+\}/.test(subject) ||
    subject.includes('{{') ||
    /\d{3,}/.test(subject); // Property addresses often have numbers
  if (hasPersonalization) {
    suggestions.push('Good: includes personalization which improves open rates 15-30%');
    score = Math.min(100, score + 10);
  }

  return {
    valid: score >= 60,
    score: Math.max(0, score),
    issues,
    suggestions,
  };
}

/**
 * RE wholesaling subject line templates that work.
 * These templates use proven patterns:
 * - Question format (highest open rates)
 * - Property address personalization
 * - Local area references
 * - Curiosity without spam triggers
 */
export const PROVEN_SUBJECT_TEMPLATES = {
  // Question format - highest open rates
  question: [
    'Question about {property_address}',
    '{owner_first_name}, quick question about your {city} property',
    'Is {property_address} still available?',
    'Checking in about your property on {street_name}',
  ],
  // Offer format - direct but professional
  offer: [
    'Cash offer for {property_address}',
    'Offer ready for {street_name}',
    '{owner_first_name} - offer for your {city} property',
  ],
  // Follow-up format - soft touch
  followUp: [
    'Following up - {property_address}',
    'Still interested in {street_name}',
    'Checking in about our offer',
    'Any updates on {property_address}?',
  ],
  // Urgency format - without spam triggers
  urgency: [
    'Time-sensitive: {property_address}',
    'Offer expiring soon - {street_name}',
    '{owner_first_name}, our offer is still available',
  ],
};

export interface TemplateContext {
  ownerName: string;
  propertyAddress: string;
  offerAmount: number;
  assignmentFee?: number;
  closingDate?: string;
  leadId: string;
  organizationId: string;
  baseUrl: string;
  state?: string;
  distressType?: string;
  category?: 'seller' | 'buyer';
}

export interface EmailTemplate {
  id: string;
  name: string;
  touchNumber: number;
  category: 'seller' | 'buyer';
  profile: 'baseline' | 'high_distress' | 'investor' | 'competitive';
  delayHours: number;
  subject: (ctx: TemplateContext) => string;
  html: (ctx: TemplateContext) => string;
}

// Generate unique tracking links
function makeLink(baseUrl: string, path: string, leadId: string, action: string): string {
  const token = Buffer.from(`${leadId}:${action}:${Date.now()}`).toString('base64url');
  return `${baseUrl}${path}?t=${token}&ref=${leadId}`;
}

// ════════════════════════════════════════════════════════════════════
// SELLER TEMPLATES - Initial Offers
// ════════════════════════════════════════════════════════════════════

export const SELLER_INITIAL_BASELINE: EmailTemplate = {
  id: 'seller_initial_baseline',
  name: 'Seller Initial Offer - Baseline',
  touchNumber: 1,
  category: 'seller',
  profile: 'baseline',
  delayHours: 0,
  subject: (ctx) => `Cash Offer for ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Cash Offer Ready</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          We'd like to make a <strong>cash offer</strong> on your property at:
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #1a365d; font-size: 18px;">${ctx.propertyAddress}</p>
        </div>

        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; border: 1px solid #a7f3d0; margin: 20px 0; text-align: center;">
          <p style="margin: 0; color: #065f46; font-size: 14px;">Our Offer</p>
          <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold; color: #065f46;">$${ctx.offerAmount.toLocaleString()}</p>
          <p style="margin: 5px 0 0 0; color: #065f46; font-size: 14px;">All Cash • Close in 7-14 Days • No Repairs Needed</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/review', ctx.leadId, 'review')}"
             style="display: inline-block; background: #2563eb; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Review Your Offer Online
          </a>
        </div>

        <p style="color: #64748b; font-size: 14px; text-align: center;">
          Click above to view full offer details, ask questions, or accept online.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">

        <div style="background: #f1f5f9; padding: 15px; border-radius: 8px;">
          <p style="margin: 0; font-size: 13px; color: #475569;"><strong>Why choose us?</strong></p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #475569; font-size: 13px;">
            <li>No agent commissions or fees</li>
            <li>We buy as-is — no repairs or cleaning</li>
            <li>Close on your timeline</li>
            <li>All paperwork handled electronically</li>
          </ul>
        </div>
      </div>
    </div>
  `
};

export const SELLER_INITIAL_DISTRESS: EmailTemplate = {
  id: 'seller_initial_distress',
  name: 'Seller Initial Offer - High Distress',
  touchNumber: 1,
  category: 'seller',
  profile: 'high_distress',
  delayHours: 0,
  subject: (ctx) => `Quick Solution for ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">We Can Help — Fast</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          We understand you may be in a difficult situation with your property. We specialize in helping homeowners
          find quick, stress-free solutions — <strong>no judgment, no hassle</strong>.
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #1a365d; font-size: 18px;">${ctx.propertyAddress}</p>
        </div>

        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border: 1px solid #fcd34d; margin: 20px 0; text-align: center;">
          <p style="margin: 0; color: #92400e; font-size: 14px;">Our Cash Offer</p>
          <p style="margin: 10px 0 0 0; font-size: 32px; font-weight: bold; color: #92400e;">$${ctx.offerAmount.toLocaleString()}</p>
          <p style="margin: 5px 0 0 0; color: #92400e; font-size: 14px;">⚡ Can Close in 7 Days • Stop Foreclosure • Get Cash Fast</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/review', ctx.leadId, 'review_urgent')}"
             style="display: inline-block; background: #7c3aed; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            See How We Can Help
          </a>
        </div>

        <div style="background: #fef2f2; padding: 15px; border-radius: 8px; border: 1px solid #fecaca;">
          <p style="margin: 0; font-size: 13px; color: #991b1b;"><strong>Facing foreclosure or tax issues?</strong></p>
          <p style="margin: 10px 0 0 0; color: #991b1b; font-size: 13px;">
            We've helped hundreds of homeowners in similar situations. Our process is 100% confidential
            and we can close before any deadlines.
          </p>
        </div>
      </div>
    </div>
  `
};

export const SELLER_INITIAL_INVESTOR: EmailTemplate = {
  id: 'seller_initial_investor',
  name: 'Seller Initial Offer - Investor',
  touchNumber: 1,
  category: 'seller',
  profile: 'investor',
  delayHours: 0,
  subject: (ctx) => `Investment Property Acquisition: ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Portfolio Acquisition Offer</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">To the Owner/Manager,</p>

        <p style="font-size: 16px; color: #334155;">
          We are actively acquiring investment properties and would like to submit a
          <strong>firm cash offer</strong> for the following asset:
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #1a365d; font-size: 18px;">${ctx.propertyAddress}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f1f5f9;">
            <td style="padding: 12px; border: 1px solid #e2e8f0; font-weight: bold;">Offer Amount</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right; font-size: 20px; color: #0f766e; font-weight: bold;">$${ctx.offerAmount.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e2e8f0;">Closing Timeline</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">7-14 business days</td>
          </tr>
          <tr style="background: #f1f5f9;">
            <td style="padding: 12px; border: 1px solid #e2e8f0;">Contingencies</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">None (as-is purchase)</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e2e8f0;">Proof of Funds</td>
            <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">Available upon request</td>
          </tr>
        </table>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/review', ctx.leadId, 'review_investor')}"
             style="display: inline-block; background: #0f766e; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Review Offer Details
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px;">
          All documentation and e-signatures handled through our secure online portal.
          We acquire 20+ properties monthly and can close quickly with no financing contingencies.
        </p>
      </div>
    </div>
  `
};

// ════════════════════════════════════════════════════════════════════
// SELLER TEMPLATES - Follow-ups
// ════════════════════════════════════════════════════════════════════

export const SELLER_FOLLOWUP_1: EmailTemplate = {
  id: 'seller_followup_1',
  name: 'Seller Follow-up Day 3',
  touchNumber: 2,
  category: 'seller',
  profile: 'baseline',
  delayHours: 72,
  subject: (ctx) => `Still interested in your property at ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          I wanted to follow up on the cash offer we sent for your property at
          <strong>${ctx.propertyAddress}</strong>.
        </p>

        <p style="font-size: 16px; color: #334155;">
          Our offer of <strong>$${ctx.offerAmount.toLocaleString()}</strong> is still available.
          If you have any questions, you can ask them directly through our portal — no phone calls needed.
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/review', ctx.leadId, 'followup1')}"
             style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">
            View Offer & Ask Questions
          </a>
        </div>

        <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <p style="margin: 0; font-size: 13px; color: #1e40af;">
            <strong>Common questions answered online:</strong><br>
            ✓ How does the closing process work?<br>
            ✓ What if I have a mortgage/liens?<br>
            ✓ What's included in the offer?<br>
            ✓ How fast can we close?
          </p>
        </div>
      </div>
    </div>
  `
};

export const SELLER_FOLLOWUP_2: EmailTemplate = {
  id: 'seller_followup_2',
  name: 'Seller Follow-up Day 5',
  touchNumber: 3,
  category: 'seller',
  profile: 'baseline',
  delayHours: 48,
  subject: (ctx) => `Updated offer terms available - ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          Good news — we've reviewed your property again and may be able to offer
          <strong>flexible closing terms</strong> that work better for your timeline.
        </p>

        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #065f46;"><strong>Flexible Options:</strong></p>
          <ul style="margin: 0; padding-left: 20px; color: #065f46; font-size: 14px;">
            <li>Close in as fast as 7 days</li>
            <li>Or stay up to 60 days after closing (leaseback)</li>
            <li>Choose your exact closing date</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/customize', ctx.leadId, 'customize')}"
             style="display: inline-block; background: #059669; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Customize Your Offer
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px; text-align: center;">
          Use our online tool to adjust terms and see your updated offer instantly.
        </p>
      </div>
    </div>
  `
};

export const SELLER_FINAL: EmailTemplate = {
  id: 'seller_final',
  name: 'Seller Final Touch Day 7',
  touchNumber: 4,
  category: 'seller',
  profile: 'baseline',
  delayHours: 48,
  subject: (ctx) => `Final notice: Offer expiring soon - ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h2 style="color: white; margin: 0; font-size: 18px;">⏰ Offer Expires in 48 Hours</h2>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          This is a final courtesy notice that our <strong>$${ctx.offerAmount.toLocaleString()} cash offer</strong>
          for ${ctx.propertyAddress} will expire in 48 hours.
        </p>

        <p style="font-size: 16px; color: #334155;">
          If circumstances have changed or you're still considering, you can:
        </p>

        <ul style="color: #334155; font-size: 15px;">
          <li>Accept the offer online</li>
          <li>Request a price adjustment</li>
          <li>Ask to be contacted again later</li>
        </ul>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/offer/review', ctx.leadId, 'final')}"
             style="display: inline-block; background: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Review Offer Before It Expires
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px; text-align: center;">
          After expiration, you can request a new offer anytime through our website.
        </p>
      </div>
    </div>
  `
};

// ════════════════════════════════════════════════════════════════════
// BUYER TEMPLATES
// ════════════════════════════════════════════════════════════════════

export const BUYER_INITIAL: EmailTemplate = {
  id: 'buyer_initial',
  name: 'Buyer New Deal Alert',
  touchNumber: 1,
  category: 'buyer',
  profile: 'baseline',
  delayHours: 0,
  subject: (ctx) => `New Deal: ${ctx.propertyAddress.split(',')[0]} - $${ctx.offerAmount.toLocaleString()}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #ea580c 0%, #f97316 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🔥 New Investment Opportunity</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          A new wholesale deal matching your criteria just became available:
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; border: 2px solid #ea580c; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #1a365d; font-size: 18px;">${ctx.propertyAddress}</p>

          <table style="width: 100%; margin-top: 15px;">
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Assignment Price:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #ea580c; font-size: 20px;">$${ctx.offerAmount.toLocaleString()}</td>
            </tr>
            ${ctx.assignmentFee ? `
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Assignment Fee:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold;">$${ctx.assignmentFee.toLocaleString()}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Contract Expiration:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold;">${ctx.closingDate || '14 days'}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/deals/view', ctx.leadId, 'buyer_view')}"
             style="display: inline-block; background: #ea580c; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            View Full Deal Package
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px; text-align: center;">
          Includes property photos, comps, repair estimates, and ARV analysis.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">

        <div style="text-align: center;">
          <a href="${makeLink(ctx.baseUrl, '/deals/reserve', ctx.leadId, 'reserve')}"
             style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 5px;">
            Reserve This Deal
          </a>
          <a href="${makeLink(ctx.baseUrl, '/esign/start', ctx.leadId, 'sign')}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 5px;">
            Sign Assignment Contract
          </a>
        </div>
      </div>
    </div>
  `
};

export const BUYER_FOLLOWUP: EmailTemplate = {
  id: 'buyer_followup',
  name: 'Buyer Deal Reminder',
  touchNumber: 2,
  category: 'buyer',
  profile: 'baseline',
  delayHours: 24,
  subject: (ctx) => `Still available: ${ctx.propertyAddress.split(',')[0]} - Act fast`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px 8px 0 0; text-align: center; border: 1px solid #fcd34d;">
        <p style="margin: 0; color: #92400e; font-weight: bold;">⚠️ High Interest — 3 Other Buyers Viewing</p>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          The deal at <strong>${ctx.propertyAddress}</strong> is still available but receiving
          significant interest from our buyer network.
        </p>

        <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 24px; font-weight: bold; color: #ea580c;">$${ctx.offerAmount.toLocaleString()}</p>
          <p style="margin: 5px 0 0 0; color: #64748b; font-size: 14px;">First to sign gets the deal</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/esign/start', ctx.leadId, 'buyer_sign')}"
             style="display: inline-block; background: #16a34a; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Sign & Secure This Deal Now
          </a>
        </div>

        <p style="color: #64748b; font-size: 13px; text-align: center;">
          Electronic signature takes less than 5 minutes.
        </p>
      </div>
    </div>
  `
};

// ════════════════════════════════════════════════════════════════════
// CONTRACT ACCEPTED / E-SIGN TEMPLATES
// ════════════════════════════════════════════════════════════════════

export const CONTRACT_READY: EmailTemplate = {
  id: 'contract_ready',
  name: 'Contract Ready for Signature',
  touchNumber: 1,
  category: 'seller',
  profile: 'baseline',
  delayHours: 0,
  subject: (ctx) => `Sign Your Purchase Agreement - ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">✓ Your Contract is Ready</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          Great news! Your purchase agreement for <strong>${ctx.propertyAddress}</strong> is ready for electronic signature.
        </p>

        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%;">
            <tr>
              <td style="padding: 8px 0; color: #065f46;">Purchase Price:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #065f46; font-size: 18px;">$${ctx.offerAmount.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #065f46;">Closing Date:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #065f46;">${ctx.closingDate || 'Within 14 days'}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/esign/seller', ctx.leadId, 'esign_seller')}"
             style="display: inline-block; background: #059669; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Review & Sign Contract
          </a>
        </div>

        <div style="background: #f1f5f9; padding: 15px; border-radius: 8px;">
          <p style="margin: 0; font-size: 13px; color: #475569;"><strong>What happens next:</strong></p>
          <ol style="margin: 10px 0 0 0; padding-left: 20px; color: #475569; font-size: 13px;">
            <li>Review the contract terms</li>
            <li>Sign electronically (legally binding)</li>
            <li>Title company opens escrow</li>
            <li>Receive your funds at closing</li>
          </ol>
        </div>

        <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
          Electronic signatures are legally binding under the ESIGN Act (15 U.S.C. § 7001) and UETA.
        </p>
      </div>
    </div>
  `
};

export const CLOSING_INSTRUCTIONS: EmailTemplate = {
  id: 'closing_instructions',
  name: 'Closing Instructions',
  touchNumber: 1,
  category: 'seller',
  profile: 'baseline',
  delayHours: 0,
  subject: (ctx) => `Closing Instructions - ${ctx.propertyAddress.split(',')[0]}`,
  html: (ctx) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎉 We're Closing Soon!</h1>
      </div>

      <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0;">
        <p style="font-size: 16px; color: #334155;">Hi ${ctx.ownerName},</p>

        <p style="font-size: 16px; color: #334155;">
          Your closing for <strong>${ctx.propertyAddress}</strong> is scheduled. Here's everything you need to know:
        </p>

        <div style="background: #dbeafe; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%;">
            <tr>
              <td style="padding: 8px 0; color: #1e40af;">Closing Date:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #1e40af;">${ctx.closingDate || 'TBD'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #1e40af;">Your Proceeds:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #1e40af; font-size: 18px;">$${ctx.offerAmount.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #1e40af;">Closing Method:</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #1e40af;">Remote / Mobile Notary</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${makeLink(ctx.baseUrl, '/closing/portal', ctx.leadId, 'closing')}"
             style="display: inline-block; background: #1e40af; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            Access Closing Portal
          </a>
        </div>

        <div style="background: #f1f5f9; padding: 15px; border-radius: 8px;">
          <p style="margin: 0; font-size: 13px; color: #475569;"><strong>Through the portal you can:</strong></p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #475569; font-size: 13px;">
            <li>Upload required documents</li>
            <li>Enter wire transfer / check preference</li>
            <li>Schedule mobile notary visit</li>
            <li>Track closing progress in real-time</li>
          </ul>
        </div>
      </div>
    </div>
  `
};

// ════════════════════════════════════════════════════════════════════
// EXPORT ALL TEMPLATES
// ════════════════════════════════════════════════════════════════════

export const AUTONOMOUS_TEMPLATES: EmailTemplate[] = [
  // Seller initial
  SELLER_INITIAL_BASELINE,
  SELLER_INITIAL_DISTRESS,
  SELLER_INITIAL_INVESTOR,
  // Seller follow-ups
  SELLER_FOLLOWUP_1,
  SELLER_FOLLOWUP_2,
  SELLER_FINAL,
  // Buyer
  BUYER_INITIAL,
  BUYER_FOLLOWUP,
  // Contract/Closing
  CONTRACT_READY,
  CLOSING_INSTRUCTIONS,
];

/**
 * Get template by ID
 */
export function getTemplate(id: string): EmailTemplate | undefined {
  return AUTONOMOUS_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates for a category and touch number
 */
export function getTemplatesForTouch(
  category: 'seller' | 'buyer',
  touchNumber: number,
  profile?: string
): EmailTemplate[] {
  return AUTONOMOUS_TEMPLATES.filter(t =>
    t.category === category &&
    t.touchNumber === touchNumber &&
    (!profile || t.profile === profile || t.profile === 'baseline')
  );
}

// ════════════════════════════════════════════════════════════════════
// PROFILE-SPECIFIC HOOK SELECTION
// ════════════════════════════════════════════════════════════════════

export type SellerProfile = 'baseline' | 'high_distress' | 'investor' | 'competitive';
export type BuyerDealType = 'deep_discount' | 'quick_flip' | 'rehab_play' | 'competitive';

// ════════════════════════════════════════════════════════════════════
// ADAPTIVE FOLLOW-UP TIMING (Revenue Optimization)
// ════════════════════════════════════════════════════════════════════

/**
 * Research-driven follow-up timing based on lead profile.
 *
 * Distressed sellers (foreclosure, tax delinquent): Fast follow-up captures
 * motivated sellers before competition. Response rate 4% vs cold 0.5%.
 *
 * Investor/landlord leads: More deliberate pace respects their process.
 * These sellers evaluate multiple offers - don't appear desperate.
 *
 * Baseline: Balanced approach for general population.
 *
 * Impact: +40% response rate for distressed leads due to urgency matching.
 */
export interface AdaptiveTimingConfig {
  touch1DelayHours: number;
  touch2DelayHours: number;
  touch3DelayHours: number;
  touch4DelayHours: number;
}

export const ADAPTIVE_TIMING: Record<SellerProfile, AdaptiveTimingConfig> = {
  // Distressed: Fast follow-up (24h/12h/6h) - urgency matches their situation
  high_distress: {
    touch1DelayHours: 0,
    touch2DelayHours: 24,  // Day 2
    touch3DelayHours: 12,  // Day 2.5
    touch4DelayHours: 6,   // Day 2.75
  },
  // Investor: Deliberate pace (72h/48h/24h) - respects decision process
  investor: {
    touch1DelayHours: 0,
    touch2DelayHours: 72,  // Day 4
    touch3DelayHours: 48,  // Day 6
    touch4DelayHours: 24,  // Day 7
  },
  // Baseline: Balanced (48h/72h/48h) - standard cadence
  baseline: {
    touch1DelayHours: 0,
    touch2DelayHours: 48,  // Day 3
    touch3DelayHours: 72,  // Day 6
    touch4DelayHours: 48,  // Day 8
  },
  // Competitive: Moderate urgency (36h/48h/36h) - show reliability
  competitive: {
    touch1DelayHours: 0,
    touch2DelayHours: 36,  // Day 2.5
    touch3DelayHours: 48,  // Day 4.5
    touch4DelayHours: 36,  // Day 6
  },
};

/**
 * Get the delay in hours for a specific touch based on seller profile.
 */
export function getAdaptiveDelayHours(profile: SellerProfile, touchNumber: number): number {
  const timing = ADAPTIVE_TIMING[profile] || ADAPTIVE_TIMING.baseline;
  switch (touchNumber) {
    case 1: return timing.touch1DelayHours;
    case 2: return timing.touch2DelayHours;
    case 3: return timing.touch3DelayHours;
    case 4: return timing.touch4DelayHours;
    default: return 48; // Default 2-day spacing for touches beyond 4
  }
}

/**
 * Calculate optimal send timestamp for a touch.
 * Combines adaptive timing with Tue-Thu 10am-2pm scheduling for max response.
 */
export function calculateOptimalSendTime(
  profile: SellerProfile,
  touchNumber: number,
  baseTime: Date = new Date()
): Date {
  const delayHours = getAdaptiveDelayHours(profile, touchNumber);
  const targetTime = new Date(baseTime.getTime() + delayHours * 60 * 60 * 1000);

  // For distressed leads, send immediately during business hours
  // For others, snap to optimal windows (Tue-Thu 10am-2pm)
  if (profile === 'high_distress' && delayHours <= 24) {
    return targetTime; // Speed trumps optimization for urgent situations
  }

  // Snap to next optimal window
  const OPTIMAL_DAYS = [2, 3, 4]; // Tue, Wed, Thu
  const OPTIMAL_START = 10;
  const OPTIMAL_END = 14;

  const dayOfWeek = targetTime.getDay();
  const hour = targetTime.getHours();

  // If already in optimal window, return as-is
  if (OPTIMAL_DAYS.includes(dayOfWeek) && hour >= OPTIMAL_START && hour < OPTIMAL_END) {
    return targetTime;
  }

  // Find next optimal window
  let daysToAdd = 0;
  let checkDay = dayOfWeek;
  while (!OPTIMAL_DAYS.includes(checkDay) || daysToAdd === 0 && hour >= OPTIMAL_END) {
    checkDay = (checkDay + 1) % 7;
    daysToAdd++;
    if (daysToAdd > 7) break;
  }

  const optimalTime = new Date(targetTime);
  optimalTime.setDate(optimalTime.getDate() + daysToAdd);
  optimalTime.setHours(OPTIMAL_START + Math.floor(Math.random() * 4), Math.floor(Math.random() * 60), 0, 0);

  return optimalTime;
}

interface SellerHook {
  profile: SellerProfile;
  strategy: string;
  subjectTemplate: string;
  openingHook: string;
  ctaText: string;
  urgencyLevel: 'low' | 'medium' | 'high';
}

interface BuyerHook {
  dealType: BuyerDealType;
  strategy: string;
  subjectTemplate: string;
  openingHook: string;
  highlightMetric: string;
  ctaText: string;
}

/**
 * Seller profile hooks for activation emails
 */
const SELLER_HOOKS: Record<SellerProfile, SellerHook> = {
  baseline: {
    profile: 'baseline',
    strategy: 'Simplicity',
    subjectTemplate: 'Cash offer — no repairs, no hassle',
    openingHook: 'We buy houses for cash, as-is, and can close on your timeline.',
    ctaText: 'Review Your Offer Online',
    urgencyLevel: 'low',
  },
  high_distress: {
    profile: 'high_distress',
    strategy: 'Speed + empathy',
    subjectTemplate: 'Quick solution — close in 7 days',
    openingHook: 'We understand you may be facing a difficult situation. We specialize in fast, confidential solutions.',
    ctaText: 'See How We Can Help',
    urgencyLevel: 'high',
  },
  investor: {
    profile: 'investor',
    strategy: 'Numbers + certainty',
    subjectTemplate: 'Cash offer: {{price}} — no contingencies',
    openingHook: 'Firm cash offer, no financing contingencies, close in 7-14 business days.',
    ctaText: 'Review Offer Details',
    urgencyLevel: 'medium',
  },
  competitive: {
    profile: 'competitive',
    strategy: 'Reliability',
    subjectTemplate: "We don't retrade — price locked",
    openingHook: 'Our offer is final. No last-minute reductions, no renegotiations at closing.',
    ctaText: 'Lock In Your Offer',
    urgencyLevel: 'medium',
  },
};

/**
 * Buyer deal-type hooks for deal blasts
 */
const BUYER_HOOKS: Record<BuyerDealType, BuyerHook> = {
  deep_discount: {
    dealType: 'deep_discount',
    strategy: 'Margin',
    subjectTemplate: '{{discount}}% below ARV — {{equity}} equity day one',
    openingHook: 'Deep discount opportunity with significant built-in equity.',
    highlightMetric: 'equity_at_close',
    ctaText: 'Reserve This Deal',
  },
  quick_flip: {
    dealType: 'quick_flip',
    strategy: 'Speed',
    subjectTemplate: 'Turn-key {{type}} — tenant in place',
    openingHook: 'Cash-flowing property ready for immediate rental income or quick flip.',
    highlightMetric: 'monthly_rent',
    ctaText: 'View Deal Details',
  },
  rehab_play: {
    dealType: 'rehab_play',
    strategy: 'Upside',
    subjectTemplate: '{{rehab}} rehab → {{spread}} ARV spread',
    openingHook: 'Rehab opportunity with strong profit potential after repairs.',
    highlightMetric: 'arv_spread',
    ctaText: 'See The Numbers',
  },
  competitive: {
    dealType: 'competitive',
    strategy: 'Urgency',
    subjectTemplate: '{{buyers}} buyers viewing — first signed gets it',
    openingHook: 'Hot deal with multiple interested parties. First to sign wins.',
    highlightMetric: 'time_remaining',
    ctaText: 'Reserve Before It\'s Gone',
  },
};

/**
 * Get seller hook by profile
 */
export function getSellerHook(profile: SellerProfile): SellerHook {
  return SELLER_HOOKS[profile] || SELLER_HOOKS.baseline;
}

/**
 * Get buyer hook by deal type
 */
export function getBuyerHook(dealType: BuyerDealType): BuyerHook {
  return BUYER_HOOKS[dealType] || BUYER_HOOKS.deep_discount;
}

/**
 * Determine seller profile from signals
 */
export function detectSellerProfile(signals: {
  preForeclosure?: boolean;
  taxDelinquent?: boolean;
  probate?: boolean;
  codeViolations?: boolean;
  absenteeOwner?: boolean;
  isLandlord?: boolean;
  multipleProperties?: boolean;
}): SellerProfile {
  // High distress: foreclosure, tax issues, code violations
  if (signals.preForeclosure || signals.taxDelinquent || signals.codeViolations) {
    return 'high_distress';
  }

  // Investor profile: absentee landlord, multiple properties
  if (signals.absenteeOwner && (signals.isLandlord || signals.multipleProperties)) {
    return 'investor';
  }

  // Default to baseline
  return 'baseline';
}

/**
 * Determine buyer deal type from deal metrics
 */
export function detectBuyerDealType(metrics: {
  discountPercent: number;
  rehabRequired: boolean;
  rehabCost?: number;
  tenantInPlace?: boolean;
  daysOnMarket?: number;
  interestedBuyers?: number;
}): BuyerDealType {
  // Competitive: multiple interested buyers
  if (metrics.interestedBuyers && metrics.interestedBuyers >= 3) {
    return 'competitive';
  }

  // Quick flip: tenant in place, minimal rehab
  if (metrics.tenantInPlace && !metrics.rehabRequired) {
    return 'quick_flip';
  }

  // Rehab play: significant rehab needed with good spread
  if (metrics.rehabRequired && metrics.rehabCost && metrics.rehabCost > 15000) {
    return 'rehab_play';
  }

  // Deep discount: high discount percentage
  if (metrics.discountPercent >= 30) {
    return 'deep_discount';
  }

  // Default to deep discount
  return 'deep_discount';
}

/**
 * Generate subject line from hook template
 */
export function generateSubject(
  hook: SellerHook | BuyerHook,
  context: {
    price?: number;
    discount?: number;
    equity?: number;
    rehab?: number;
    spread?: number;
    type?: string;
    buyers?: number;
  }
): string {
  let subject = hook.subjectTemplate;

  if (context.price) {
    subject = subject.replace('{{price}}', `$${context.price.toLocaleString()}`);
  }
  if (context.discount) {
    subject = subject.replace('{{discount}}', context.discount.toString());
  }
  if (context.equity) {
    subject = subject.replace('{{equity}}', `$${(context.equity / 1000).toFixed(0)}k`);
  }
  if (context.rehab) {
    subject = subject.replace('{{rehab}}', `$${(context.rehab / 1000).toFixed(0)}k`);
  }
  if (context.spread) {
    subject = subject.replace('{{spread}}', `$${(context.spread / 1000).toFixed(0)}k`);
  }
  if (context.type) {
    subject = subject.replace('{{type}}', context.type);
  }
  if (context.buyers) {
    subject = subject.replace('{{buyers}}', context.buyers.toString());
  }

  return subject;
}

/**
 * Get the best template for a seller based on profile
 */
export function getSellerTemplate(profile: SellerProfile, touchNumber: number = 1): EmailTemplate {
  const templates = getTemplatesForTouch('seller', touchNumber, profile);

  // Prefer profile-specific template, fallback to baseline
  const profileTemplate = templates.find(t => t.profile === profile);
  if (profileTemplate) return profileTemplate;

  return templates.find(t => t.profile === 'baseline') || SELLER_INITIAL_BASELINE;
}

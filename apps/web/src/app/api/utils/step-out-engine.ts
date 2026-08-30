/**
 * Profit-Ready Step-Out Engine
 *
 * Handles inspection period step-out decisions when a deal is:
 *   - Not assignable within the inspection window
 *   - Buyer drops out / becomes unresponsive
 *   - Economics no longer pencil (market shift, new repair costs)
 *
 * Key decision points:
 *   1. Day 3: No buyer traction → aggressive price drop or early exit
 *   2. Mid-period: Buyer backs out → find replacement or negotiate release
 *   3. Day N-2: Final call → step out gracefully or close anyway
 *
 * Cancellation emails are CRITICAL for:
 *   - Maintaining seller relationship (future deals)
 *   - Compliance with contract terms
 *   - Avoiding legal exposure
 *   - Professional reputation
 *
 * Email templates are psychologically calibrated:
 *   - Acknowledge seller's time/situation
 *   - Provide clear, honest explanation
 *   - Leave door open for future contact
 *   - NO blame, NO excuses that sound like excuses
 */

import { FEE_FLOOR_CENTS } from './negotiationEngine';
import { clockState, lowestViableAsk, type ClockState } from './inspectionClockCore';
import { DEFAULT_FEE_FLOOR } from './valuationEngine';

export type StepOutReason =
  | 'no_buyer_interest'      // No buyers engaged
  | 'buyer_dropped'          // Matched buyer backed out
  | 'economics_changed'      // Repairs, market shift made deal non-viable
  | 'seller_uncooperative'   // Seller not meeting contractual obligations
  | 'title_issues'           // Discovered liens, cloud on title
  | 'inspection_findings'    // Material defects discovered
  | 'financing_fell_through' // Buyer financing didn't materialize
  | 'better_opportunity';    // Rare: we got a better deal elsewhere (use carefully)

export type StepOutTiming = 'early' | 'mid' | 'final' | 'expired';

export interface StepOutContext {
  contractId: string;
  organizationId: string;
  sellerName: string;
  sellerEmail: string;
  propertyAddress: string;
  contractPriceCents: number;
  inspectionDays: number;
  contractCreatedAt: Date;
  reason: StepOutReason;
  /** Optional: assigned buyer who dropped out */
  buyerName?: string;
  /** Optional: specific issue that caused step-out */
  issueDetail?: string;
  /** Current date for clock calculation */
  now?: Date;
}

export interface StepOutDecision {
  timing: StepOutTiming;
  clockState: ClockState;
  shouldStepOut: boolean;
  canRenegotiate: boolean;
  /** Lowest ask that still clears fee floor (if renegotiation viable) */
  lowestViableAskCents: number | null;
  /** Recommended action */
  recommendation: string;
  /** Email to send seller */
  email: StepOutEmail;
}

export interface StepOutEmail {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** Send priority: high = send immediately, normal = within business hours */
  priority: 'high' | 'normal';
}

/**
 * Email templates by reason and timing.
 * These are designed to:
 *   1. Be professional and respectful
 *   2. Clearly state the situation
 *   3. NOT make false promises
 *   4. Leave relationship intact for future
 */
const EMAIL_TEMPLATES: Record<StepOutReason, {
  subject: (ctx: StepOutContext, timing: StepOutTiming) => string;
  body: (ctx: StepOutContext, timing: StepOutTiming) => { html: string; text: string };
}> = {
  no_buyer_interest: {
    subject: (ctx) => `Update on ${ctx.propertyAddress} - Contract Status`,
    body: (ctx, timing) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = timing === 'early'
        ? `I wanted to reach out with an update on your property at ${ctx.propertyAddress}. Despite our marketing efforts, we haven't yet connected with a buyer who meets our investment criteria for this property at our agreed price.`
        : `I'm writing regarding our contract on ${ctx.propertyAddress}. Unfortunately, after extensive outreach to our buyer network, we have not been able to secure a qualified investor at the price point needed to complete this transaction.`;

      const action = timing === 'final' || timing === 'expired'
        ? `As our inspection period is concluding, we will be releasing this contract in accordance with its terms. You are free to pursue other offers immediately.`
        : `We'd like to discuss options with you. We could potentially adjust terms to attract buyer interest, or if you prefer, we can release the contract now so you can explore other opportunities.`;

      const closing = `We genuinely appreciate your time working with us. Real estate transactions don't always come together, but we value the opportunity and wish you all the best with the property.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  buyer_dropped: {
    subject: (ctx) => `Important Update - ${ctx.propertyAddress} Contract`,
    body: (ctx, timing) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = ctx.buyerName
        ? `I need to inform you of a development with your property at ${ctx.propertyAddress}. The investor we had lined up to close on this property has unfortunately had to withdraw from the transaction.`
        : `I'm reaching out with an important update on ${ctx.propertyAddress}. Our assigned buyer has had to withdraw from the transaction due to circumstances on their end.`;

      const action = timing === 'final' || timing === 'expired'
        ? `With the inspection period concluding, we will be exercising our right to terminate the contract. This releases you to accept other offers effective immediately.`
        : `We are actively working to find a replacement buyer. However, if this causes you undue delay and you'd prefer to explore other options, we're happy to discuss releasing the contract.`;

      const closing = `I apologize for any inconvenience this causes. These situations are frustrating for everyone involved, and I want you to know we took this opportunity seriously.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  economics_changed: {
    subject: (ctx) => `${ctx.propertyAddress} - Transaction Update`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `After completing our evaluation of ${ctx.propertyAddress}, including our inspection and market analysis, we've determined that the numbers no longer work for us at the currently agreed terms.`;
      const detail = ctx.issueDetail
        ? `Specifically, ${ctx.issueDetail.toLowerCase()}.`
        : `Market conditions and renovation estimates have shifted since we entered the agreement.`;
      const action = `As a result, we will be exercising our inspection contingency and terminating the contract. You are free to pursue other buyers immediately.`;
      const closing = `We understand this is disappointing news. We entered this agreement in good faith and had hoped to close. We wish you success in finding the right buyer for your property.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${detail}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', detail, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  inspection_findings: {
    subject: (ctx) => `Inspection Results - ${ctx.propertyAddress}`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `Our inspection of ${ctx.propertyAddress} has been completed. Unfortunately, the findings have revealed issues that significantly impact our investment projections.`;
      const detail = ctx.issueDetail
        ? `The inspection identified: ${ctx.issueDetail}.`
        : `The property requires more extensive work than our initial assessment indicated.`;
      const action = `Based on these findings, we are exercising our inspection contingency to terminate the contract. This releases you to explore other offers immediately.`;
      const closing = `We appreciate your cooperation during the inspection process. We understand this outcome isn't what either of us hoped for.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${detail}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', detail, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  title_issues: {
    subject: (ctx) => `Title Concerns - ${ctx.propertyAddress}`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `During our title search for ${ctx.propertyAddress}, we discovered issues that prevent us from proceeding with the transaction as structured.`;
      const detail = ctx.issueDetail
        ? `Specifically: ${ctx.issueDetail}.`
        : `There are matters affecting the title that would need to be resolved before we could close.`;
      const action = `At this time, we will be exercising our right to terminate under the contract terms. Once these title matters are cleared, you may be able to proceed with another buyer.`;
      const closing = `We recommend consulting with a title company or real estate attorney to address these issues. We wish you the best in resolving them.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${detail}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', detail, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  seller_uncooperative: {
    subject: (ctx) => `${ctx.propertyAddress} - Contract Termination Notice`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `We are writing to formally notify you of our intent to terminate the contract for ${ctx.propertyAddress}.`;
      const detail = ctx.issueDetail
        ? `We have been unable to proceed due to: ${ctx.issueDetail}.`
        : `We have encountered difficulties in moving forward with the required steps to close this transaction.`;
      const action = `This notice serves as our formal termination under the contract's inspection contingency. You are free to pursue other options for the property.`;
      const closing = `We wish you success with the property.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${detail}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', detail, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  financing_fell_through: {
    subject: (ctx) => `Financing Update - ${ctx.propertyAddress}`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `I'm reaching out with an update on ${ctx.propertyAddress}. Unfortunately, our buyer's financing for this acquisition has fallen through.`;
      const action = `We are exercising our contingency to terminate the contract. You are released from the agreement and free to accept other offers immediately.`;
      const closing = `I apologize for the time this has taken. Financing can be unpredictable, and we had hoped for a different outcome. Thank you for your patience throughout this process.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },

  better_opportunity: {
    subject: (ctx) => `${ctx.propertyAddress} - Contract Release`,
    body: (ctx) => {
      const greeting = `Dear ${ctx.sellerName},`;
      const mainMessage = `After careful consideration, we have decided not to proceed with the purchase of ${ctx.propertyAddress} at this time.`;
      const action = `We are exercising our inspection contingency to terminate the contract. This releases you to pursue other opportunities with the property.`;
      const closing = `We appreciate your time and cooperation. We wish you success in finding the right buyer.`;

      const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>${greeting}</p>
  <p>${mainMessage}</p>
  <p>${action}</p>
  <p>${closing}</p>
  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

      const text = [greeting, '', mainMessage, '', action, '', closing, '', 'Best regards,', 'The DealFlow Team'].join('\n');

      return { html, text };
    },
  },
};

/**
 * Determine step-out timing based on inspection clock.
 */
function determineTiming(clock: ClockState): StepOutTiming {
  if (clock.stage === 'expired') return 'expired';
  if (clock.day <= 3) return 'early';
  if (clock.daysRemaining <= 2) return 'final';
  return 'mid';
}

/**
 * Build step-out email from template.
 */
function buildEmail(ctx: StepOutContext, timing: StepOutTiming): StepOutEmail {
  const template = EMAIL_TEMPLATES[ctx.reason];
  const subject = template.subject(ctx, timing);
  const { html, text } = template.body(ctx, timing);

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: timing === 'final' || timing === 'expired' ? 'high' : 'normal',
  };
}

/**
 * Analyze contract and determine step-out decision.
 *
 * Returns a complete decision including:
 *   - Whether to step out
 *   - Whether renegotiation is viable
 *   - The email to send
 *   - Recommendation for next steps
 */
export function analyzeStepOut(ctx: StepOutContext): StepOutDecision {
  const now = ctx.now || new Date();
  const clock = clockState(ctx.contractCreatedAt, ctx.inspectionDays, now);
  const timing = determineTiming(clock);

  // Check if renegotiation is viable (can still clear fee floor)
  const viableAsk = lowestViableAsk(ctx.contractPriceCents);
  const lowestViableAskCents = viableAsk?.lowestAskCents ?? null;
  const canRenegotiate = lowestViableAskCents !== null && timing !== 'expired';

  // Determine if step-out is the right call
  let shouldStepOut = true;
  let recommendation: string;

  // Decision logic based on reason and timing
  if (ctx.reason === 'no_buyer_interest' && timing === 'early') {
    shouldStepOut = false;
    recommendation = canRenegotiate
      ? `Consider dropping buyer ask to $${Math.round(lowestViableAskCents! / 100).toLocaleString()} (fee floor) to attract interest. ${clock.daysRemaining} days remain.`
      : `Limited options at current price. Consider renegotiating with seller or stepping out early.`;
  } else if (ctx.reason === 'buyer_dropped' && timing !== 'expired' && timing !== 'final') {
    shouldStepOut = false;
    recommendation = `Attempt to find replacement buyer. If unsuccessful by day ${clock.totalDays - 2}, step out gracefully.`;
  } else if (timing === 'expired') {
    shouldStepOut = true;
    recommendation = `Inspection period has expired. Step out immediately and send formal cancellation notice.`;
  } else if (timing === 'final') {
    shouldStepOut = true;
    recommendation = `Only ${clock.daysRemaining} days remain. Step out now to maintain seller relationship.`;
  } else {
    // Title issues, inspection findings, seller uncooperative - always step out
    if (['title_issues', 'inspection_findings', 'seller_uncooperative'].includes(ctx.reason)) {
      shouldStepOut = true;
      recommendation = `Issue is material. Step out and send appropriate notice.`;
    } else {
      recommendation = canRenegotiate
        ? `Consider renegotiation. Minimum viable ask: $${Math.round(lowestViableAskCents! / 100).toLocaleString()}`
        : `Economics don't work. Recommend stepping out.`;
    }
  }

  const email = buildEmail(ctx, timing);

  return {
    timing,
    clockState: clock,
    shouldStepOut,
    canRenegotiate,
    lowestViableAskCents,
    recommendation,
    email,
  };
}

/**
 * Calculate the profitability window for a contract.
 *
 * Returns days until step-out is economically necessary.
 */
export function profitWindow(
  contractPriceCents: number,
  targetAssignmentFeeCents: number,
  inspectionDays: number,
  contractCreatedAt: Date,
  now: Date = new Date()
): { daysToProfit: number; profitable: boolean; minBuyerPriceCents: number } {
  const clock = clockState(contractCreatedAt, inspectionDays, now);
  const minBuyerPriceCents = contractPriceCents + FEE_FLOOR_CENTS;
  const targetBuyerPriceCents = contractPriceCents + targetAssignmentFeeCents;

  return {
    daysToProfit: clock.daysRemaining,
    profitable: targetAssignmentFeeCents >= FEE_FLOOR_CENTS,
    minBuyerPriceCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUYER/SELLER STEP-OUT CONFIRMATION FLOW
// When prospect wants to step out during inspection period, they must confirm.
// ─────────────────────────────────────────────────────────────────────────────

export type StepOutParty = 'seller' | 'buyer';

export interface StepOutConfirmationContext {
  organizationId: string;
  contractId: string;
  party: StepOutParty;
  partyName: string;
  partyEmail: string;
  propertyAddress: string;
  otherPartyName?: string;
  otherPartyEmail?: string;
  inspectionDaysRemaining: number;
  confirmationToken: string;
}

/**
 * Generate step-out confirmation email (sent when party requests to cancel).
 * They must click a link to confirm the step-out.
 */
export function generateStepOutConfirmationEmail(ctx: StepOutConfirmationContext): StepOutEmail {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';
  const confirmUrl = `${baseUrl}/api/contracts/step-out/confirm?token=${ctx.confirmationToken}`;

  const subject = `Action Required: Confirm Cancellation Request - ${ctx.propertyAddress}`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>Dear ${ctx.partyName},</p>

  <p>We received your request to step out of the contract for:</p>

  <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
    <strong>${ctx.propertyAddress}</strong><br>
    Inspection Period: ${ctx.inspectionDaysRemaining} days remaining
  </div>

  <p>To confirm this cancellation, please click the button below:</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${confirmUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
      Confirm Cancellation
    </a>
  </div>

  <p style="color: #666; font-size: 14px;">
    <strong>Important:</strong> Once confirmed, this action cannot be undone. The contract will be terminated and all parties will be notified.
  </p>

  <p>If you did not request this cancellation or have changed your mind, simply ignore this email. No action will be taken.</p>

  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

  const text = `
Dear ${ctx.partyName},

We received your request to step out of the contract for:
${ctx.propertyAddress}
Inspection Period: ${ctx.inspectionDaysRemaining} days remaining

To confirm this cancellation, visit: ${confirmUrl}

IMPORTANT: Once confirmed, this action cannot be undone.

If you did not request this cancellation, ignore this email.

Best regards,
The DealFlow Team
`.trim();

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: 'high',
  };
}

/**
 * Generate email sent to seller when deal is cancelled (step-out confirmed).
 */
export function generateSellerCancellationConfirmedEmail(ctx: {
  sellerName: string;
  propertyAddress: string;
}): StepOutEmail {
  const subject = `Contract Terminated - ${ctx.propertyAddress}`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>Dear ${ctx.sellerName},</p>

  <p>This confirms that the contract for <strong>${ctx.propertyAddress}</strong> has been cancelled at your request.</p>

  <p>You are now free to:</p>
  <ul>
    <li>List the property with other buyers</li>
    <li>Accept new offers</li>
    <li>Work with other investors</li>
  </ul>

  <p>We appreciate you working with us. If you ever reconsider or have another property in the future, we'd be happy to work with you again.</p>

  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

  const text = `
Dear ${ctx.sellerName},

This confirms that the contract for ${ctx.propertyAddress} has been cancelled at your request.

You are now free to list the property with other buyers, accept new offers, or work with other investors.

We appreciate you working with us.

Best regards,
The DealFlow Team
`.trim();

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: 'normal',
  };
}

/**
 * Generate email sent to buyer when seller cancels (sophisticated but understandable).
 * This is the "seller-has-canceled" email with empathy and explanation.
 */
export function generateBuyerNotificationOfSellerCancellation(ctx: {
  buyerName: string;
  sellerName: string;
  propertyAddress: string;
  assignmentFeeCents?: number;
}): StepOutEmail {
  const subject = `Important Update: Contract Cancelled - ${ctx.propertyAddress}`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>Dear ${ctx.buyerName},</p>

  <p>I'm reaching out with an important update regarding the property at <strong>${ctx.propertyAddress}</strong>.</p>

  <p>Unfortunately, the seller has exercised their right to cancel the contract during the inspection period. While this is disappointing, I want to explain what happened and why we allow this.</p>

  <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
    <strong>Why we allow seller step-outs:</strong><br>
    In our experience, out of every 100+ contracts we facilitate, perhaps 1-2 sellers will exercise this option. It's not common, but it's an important part of how we do business.
  </div>

  <p>By giving sellers a brief window to reconsider, we:</p>
  <ul>
    <li>Build trust that leads to more quality deals</li>
    <li>Ensure sellers feel comfortable and not pressured</li>
    <li>Maintain our reputation for fair, transparent dealings</li>
    <li>Reduce the risk of disputes or legal complications down the road</li>
  </ul>

  <p>I understand this is frustrating, especially if you were excited about this property. Here's what happens next:</p>

  <ol>
    <li>Any earnest money you've submitted will be returned in full</li>
    <li>We're actively sourcing similar properties in the area</li>
    <li>You'll be the first to know about comparable opportunities</li>
  </ol>

  <p>We sincerely apologize for any inconvenience this causes. Our team is committed to finding you a great investment property, and we'll be in touch soon with new opportunities.</p>

  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>

  <p style="font-size: 12px; color: #666; margin-top: 30px;">
    Questions? Reply to this email and we'll get back to you within 24 hours.
  </p>
</div>`;

  const text = `
Dear ${ctx.buyerName},

I'm reaching out with an important update regarding the property at ${ctx.propertyAddress}.

Unfortunately, the seller has exercised their right to cancel the contract during the inspection period. While this is disappointing, I want to explain what happened.

WHY WE ALLOW SELLER STEP-OUTS:
In our experience, out of every 100+ contracts we facilitate, perhaps 1-2 sellers will exercise this option. It's not common, but it's an important part of how we do business.

By giving sellers a brief window to reconsider, we:
- Build trust that leads to more quality deals
- Ensure sellers feel comfortable and not pressured
- Maintain our reputation for fair, transparent dealings
- Reduce the risk of disputes or legal complications

WHAT HAPPENS NEXT:
1. Any earnest money you've submitted will be returned in full
2. We're actively sourcing similar properties in the area
3. You'll be the first to know about comparable opportunities

We sincerely apologize for any inconvenience. We'll be in touch soon with new opportunities.

Best regards,
The DealFlow Team
`.trim();

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: 'high',
  };
}

/**
 * Generate email sent to seller when buyer cancels.
 */
export function generateSellerNotificationOfBuyerCancellation(ctx: {
  sellerName: string;
  buyerName: string;
  propertyAddress: string;
}): StepOutEmail {
  const subject = `Update: Buyer Changed Plans - ${ctx.propertyAddress}`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>Dear ${ctx.sellerName},</p>

  <p>I wanted to update you on the status of your property at <strong>${ctx.propertyAddress}</strong>.</p>

  <p>The buyer we had assigned to your property has decided not to proceed with the purchase. This happens occasionally in real estate — circumstances change, financing plans shift, or priorities adjust.</p>

  <p><strong>What this means for you:</strong></p>
  <ul>
    <li>Our contract remains in place — nothing changes on your end</li>
    <li>We are actively marketing your property to our buyer network</li>
    <li>We have several interested investors we're reaching out to</li>
  </ul>

  <p>We remain committed to closing this deal. In most cases, we're able to find a replacement buyer within a few days. We'll keep you updated on our progress.</p>

  <p>If you have any questions or concerns, please don't hesitate to reach out.</p>

  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

  const text = `
Dear ${ctx.sellerName},

I wanted to update you on the status of your property at ${ctx.propertyAddress}.

The buyer we had assigned to your property has decided not to proceed with the purchase. This happens occasionally in real estate.

WHAT THIS MEANS FOR YOU:
- Our contract remains in place — nothing changes on your end
- We are actively marketing your property to our buyer network
- We have several interested investors we're reaching out to

We remain committed to closing this deal. In most cases, we're able to find a replacement buyer within a few days.

If you have any questions, please reach out.

Best regards,
The DealFlow Team
`.trim();

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: 'normal',
  };
}

/**
 * Generate the final "deal has ended" confirmation email.
 */
export function generateDealEndedEmail(ctx: {
  recipientName: string;
  propertyAddress: string;
  party: StepOutParty;
  initiatedBy: StepOutParty;
}): StepOutEmail {
  const wasInitiator = ctx.party === ctx.initiatedBy;
  const subject = `Contract Closed - ${ctx.propertyAddress}`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
  <p>Dear ${ctx.recipientName},</p>

  <p>This email confirms that the contract for <strong>${ctx.propertyAddress}</strong> has been formally closed and terminated.</p>

  ${wasInitiator
    ? `<p>As you requested, all parties have been notified and the contract is now void. You are free to proceed with other plans for the property.</p>`
    : `<p>The other party has exercised their right to terminate the contract during the inspection period. While unexpected, this is within the terms we agreed to.</p>`
  }

  <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
    <strong>Contract Status:</strong> Terminated<br>
    <strong>Effective Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}<br>
    <strong>Initiated By:</strong> ${ctx.initiatedBy === 'seller' ? 'Seller' : 'Buyer'}
  </div>

  <p>Thank you for working with us. We wish you the best with your real estate endeavors.</p>

  <p style="margin-top: 24px;">
    Best regards,<br>
    The DealFlow Team
  </p>
</div>`;

  const text = `
Dear ${ctx.recipientName},

This confirms that the contract for ${ctx.propertyAddress} has been formally closed and terminated.

Contract Status: Terminated
Effective Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Initiated By: ${ctx.initiatedBy === 'seller' ? 'Seller' : 'Buyer'}

Thank you for working with us.

Best regards,
The DealFlow Team
`.trim();

  return {
    subject,
    bodyHtml: html,
    bodyText: text,
    priority: 'normal',
  };
}

/**
 * Generate a formal cancellation notice (for legal/compliance).
 */
export function generateCancellationNotice(ctx: StepOutContext): string {
  const now = ctx.now || new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
NOTICE OF CONTRACT TERMINATION

Date: ${dateStr}

To: ${ctx.sellerName}
Property: ${ctx.propertyAddress}

RE: Termination of Purchase Agreement

Dear ${ctx.sellerName},

This letter serves as formal notice that we are exercising our right to terminate
the Purchase Agreement dated for the property located at:

${ctx.propertyAddress}

This termination is made pursuant to the inspection contingency provision of the
Agreement. Effective upon your receipt of this notice, the Agreement is terminated
and all parties are released from their obligations thereunder.

Any earnest money deposit shall be handled in accordance with the terms of the
Agreement.

Sincerely,

DealFlow AI
`.trim();
}

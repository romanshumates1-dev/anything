/**
 * Assignment Signed Follow-Up Email
 * Sophisticated, easily understandable email sent after buyer signs assignment.
 * Comprehensive on details, written for a 3rd-grader to understand.
 */

export interface AssignmentFollowupData {
  // Buyer info
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;

  // Property info
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;

  // Financial details
  purchasePrice: number;
  assignmentFee: number;
  totalDueAtClosing: number;
  estimatedARV?: number;
  estimatedRehab?: number;

  // Dates
  assignmentSignedDate: string;
  closingDate: string;
  inspectionPeriodEnds?: string;
  wireInstructionsDueDate?: string;

  // Title company
  titleCompanyName: string;
  titleCompanyContact?: string;
  titleCompanyPhone?: string;
  titleCompanyEmail?: string;

  // Deal team
  dealSwiftContact: string;
  dealSwiftPhone: string;
  dealSwiftEmail: string;

  // Deal ID
  dealId: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US');
}

function calculatePotentialEquity(data: AssignmentFollowupData): number | null {
  if (!data.estimatedARV) return null;
  const rehab = data.estimatedRehab || 0;
  return data.estimatedARV - data.totalDueAtClosing - rehab;
}

export function generateAssignmentFollowupEmail(data: AssignmentFollowupData): {
  subject: string;
  html: string;
  text: string;
} {
  const potentialEquity = calculatePotentialEquity(data);

  const subject = `Congratulations! Your Deal is Confirmed: ${data.propertyAddress}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; border-radius: 8px 8px 0 0; }
    .header h1 { color: white; margin: 0; font-size: 24px; }
    .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 18px; font-weight: bold; color: #1e3a5f; margin-bottom: 15px; border-bottom: 2px solid #059669; padding-bottom: 8px; }
    .highlight-box { background: #ecfdf5; padding: 20px; border-radius: 8px; border: 1px solid #a7f3d0; margin: 15px 0; }
    .warning-box { background: #fef3c7; padding: 15px; border-radius: 8px; border: 1px solid #fcd34d; margin: 15px 0; }
    .info-box { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 15px 0; }
    .number-big { font-size: 28px; font-weight: bold; color: #059669; }
    .number-breakdown { color: #64748b; font-size: 14px; }
    .timeline { list-style: none; padding: 0; }
    .timeline li { padding: 10px 0 10px 30px; position: relative; border-left: 2px solid #e2e8f0; }
    .timeline li:before { content: ''; position: absolute; left: -6px; top: 14px; width: 10px; height: 10px; border-radius: 50%; background: #059669; }
    .timeline li:first-child:before { background: #059669; }
    .checklist { list-style: none; padding: 0; }
    .checklist li { padding: 8px 0; padding-left: 25px; position: relative; }
    .checklist li:before { content: '☐'; position: absolute; left: 0; }
    table { width: 100%; border-collapse: collapse; }
    table td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
    table td:first-child { color: #64748b; width: 40%; }
    .faq-q { font-weight: bold; color: #1e3a5f; margin-top: 15px; }
    .faq-a { color: #475569; margin-bottom: 10px; }
    .footer { background: #1e293b; padding: 20px; border-radius: 0 0 8px 8px; text-align: center; }
    .footer p { color: #94a3b8; font-size: 12px; margin: 5px 0; }
  </style>
</head>
<body>
  <div class="container">
    <!-- HEADER -->
    <div class="header">
      <h1>🎉 Congratulations, ${data.buyerName}!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Your deal is confirmed and locked in.</p>
    </div>

    <div class="content">
      <!-- SECTION 1: DEAL CONFIRMED -->
      <div class="section">
        <div class="highlight-box">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #065f46;">DEAL CONFIRMED</p>
          <p style="margin: 0; font-size: 20px; font-weight: bold; color: #1e3a5f;">${data.propertyAddress}</p>
          <p style="margin: 5px 0 0 0; color: #64748b;">${data.propertyCity}, ${data.propertyState} ${data.propertyZip}</p>
          <p class="number-big" style="margin-top: 15px;">${formatCurrency(data.totalDueAtClosing)}</p>
          <p class="number-breakdown">Your total investment at closing</p>
        </div>
      </div>

      <!-- SECTION 2: WHAT YOU JUST AGREED TO -->
      <div class="section">
        <div class="section-title">What You Just Agreed To (Plain English)</div>
        <div class="info-box">
          <p><strong>Here's exactly what happened:</strong></p>
          <ul style="padding-left: 20px; color: #475569;">
            <li>You bought the <strong>rights to purchase</strong> ${data.propertyAddress} for ${formatCurrency(data.purchasePrice)}</li>
            <li>You paid <strong>${formatCurrency(data.assignmentFee)}</strong> for this opportunity (assignment fee)</li>
            <li>At closing, you'll pay <strong>${formatCurrency(data.purchasePrice)}</strong> directly to the seller</li>
            <li>Your <strong>total investment</strong>: ${formatCurrency(data.totalDueAtClosing)} (${formatCurrency(data.purchasePrice)} + ${formatCurrency(data.assignmentFee)})</li>
          </ul>
          <p style="color: #059669; font-weight: bold; margin-bottom: 0;">✓ The property is now reserved for YOU. No one else can buy it.</p>
        </div>
      </div>

      <!-- SECTION 3: THE NUMBERS BREAKDOWN -->
      <div class="section">
        <div class="section-title">The Numbers Breakdown</div>
        <table>
          <tr>
            <td>Property Purchase Price</td>
            <td style="font-weight: bold;">${formatCurrency(data.purchasePrice)}</td>
          </tr>
          <tr>
            <td>Assignment Fee (already paid)</td>
            <td style="font-weight: bold;">${formatCurrency(data.assignmentFee)}</td>
          </tr>
          <tr style="background: #f0fdf4;">
            <td style="font-weight: bold; color: #1e3a5f;">TOTAL INVESTMENT</td>
            <td style="font-weight: bold; color: #059669; font-size: 18px;">${formatCurrency(data.totalDueAtClosing)}</td>
          </tr>
          ${data.estimatedARV ? `
          <tr>
            <td>Estimated After-Repair Value (ARV)</td>
            <td>${formatCurrency(data.estimatedARV)}</td>
          </tr>
          ` : ''}
          ${data.estimatedRehab ? `
          <tr>
            <td>Estimated Rehab Costs</td>
            <td>${formatCurrency(data.estimatedRehab)}</td>
          </tr>
          ` : ''}
          ${potentialEquity !== null ? `
          <tr style="background: #ecfdf5;">
            <td style="font-weight: bold;">Potential Equity at Close</td>
            <td style="font-weight: bold; color: #059669;">${formatCurrency(potentialEquity)}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      <!-- SECTION 4: WHAT HAPPENS NEXT -->
      <div class="section">
        <div class="section-title">What Happens Next (Timeline)</div>
        <ul class="timeline">
          <li><strong>TODAY</strong> - Your signed assignment contract is on file ✓</li>
          <li><strong>WITHIN 48 HOURS</strong> - Title company receives all documents</li>
          <li><strong>5-7 BUSINESS DAYS</strong> - Title search completed for clear title</li>
          <li><strong>CLOSING DAY (${formatDate(data.closingDate)})</strong> - Bring certified funds or wire confirmation</li>
          <li><strong>SAME DAY</strong> - Keys in hand, property is yours!</li>
        </ul>
      </div>

      <!-- SECTION 5: IMPORTANT DATES -->
      <div class="section">
        <div class="section-title">Important Dates - Mark Your Calendar</div>
        <div class="warning-box">
          <table style="margin: 0;">
            <tr>
              <td>📝 Assignment Signed</td>
              <td><strong>${formatDate(data.assignmentSignedDate)}</strong></td>
            </tr>
            ${data.inspectionPeriodEnds ? `
            <tr>
              <td>🔍 Inspection Period Ends</td>
              <td><strong>${formatDate(data.inspectionPeriodEnds)}</strong></td>
            </tr>
            ` : ''}
            ${data.wireInstructionsDueDate ? `
            <tr>
              <td>💰 Wire Instructions Due</td>
              <td><strong>${formatDate(data.wireInstructionsDueDate)}</strong></td>
            </tr>
            ` : ''}
            <tr style="background: #fef3c7;">
              <td>🏠 <strong>CLOSING DATE</strong></td>
              <td><strong style="color: #92400e; font-size: 16px;">${formatDate(data.closingDate)}</strong></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- SECTION 6: REQUIRED ACTIONS -->
      <div class="section">
        <div class="section-title">Your Action Items</div>
        <div class="info-box">
          <ul class="checklist">
            <li><strong>Confirm receipt</strong> of this email (reply "Got it!")</li>
            <li><strong>Add closing date</strong> to your calendar: ${formatDate(data.closingDate)}</li>
            <li><strong>Prepare certified funds</strong> or set up wire transfer</li>
            <li><strong>Contact your lender</strong> if financing (close date is fixed)</li>
            <li><strong>Schedule property inspection</strong> if not already waived</li>
            <li><strong>Arrange insurance</strong> (required by some title companies)</li>
          </ul>
        </div>
      </div>

      <!-- SECTION 7: TITLE COMPANY INFO -->
      <div class="section">
        <div class="section-title">Title Company Information</div>
        <div class="info-box">
          <table style="margin: 0;">
            <tr>
              <td>Company</td>
              <td><strong>${data.titleCompanyName}</strong></td>
            </tr>
            ${data.titleCompanyContact ? `
            <tr>
              <td>Contact</td>
              <td>${data.titleCompanyContact}</td>
            </tr>
            ` : ''}
            ${data.titleCompanyPhone ? `
            <tr>
              <td>Phone</td>
              <td><a href="tel:${data.titleCompanyPhone}">${data.titleCompanyPhone}</a></td>
            </tr>
            ` : ''}
            ${data.titleCompanyEmail ? `
            <tr>
              <td>Email</td>
              <td><a href="mailto:${data.titleCompanyEmail}">${data.titleCompanyEmail}</a></td>
            </tr>
            ` : ''}
          </table>
          <p style="color: #64748b; font-size: 13px; margin: 15px 0 0 0;">
            ⚠️ <strong>Wire instructions</strong> will be sent via separate secure email from the title company.
            Never wire funds based on instructions received by regular email alone.
          </p>
        </div>
      </div>

      <!-- SECTION 8: YOUR DEAL TEAM -->
      <div class="section">
        <div class="section-title">Your DealSwift Team</div>
        <div class="highlight-box">
          <table style="margin: 0;">
            <tr>
              <td>Your Contact</td>
              <td><strong>${data.dealSwiftContact}</strong></td>
            </tr>
            <tr>
              <td>Phone</td>
              <td><a href="tel:${data.dealSwiftPhone}">${data.dealSwiftPhone}</a></td>
            </tr>
            <tr>
              <td>Email</td>
              <td><a href="mailto:${data.dealSwiftEmail}">${data.dealSwiftEmail}</a></td>
            </tr>
            <tr>
              <td>Response Time</td>
              <td>Within 2 hours (business hours)</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- SECTION 9: FAQ -->
      <div class="section">
        <div class="section-title">Frequently Asked Questions</div>

        <p class="faq-q">Q: What if I can't close on time?</p>
        <p class="faq-a">A: Contact us <strong>immediately</strong>. Extensions may be possible but require seller approval. The sooner you tell us, the better your chances.</p>

        <p class="faq-q">Q: Can I back out of the deal?</p>
        <p class="faq-a">A: Your earnest money is non-refundable after the inspection period ends. If you cannot close, you forfeit the ${formatCurrency(data.assignmentFee)} assignment fee already paid. We strongly recommend completing your due diligence before the inspection period ends.</p>

        <p class="faq-q">Q: How do I get the property inspected?</p>
        <p class="faq-a">A: Schedule with any licensed home inspector. We recommend getting it done within the first week. ${data.inspectionPeriodEnds ? `Your inspection must be completed by ${formatDate(data.inspectionPeriodEnds)}.` : ''}</p>

        <p class="faq-q">Q: What documents do I need at closing?</p>
        <p class="faq-a">A: Bring a <strong>valid government ID</strong> (driver's license or passport), <strong>certified funds or wire confirmation</strong>, and <strong>proof of insurance</strong> if required by the title company.</p>

        <p class="faq-q">Q: Can I assign this to someone else?</p>
        <p class="faq-a">A: In most cases, yes. Contact us first - additional assignment fees may apply.</p>
      </div>

      <!-- SECTION 10: LEGAL REMINDER -->
      <div class="section">
        <div class="warning-box">
          <p style="margin: 0; font-weight: bold; color: #92400e;">⚖️ Important Legal Reminder</p>
          <p style="margin: 10px 0 0 0; color: #78350f; font-size: 14px;">
            This is a <strong>contract assignment</strong>, not a new purchase agreement.
            You are stepping into the original buyer's shoes and assuming all obligations.
            All terms of the original purchase agreement between the seller and DealSwift Automation LLC now apply to you.
          </p>
        </div>
      </div>

      <!-- SECTION 11: SUPPORT -->
      <div class="section" style="text-align: center; margin-bottom: 0;">
        <p style="font-size: 16px; color: #1e3a5f;">Questions? We're here to help you close smoothly.</p>
        <p style="margin: 15px 0;">
          <a href="mailto:${data.dealSwiftEmail}" style="display: inline-block; background: #059669; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reply to This Email</a>
          &nbsp;&nbsp;or&nbsp;&nbsp;
          <a href="tel:${data.dealSwiftPhone}" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Call ${data.dealSwiftPhone}</a>
        </p>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <p>Deal ID: ${data.dealId}</p>
      <p>DealSwift Automation LLC</p>
      <p>This email was sent because you signed an assignment contract for the property above.</p>
    </div>
  </div>
</body>
</html>
`;

  // Plain text version
  const text = `
CONGRATULATIONS, ${data.buyerName}!
Your Deal is Confirmed
================================

PROPERTY: ${data.propertyAddress}
${data.propertyCity}, ${data.propertyState} ${data.propertyZip}

TOTAL INVESTMENT: ${formatCurrency(data.totalDueAtClosing)}

--------------------------------
WHAT YOU JUST AGREED TO
--------------------------------

Here's exactly what happened:
• You bought the rights to purchase ${data.propertyAddress} for ${formatCurrency(data.purchasePrice)}
• You paid ${formatCurrency(data.assignmentFee)} for this opportunity (assignment fee)
• At closing, you'll pay ${formatCurrency(data.purchasePrice)} directly to the seller
• Your total investment: ${formatCurrency(data.totalDueAtClosing)}

The property is now reserved for YOU. No one else can buy it.

--------------------------------
THE NUMBERS BREAKDOWN
--------------------------------

Property Purchase Price: ${formatCurrency(data.purchasePrice)}
Assignment Fee (already paid): ${formatCurrency(data.assignmentFee)}
TOTAL INVESTMENT: ${formatCurrency(data.totalDueAtClosing)}
${data.estimatedARV ? `Estimated ARV: ${formatCurrency(data.estimatedARV)}` : ''}
${data.estimatedRehab ? `Estimated Rehab: ${formatCurrency(data.estimatedRehab)}` : ''}
${potentialEquity !== null ? `Potential Equity: ${formatCurrency(potentialEquity)}` : ''}

--------------------------------
WHAT HAPPENS NEXT
--------------------------------

1. TODAY - Your signed assignment contract is on file
2. WITHIN 48 HOURS - Title company receives documents
3. 5-7 BUSINESS DAYS - Title search completed
4. CLOSING DAY (${formatDate(data.closingDate)}) - Bring certified funds
5. SAME DAY - Keys in hand!

--------------------------------
IMPORTANT DATES
--------------------------------

Assignment Signed: ${formatDate(data.assignmentSignedDate)}
${data.inspectionPeriodEnds ? `Inspection Period Ends: ${formatDate(data.inspectionPeriodEnds)}` : ''}
${data.wireInstructionsDueDate ? `Wire Instructions Due: ${formatDate(data.wireInstructionsDueDate)}` : ''}
CLOSING DATE: ${formatDate(data.closingDate)}

--------------------------------
YOUR ACTION ITEMS
--------------------------------

[ ] Confirm receipt of this email
[ ] Add closing date to your calendar
[ ] Prepare certified funds or wire
[ ] Contact lender if financing
[ ] Schedule property inspection
[ ] Arrange insurance

--------------------------------
TITLE COMPANY
--------------------------------

${data.titleCompanyName}
${data.titleCompanyContact || ''}
${data.titleCompanyPhone || ''}
${data.titleCompanyEmail || ''}

Wire instructions will be sent via separate secure email.

--------------------------------
YOUR DEALSWIFT TEAM
--------------------------------

Contact: ${data.dealSwiftContact}
Phone: ${data.dealSwiftPhone}
Email: ${data.dealSwiftEmail}
Response Time: Within 2 hours (business hours)

--------------------------------
FAQ
--------------------------------

Q: What if I can't close on time?
A: Contact us immediately. Extensions may be possible but require seller approval.

Q: Can I back out?
A: Your earnest money is non-refundable after inspection period. If you cannot close, you forfeit the ${formatCurrency(data.assignmentFee)} assignment fee.

Q: What documents do I need at closing?
A: Valid government ID, certified funds or wire confirmation, proof of insurance (if required).

--------------------------------
LEGAL REMINDER
--------------------------------

This is a contract assignment, not a new purchase agreement. You are stepping into the original buyer's shoes. All terms of the original purchase agreement apply to you.

--------------------------------

Questions? Reply to this email or call ${data.dealSwiftPhone}

Deal ID: ${data.dealId}
DealSwift Automation LLC
`;

  return { subject, html, text };
}

/**
 * Generate closing timeline visualization email
 */
export function generateClosingTimelineEmail(data: AssignmentFollowupData): {
  subject: string;
  html: string;
} {
  const subject = `Your Closing Timeline: ${data.propertyAddress}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #1e3a5f; padding: 20px; color: white; border-radius: 8px 8px 0 0; }
    .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
    .timeline-item { display: flex; margin-bottom: 20px; }
    .timeline-marker { width: 40px; text-align: center; }
    .timeline-check { width: 30px; height: 30px; border-radius: 50%; background: #059669; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .timeline-pending { background: #e2e8f0; color: #64748b; }
    .timeline-content { flex: 1; padding-left: 15px; }
    .timeline-date { font-size: 12px; color: #64748b; }
    .timeline-title { font-weight: bold; color: #1e3a5f; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">📅 Your Closing Timeline</h2>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${data.propertyAddress}</p>
    </div>
    <div class="content">
      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check">✓</div></div>
        <div class="timeline-content">
          <div class="timeline-date">${formatDate(data.assignmentSignedDate)}</div>
          <div class="timeline-title">Assignment Contract Signed</div>
          <p style="margin: 5px 0 0 0; color: #475569;">Your deal is locked in!</p>
        </div>
      </div>

      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check timeline-pending">2</div></div>
        <div class="timeline-content">
          <div class="timeline-date">Within 48 hours</div>
          <div class="timeline-title">Documents to Title Company</div>
          <p style="margin: 5px 0 0 0; color: #475569;">All paperwork forwarded for processing</p>
        </div>
      </div>

      ${data.inspectionPeriodEnds ? `
      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check timeline-pending">3</div></div>
        <div class="timeline-content">
          <div class="timeline-date">${formatDate(data.inspectionPeriodEnds)}</div>
          <div class="timeline-title">Inspection Period Ends</div>
          <p style="margin: 5px 0 0 0; color: #475569;">Complete your due diligence before this date</p>
        </div>
      </div>
      ` : ''}

      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check timeline-pending">4</div></div>
        <div class="timeline-content">
          <div class="timeline-date">5-7 business days before closing</div>
          <div class="timeline-title">Title Search Complete</div>
          <p style="margin: 5px 0 0 0; color: #475569;">Clear title confirmed</p>
        </div>
      </div>

      ${data.wireInstructionsDueDate ? `
      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check timeline-pending">5</div></div>
        <div class="timeline-content">
          <div class="timeline-date">${formatDate(data.wireInstructionsDueDate)}</div>
          <div class="timeline-title">Wire Instructions Due</div>
          <p style="margin: 5px 0 0 0; color: #475569;">Initiate wire transfer by this date</p>
        </div>
      </div>
      ` : ''}

      <div class="timeline-item">
        <div class="timeline-marker"><div class="timeline-check timeline-pending" style="background: #059669; color: white;">★</div></div>
        <div class="timeline-content">
          <div class="timeline-date" style="font-weight: bold; color: #059669;">${formatDate(data.closingDate)}</div>
          <div class="timeline-title" style="font-size: 18px;">CLOSING DAY</div>
          <p style="margin: 5px 0 0 0; color: #475569;">Bring ID + certified funds. Keys handed over!</p>
        </div>
      </div>

      <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: center;">
        <p style="margin: 0; font-weight: bold; color: #065f46;">Questions about your timeline?</p>
        <p style="margin: 10px 0 0 0;">
          <a href="mailto:${data.dealSwiftEmail}">${data.dealSwiftEmail}</a> |
          <a href="tel:${data.dealSwiftPhone}">${data.dealSwiftPhone}</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  return { subject, html };
}

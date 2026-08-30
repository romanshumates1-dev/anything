/**
 * Deal Summary API
 * GET /api/deals/summary?dealId=xxx
 * Returns a 3rd-grader readable deal summary for buyers.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

interface DealSummary {
  dealId: string;
  propertyAddress: string;
  city: string;
  state: string;
  zip: string;

  // Pricing
  purchasePrice: number;
  assignmentFee: number;
  totalDueAtClosing: number;

  // Value
  estimatedARV?: number;
  estimatedRehab?: number;
  potentialProfit?: number;

  // Timeline
  closingDate: string;
  closingDays: number;
  inspectionDays?: number;

  // Rendered views
  html: string;
  text: string;
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US');
}

function generateSummaryHTML(data: Partial<DealSummary>): string {
  const potentialProfit = data.potentialProfit || 0;

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; }
    .summary { max-width: 500px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; margin-bottom: 20px; }
    .property { font-size: 18px; font-weight: bold; color: #1e3a5f; }
    .total-box { background: #f0fdf4; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .total-label { font-size: 14px; color: #64748b; }
    .total-amount { font-size: 32px; font-weight: bold; color: #059669; }
    .breakdown { background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .breakdown-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .breakdown-row:last-child { border-bottom: none; }
    .what-you-get { background: #ecfdf5; padding: 15px; border-radius: 8px; }
    .what-you-get h3 { margin: 0 0 10px 0; color: #065f46; }
    .what-you-get li { margin: 5px 0; color: #047857; }
    .cta { text-align: center; margin-top: 20px; }
    .cta a { display: inline-block; background: #059669; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="summary">
    <div class="header">
      <div style="font-size: 24px;">🏠</div>
      <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">Deal Summary</div>
    </div>

    <div class="property">${data.propertyAddress || 'Property'}</div>
    <div style="color: #64748b;">${data.city || ''}, ${data.state || ''} ${data.zip || ''}</div>

    <div class="total-box">
      <div class="total-label">You Pay at Closing</div>
      <div class="total-amount">${formatCurrency(data.totalDueAtClosing || 0)}</div>
    </div>

    <div class="breakdown">
      <div class="breakdown-row">
        <span>Goes to Seller</span>
        <span>${formatCurrency(data.purchasePrice || 0)}</span>
      </div>
      <div class="breakdown-row">
        <span>Assignment Fee</span>
        <span>${formatCurrency(data.assignmentFee || 0)}</span>
      </div>
    </div>

    <div class="what-you-get">
      <h3>What You Get</h3>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${data.estimatedARV ? `<li>✓ Property worth ~${formatCurrency(data.estimatedARV)} (ARV)</li>` : ''}
        ${potentialProfit > 0 ? `<li>✓ Potential profit: ${formatCurrency(potentialProfit)}</li>` : ''}
        ${data.closingDays ? `<li>✓ Close in ${data.closingDays} days</li>` : ''}
        <li>✓ No repairs required to close</li>
        <li>✓ Clear title guaranteed</li>
      </ul>
    </div>

    <div class="cta">
      <a href="#">Continue to Payment Setup →</a>
    </div>
  </div>
</body>
</html>
`;
}

function generateSummaryText(data: Partial<DealSummary>): string {
  const potentialProfit = data.potentialProfit || 0;

  return `
🏠 DEAL SUMMARY

Property: ${data.propertyAddress || 'Property'}
${data.city || ''}, ${data.state || ''} ${data.zip || ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOU PAY AT CLOSING: ${formatCurrency(data.totalDueAtClosing || 0)}

├─ Goes to Seller: ${formatCurrency(data.purchasePrice || 0)}
└─ Assignment Fee: ${formatCurrency(data.assignmentFee || 0)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT YOU GET:
${data.estimatedARV ? `✓ Property worth ~${formatCurrency(data.estimatedARV)} (ARV)` : ''}
${potentialProfit > 0 ? `✓ Potential profit: ${formatCurrency(potentialProfit)}` : ''}
${data.closingDays ? `✓ Close in ${data.closingDays} days` : ''}
✓ No repairs required to close
✓ Clear title guaranteed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Continue to Payment Setup →]
`.trim();
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const dealId = req.nextUrl.searchParams.get('dealId');
  if (!dealId) {
    return Response.json({ error: 'dealId required' }, { status: 400 });
  }

  try {
    // Get deal data
    const [deal] = await sql`
      SELECT * FROM leads
      WHERE id = ${dealId}
      AND organization_id = ${organization.id}
    `;

    if (!deal) {
      return Response.json({ error: 'Deal not found' }, { status: 404 });
    }

    const metadata = deal.metadata || {};

    // Extract pricing info
    const purchasePrice = metadata.purchase_price || metadata.offer_price || 0;
    const assignmentFee = metadata.assignment_fee || Math.max(5000, purchasePrice * 0.1);
    const totalDueAtClosing = purchasePrice + assignmentFee;

    // Extract property info
    const propertyAddress = metadata.address || metadata.property_address || '';
    const city = metadata.city || metadata.property_city || '';
    const state = metadata.state || metadata.property_state || '';
    const zip = metadata.zip || metadata.property_zip || '';

    // Value estimates
    const estimatedARV = metadata.arv || metadata.estimated_arv;
    const estimatedRehab = metadata.rehab || metadata.estimated_rehab || 0;
    const potentialProfit = estimatedARV
      ? estimatedARV - totalDueAtClosing - estimatedRehab
      : undefined;

    // Timeline
    const closingDate = metadata.closing_date;
    const closingDays = closingDate
      ? Math.ceil((new Date(closingDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : metadata.closing_days || 21;
    const inspectionDays = metadata.inspection_days;

    const summaryData: Partial<DealSummary> = {
      dealId,
      propertyAddress,
      city,
      state,
      zip,
      purchasePrice,
      assignmentFee,
      totalDueAtClosing,
      estimatedARV,
      estimatedRehab,
      potentialProfit,
      closingDate,
      closingDays,
      inspectionDays,
    };

    const summary: DealSummary = {
      ...summaryData as DealSummary,
      html: generateSummaryHTML(summaryData),
      text: generateSummaryText(summaryData),
    };

    return Response.json(summary);
  } catch (error: any) {
    console.error('[DEAL-SUMMARY] Error:', error);
    return Response.json(
      { error: 'Failed to generate summary', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * @deprecated Use `generateContract` from '@/app/api/contracts' instead.
 * This legacy template-based system is superseded by the regional contract
 * engine which provides state-specific addenda, disclosures, and compliance.
 *
 * Migration:
 *   import { generateContract } from '@/app/api/contracts';
 *   const contract = generateContract(dealData, 'PURCHASE_AGREEMENT');
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { scheduleInspectionUrgency } from '@/app/api/utils/inspectionClock';

/** @deprecated Use `generateContract` from '@/app/api/contracts' */
export async function generateContractFromTemplate(params: {
  organizationId: string;
  templateId: string;
  direction: 'SELLER' | 'BUYER';
  fillData: { price: number; address: string; partyName: string; date: Date };
}): Promise<{ contractId: string }> {
  const { organizationId, templateId, direction, fillData } = params;

  const templateRows = await sql`
    SELECT * FROM contract_templates WHERE id = ${templateId} AND organization_id = ${organizationId}
  `;
  if (templateRows.length === 0) {
    throw new Error('Contract template not found');
  }
  const template = templateRows[0];

  // IMPORTANT: Only merge-field values are substituted. Legal boilerplate is never modified.
  const filled = template.template_body
    .replace(/\{\{price\}\}/g, fillData.price.toLocaleString())
    .replace(/\{\{address\}\}/g, fillData.address)
    .replace(/\{\{partyName\}\}/g, fillData.partyName)
    .replace(/\{\{date\}\}/g, fillData.date.toLocaleDateString());

  // Verify static legal text is unchanged (byte-identical for non-merge sections)
  const staticBefore = template.template_body.replace(/\{\{[^}]+\}\}/g, '{{PLACEHOLDER}}');
  const staticAfter = filled.replace(/\{\{[^}]+\}\}/g, '{{PLACEHOLDER}}');
  if (staticBefore !== staticAfter) {
    throw new Error('Contract fill modified protected legal text');
  }

  // TODO: Render PDF via existing PDF lib (e.g., @react-pdf/renderer or puppeteer)
  // const pdfBuffer = await renderHtmlToPdf(filled);

  const contractId = crypto.randomUUID();
  // Phase V-R: inspection clock starts at creation. Price (dollars) → cents for
  // the day-N−2 lowest-viable-ask math; window defaults to 10 days (7–14).
  const inspectionDays = 10;
  const priceCents = Number.isFinite(Number(fillData.price)) && Number(fillData.price) > 0
    ? Math.round(Number(fillData.price) * 100)
    : null;
  await sql`
    INSERT INTO contracts (id, organization_id, template_id, direction, filled_body, status, inspection_days, contract_price_cents)
    VALUES (${contractId}, ${organizationId}, ${templateId}, ${direction}, ${filled}, 'PENDING_SIGNATURE', ${inspectionDays}, ${priceCents})
  `;

  await logEvent('contract_generated', 'contract', contractId, { templateId, direction, price: fillData.price }, organizationId);

  // Urgency hooks (day 3 + day N−2), idempotent via dedupe keys.
  await scheduleInspectionUrgency(contractId, organizationId, new Date(), inspectionDays);

  return { contractId };
}
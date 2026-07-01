import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

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
  await sql`
    INSERT INTO contracts (id, organization_id, template_id, direction, filled_body, status)
    VALUES (${contractId}, ${organizationId}, ${templateId}, ${direction}, ${filled}, 'PENDING_SIGNATURE')
  `;

  await logEvent('contract_generated', 'contract', contractId, { templateId, direction, price: fillData.price }, organizationId);

  return { contractId };
}
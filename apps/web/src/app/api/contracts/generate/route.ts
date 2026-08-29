/**
 * POST /api/contracts/generate
 *
 * Generate a contract (Purchase Agreement or Assignment) for a deal.
 * Validates deal exists, contract variables match negotiation record,
 * and generates the contract with regional template.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import {
  generateContract,
  validateContractVariables,
  detectState,
  MINIMUM_ASSIGNMENT_FEE,
  type ContractType,
  type DealData,
  type NegotiationRecord,
} from '../engine';
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

interface GenerateContractRequest {
  dealId: string;
  type: ContractType;

  // Optional overrides (if not pulling from deal/negotiation)
  assigneeId?: string;
  assigneeName?: string;
  assigneeAddress?: string;
  assigneePhone?: string;
  assigneeEmail?: string;
  assigneeCompany?: string;
  assigneeTier?: 'VIP' | 'VERIFIED' | 'PROSPECT' | 'UNVERIFIED';

  additionalTerms?: string;
  skipValidation?: boolean; // For admin override - use with caution
}

export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  let body: GenerateContractRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { dealId, type, skipValidation } = body;

  if (!dealId) {
    return Response.json({ error: 'dealId is required' }, { status: 400 });
  }

  if (!type || !['PURCHASE_AGREEMENT', 'ASSIGNMENT'].includes(type)) {
    return Response.json({
      error: 'type must be PURCHASE_AGREEMENT or ASSIGNMENT',
    }, { status: 400 });
  }

  try {
    // Fetch the deal
    const [deal] = await sql`
      SELECT * FROM leads
      WHERE id = ${dealId} AND organization_id = ${organization.id}
    `;

    if (!deal) {
      return Response.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Fetch negotiation record (if exists)
    const [negotiation] = await sql`
      SELECT * FROM negotiations
      WHERE deal_id = ${dealId}
      ORDER BY created_at DESC
      LIMIT 1
    `.catch(() => [null]); // Table may not exist yet

    // Build deal data from database record
    const metadata = deal.metadata || {};
    const dealData: DealData = {
      id: deal.id,
      property_address: metadata.property_address || metadata.address || deal.address || '',
      property_city: metadata.property_city || metadata.city || '',
      property_state: metadata.property_state || metadata.state || '',
      property_zip: metadata.property_zip || metadata.zip || '',
      property_county: metadata.property_county || metadata.county || '',
      property_parcel_id: metadata.parcel_id,
      property_legal_description: metadata.legal_description,
      property_year_built: metadata.year_built ? parseInt(metadata.year_built, 10) : undefined,

      seller_name: metadata.seller_name || metadata.owner_name || deal.name || '',
      seller_address: metadata.seller_address || metadata.mailing_address || '',
      seller_phone: metadata.seller_phone || deal.phone || '',
      seller_email: metadata.seller_email || deal.email || '',

      purchase_price: negotiation?.purchase_price || metadata.agreed_price || metadata.purchase_price || deal.agreed_price || 0,
      earnest_money: metadata.earnest_money || 1000,
      closing_date: negotiation?.closing_date || metadata.closing_date || '',
      contract_date: new Date().toISOString().split('T')[0],
      inspection_days: metadata.inspection_days || 14,
      attorney_mod_days: metadata.attorney_mod_days || 5,

      hoa: metadata.hoa === true || metadata.hoa === 'true',
      condominium: metadata.condominium === true || metadata.condominium === 'true',
      well_water: metadata.well_water === true || metadata.well_water === 'true',
      septic_system: metadata.septic_system === true || metadata.septic_system === 'true',
      flood_zone: metadata.flood_zone,
      special_flood_hazard_area: metadata.special_flood_hazard_area === true,
      earthquake_fault_zone: metadata.earthquake_fault_zone === true,
      fire_hazard_zone: metadata.fire_hazard_zone === true,

      additional_terms: body.additionalTerms || metadata.additional_terms,
      metadata,
    };

    // Auto-detect state if not provided
    if (!dealData.property_state) {
      const detectedState = detectState(dealData.property_address);
      if (detectedState) {
        dealData.property_state = detectedState;
      }
    }

    // Validate required fields
    if (!dealData.property_address) {
      return Response.json({
        error: 'Deal is missing property_address in metadata',
      }, { status: 400 });
    }

    if (!dealData.seller_name) {
      return Response.json({
        error: 'Deal is missing seller/owner name',
      }, { status: 400 });
    }

    if (!dealData.purchase_price || dealData.purchase_price <= 0) {
      return Response.json({
        error: 'Deal is missing valid purchase_price',
      }, { status: 400 });
    }

    // For assignment contracts, get assignee details
    if (type === 'ASSIGNMENT') {
      let assignee: any = null;

      if (body.assigneeId) {
        [assignee] = await sql`
          SELECT * FROM buyers
          WHERE id = ${body.assigneeId} AND organization_id = ${organization.id}
        `.catch(() => [null]);
      }

      // Use provided details or fetch from assignee record
      dealData.assignee_name = body.assigneeName || assignee?.name;
      dealData.assignee_address = body.assigneeAddress || assignee?.address;
      dealData.assignee_phone = body.assigneePhone || assignee?.phone;
      dealData.assignee_email = body.assigneeEmail || assignee?.email;
      dealData.assignee_company = body.assigneeCompany || assignee?.company;
      dealData.assignee_tier = body.assigneeTier || assignee?.tier || 'UNVERIFIED';

      // Get assignment fee from negotiation
      dealData.assignment_fee = negotiation?.assignment_fee || metadata.assignment_fee;

      // Get original contract reference
      const [originalContract] = await sql`
        SELECT id, created_at FROM contracts
        WHERE lead_id = ${dealId} AND type = 'PURCHASE_AGREEMENT' AND status = 'SIGNED'
        ORDER BY created_at DESC
        LIMIT 1
      `.catch(() => [null]);

      if (originalContract) {
        dealData.original_contract_id = originalContract.id;
        dealData.original_contract_date = originalContract.created_at?.split('T')[0];
      } else {
        // Generate a reference ID if no signed contract exists
        dealData.original_contract_id = `PA-${dealId.substring(0, 8)}`;
        dealData.original_contract_date = metadata.contract_date || new Date().toISOString().split('T')[0];
      }

      // Validate assignee requirements
      if (!dealData.assignee_name) {
        return Response.json({
          error: 'Assignment contract requires assignee name (provide assigneeId or assigneeName)',
        }, { status: 400 });
      }

      if (!dealData.assignee_address) {
        return Response.json({
          error: 'Assignment contract requires assignee address',
        }, { status: 400 });
      }

      // HARD FLOOR: Assignment fee must be at least $5,000
      if (!dealData.assignment_fee || dealData.assignment_fee < MINIMUM_ASSIGNMENT_FEE) {
        return Response.json({
          error: `Assignment fee must be at least $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()} (NON-NEGOTIABLE). ` +
                 `Current fee: $${(dealData.assignment_fee || 0).toLocaleString()}`,
        }, { status: 400 });
      }
    }

    // Validate contract variables against negotiation record
    if (negotiation && !skipValidation) {
      const negotiationRecord: NegotiationRecord = {
        id: negotiation.id,
        deal_id: negotiation.deal_id,
        purchase_price: negotiation.purchase_price,
        assignment_fee: negotiation.assignment_fee || MINIMUM_ASSIGNMENT_FEE,
        closing_date: negotiation.closing_date,
        agreed_price: negotiation.agreed_price,
        seller_agreed: negotiation.seller_agreed,
        buyer_agreed: negotiation.buyer_agreed,
      };

      const validation = validateContractVariables(
        {
          purchase_price: dealData.purchase_price,
          assignment_fee: dealData.assignment_fee,
          closing_date: dealData.closing_date,
        },
        negotiationRecord
      );

      if (!validation.valid) {
        return Response.json({
          error: 'Contract variables do not match negotiation record',
          details: validation.errors,
          warnings: validation.warnings,
        }, { status: 400 });
      }

      // Include warnings in response even if valid
      if (validation.warnings.length > 0) {
        console.warn(`[CONTRACTS] Warnings for deal ${dealId}:`, validation.warnings);
      }
    }

    // Generate the contract
    const contract = generateContract(dealData, type);

    // Store the contract in database - failure is an error, not silently ignored
    let contractRecord;
    try {
      contractRecord = await sql`
        INSERT INTO contracts (
          id, organization_id, lead_id, type, status, content,
          regional_addendum, state, disclosures, variables, generated_at
        )
        VALUES (
          ${contract.contractId},
          ${organization.id},
          ${dealId},
          ${type},
          ${contract.status},
          ${contract.content},
          ${contract.regionalAddendum || null},
          ${contract.state},
          ${JSON.stringify(contract.disclosures)},
          ${JSON.stringify(contract.variables)},
          ${contract.generatedAt}
        )
        RETURNING id, status, generated_at
      `;

      if (!contractRecord || contractRecord.length === 0) {
        console.error('[CONTRACTS] Contract INSERT returned no rows');
        return Response.json({ error: 'Failed to save contract to database' }, { status: 500 });
      }
    } catch (err: any) {
      console.error('[CONTRACTS] Failed to store contract in database:', err.message);
      return Response.json({ error: 'Failed to save contract to database' }, { status: 500 });
    }

    // Log the event
    await logEvent('contract_generated', 'contract', contract.contractId, {
      type,
      dealId,
      state: contract.state,
      disclosureCount: contract.disclosures.length,
    }, organization.id);

    // Update deal status
    await sql`
      UPDATE leads
      SET status = ${type === 'ASSIGNMENT' ? 'CONTRACT_GENERATED_ASSIGNMENT' : 'CONTRACT_GENERATED'},
          updated_at = now()
      WHERE id = ${dealId}
    `.catch(() => {
      // Ignore if status column doesn't accept this value
    });

    return Response.json({
      ok: true,
      contractId: contract.contractId,
      type: contract.type,
      status: contract.status,
      state: contract.state,
      disclosures: contract.disclosures,
      generatedAt: contract.generatedAt,
      content: contract.content,
      regionalAddendum: contract.regionalAddendum,
      warnings: negotiation ? [] : ['No negotiation record found - using deal metadata'],
    });

  } catch (error: any) {
    console.error('[CONTRACTS] Error generating contract:', error);
    return Response.json({
      error: error.message || 'Failed to generate contract',
    }, { status: 500 });
  }
}

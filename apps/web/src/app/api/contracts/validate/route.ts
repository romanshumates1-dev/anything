/**
 * POST /api/contracts/validate
 *
 * Validate contract variables against negotiation record.
 * Verifies purchase_price, assignment_fee, closing_date match.
 * Enforces assignment_fee >= $5,000 (NON-NEGOTIABLE).
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  validateContractVariables,
  validateStateRequirements,
  detectState,
  MINIMUM_ASSIGNMENT_FEE,
  type NegotiationRecord,
  type DealData,
} from '../engine';

interface ValidateContractRequest {
  // Option 1: Provide contract variables directly
  purchase_price?: number;
  assignment_fee?: number;
  closing_date?: string;

  // Option 2: Provide deal ID to fetch negotiation
  dealId?: string;

  // Option 3: Provide contract ID to validate existing contract
  contractId?: string;

  // Validate against state requirements
  validateStateRequirements?: boolean;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  let body: ValidateContractRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    let contractVars: {
      purchase_price?: number;
      assignment_fee?: number;
      closing_date?: string;
    } = {};

    let negotiationRecord: NegotiationRecord | null = null;
    let dealData: Partial<DealData> | null = null;

    // Option 1: Direct variables provided
    if (body.purchase_price !== undefined || body.assignment_fee !== undefined || body.closing_date !== undefined) {
      contractVars = {
        purchase_price: body.purchase_price,
        assignment_fee: body.assignment_fee,
        closing_date: body.closing_date,
      };
    }

    // Option 2: Fetch from contract ID
    if (body.contractId) {
      const [contract] = await sql`
        SELECT * FROM contracts
        WHERE id = ${body.contractId} AND organization_id = ${organization.id}
      `.catch(() => [null]);

      if (!contract) {
        return Response.json({ error: 'Contract not found' }, { status: 404 });
      }

      const variables = typeof contract.variables === 'string'
        ? JSON.parse(contract.variables)
        : contract.variables;

      contractVars = {
        purchase_price: variables?.purchase_price,
        assignment_fee: variables?.assignment_fee,
        closing_date: variables?.closing_date,
      };

      // Get the deal ID from contract
      body.dealId = contract.lead_id;
    }

    // Fetch negotiation record if dealId provided
    if (body.dealId) {
      const [deal] = await sql`
        SELECT * FROM leads
        WHERE id = ${body.dealId} AND organization_id = ${organization.id}
      `;

      if (!deal) {
        return Response.json({ error: 'Deal not found' }, { status: 404 });
      }

      const [negotiation] = await sql`
        SELECT * FROM negotiations
        WHERE deal_id = ${body.dealId}
        ORDER BY created_at DESC
        LIMIT 1
      `.catch(() => [null]);

      if (negotiation) {
        negotiationRecord = {
          id: negotiation.id,
          deal_id: negotiation.deal_id,
          purchase_price: negotiation.purchase_price,
          assignment_fee: negotiation.assignment_fee || MINIMUM_ASSIGNMENT_FEE,
          closing_date: negotiation.closing_date,
          agreed_price: negotiation.agreed_price,
          seller_agreed: negotiation.seller_agreed,
          buyer_agreed: negotiation.buyer_agreed,
        };
      }

      // Build partial deal data for state validation
      const metadata = deal.metadata || {};
      dealData = {
        id: deal.id,
        property_address: metadata.property_address || metadata.address || deal.address || '',
        property_city: metadata.property_city || metadata.city || '',
        property_state: metadata.property_state || metadata.state || '',
        property_zip: metadata.property_zip || metadata.zip || '',
        property_county: metadata.property_county || metadata.county || '',
        seller_name: metadata.seller_name || metadata.owner_name || deal.name || '',
        seller_address: metadata.seller_address || metadata.mailing_address || '',
        purchase_price: contractVars.purchase_price || negotiation?.purchase_price || deal.agreed_price || 0,
        closing_date: contractVars.closing_date || negotiation?.closing_date || '',
      };

      // Auto-detect state
      if (!dealData.property_state && dealData.property_address) {
        const detectedState = detectState(dealData.property_address);
        if (detectedState) {
          dealData.property_state = detectedState;
        }
      }
    }

    // Validation 1: Assignment fee floor (ALWAYS ENFORCED)
    if (contractVars.assignment_fee !== undefined) {
      if (contractVars.assignment_fee < MINIMUM_ASSIGNMENT_FEE) {
        errors.push(
          `Assignment fee $${contractVars.assignment_fee.toLocaleString()} is below the ` +
          `MINIMUM of $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()} (NON-NEGOTIABLE)`
        );
      }
    }

    // Validation 2: Compare against negotiation record
    if (negotiationRecord) {
      const negotiationValidation = validateContractVariables(contractVars, negotiationRecord);

      if (!negotiationValidation.valid) {
        errors.push(...negotiationValidation.errors);
      }
      warnings.push(...negotiationValidation.warnings);

      // Also check negotiation record's assignment fee
      if (negotiationRecord.assignment_fee < MINIMUM_ASSIGNMENT_FEE) {
        errors.push(
          `Negotiation record assignment fee $${negotiationRecord.assignment_fee.toLocaleString()} ` +
          `is below the MINIMUM of $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()} - ` +
          `negotiation must be updated before contract generation`
        );
      }
    } else if (body.dealId) {
      warnings.push('No negotiation record found for this deal');
    }

    // Validation 3: State requirements (optional)
    if (body.validateStateRequirements && dealData) {
      const state = dealData.property_state || 'UNKNOWN';
      const stateValidation = validateStateRequirements(dealData as DealData, state);

      if (!stateValidation.valid) {
        errors.push(...stateValidation.errors.map(e => `[State: ${state}] ${e}`));
      }
      warnings.push(...stateValidation.warnings.map(w => `[State: ${state}] ${w}`));
    }

    // Validation 4: Basic field validations
    if (contractVars.purchase_price !== undefined && contractVars.purchase_price <= 0) {
      errors.push('Purchase price must be a positive number');
    }

    if (contractVars.closing_date) {
      const closingDate = new Date(contractVars.closing_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (closingDate < today) {
        warnings.push('Closing date is in the past');
      }
    }

    // Additional checks based on negotiation status
    if (negotiationRecord) {
      if (!negotiationRecord.seller_agreed) {
        warnings.push('Seller has not agreed to the negotiated terms');
      }
      if (!negotiationRecord.buyer_agreed) {
        warnings.push('Buyer has not agreed to the negotiated terms');
      }
    }

    const valid = errors.length === 0;

    return Response.json({
      valid,
      errors,
      warnings,
      validated: {
        purchase_price: contractVars.purchase_price,
        assignment_fee: contractVars.assignment_fee,
        closing_date: contractVars.closing_date,
        assignment_fee_floor: MINIMUM_ASSIGNMENT_FEE,
        assignment_fee_valid: !contractVars.assignment_fee || contractVars.assignment_fee >= MINIMUM_ASSIGNMENT_FEE,
      },
      negotiationRecord: negotiationRecord ? {
        id: negotiationRecord.id,
        purchase_price: negotiationRecord.purchase_price,
        assignment_fee: negotiationRecord.assignment_fee,
        closing_date: negotiationRecord.closing_date,
        seller_agreed: negotiationRecord.seller_agreed,
        buyer_agreed: negotiationRecord.buyer_agreed,
      } : null,
      state: dealData?.property_state || null,
    });

  } catch (error: any) {
    console.error('[CONTRACTS] Validation error:', error);
    return Response.json({
      error: error.message || 'Failed to validate contract',
    }, { status: 500 });
  }
}

/**
 * GET /api/contracts/validate
 *
 * Get validation rules and requirements.
 */
export async function GET() {
  return Response.json({
    rules: {
      assignment_fee: {
        minimum: MINIMUM_ASSIGNMENT_FEE,
        description: 'Minimum assignment fee (NON-NEGOTIABLE)',
        enforced: true,
      },
      purchase_price: {
        minimum: 0,
        description: 'Must be a positive number',
        enforced: true,
      },
      closing_date: {
        description: 'Should not be in the past',
        enforced: false, // Warning only
      },
    },
    negotiation_matching: {
      fields: ['purchase_price', 'assignment_fee', 'closing_date'],
      description: 'Contract variables must match negotiation record',
    },
    state_requirements: {
      supported_states: ['TX', 'FL', 'CA'],
      generic_fallback: true,
      description: 'State-specific disclosure requirements',
    },
  });
}

import sql from '@/app/api/utils/sql';
import {
  REQUIRED_ACCEPTANCE_VERSIONS,
  MESSAGING_AGREEMENT_VERSION,
  ACCEPTANCE_DOC_TYPES,
} from './legal-versions';

/**
 * Server-side acceptance checks (used by the campaign-activation gate and the
 * re-accept status endpoint). Edge-safe query shape but this module is not
 * imported by middleware — middleware inlines the same query so it never pulls
 * a non-edge dependency.
 */

/** True when the user has accepted the CURRENT tos AND privacy versions. */
export async function hasAcceptedCurrentLegal(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT document_type FROM legal_acceptances
    WHERE user_id = ${userId}
      AND (
        (document_type = ${ACCEPTANCE_DOC_TYPES.tos} AND version = ${REQUIRED_ACCEPTANCE_VERSIONS.tos})
        OR (document_type = ${ACCEPTANCE_DOC_TYPES.privacy} AND version = ${REQUIRED_ACCEPTANCE_VERSIONS.privacy})
      )
  `;
  const accepted = new Set((rows as { document_type: string }[]).map((r) => r.document_type));
  return accepted.has(ACCEPTANCE_DOC_TYPES.tos) && accepted.has(ACCEPTANCE_DOC_TYPES.privacy);
}

/** True when the user has accepted the current Messaging Compliance Agreement. */
export async function hasAcceptedMessagingAgreement(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM legal_acceptances
    WHERE user_id = ${userId}
      AND document_type = ${ACCEPTANCE_DOC_TYPES.messaging}
      AND version = ${MESSAGING_AGREEMENT_VERSION}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Shared assignment-fee authority (2026-09-26).
 *
 * The assignment fee is REAL money charged to a buyer. Multiple payment routes
 * (`payments/charge-assignment`, `payments/stripe`) must derive the figure from
 * the CONTRACT — never from the request body — so the resolution rule lives here
 * in one place. A route that cannot resolve a fee must fail closed.
 *
 * Returns 0 when the contract carries no usable fee.
 */
export function resolveAssignmentFeeCents(contract: any): number {
  const candidates = [
    contract?.assignment_fee_cents,
    contract?.deal_metadata?.negotiation?.assignment_fee,
    contract?.deal_metadata?.assignment_fee,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return 0;
}

import { getPublicPlans } from '@/config/plans';

/**
 * Public plan catalog — the SAME source the /pricing page renders from and the
 * entitlement gate enforces. No auth: anyone evaluating the product can read it.
 */
export function GET() {
  return Response.json({ plans: getPublicPlans() });
}

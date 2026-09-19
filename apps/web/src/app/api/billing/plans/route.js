/**
 * Plans API endpoint
 * Single source of truth for subscription plans - fetches from database
 */
import { NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
/**
 * Fetch all subscription plans from database
 */
export async function getPlansFromDB() {
    const rows = await sql `
    SELECT id, name, tier, price_cents, limits
    FROM subscription_plans
    WHERE tier IN ('free', 'starter', 'pro', 'business', 'scale')
    ORDER BY price_cents ASC
  `;
    return rows;
}
/**
 * Transform DB plan to UI-friendly format
 */
export function transformPlanForUI(plan) {
    const limits = plan.limits;
    return {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
        price: plan.price_cents / 100,
        limits: {
            sms: limits.monthly_sms_allowance,
            email: limits.monthly_email_allowance,
            ai: limits.monthly_ai_credits,
        },
        overage: limits.overage_sms_cents !== null ? {
            sms: limits.overage_sms_cents ? limits.overage_sms_cents / 100 : null,
            email: limits.overage_email_cents ? limits.overage_email_cents / 100 : null,
            ai: limits.overage_ai_credit_cents ? limits.overage_ai_credit_cents / 100 : null,
        } : null,
        features: limits.features || [],
        campaigns: limits.campaigns,
        seats: limits.seats,
    };
}
export async function GET() {
    try {
        const plans = await getPlansFromDB();
        const uiPlans = plans.map(transformPlanForUI);
        return NextResponse.json({
            plans: uiPlans,
            // Also return raw for internal use
            rawPlans: plans,
        });
    }
    catch (error) {
        console.error('[BILLING] Failed to fetch plans:', error);
        return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 });
    }
}

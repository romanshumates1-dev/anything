/**
 * Subscription API endpoint
 * Handles plan subscriptions with credit-based billing
 *
 * IMPORTANT: Pricing is sourced from subscription_plans table (migration 067)
 * Do NOT hardcode prices here - fetch from database.
 */
import { NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
/**
 * Fetch plan configuration from database (single source of truth)
 */
async function getPlanFromDB(tier) {
    const rows = await sql `
    SELECT name, price_cents, limits
    FROM subscription_plans
    WHERE tier = ${tier}
    LIMIT 1
  `;
    if (!rows[0])
        return null;
    const plan = rows[0];
    const limits = plan.limits;
    return {
        name: plan.name,
        price: plan.price_cents / 100,
        aiCredits: limits.monthly_ai_credits || 0,
        leads: limits.monthly_lead_allowance || -1,
        sms: limits.monthly_sms_allowance || 0,
        campaigns: limits.campaigns || 1,
        users: limits.seats || 1,
        features: limits.features || [],
    };
}
/**
 * Fetch all available plans from database
 */
async function getAllPlansFromDB() {
    const rows = await sql `
    SELECT tier, name, price_cents, limits
    FROM subscription_plans
    WHERE tier IN ('free', 'starter', 'pro', 'business', 'scale')
  `;
    const plans = {};
    for (const row of rows) {
        const limits = row.limits;
        plans[row.tier] = {
            name: row.name,
            price: row.price_cents / 100,
            aiCredits: limits.monthly_ai_credits || 0,
            leads: limits.monthly_lead_allowance || -1,
            sms: limits.monthly_sms_allowance || 0,
            campaigns: limits.campaigns || 1,
            users: limits.seats || 1,
            features: limits.features || [],
        };
    }
    return plans;
}
const CREDIT_PACKS = {
    '100': { credits: 100, price: 5 },
    '500': { credits: 500, price: 20 },
    '1000': { credits: 1000, price: 35 },
    '5000': { credits: 5000, price: 150 },
};
export async function POST(req) {
    let body;
    try {
        body = await req.json();
    }
    catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { planId, email, password, creditPackId, promoCode } = body;
    // Handle credit pack purchase
    if (creditPackId) {
        const session = await auth.api.getSession({ headers: await headers() });
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const organization = await getOrganization();
        if (!organization) {
            return NextResponse.json({ error: 'No organization' }, { status: 403 });
        }
        const pack = CREDIT_PACKS[creditPackId];
        if (!pack) {
            return NextResponse.json({ error: 'Invalid credit pack' }, { status: 400 });
        }
        try {
            // Add credits to organization
            await sql `
        UPDATE organizations
        SET
          ai_credits = COALESCE(ai_credits, 0) + ${pack.credits},
          updated_at = NOW()
        WHERE id = ${organization.id}
      `;
            // Log the purchase
            await sql `
        INSERT INTO billing_events (
          id, organization_id, event_type, amount, metadata, created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${organization.id},
          'credit_purchase',
          ${pack.price},
          ${JSON.stringify({ credits: pack.credits, packId: creditPackId })},
          NOW()
        )
      `.catch(console.error);
            await logEvent('credits_purchased', 'billing', organization.id, {
                credits: pack.credits,
                amount: pack.price,
            }, session.user.id);
            return NextResponse.json({
                success: true,
                creditsAdded: pack.credits,
                message: `Added ${pack.credits} AI credits to your account`,
            });
        }
        catch (error) {
            console.error('[BILLING] Credit purchase error:', error);
            return NextResponse.json({ error: 'Failed to add credits' }, { status: 500 });
        }
    }
    // Handle new subscription - fetch plan from database
    const plan = await getPlanFromDB(planId);
    if (!planId || !plan) {
        return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    // Calculate final price (apply promo if valid)
    let finalPrice = plan.price;
    let discount = 0;
    if (promoCode === 'LAUNCH50') {
        discount = 50;
        finalPrice = Math.round(plan.price * 0.5);
    }
    // Check if this is a new signup or existing user upgrade
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) {
        // Existing user - upgrade their plan
        const organization = await getOrganization();
        if (!organization) {
            return NextResponse.json({ error: 'No organization' }, { status: 403 });
        }
        try {
            // Update subscription
            await sql `
        UPDATE organizations
        SET
          subscription_tier = ${planId},
          subscription_price = ${finalPrice},
          ai_credits = COALESCE(ai_credits, 0) + ${plan.aiCredits},
          leads_limit = ${plan.leads},
          sms_limit = ${plan.sms},
          campaigns_limit = ${plan.campaigns},
          users_limit = ${plan.users},
          features = ${plan.features},
          trial_ends_at = CASE
            WHEN trial_ends_at IS NULL THEN NOW() + INTERVAL '14 days'
            ELSE trial_ends_at
          END,
          updated_at = NOW()
        WHERE id = ${organization.id}
      `;
            await logEvent('subscription_upgraded', 'billing', organization.id, {
                plan: planId,
                price: finalPrice,
                discount,
            }, session.user.id);
            // Send confirmation email
            if (session.user.email) {
                await sendEmailAuto(organization.id, {
                    to: session.user.email,
                    subject: `Welcome to DealFlow AI ${plan.name}!`,
                    text: `Your ${plan.name} plan is now active. You have ${plan.aiCredits} AI credits to start.`,
                    html: `
            <h2>Welcome to DealFlow AI ${plan.name}!</h2>
            <p>Your subscription is now active.</p>
            <h3>Your Plan Includes:</h3>
            <ul>
              <li>${plan.aiCredits.toLocaleString()} AI credits/month</li>
              <li>${plan.leads === -1 ? 'Unlimited' : plan.leads.toLocaleString()} leads</li>
              <li>${plan.sms.toLocaleString()} SMS messages</li>
              <li>${plan.campaigns === -1 ? 'Unlimited' : plan.campaigns} campaigns</li>
              <li>${plan.users} team members</li>
            </ul>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">Go to Dashboard</a></p>
          `,
                }).catch(console.error);
            }
            return NextResponse.json({
                success: true,
                plan: planId,
                price: finalPrice,
                trial: true,
                trialDays: 14,
                message: `Upgraded to ${plan.name} plan. 14-day free trial started.`,
            });
        }
        catch (error) {
            console.error('[BILLING] Upgrade error:', error);
            return NextResponse.json({ error: 'Failed to upgrade plan' }, { status: 500 });
        }
    }
    // New user signup - create account first
    if (!email || !password) {
        return NextResponse.json({ error: 'Email and password required for new accounts' }, { status: 400 });
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    // Validate password
    if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    try {
        // Check if user exists
        const [existingUser] = await sql `
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `.catch(() => [null]);
        if (existingUser) {
            return NextResponse.json({
                error: 'Account exists',
                message: 'An account with this email already exists. Please log in instead.',
            }, { status: 409 });
        }
        // Create via auth signup endpoint
        const signupResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000'}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email.toLowerCase(),
                password,
                name: email.split('@')[0],
            }),
        });
        if (!signupResponse.ok) {
            const signupError = await signupResponse.json().catch(() => ({}));
            return NextResponse.json({
                error: signupError.message || 'Failed to create account',
            }, { status: signupResponse.status });
        }
        // Get the newly created user
        const [newUser] = await sql `
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;
        if (!newUser) {
            return NextResponse.json({ error: 'Account creation failed' }, { status: 500 });
        }
        // Create organization with subscription
        const orgId = crypto.randomUUID();
        await sql `
      INSERT INTO organizations (
        id, name, owner_id,
        subscription_tier, subscription_price,
        ai_credits, leads_limit, sms_limit, campaigns_limit, users_limit,
        features, trial_ends_at, created_at
      ) VALUES (
        ${orgId},
        ${email.split('@')[0] + "'s Org"},
        ${newUser.id},
        ${planId},
        ${finalPrice},
        ${plan.aiCredits},
        ${plan.leads},
        ${plan.sms},
        ${plan.campaigns},
        ${plan.users},
        ${plan.features},
        NOW() + INTERVAL '14 days',
        NOW()
      )
    `;
        // Add user to organization
        await sql `
      INSERT INTO organization_members (
        id, organization_id, user_id, role, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${orgId},
        ${newUser.id},
        'ADMIN',
        NOW()
      )
    `;
        await logEvent('subscription_created', 'billing', orgId, {
            plan: planId,
            price: finalPrice,
            email,
            isNewUser: true,
        }, newUser.id);
        // Send welcome email
        await sendEmailAuto(orgId, {
            to: email,
            subject: `Welcome to DealFlow AI ${plan.name}!`,
            text: `Your account is ready. Start your 14-day free trial now.`,
            html: `
        <h2>Welcome to DealFlow AI!</h2>
        <p>Your ${plan.name} plan is ready. You have 14 days to try everything for free.</p>
        <h3>Your Plan Includes:</h3>
        <ul>
          <li>${plan.aiCredits.toLocaleString()} AI credits/month</li>
          <li>${plan.leads === -1 ? 'Unlimited' : plan.leads.toLocaleString()} leads</li>
          <li>${plan.sms.toLocaleString()} SMS messages</li>
          <li>14-day free trial - no card charged</li>
        </ul>
        <p style="margin-top: 20px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
             style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Start Using DealFlow
          </a>
        </p>
        <p style="margin-top: 30px; color: #666; font-size: 12px;">
          Questions? Reply to this email or visit our help center.
        </p>
      `,
        }).catch(console.error);
        return NextResponse.json({
            success: true,
            plan: planId,
            price: finalPrice,
            trial: true,
            trialDays: 14,
            message: `Account created! Check your email to get started.`,
        });
    }
    catch (error) {
        console.error('[BILLING] Signup error:', error);
        return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }
}
export async function GET(req) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const organization = await getOrganization();
    if (!organization) {
        return NextResponse.json({ error: 'No organization' }, { status: 403 });
    }
    const url = new URL(req.url);
    const includeUsage = url.searchParams.get('usage') === 'true';
    try {
        // Get current subscription
        const [org] = await sql `
      SELECT
        subscription_tier,
        subscription_price,
        ai_credits,
        leads_limit,
        sms_limit,
        campaigns_limit,
        users_limit,
        features,
        trial_ends_at,
        created_at
      FROM organizations
      WHERE id = ${organization.id}
    `;
        let usage = null;
        if (includeUsage) {
            const [counts] = await sql `
        SELECT
          (SELECT COUNT(*) FROM leads WHERE organization_id = ${organization.id}) as leads_count,
          (SELECT COUNT(*) FROM campaigns WHERE organization_id = ${organization.id}) as campaigns_count,
          (SELECT COUNT(*) FROM organization_members WHERE organization_id = ${organization.id}) as users_count
      `;
            usage = counts;
        }
        // Fetch plan config from database (single source of truth)
        const planConfig = await getPlanFromDB(org.subscription_tier || 'starter');
        const allPlans = await getAllPlansFromDB();
        return NextResponse.json({
            subscription: {
                tier: org.subscription_tier || 'starter',
                price: org.subscription_price || planConfig?.price || 0,
                trialEndsAt: org.trial_ends_at,
                isTrialing: org.trial_ends_at && new Date(org.trial_ends_at) > new Date(),
            },
            limits: {
                aiCredits: org.ai_credits || 0,
                aiCreditsMax: planConfig?.aiCredits || 0,
                leads: org.leads_limit || planConfig?.leads || -1,
                sms: org.sms_limit || planConfig?.sms || 0,
                campaigns: org.campaigns_limit || planConfig?.campaigns || 1,
                users: org.users_limit || planConfig?.users || 1,
            },
            features: org.features || planConfig?.features || [],
            usage,
            plans: allPlans,
            creditPacks: CREDIT_PACKS,
        });
    }
    catch (error) {
        console.error('[BILLING] Get subscription error:', error);
        return NextResponse.json({ error: 'Failed to get subscription' }, { status: 500 });
    }
}

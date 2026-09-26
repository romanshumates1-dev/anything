/**
 * Subscription API endpoint
 * Handles plan subscriptions with credit-based billing
 *
 * IMPORTANT: Pricing is sourced from subscription_plans table (migration 067)
 * Do NOT hardcode prices here - fetch from database.
 *
 * PAYMENT MODEL
 * Entitlements are granted in exactly one place: the signature-verified
 * `checkout.session.completed` handler in /api/payments/webhook. This route
 * only *starts* a purchase. Nothing here — and nothing a client sends — can
 * activate a plan or add credits on its own.
 *
 *   live (STRIPE_PROVIDER=live + both secrets)  → Stripe Checkout redirect
 *   production without a usable Stripe config   → 503, nothing granted
 *   dev/test                                    → direct activation, so the
 *                                                 flow stays workable offline
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { addCredits } from '@/app/api/utils/credits';
import {
  getStripeProvider,
  type StripeProvider,
  type StripeProviderType,
} from '@/app/api/services/stripeProvider';
import { appBaseUrl } from '@/app/api/utils/appUrl';
import { selectPlanRow, dedupePlansByTier } from '@/app/api/utils/planCatalog';

// ─── Payments: configuration ────────────────────────────────────────────────

function stripeMode(): StripeProviderType {
  return (process.env.STRIPE_PROVIDER || 'mock').toLowerCase() === 'live'
    ? 'live'
    : 'mock';
}

/**
 * The first missing piece of configuration that makes real payment unsafe, or
 * null when the live path is usable.
 *
 * STRIPE_WEBHOOK_SECRET is required alongside the secret key on purpose.
 * Entitlements are granted ONLY from a signature-verified webhook, so with the
 * key present but the webhook secret missing a customer would be charged and
 * never receive anything. Refusing the checkout is the safe failure.
 */
function stripeConfigGap(): string | null {
  if (stripeMode() !== 'live') return 'STRIPE_PROVIDER';
  if (!process.env.STRIPE_SECRET_KEY) return 'STRIPE_SECRET_KEY';
  if (!process.env.STRIPE_WEBHOOK_SECRET) return 'STRIPE_WEBHOOK_SECRET';
  return null;
}

function isPaymentLive(): boolean {
  return stripeConfigGap() === null;
}

/**
 * The organization's Stripe customer, when it already has one.
 *
 * Read, never created, here: the first checkout lets Stripe mint the customer
 * and the webhook persists the id from the verified event. Every later checkout
 * reuses it, so an organization can never accumulate duplicate customers.
 */
async function getStripeCustomerId(organizationId: string): Promise<string | undefined> {
  const [row] = await sql`
    SELECT stripe_customer_id
    FROM organizations
    WHERE id = ${organizationId}
    LIMIT 1
  `;
  const id = (row as { stripe_customer_id?: string | null } | undefined)
    ?.stripe_customer_id;
  return id ?? undefined;
}

/** 503 carrying the name of the missing variable, so ops can fix it fast. */
function notConfiguredResponse(missing: string): NextResponse {
  console.error(`[BILLING] Refusing to sell: Stripe is not configured (${missing} missing)`);
  return NextResponse.json(
    {
      error: 'Payment processing is not configured',
      code: 'PAYMENT_NOT_CONFIGURED',
    },
    { status: 503 }
  );
}

/**
 * Start a Stripe Checkout session for an organization purchase.
 *
 * `amountCents` always comes from a plan or pack row read out of the database,
 * never from the request body, and the organization travels in Stripe metadata
 * so the webhook can resolve the purchase from the verified event alone.
 *
 * Callers must check isPaymentLive() first: the live provider throws when the
 * secret key is absent.
 */
async function startCheckout(params: {
  organizationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  planId?: string;
  creditPackId?: string;
  amountCents: number;
  productName: string;
  productDescription?: string;
}): Promise<string> {
  const provider: StripeProvider = getStripeProvider({ type: stripeMode() });
  const base = appBaseUrl();

  const session = await provider.createBillingCheckoutSession({
    userId: params.userId,
    organizationId: params.organizationId,
    planId: params.planId,
    creditPackId: params.creditPackId,
    amountCents: params.amountCents,
    productName: params.productName,
    productDescription: params.productDescription,
    customerEmail: params.userEmail,
    stripeCustomerId: await getStripeCustomerId(params.organizationId),
    // The return URL is a UI hint ONLY. Access is granted by the webhook, so
    // landing on this URL proves nothing and grants nothing.
    successUrl: `${base}/settings/billing?checkout=success`,
    cancelUrl: `${base}/settings/billing?checkout=cancelled`,
  });

  return session.checkoutUrl;
}



interface PlanConfig {
  name: string;
  price: number;
  aiCredits: number;
  leads: number;
  sms: number;
  campaigns: number;
  users: number;
  features: string[];
}

/**
 * Fetch plan configuration from database (single source of truth).
 *
 * Resolves by primary key OR tier, then picks THE row deterministically:
 * a tier can map to more than one row (plan_professional is a retained
 * "Pro (Legacy)" alias of tier 'pro'), and `WHERE tier = ... LIMIT 1` with no
 * ORDER BY could quote either $79 or $299 for the same plan depending on
 * Postgres row order. See utils/planCatalog.ts for the selection rules.
 */
async function getPlanFromDB(planOrTier: string): Promise<PlanConfig | null> {
  const rows = await sql`
    SELECT id, tier, name, price_cents, limits
    FROM subscription_plans
    WHERE id = ${planOrTier} OR tier = ${planOrTier}
  `;

  const plan = selectPlanRow(
    rows as Array<{ id: string; tier: string }>,
    planOrTier
  ) as { name: string; price_cents: number; limits: any } | null;

  if (!plan) return null;

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
 * Fetch all available plans from database — exactly ONE row per tier
 * (canonical `plan_<tier>` preferred) so a retained legacy alias can neither
 * overwrite the canonical plan in this record nor be advertised beside it.
 */
async function getAllPlansFromDB(): Promise<Record<string, PlanConfig>> {
  const rows = await sql`
    SELECT id, tier, name, price_cents, limits
    FROM subscription_plans
    WHERE tier IN ('free', 'starter', 'pro', 'business', 'scale')
  `;

  const plans: Record<string, PlanConfig> = {};
  for (const row of dedupePlansByTier(rows as Array<{ id: string; tier: string }>) as any[]) {
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

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { planId, email, password, creditPackId, promoCode } = body;

  // ── Credit pack purchase ──────────────────────────────────────────────────
  // /settings/billing buys packs through the canonical /api/credits/purchase
  // endpoint; this branch is retained for existing clients, but it must not
  // become a way to obtain paid credits without payment, so it is gated exactly
  // like a plan purchase.
  if (creditPackId) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization' }, { status: 403 });
    }

    const pack = CREDIT_PACKS[creditPackId as keyof typeof CREDIT_PACKS];
    if (!pack) {
      return NextResponse.json({ error: 'Invalid credit pack' }, { status: 400 });
    }

    // Real payment: hand off to Stripe. Credits are granted by the verified
    // webhook, never here.
    let checkoutUrl: string | null = null;
    if (isPaymentLive()) {
      try {
        checkoutUrl = await startCheckout({
          organizationId: organization.id,
          userId: session.user.id,
          userEmail: session.user.email,
          userName: session.user.name,
          creditPackId,
          amountCents: pack.price * 100,
          productName: `DealFlow AI — ${pack.credits.toLocaleString()} AI credits`,
          productDescription: `${pack.credits.toLocaleString()} AI credits for SMS, email and AI operations`,
        });
      } catch (error: any) {
        console.error('[BILLING] Credit pack checkout error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 502 });
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Production must never grant paid credits without a verified payment.
      return notConfiguredResponse(stripeConfigGap() ?? 'STRIPE_PROVIDER');
    }

    if (checkoutUrl) {
      await logEvent('credits_checkout_started', 'billing', organization.id, {
        credits: pack.credits,
        amount: pack.price,
        packId: creditPackId,
      }, session.user.id);

      return NextResponse.json({
        success: true,
        requiresPayment: true,
        checkoutUrl,
        creditsAdded: 0,
        message: `Redirecting to secure checkout for ${pack.credits.toLocaleString()} credits`,
      });
    }

    // ── dev/test only (no Stripe configured, NODE_ENV !== 'production') ─────
    // Grants through the authoritative credit ledger so local behaviour matches
    // the webhook path, instead of writing the legacy mirror by hand.
    try {
      const result = await addCredits(
        organization.id,
        pack.credits,
        'PURCHASE',
        `Dev credit purchase: ${creditPackId}`,
        { packId: creditPackId, devFallback: true },
        `dev-credit-${crypto.randomUUID()}`
      );

      await sql`
        INSERT INTO billing_events (
          id, organization_id, event_type, amount, metadata, created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${organization.id},
          'credit_purchase',
          ${pack.price},
          ${JSON.stringify({
            credits: pack.credits,
            packId: creditPackId,
            devFallback: true,
          })}::jsonb,
          NOW()
        )
      `.catch(console.error);

      await logEvent('credits_purchased', 'billing', organization.id, {
        credits: pack.credits,
        amount: pack.price,
        devFallback: true,
      }, session.user.id);

      return NextResponse.json({
        success: true,
        creditsAdded: pack.credits,
        newBalance: result.balance,
        message: `Added ${pack.credits} AI credits to your account`,
      });
    } catch (error: any) {
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

    // Real payment: hand off to Stripe. The verified webhook activates the plan;
    // activation must never happen synchronously here, because this route cannot
    // know whether the customer actually paid.
    if (isPaymentLive()) {
      try {
        const checkoutUrl = await startCheckout({
          organizationId: organization.id,
          userId: session.user.id,
          userEmail: session.user.email,
          userName: session.user.name,
          planId,
          // finalPrice is in dollars (getPlanFromDB divides price_cents by 100).
          amountCents: Math.round(finalPrice * 100),
          productName: `DealFlow AI — ${plan.name} plan`,
          productDescription: `${plan.aiCredits.toLocaleString()} AI credits, ${
            plan.leads === -1 ? 'unlimited' : plan.leads.toLocaleString()
          } leads, ${plan.sms.toLocaleString()} SMS per month`,
        });

        await logEvent('subscription_checkout_started', 'billing', organization.id, {
          plan: planId,
          price: finalPrice,
          discount,
        }, session.user.id);

        return NextResponse.json({
          success: true,
          requiresPayment: true,
          plan: planId,
          price: finalPrice,
          checkoutUrl,
          message: `Redirecting to secure checkout for the ${plan.name} plan`,
        });
      } catch (error: any) {
        console.error('[BILLING] Plan checkout error:', error);
        return NextResponse.json({ error: 'Failed to start checkout' }, { status: 502 });
      }
    }

    if (process.env.NODE_ENV === 'production') {
      // Production must never grant a paid plan without a verified payment.
      return notConfiguredResponse(stripeConfigGap() ?? 'STRIPE_PROVIDER');
    }

    // ── dev/test only (no Stripe configured, NODE_ENV !== 'production') ─────
    try {
      // Update subscription
      await sql`
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
    } catch (error: any) {
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

  // A paid plan cannot be granted before payment, and there is no organization to
  // attach a Stripe Checkout session to until the account exists. In live mode a
  // *paid* plan therefore requires the account first; the client should sign up,
  // then purchase from the authenticated billing page. A zero-price plan is
  // still allowed through, since nothing is owed and nothing is bypassed.
  if (isPaymentLive() && finalPrice > 0) {
    return NextResponse.json(
      {
        error: 'Create your account first, then choose a paid plan',
        code: 'SIGNUP_REQUIRED',
        signupUrl: '/signup',
      },
      { status: 409 }
    );
  }

  try {
    // Check if user exists. The table is `"user"` (better-auth's schema, quoted
    // because `user` is a reserved word) — the previous `users` reference raised
    // 42P01, and because it was wrapped in `.catch(() => [null])` the duplicate
    // account check silently never matched.
    const [existingUser] = await sql`
      SELECT id FROM "user" WHERE email = ${email.toLowerCase()}
    `;

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
    const [newUser] = await sql`
      SELECT id FROM users WHERE email = ${email.toLowerCase()}
    `;

    if (!newUser) {
      return NextResponse.json({ error: 'Account creation failed' }, { status: 500 });
    }

    // Create organization with subscription
    const orgId = crypto.randomUUID();
    await sql`
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
    await sql`
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
  } catch (error: any) {
    console.error('[BILLING] Signup error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
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
    const [org] = await sql`
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
      const [counts] = await sql`
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
  } catch (error: any) {
    console.error('[BILLING] Get subscription error:', error);
    return NextResponse.json({ error: 'Failed to get subscription' }, { status: 500 });
  }
}

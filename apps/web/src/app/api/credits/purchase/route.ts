/**
 * Credits Purchase API - Stripe checkout for credit packs
 *
 * Creates a Stripe checkout session for purchasing credits.
 * On successful payment, credits are added via webhook.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { addCredits, getBalance } from '@/app/api/utils/credits';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Credit packs available for purchase.
 * Price is in USD, with volume discounts for larger packs.
 */
const CREDIT_PACKS = {
  'pack_100': {
    id: 'pack_100',
    credits: 100,
    price: 5,
    pricePerCredit: 0.05,
    label: '100 Credits',
    popular: false,
  },
  'pack_500': {
    id: 'pack_500',
    credits: 500,
    price: 20,
    pricePerCredit: 0.04,
    label: '500 Credits',
    popular: true,
    savings: '20%',
  },
  'pack_1000': {
    id: 'pack_1000',
    credits: 1000,
    price: 35,
    pricePerCredit: 0.035,
    label: '1,000 Credits',
    popular: false,
    savings: '30%',
  },
  'pack_5000': {
    id: 'pack_5000',
    credits: 5000,
    price: 150,
    pricePerCredit: 0.03,
    label: '5,000 Credits',
    popular: false,
    savings: '40%',
  },
  'pack_10000': {
    id: 'pack_10000',
    credits: 10000,
    price: 250,
    pricePerCredit: 0.025,
    label: '10,000 Credits',
    popular: false,
    savings: '50%',
  },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export interface PurchaseRequest {
  packId: CreditPackId;
  /** For testing: simulate immediate credit grant */
  testMode?: boolean;
}

export interface PurchaseResponse {
  success: boolean;
  checkoutUrl?: string;
  /** In test mode, credits are added immediately */
  creditsAdded?: number;
  newBalance?: number;
  error?: string;
}

/**
 * GET /api/credits/purchase - List available credit packs
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    packs: Object.values(CREDIT_PACKS),
  });
}

/**
 * POST /api/credits/purchase - Create Stripe checkout session
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  let body: PurchaseRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { packId, testMode } = body;

  if (!packId || !(packId in CREDIT_PACKS)) {
    return NextResponse.json({ error: 'Invalid pack ID' }, { status: 400 });
  }

  const pack = CREDIT_PACKS[packId];

  try {
    // Test mode: immediately grant credits (for development)
    if (testMode && process.env.NODE_ENV !== 'production') {
      const result = await addCredits(
        organization.id,
        pack.credits,
        'PURCHASE',
        `Test purchase: ${pack.label}`,
        {
          packId,
          price: pack.price,
          testMode: true,
          userId: session.user.id,
        }
      );

      await logEvent('credits_purchased_test', 'billing', organization.id, {
        packId,
        credits: pack.credits,
        price: pack.price,
      }, session.user.id);

      return NextResponse.json({
        success: true,
        creditsAdded: pack.credits,
        newBalance: result.balance,
      });
    }

    // Production: Create Stripe checkout session
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // In production, payment is required - fail if Stripe is not configured
      if (process.env.NODE_ENV === 'production') {
        console.error('[CREDITS] Stripe not configured in production - cannot process payment');
        return NextResponse.json(
          { error: 'Payment processing is not configured. Please contact support.' },
          { status: 503 }
        );
      }

      // Development/staging fallback: grant credits for demo purposes only
      console.warn('[CREDITS] Stripe not configured (non-production), granting credits directly');

      const result = await addCredits(
        organization.id,
        pack.credits,
        'PURCHASE',
        `Credit purchase: ${pack.label}`,
        {
          packId,
          price: pack.price,
          stripeConfigured: false,
          userId: session.user.id,
        }
      );

      await logEvent('credits_purchased', 'billing', organization.id, {
        packId,
        credits: pack.credits,
        price: pack.price,
        stripeConfigured: false,
      }, session.user.id);

      return NextResponse.json({
        success: true,
        creditsAdded: pack.credits,
        newBalance: result.balance,
      });
    }

    // Import Stripe dynamically to avoid issues when not configured
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-06-24.dahlia' });

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `DealFlow AI - ${pack.label}`,
              description: `${pack.credits.toLocaleString()} platform credits for SMS, email, and AI operations`,
            },
            unit_amount: pack.price * 100, // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'credit_purchase',
        organizationId: organization.id,
        userId: session.user.id,
        packId,
        credits: pack.credits.toString(),
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?purchase=success&credits=${pack.credits}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?purchase=cancelled`,
      customer_email: session.user.email,
    });

    await logEvent('credits_checkout_created', 'billing', organization.id, {
      packId,
      credits: pack.credits,
      price: pack.price,
      checkoutId: checkoutSession.id,
    }, session.user.id);

    return NextResponse.json({
      success: true,
      checkoutUrl: checkoutSession.url,
    });
  } catch (error: any) {
    console.error('[CREDITS] Purchase error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout' },
      { status: 500 }
    );
  }
}

/**
 * Handle Stripe webhook for successful payment.
 * Called by /api/payments/webhook when credit_purchase event is received.
 */
export async function handleCreditPurchaseWebhook(
  organizationId: string,
  packId: string,
  credits: number,
  paymentIntentId: string
): Promise<void> {
  await addCredits(
    organizationId,
    credits,
    'PURCHASE',
    `Credit purchase: ${credits.toLocaleString()} credits`,
    {
      packId,
      paymentIntentId,
      source: 'stripe_webhook',
    }
  );

  await logEvent('credits_purchased_webhook', 'billing', organizationId, {
    packId,
    credits,
    paymentIntentId,
  });
}

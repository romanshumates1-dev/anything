/**
 * Offer Portal API
 *
 * Web-based offer review, acceptance, and negotiation.
 * No phone calls or human contact required.
 *
 * GET  - Get offer details for a lead
 * POST - Submit offer response (accept, counter, decline, questions)
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

interface OfferDetails {
  leadId: string;
  propertyAddress: string;
  ownerName: string;
  offerAmount: number;
  closingTimeline: string;
  expiresAt: string;
  terms: {
    asIs: boolean;
    noContingencies: boolean;
    sellerCanStay: boolean;
    closingCostsCovered: boolean;
  };
  status: 'pending' | 'accepted' | 'countered' | 'declined' | 'expired';
}

function parseToken(token: string): { leadId: string; action: string; ts: number } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [leadId, action, ts] = decoded.split(':');
    return { leadId, action, ts: parseInt(ts, 10) };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const leadId = url.searchParams.get('ref') || url.searchParams.get('leadId');

  if (!token && !leadId) {
    return Response.json({ error: 'Missing token or leadId' }, { status: 400 });
  }

  // Parse token if provided
  let resolvedLeadId = leadId;
  if (token && !leadId) {
    const parsed = parseToken(token);
    if (!parsed) {
      return Response.json({ error: 'Invalid token' }, { status: 400 });
    }
    resolvedLeadId = parsed.leadId;
  }

  try {
    // Get lead and offer details
    const [lead] = await sql`
      SELECT
        l.id,
        l.name as owner_name,
        l.address as property_address,
        l.metadata,
        l.status,
        l.created_at,
        COALESCE(ls.distress_score, 0.5) as distress_score,
        v.arv_cents,
        v.offer_cents
      FROM leads l
      LEFT JOIN lead_scores ls ON ls.lead_id = l.id
      LEFT JOIN property_valuations v ON v.lead_id = l.id
      WHERE l.id = ${resolvedLeadId}
      ORDER BY v.created_at DESC NULLS LAST
      LIMIT 1
    `.catch(() => [null]);

    if (!lead) {
      // Try sourced_leads
      const [sourced] = await sql`
        SELECT
          id,
          owner_name,
          property_address,
          distress_score,
          assessed_value_cents,
          created_at
        FROM sourced_leads
        WHERE id::text = ${resolvedLeadId} OR source_id = ${resolvedLeadId}
        LIMIT 1
      `.catch(() => [null]);

      if (!sourced) {
        return Response.json({ error: 'Lead not found' }, { status: 404 });
      }

      // Calculate offer for sourced lead
      const assessedValue = sourced.assessed_value_cents ? sourced.assessed_value_cents / 100 : 150000;
      const distressMultiplier = 0.65 + (1 - (sourced.distress_score || 50) / 100) * 0.15;
      const offerAmount = Math.round(assessedValue * distressMultiplier);

      const offer: OfferDetails = {
        leadId: sourced.id?.toString() || sourced.source_id,
        propertyAddress: sourced.property_address || 'Address on file',
        ownerName: sourced.owner_name || 'Property Owner',
        offerAmount,
        closingTimeline: '7-14 days',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        terms: {
          asIs: true,
          noContingencies: true,
          sellerCanStay: true,
          closingCostsCovered: false,
        },
        status: 'pending',
      };

      await logEvent('offer_viewed', 'sourced_lead', sourced.id?.toString(), { via: 'portal' });

      return Response.json({
        offer,
        actions: {
          accept: '/api/portal/offer?action=accept',
          counter: '/api/portal/offer?action=counter',
          decline: '/api/portal/offer?action=decline',
          question: '/api/portal/offer?action=question',
        },
        faq: [
          { q: 'How does the closing process work?', a: 'Once you accept, we open escrow with a local title company. They handle all paperwork. A mobile notary comes to you for signatures. Funds wire to your account at closing.' },
          { q: 'What if I have a mortgage?', a: 'No problem. The title company pays off your existing mortgage at closing from the proceeds. You receive the remaining balance.' },
          { q: 'Can I stay in the property after closing?', a: 'Yes, we offer leaseback options of up to 60 days at no cost in most cases.' },
          { q: 'Is this offer negotiable?', a: 'Yes! Use the counter option to propose different terms. We review all counteroffers within 24 hours.' },
        ],
      });
    }

    // Calculate offer from lead data
    const arv = lead.arv_cents ? lead.arv_cents / 100 : 200000;
    const existingOffer = lead.offer_cents ? lead.offer_cents / 100 : null;
    const distressMultiplier = 0.65 + (1 - (lead.distress_score || 0.5)) * 0.15;
    const offerAmount = existingOffer || Math.round(arv * distressMultiplier);

    const offer: OfferDetails = {
      leadId: lead.id.toString(),
      propertyAddress: lead.property_address || 'Address on file',
      ownerName: lead.owner_name || 'Property Owner',
      offerAmount,
      closingTimeline: '7-14 days',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      terms: {
        asIs: true,
        noContingencies: true,
        sellerCanStay: true,
        closingCostsCovered: false,
      },
      status: lead.status === 'ACCEPTED' ? 'accepted' : 'pending',
    };

    await logEvent('offer_viewed', 'lead', lead.id.toString(), { via: 'portal' });

    return Response.json({
      offer,
      actions: {
        accept: '/api/portal/offer?action=accept',
        counter: '/api/portal/offer?action=counter',
        decline: '/api/portal/offer?action=decline',
        question: '/api/portal/offer?action=question',
      },
      faq: [
        { q: 'How does the closing process work?', a: 'Once you accept, we open escrow with a local title company. They handle all paperwork. A mobile notary comes to you for signatures. Funds wire to your account at closing.' },
        { q: 'What if I have a mortgage?', a: 'No problem. The title company pays off your existing mortgage at closing from the proceeds. You receive the remaining balance.' },
        { q: 'Can I stay in the property after closing?', a: 'Yes, we offer leaseback options of up to 60 days at no cost in most cases.' },
        { q: 'Is this offer negotiable?', a: 'Yes! Use the counter option to propose different terms. We review all counteroffers within 24 hours.' },
      ],
    });
  } catch (err: any) {
    console.error('[OFFER-PORTAL] Error:', err);
    return Response.json({ error: 'Failed to load offer' }, { status: 500 });
  }
}

interface OfferResponse {
  leadId: string;
  action: 'accept' | 'counter' | 'decline' | 'question';
  counterAmount?: number;
  preferredClosingDate?: string;
  questions?: string;
  contactPreference?: 'email' | 'sms' | 'none';
}

export async function POST(req: NextRequest) {
  let body: OfferResponse;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId, action, counterAmount, preferredClosingDate, questions, contactPreference } = body;

  if (!leadId || !action) {
    return Response.json({ error: 'leadId and action required' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'accept': {
        // Update lead status and create contract
        await sql`
          UPDATE leads
          SET status = 'ACCEPTED', updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                acceptedAt: new Date().toISOString(),
                acceptedVia: 'web_portal',
              })}::jsonb
          WHERE id = ${leadId}
        `.catch(() => {});

        await sql`
          UPDATE sourced_leads
          SET status = 'accepted'
          WHERE id::text = ${leadId} OR source_id = ${leadId}
        `.catch(() => {});

        await logEvent('offer_accepted', 'lead', leadId, { via: 'portal' });

        return Response.json({
          success: true,
          message: 'Congratulations! Your offer has been accepted.',
          nextSteps: {
            step1: 'Check your email for the purchase agreement',
            step2: 'Review and sign the contract electronically',
            step3: 'Title company will contact you within 24 hours',
            esignUrl: `/esign/seller?lead=${leadId}`,
          },
        });
      }

      case 'counter': {
        if (!counterAmount) {
          return Response.json({ error: 'counterAmount required for counter action' }, { status: 400 });
        }

        await sql`
          UPDATE leads
          SET status = 'COUNTER_RECEIVED', updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                counterAmount,
                counterAt: new Date().toISOString(),
                preferredClosingDate,
                counterVia: 'web_portal',
              })}::jsonb
          WHERE id = ${leadId}
        `.catch(() => {});

        await sql`
          INSERT INTO negotiation_queue (lead_id, counter_amount, notes, status)
          VALUES (${leadId}, ${counterAmount}, ${`Counter via portal: $${counterAmount.toLocaleString()}`}, 'pending')
          ON CONFLICT DO NOTHING
        `.catch(() => {});

        await logEvent('offer_countered', 'lead', leadId, { counterAmount, via: 'portal' });

        return Response.json({
          success: true,
          message: 'Your counter-offer has been submitted.',
          counterAmount,
          estimatedResponse: '24 hours',
          nextSteps: {
            step1: 'We will review your counter-offer',
            step2: 'Response sent to your email within 24 hours',
            step3: 'You can check status anytime at this portal',
          },
        });
      }

      case 'decline': {
        await sql`
          UPDATE leads
          SET status = 'DECLINED', updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
                declinedAt: new Date().toISOString(),
                declinedVia: 'web_portal',
              })}::jsonb
          WHERE id = ${leadId}
        `.catch(() => {});

        await sql`
          UPDATE sourced_leads
          SET status = 'declined'
          WHERE id::text = ${leadId} OR source_id = ${leadId}
        `.catch(() => {});

        await logEvent('offer_declined', 'lead', leadId, { via: 'portal' });

        return Response.json({
          success: true,
          message: 'We understand. Thank you for considering our offer.',
          followUp: 'Feel free to reach out if circumstances change. We are always interested.',
        });
      }

      case 'question': {
        if (!questions) {
          return Response.json({ error: 'questions required for question action' }, { status: 400 });
        }

        await sql`
          INSERT INTO ai_conversations (lead_id, channel, history, status)
          VALUES (
            ${leadId},
            'web_portal',
            ${JSON.stringify([{ role: 'user', content: questions, timestamp: new Date().toISOString() }])}::jsonb,
            'pending'
          )
          ON CONFLICT (lead_id) DO UPDATE
          SET history = ai_conversations.history || ${JSON.stringify([{ role: 'user', content: questions, timestamp: new Date().toISOString() }])}::jsonb,
              status = 'pending',
              updated_at = NOW()
        `.catch(() => {});

        await logEvent('portal_question', 'lead', leadId, { question: questions.slice(0, 200), via: 'portal' });

        return Response.json({
          success: true,
          message: 'Your question has been received.',
          estimatedResponse: '24 hours',
          contactPreference: contactPreference || 'email',
        });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[OFFER-PORTAL] POST Error:', err);
    return Response.json({ error: 'Failed to process action' }, { status: 500 });
  }
}

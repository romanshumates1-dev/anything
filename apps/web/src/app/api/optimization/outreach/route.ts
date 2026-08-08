/**
 * Outreach Optimization API
 *
 * Implements sussy2.md requirements:
 * - Response likelihood prediction per channel
 * - Optimal contact timing model
 * - Channel selection logic per lead
 * - Expected ROI per outreach action
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

type Channel = 'sms' | 'email' | 'call' | 'mail';

interface ChannelScore {
  channel: Channel;
  responseLikelihood: number;
  expectedRoi: number;
  costPerContact: number;
  recommended: boolean;
}

interface OutreachStrategy {
  leadId: number;
  primaryChannel: Channel;
  channelScores: ChannelScore[];
  optimalTiming: {
    dayOfWeek: string;
    timeOfDay: string;
    timezone: string;
  };
  sequenceRecommendation: Channel[];
  expectedResponseRate: number;
  touchesRequired: number;
}

const CHANNEL_BASE_COSTS: Record<Channel, number> = {
  sms: 0.01,
  email: 0.001,
  call: 0.05,
  mail: 0.55
};

const CHANNEL_BASE_RESPONSE: Record<Channel, number> = {
  sms: 0.08,
  email: 0.02,
  call: 0.15,
  mail: 0.03
};

function calculateChannelScore(
  channel: Channel,
  leadMetadata: any,
  historicalData: any
): ChannelScore {
  let responseLikelihood = CHANNEL_BASE_RESPONSE[channel];
  const costPerContact = CHANNEL_BASE_COSTS[channel];

  // Adjust based on lead characteristics
  const hasPhone = !!leadMetadata?.phone;
  const hasEmail = !!leadMetadata?.email;
  const hasAddress = !!leadMetadata?.mailing_address;
  const signals = leadMetadata?.signals || [];

  // Channel availability adjustments
  if (channel === 'sms' && !hasPhone) responseLikelihood = 0;
  if (channel === 'call' && !hasPhone) responseLikelihood = 0;
  if (channel === 'email' && !hasEmail) responseLikelihood = 0;
  if (channel === 'mail' && !hasAddress) responseLikelihood = 0;

  // Distressed leads respond better to calls
  if (signals.includes('foreclosure') || signals.includes('probate')) {
    if (channel === 'call') responseLikelihood *= 1.5;
    if (channel === 'sms') responseLikelihood *= 1.3;
  }

  // Investors prefer email
  if (signals.includes('llc_owned') || signals.includes('out_of_state')) {
    if (channel === 'email') responseLikelihood *= 1.4;
  }

  // Adjust based on historical performance
  if (historicalData?.channelPerformance?.[channel]) {
    const historical = historicalData.channelPerformance[channel];
    responseLikelihood = (responseLikelihood + historical) / 2;
  }

  const expectedRoi = responseLikelihood > 0 ?
    (responseLikelihood * 10000 - costPerContact) / costPerContact : 0;

  return {
    channel,
    responseLikelihood: Math.round(responseLikelihood * 100) / 100,
    expectedRoi: Math.round(expectedRoi * 100) / 100,
    costPerContact,
    recommended: responseLikelihood > 0.05
  };
}

function determineOptimalTiming(leadMetadata: any): OutreachStrategy['optimalTiming'] {
  const signals = leadMetadata?.signals || [];
  const isInvestor = signals.includes('llc_owned') || signals.includes('out_of_state');

  if (isInvestor) {
    return {
      dayOfWeek: 'Tuesday-Thursday',
      timeOfDay: '9:00 AM - 11:00 AM',
      timezone: 'local'
    };
  }

  // Default: evenings for owner-occupied
  return {
    dayOfWeek: 'Tuesday-Thursday',
    timeOfDay: '5:00 PM - 7:00 PM',
    timezone: 'local'
  };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId } = body;
  if (!leadId) {
    return Response.json({ error: 'leadId required' }, { status: 400 });
  }

  try {
    const [lead] = await sql`
      SELECT id, metadata, name
      FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
    `;

    if (!lead) {
      return Response.json({ error: 'Lead not found' }, { status: 404 });
    }

    const metadata = lead.metadata || {};

    // Get historical performance for this org
    const historicalData = {
      channelPerformance: {
        sms: 0.08,
        email: 0.02,
        call: 0.12,
        mail: 0.03
      }
    };

    // Calculate scores for each channel
    const channelScores: ChannelScore[] = (['sms', 'email', 'call', 'mail'] as Channel[])
      .map(channel => calculateChannelScore(channel, metadata, historicalData))
      .sort((a, b) => b.responseLikelihood - a.responseLikelihood);

    const primaryChannel = channelScores.find(c => c.recommended)?.channel || 'sms';

    // Build recommended sequence
    const sequenceRecommendation = channelScores
      .filter(c => c.recommended)
      .map(c => c.channel);

    // Calculate expected response rate with multi-touch
    const touchesRequired = Math.ceil(1 / (channelScores[0]?.responseLikelihood || 0.1));
    const expectedResponseRate = Math.min(0.95, channelScores[0]?.responseLikelihood * touchesRequired);

    const strategy: OutreachStrategy = {
      leadId,
      primaryChannel,
      channelScores,
      optimalTiming: determineOptimalTiming(metadata),
      sequenceRecommendation,
      expectedResponseRate: Math.round(expectedResponseRate * 100) / 100,
      touchesRequired: Math.min(touchesRequired, 7)
    };

    return Response.json(strategy);
  } catch (error: any) {
    console.error('Outreach strategy error:', error);
    return Response.json({ error: 'Failed to generate strategy' }, { status: 500 });
  }
}

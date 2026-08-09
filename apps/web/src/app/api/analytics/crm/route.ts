/**
 * CRM Analytics API Route
 *
 * Exposes the CRM Analytics Engine for:
 * - Regional analytics (state, county, city, zip)
 * - Outreach method analytics (email, SMS, social media)
 * - Channel attribution
 * - Conversion funnels
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import {
  getRegionalAnalytics,
  getOutreachMethodAnalytics,
  getChannelAttribution,
  getConversionFunnel,
  getCRMDashboardAnalytics,
  type DateRange,
} from '@/app/api/utils/crmAnalyticsEngine';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }
    const organizationId = organization.id;
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') || 'dashboard';
    const groupBy = searchParams.get('groupBy') as 'state' | 'county' | 'city' | 'zipCode' || 'state';
    const days = parseInt(searchParams.get('days') || '30', 10);

    const dateRange: DateRange = {
      start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      end: new Date(),
    };

    switch (view) {
      case 'regional': {
        const data = await getRegionalAnalytics(organizationId, groupBy, dateRange);
        return NextResponse.json({
          view: 'regional',
          groupBy,
          days,
          data,
          updatedAt: new Date().toISOString(),
        });
      }

      case 'outreach': {
        const data = await getOutreachMethodAnalytics(organizationId, dateRange);
        return NextResponse.json({
          view: 'outreach',
          days,
          data,
          updatedAt: new Date().toISOString(),
        });
      }

      case 'attribution': {
        const data = await getChannelAttribution(organizationId, dateRange);
        return NextResponse.json({
          view: 'attribution',
          days,
          data,
          updatedAt: new Date().toISOString(),
        });
      }

      case 'funnel': {
        const data = await getConversionFunnel(organizationId, dateRange);
        return NextResponse.json({
          view: 'funnel',
          days,
          data,
          updatedAt: new Date().toISOString(),
        });
      }

      case 'dashboard':
      default: {
        const data = await getCRMDashboardAnalytics(organizationId, dateRange);
        return NextResponse.json({
          view: 'dashboard',
          days,
          ...data,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (error: any) {
    console.error('[CRM Analytics] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

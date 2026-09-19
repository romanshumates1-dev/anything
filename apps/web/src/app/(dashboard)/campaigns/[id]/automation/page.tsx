/**
 * Campaign Automation Page
 *
 * Displays the automation dashboard and settings for a specific campaign.
 * Allows users to configure and monitor automated outreach.
 */
import { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CampaignAutomationDashboard } from '@/components/campaigns/CampaignAutomationDashboard';
import { CampaignAutomationSettings } from '@/components/campaigns/CampaignAutomationSettings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import sql from '@/app/api/utils/sql';
import { getOrganization } from '@/lib/organization-context';

export const metadata: Metadata = {
  title: 'Campaign Automation | DealFlow',
  description: 'Configure and monitor automated campaign outreach',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CampaignAutomationPage({ params }: PageProps) {
  const { id: campaignId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/auth/sign-in');
  }

  const organization = await getOrganization();
  if (!organization) {
    redirect('/onboarding');
  }

  // Get campaign details
  const [campaign] = await sql`
    SELECT oc.*, cs.*
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId} AND oc.organization_id = ${organization.id}
  `;

  if (!campaign) {
    redirect('/campaigns');
  }

  // Parse settings for the settings component
  const initialSettings = campaign.target_regions ? {
    regions: campaign.target_regions || [],
    propertyTypes: campaign.target_property_types || ['single_family', 'multi_family', 'condo'],
    priceRange: {
      min: campaign.target_price_min || 0,
      max: campaign.target_price_max || 100000000,
    },
    sendWindow: {
      start: campaign.send_window_start || '09:00',
      end: campaign.send_window_end || '17:00',
    },
    sendDays: campaign.send_days || ['mon', 'tue', 'wed', 'thu', 'fri'],
    touchDelays: campaign.touch_delays || [0, 2, 5, 10],
    automationLevel: campaign.automation_level || 'semi_auto',
    autoSendEnabled: campaign.auto_send_enabled ?? false,
    autoNegotiateEnabled: campaign.auto_negotiate_enabled ?? false,
    autoContractEnabled: campaign.auto_contract_enabled ?? false,
    humanReviewThreshold: campaign.human_review_threshold || 10000000,
    maxAutoCounters: campaign.max_auto_counters || 3,
    responseTimeoutHours: campaign.response_timeout_hours || 72,
    maxTouches: campaign.max_touches || 4,
    aiTone: campaign.ai_tone || 'professional',
    aiPersonalizationLevel: campaign.ai_personalization_level || 'high',
    abTestingEnabled: campaign.ab_testing_enabled ?? false,
  } : undefined;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
        <p className="text-gray-500 mt-1">
          Campaign Automation - {campaign.automation_enabled ? 'Enabled' : 'Disabled'}
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <CampaignAutomationDashboard campaignId={campaignId} />
        </TabsContent>

        <TabsContent value="settings">
          <CampaignAutomationSettings
            campaignId={campaignId}
            initialSettings={initialSettings}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

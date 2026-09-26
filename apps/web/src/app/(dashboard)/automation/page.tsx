/**
 * Automation Dashboard Page
 *
 * Overview of all automated campaigns and items needing attention.
 * The "command center" for set-and-forget campaign operation.
 */
import { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CampaignAutomationDashboard } from '@/components/campaigns/CampaignAutomationDashboard';
import { getOrganization } from '@/lib/organization-context';

export const metadata: Metadata = {
  title: 'Automation Dashboard | DealFlow',
  description: 'Monitor and manage all automated campaigns',
};

export default async function AutomationDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/account/signin');
  }

  const organization = await getOrganization();
  if (!organization) {
    // No /onboarding route exists and auth auto-creates an org on signup, so
    // a null org means a legacy account predating that hook. Render an inline
    // empty state (same pattern as optimization/dashboard) rather than
    // redirecting to a nonexistent route.
    return (
      <div className="container mx-auto py-8">
        <h1 className="text-2xl font-bold text-gray-900">Automation Dashboard</h1>
        <p className="text-gray-500 mt-1">
          No organization found for your account. Please contact support to set
          up your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Automation Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Monitor and manage your automated outreach campaigns
        </p>
      </div>

      <CampaignAutomationDashboard />
    </div>
  );
}

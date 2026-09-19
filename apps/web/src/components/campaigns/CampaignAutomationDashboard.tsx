/**
 * Campaign Automation Dashboard
 *
 * Real-time monitoring of automated campaigns showing:
 * - Campaign status and metrics
 * - Items needing human attention
 * - Response rates and conversion funnel
 * - Quick actions for common tasks
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  PlayIcon,
  PauseIcon,
  ExclamationTriangleIcon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  DocumentCheckIcon,
  ClockIcon,
  ArrowTrendingUpIcon,
  Cog6ToothIcon,
  BellAlertIcon,
} from '@heroicons/react/24/outline';

interface CampaignMetrics {
  leadsProcessed: number;
  messagesSent: number;
  responsesReceived: number;
  responseRate: number;
  interestedCount: number;
  notInterestedCount: number;
  counterOfferCount: number;
  noResponseCount: number;
  negotiationsStarted: number;
  contractsSent: number;
  contractsSigned: number;
  humanEscalations: number;
  avgResponseTimeHours: number;
  avgTouchesToResponse: number;
}

interface CampaignStatus {
  status: string;
  isRunning: boolean;
  lastRun: string | null;
  nextScheduledRun: string | null;
  contactsByStage: Record<string, number>;
  warnings: string[];
}

interface HumanAttentionItem {
  type: 'escalation' | 'high_value_deal' | 'complex_negotiation' | 'stuck_lead';
  contactId: string;
  campaignId: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  context: Record<string, any>;
  createdAt: string;
}

interface CampaignSummary {
  id: string;
  name: string;
  direction: string;
  status: string;
  automation_enabled: boolean;
  last_automation_run: string | null;
  total_contacts: number;
  pending_human_review: number;
  in_negotiation: number;
  contracts_signed: number;
}

interface DashboardData {
  campaigns: CampaignSummary[];
  attentionItems: HumanAttentionItem[];
  summary: {
    totalActiveCampaigns: number;
    totalAutomationEnabled: number;
    totalPendingHumanReview: number;
    totalInNegotiation: number;
  };
}

interface CampaignAutomationDashboardProps {
  campaignId?: string;
}

export function CampaignAutomationDashboard({ campaignId }: CampaignAutomationDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [campaignMetrics, setCampaignMetrics] = useState<CampaignMetrics | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      if (campaignId) {
        // Fetch specific campaign data
        const response = await fetch(`/api/campaigns/automation?campaignId=${campaignId}`);
        if (!response.ok) throw new Error('Failed to fetch campaign data');
        const data = await response.json();
        setCampaignMetrics(data.metrics);
        setCampaignStatus(data.status);
      } else {
        // Fetch dashboard overview
        const response = await fetch('/api/campaigns/automation');
        if (!response.ok) throw new Error('Failed to fetch dashboard data');
        const data = await response.json();
        setDashboardData(data);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleToggleAutomation = async (campaignId: string, enabled: boolean) => {
    try {
      const response = await fetch('/api/campaigns/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: enabled ? 'enable' : 'disable',
          campaignId,
        }),
      });
      if (!response.ok) throw new Error('Failed to toggle automation');
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-600">{error}</p>
        <Button onClick={fetchData} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  // Campaign-specific view
  if (campaignId && campaignMetrics && campaignStatus) {
    return (
      <CampaignDetailView
        metrics={campaignMetrics}
        status={campaignStatus}
        onRefresh={fetchData}
      />
    );
  }

  // Dashboard overview
  if (dashboardData) {
    return (
      <DashboardOverview
        data={dashboardData}
        onToggleAutomation={handleToggleAutomation}
        onRefresh={fetchData}
      />
    );
  }

  return null;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

interface DashboardOverviewProps {
  data: DashboardData;
  onToggleAutomation: (campaignId: string, enabled: boolean) => void;
  onRefresh: () => void;
}

function DashboardOverview({ data, onToggleAutomation, onRefresh }: DashboardOverviewProps) {
  return (
    <div className="space-y-6 p-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          title="Active Campaigns"
          value={data.summary.totalActiveCampaigns}
          icon={<PlayIcon className="h-5 w-5" />}
          color="green"
        />
        <SummaryCard
          title="Automation Enabled"
          value={data.summary.totalAutomationEnabled}
          icon={<Cog6ToothIcon className="h-5 w-5" />}
          color="blue"
        />
        <SummaryCard
          title="Needs Attention"
          value={data.summary.totalPendingHumanReview}
          icon={<BellAlertIcon className="h-5 w-5" />}
          color={data.summary.totalPendingHumanReview > 0 ? 'red' : 'gray'}
        />
        <SummaryCard
          title="In Negotiation"
          value={data.summary.totalInNegotiation}
          icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Campaigns List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserGroupIcon className="h-5 w-5" />
              Automated Campaigns
            </CardTitle>
            <CardDescription>
              Campaigns with automation enabled or available
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.campaigns.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  campaign={campaign}
                  onToggleAutomation={onToggleAutomation}
                />
              ))}
              {data.campaigns.length === 0 && (
                <p className="text-gray-500 text-center py-4">
                  No campaigns found
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Attention Items */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellAlertIcon className="h-5 w-5 text-red-500" />
              Needs Your Attention
            </CardTitle>
            <CardDescription>
              Items requiring human review or action
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.attentionItems.map((item, index) => (
                <AttentionItem key={index} item={item} />
              ))}
              {data.attentionItems.length === 0 && (
                <div className="text-center py-8">
                  <DocumentCheckIcon className="h-12 w-12 text-green-400 mx-auto mb-2" />
                  <p className="text-gray-500">All caught up!</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'green' | 'blue' | 'red' | 'purple' | 'gray';
}

function SummaryCard({ title, value, icon, color }: SummaryCardProps) {
  const colorClasses = {
    green: 'bg-green-50 text-green-600 border-green-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}

interface CampaignRowProps {
  campaign: CampaignSummary;
  onToggleAutomation: (campaignId: string, enabled: boolean) => void;
}

function CampaignRow({ campaign, onToggleAutomation }: CampaignRowProps) {
  const statusVariant = {
    ACTIVE: 'success',
    PAUSED: 'warning',
    DRAFT: 'neutral',
    COMPLETED: 'info',
  }[campaign.status] || 'neutral';

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">{campaign.name}</span>
          <StatusPill variant={statusVariant as any}>{campaign.status}</StatusPill>
          <Badge variant="outline" className="text-xs">
            {campaign.direction}
          </Badge>
        </div>
        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
          <span>{campaign.total_contacts} contacts</span>
          <span className="text-purple-600">{campaign.in_negotiation} negotiating</span>
          <span className="text-green-600">{campaign.contracts_signed} signed</span>
          {campaign.pending_human_review > 0 && (
            <span className="text-red-600 flex items-center gap-1">
              <ExclamationTriangleIcon className="h-3 w-3" />
              {campaign.pending_human_review} need review
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id={`automation-${campaign.id}`}
            checked={campaign.automation_enabled}
            onCheckedChange={(checked) => onToggleAutomation(campaign.id, checked)}
            disabled={campaign.status !== 'ACTIVE'}
          />
          <Label htmlFor={`automation-${campaign.id}`} className="text-xs text-gray-500">
            Auto
          </Label>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/campaigns/${campaign.id}/automation`}>
            <Cog6ToothIcon className="h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}

interface AttentionItemProps {
  item: HumanAttentionItem;
}

function AttentionItem({ item }: AttentionItemProps) {
  const priorityColors = {
    high: 'border-red-300 bg-red-50',
    medium: 'border-yellow-300 bg-yellow-50',
    low: 'border-gray-300 bg-gray-50',
  };

  const typeIcons = {
    escalation: <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />,
    high_value_deal: <ArrowTrendingUpIcon className="h-4 w-4 text-green-500" />,
    complex_negotiation: <ChatBubbleLeftRightIcon className="h-4 w-4 text-purple-500" />,
    stuck_lead: <ClockIcon className="h-4 w-4 text-yellow-500" />,
  };

  return (
    <div className={`p-3 rounded-lg border ${priorityColors[item.priority]}`}>
      <div className="flex items-start gap-2">
        {typeIcons[item.type]}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm">{item.reason}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{item.context.name || 'Unknown'}</span>
            {item.context.propertyAddress && (
              <span className="truncate">{item.context.propertyAddress}</span>
            )}
          </div>
        </div>
        <Badge variant={item.priority === 'high' ? 'destructive' : 'secondary'} className="text-xs">
          {item.priority}
        </Badge>
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" className="text-xs">
          Review
        </Button>
        <Button variant="outline" size="sm" className="text-xs">
          Dismiss
        </Button>
      </div>
    </div>
  );
}

interface CampaignDetailViewProps {
  metrics: CampaignMetrics;
  status: CampaignStatus;
  onRefresh: () => void;
}

function CampaignDetailView({ metrics, status, onRefresh }: CampaignDetailViewProps) {
  return (
    <div className="space-y-6 p-6">
      {/* Status Banner */}
      {status.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-yellow-800">
            <ExclamationTriangleIcon className="h-5 w-5" />
            <span className="font-medium">Warnings</span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-yellow-700">
            {status.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          title="Leads Processed"
          value={metrics.leadsProcessed}
          subtitle="Total in campaign"
        />
        <MetricCard
          title="Messages Sent"
          value={metrics.messagesSent}
          subtitle={`${Math.round(metrics.responseRate * 100)}% response rate`}
        />
        <MetricCard
          title="Responses"
          value={metrics.responsesReceived}
          subtitle={`${metrics.avgTouchesToResponse.toFixed(1)} avg touches`}
        />
        <MetricCard
          title="In Negotiation"
          value={metrics.negotiationsStarted}
          subtitle={`${metrics.contractsSigned} signed`}
          highlight
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Response Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Response Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <BreakdownBar
                label="Interested"
                value={metrics.interestedCount}
                total={metrics.responsesReceived}
                color="green"
              />
              <BreakdownBar
                label="Counter Offers"
                value={metrics.counterOfferCount}
                total={metrics.responsesReceived}
                color="blue"
              />
              <BreakdownBar
                label="Not Interested"
                value={metrics.notInterestedCount}
                total={metrics.responsesReceived}
                color="red"
              />
              <BreakdownBar
                label="No Response"
                value={metrics.noResponseCount}
                total={metrics.leadsProcessed}
                color="gray"
              />
            </div>
          </CardContent>
        </Card>

        {/* Contacts by Stage */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Stages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(status.contactsByStage).map(([stage, count]) => (
                <div key={stage} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{formatStageName(stage)}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {metrics.avgResponseTimeHours.toFixed(1)}h
              </p>
              <p className="text-sm text-gray-500">Avg Response Time</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {metrics.avgTouchesToResponse.toFixed(1)}
              </p>
              <p className="text-sm text-gray-500">Avg Touches to Response</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {metrics.humanEscalations}
              </p>
              <p className="text-sm text-gray-500">Human Escalations</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">
                {metrics.contractsSigned}
              </p>
              <p className="text-sm text-gray-500">Contracts Signed</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: number;
  subtitle: string;
  highlight?: boolean;
}

function MetricCard({ title, value, subtitle, highlight }: MetricCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'bg-green-50 border-green-200' : 'bg-white'}`}>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className={`text-3xl font-bold mt-1 ${highlight ? 'text-green-600' : 'text-gray-900'}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

interface BreakdownBarProps {
  label: string;
  value: number;
  total: number;
  color: 'green' | 'blue' | 'red' | 'gray';
}

function BreakdownBar({ label, value, total, color }: BreakdownBarProps) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  const colorClasses = {
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    gray: 'bg-gray-400',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium">{value} ({percentage}%)</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function formatStageName(stage: string): string {
  return stage
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

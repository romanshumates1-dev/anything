'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  MapPin,
  Clock,
  Target,
  Brain,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Lightbulb,
  BarChart3,
  Users,
  Building2,
  DollarSign,
  ArrowRight,
  Mail,
  MessageSquare,
  Camera,
  Share2,
} from 'lucide-react';
import { useState } from 'react';

const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;
const money = (n: number) => `$${(n || 0).toLocaleString()}`;

interface RegionalMetrics {
  state: string;
  contacted: number;
  replied: number;
  interested: number;
  contracts: number;
  responseRate: number;
  interestRate: number;
  contractRate: number;
  avgDealValue: number;
  totalRevenue: number;
  roi: number;
}

interface HourlyMetrics {
  hour: number;
  hourLabel: string;
  sent: number;
  delivered: number;
  replied: number;
  responseRate: number;
  qualityScore: number;
}

interface AIRecommendation {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  analysis: string;
  specificAction: string;
  expectedImpact: string;
  implementationSteps: string[];
  estimatedEffort: string;
  roiProjection?: {
    projectedAdditionalReplies: number;
    projectedAdditionalDeals: number;
    projectedRevenueImpact: string;
    confidenceRange: { low: string; high: string };
  };
  confidence: string;
  sampleSize: number;
  dataCitations: string[];
}

interface BuyerMetrics {
  totalBuyers: number;
  vipBuyers: number;
  verifiedBuyers: number;
  avgCloseTime: number;
  totalAssignments: number;
  pendingAssignments: number;
  completedDeals: number;
  avgAssignmentFee: number;
}

interface SellerMetrics {
  totalLeads: number;
  contacted: number;
  replied: number;
  interested: number;
  contracted: number;
  avgResponseTime: number;
  avgTouchesToInterest: number;
  topSources: { source: string; leads: number; contractRate: number }[];
}

interface OutreachMethodMetrics {
  method: string;
  messagesSent: number;
  messagesDelivered: number;
  messagesOpened: number;
  responses: number;
  conversions: number;
  optOuts: number;
  bounces: number;
  deliveryRate: number;
  openRate: number;
  responseRate: number;
  conversionRate: number;
  costPerMessage: number;
  costPerConversion: number;
  roi: number;
}

export default function AdvancedAnalyticsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());
  const [selectedDays, setSelectedDays] = useState(30);

  const { data: advanced, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['analytics-advanced', selectedDays],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/advanced?days=${selectedDays}`);
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: aiRecommendations, isLoading: aiLoading, refetch: refetchAI } = useQuery({
    queryKey: ['analytics-ai-recommendations', selectedDays],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/ai-recommendations?days=${selectedDays}`);
      if (!res.ok) throw new Error('Failed to fetch AI recommendations');
      return res.json();
    },
    enabled: !!session,
    staleTime: 300_000,
  });

  const { data: crmData, isLoading: crmLoading } = useQuery({
    queryKey: ['analytics-crm', selectedDays],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/crm?view=dashboard&days=${selectedDays}`);
      if (!res.ok) throw new Error('Failed to fetch CRM analytics');
      return res.json();
    },
    enabled: !!session,
    staleTime: 60_000,
  });

  const toggleState = (state: string) => {
    const newSet = new Set(expandedStates);
    if (newSet.has(state)) {
      newSet.delete(state);
    } else {
      newSet.add(state);
    }
    setExpandedStates(newSet);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) return null;

  const regional: RegionalMetrics[] = advanced?.regional || [];
  const hourly: HourlyMetrics[] = advanced?.hourly || [];
  const recommendations: AIRecommendation[] = aiRecommendations?.recommendations || [];
  const buyerMetrics: BuyerMetrics = advanced?.buyerMetrics || {};
  const sellerMetrics: SellerMetrics = advanced?.sellerMetrics || {};
  const summary = aiRecommendations?.summary || {};
  const outreachMethods: OutreachMethodMetrics[] = crmData?.outreach || [];
  const channelAttribution = crmData?.attribution || [];
  const crmSummary = crmData?.summary || {};

  const priorityColors = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200',
  };

  const categoryIcons: Record<string, any> = {
    messaging: Brain,
    timing: Clock,
    targeting: Target,
    channel: BarChart3,
    followup: RefreshCw,
    compliance: AlertTriangle,
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Advanced CRM Analytics</h1>
            <p className="text-gray-500 mt-1">Regional performance, AI insights, and pipeline metrics</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedDays}
              onChange={(e) => setSelectedDays(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetch(); refetchAI(); }}
              disabled={isFetching || aiLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </header>

        <Tabs defaultValue="regional" className="space-y-6">
          <TabsList className="bg-white border shadow-sm">
            <TabsTrigger value="regional" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Regional
            </TabsTrigger>
            <TabsTrigger value="outreach" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Outreach Methods
            </TabsTrigger>
            <TabsTrigger value="ai-review" className="flex items-center gap-2">
              <Brain className="h-4 w-4" /> AI Campaign Review
            </TabsTrigger>
            <TabsTrigger value="pipelines" className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Pipeline Metrics
            </TabsTrigger>
            <TabsTrigger value="timing" className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Timing Analysis
            </TabsTrigger>
          </TabsList>

          {/* Regional Analytics Tab */}
          <TabsContent value="regional" className="space-y-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  Regional Performance by State
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="py-12 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : regional.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">
                    No regional data available. Run campaigns to see geographic breakdown.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {regional.map((r) => (
                      <div key={r.state} className="border rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleState(r.state)}
                          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center gap-4">
                            {expandedStates.has(r.state) ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                            <span className="font-semibold text-lg">{r.state}</span>
                            <Badge variant="outline">{r.contacted} contacted</Badge>
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div className="text-right">
                              <div className="text-gray-500">Response</div>
                              <div className={`font-semibold ${r.responseRate >= 10 ? 'text-green-600' : r.responseRate >= 5 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {pct(r.responseRate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-gray-500">Contract</div>
                              <div className={`font-semibold ${r.contractRate >= 3 ? 'text-green-600' : r.contractRate >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {pct(r.contractRate)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-gray-500">ROI</div>
                              <div className={`font-semibold flex items-center gap-1 ${r.roi >= 100 ? 'text-green-600' : r.roi >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {r.roi >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                                {pct(r.roi)}
                              </div>
                            </div>
                          </div>
                        </button>
                        {expandedStates.has(r.state) && (
                          <div className="border-t bg-gray-50 p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <MetricBox label="Contacted" value={r.contacted} />
                              <MetricBox label="Replied" value={r.replied} />
                              <MetricBox label="Interested" value={r.interested} />
                              <MetricBox label="Contracts" value={r.contracts} />
                              <MetricBox label="Avg Deal Value" value={money(r.avgDealValue)} />
                              <MetricBox label="Total Revenue" value={money(r.totalRevenue)} />
                              <MetricBox label="Interest Rate" value={pct(r.interestRate)} />
                              <MetricBox label="ROI" value={pct(r.roi)} highlight={r.roi >= 100} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Regional Performance Summary */}
            {regional.length > 0 && (
              <div className="grid md:grid-cols-3 gap-4">
                <Card className="border-none shadow-sm bg-green-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-green-700 mb-2">
                      <TrendingUp className="h-5 w-5" />
                      <span className="font-semibold">Top Performing States</span>
                    </div>
                    <div className="space-y-2">
                      {regional
                        .filter(r => r.roi > 0)
                        .sort((a, b) => b.roi - a.roi)
                        .slice(0, 3)
                        .map(r => (
                          <div key={r.state} className="flex justify-between text-sm">
                            <span>{r.state}</span>
                            <span className="font-semibold text-green-700">{pct(r.roi)} ROI</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-yellow-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-yellow-700 mb-2">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-semibold">Needs Attention</span>
                    </div>
                    <div className="space-y-2">
                      {regional
                        .filter(r => r.responseRate < 5 && r.contacted >= 50)
                        .sort((a, b) => a.responseRate - b.responseRate)
                        .slice(0, 3)
                        .map(r => (
                          <div key={r.state} className="flex justify-between text-sm">
                            <span>{r.state}</span>
                            <span className="font-semibold text-yellow-700">{pct(r.responseRate)} response</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-blue-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-blue-700 mb-2">
                      <Target className="h-5 w-5" />
                      <span className="font-semibold">Highest Volume</span>
                    </div>
                    <div className="space-y-2">
                      {regional
                        .sort((a, b) => b.contacted - a.contacted)
                        .slice(0, 3)
                        .map(r => (
                          <div key={r.state} className="flex justify-between text-sm">
                            <span>{r.state}</span>
                            <span className="font-semibold text-blue-700">{r.contacted.toLocaleString()} leads</span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Outreach Methods Tab */}
          <TabsContent value="outreach" className="space-y-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                  Outreach Method Performance
                  {outreachMethods.length > 0 && (
                    <Badge variant="outline" className="ml-2">{outreachMethods.length} channels</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {crmLoading ? (
                  <div className="py-12 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : outreachMethods.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">
                    No outreach data available. Run campaigns to see channel breakdown.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Method Cards */}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {outreachMethods.filter(m => m.messagesSent > 0).map((method) => (
                        <div
                          key={method.method}
                          className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-center gap-2 mb-3">
                            {method.method === 'email' && <Mail className="h-5 w-5 text-blue-600" />}
                            {method.method === 'sms' && <MessageSquare className="h-5 w-5 text-green-600" />}
                            {method.method === 'instagram' && <Camera className="h-5 w-5 text-pink-600" />}
                            {method.method === 'facebook' && <Share2 className="h-5 w-5 text-blue-700" />}
                            {!['email', 'sms', 'instagram', 'facebook'].includes(method.method) && (
                              <MessageSquare className="h-5 w-5 text-gray-600" />
                            )}
                            <span className="font-semibold capitalize">{method.method}</span>
                            {method.roi > 0 && (
                              <Badge variant="outline" className="ml-auto bg-green-50 text-green-700">
                                {pct(method.roi)} ROI
                              </Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <div className="text-gray-500">Sent</div>
                              <div className="font-semibold">{method.messagesSent.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Delivered</div>
                              <div className="font-semibold">{pct(method.deliveryRate)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Responses</div>
                              <div className="font-semibold">{method.responses.toLocaleString()}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Response Rate</div>
                              <div className={`font-semibold ${method.responseRate >= 3 ? 'text-green-600' : method.responseRate >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {pct(method.responseRate)}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Conversions</div>
                              <div className="font-semibold">{method.conversions}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Cost/Conv</div>
                              <div className="font-semibold">{money(method.costPerConversion)}</div>
                            </div>
                          </div>

                          {method.optOuts > 0 && (
                            <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                              {method.optOuts} opt-outs ({pct(method.optOuts / Math.max(method.messagesSent, 1) * 100)})
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Comparison Chart */}
                    {outreachMethods.filter(m => m.messagesSent > 0).length > 1 && (
                      <Card className="border-none bg-gray-50">
                        <CardHeader>
                          <CardTitle className="text-base">Channel Comparison</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {outreachMethods.filter(m => m.messagesSent > 0).map((method) => (
                              <div key={method.method} className="flex items-center gap-4">
                                <div className="w-24 text-sm font-medium capitalize">{method.method}</div>
                                <div className="flex-1">
                                  <div className="h-6 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        method.method === 'email' ? 'bg-blue-500' :
                                        method.method === 'sms' ? 'bg-green-500' :
                                        method.method === 'instagram' ? 'bg-pink-500' :
                                        method.method === 'facebook' ? 'bg-blue-700' :
                                        'bg-gray-500'
                                      }`}
                                      style={{ width: `${Math.min(method.responseRate * 10, 100)}%` }}
                                    />
                                  </div>
                                </div>
                                <div className="w-20 text-sm font-semibold text-right">
                                  {pct(method.responseRate)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Channel Attribution */}
                    {channelAttribution.length > 0 && (
                      <Card className="border-none bg-blue-50">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Target className="h-4 w-4" />
                            Channel Attribution
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-gray-600 border-b">
                                  <th className="py-2">Channel</th>
                                  <th className="py-2 text-right">First Touch</th>
                                  <th className="py-2 text-right">Last Touch</th>
                                  <th className="py-2 text-right">Assisted</th>
                                  <th className="py-2 text-right">Direct</th>
                                  <th className="py-2 text-right">Revenue</th>
                                </tr>
                              </thead>
                              <tbody>
                                {channelAttribution.map((attr: any) => (
                                  <tr key={attr.channel} className="border-b last:border-0">
                                    <td className="py-2 font-medium capitalize">{attr.channel || 'Unknown'}</td>
                                    <td className="py-2 text-right">{attr.firstTouch}</td>
                                    <td className="py-2 text-right">{attr.lastTouch}</td>
                                    <td className="py-2 text-right">{attr.assistedConversions}</td>
                                    <td className="py-2 text-right">{attr.directConversions}</td>
                                    <td className="py-2 text-right font-semibold text-green-700">
                                      {money(attr.totalRevenue)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Summary Stats */}
                    {crmSummary.totalLeads > 0 && (
                      <div className="grid md:grid-cols-4 gap-4">
                        <div className="bg-blue-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-blue-700">{crmSummary.totalLeads?.toLocaleString() || 0}</div>
                          <div className="text-sm text-blue-600">Total Leads</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-green-700">{crmSummary.totalConversions?.toLocaleString() || 0}</div>
                          <div className="text-sm text-green-600">Conversions</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-purple-700">{pct(crmSummary.avgConversionRate || 0)}</div>
                          <div className="text-sm text-purple-600">Avg Conversion</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-4 text-center">
                          <div className="text-3xl font-bold text-amber-700">{money(crmSummary.totalRevenue || 0)}</div>
                          <div className="text-sm text-amber-600">Total Revenue</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Campaign Review Tab */}
          <TabsContent value="ai-review" className="space-y-6">
            {/* AI Summary */}
            {summary.overallAssessment && (
              <Card className="border-none shadow-sm bg-gradient-to-r from-purple-50 to-blue-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-purple-600" />
                    AI Campaign Assessment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 text-lg">{summary.overallAssessment}</p>
                  {summary.keyFindings && (
                    <div className="mt-4 grid md:grid-cols-3 gap-4">
                      {summary.keyFindings.map((finding: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                          <span>{finding}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-600" />
                  AI-Powered Recommendations
                  {recommendations.length > 0 && (
                    <Badge variant="outline" className="ml-2">{recommendations.length} suggestions</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aiLoading ? (
                  <div className="py-12 flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                    <p className="text-gray-500">AI is analyzing your campaign data...</p>
                  </div>
                ) : recommendations.length === 0 ? (
                  <div className="py-12 text-center">
                    <Brain className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-gray-500">No recommendations yet.</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Run more campaigns to generate AI-powered insights and optimization suggestions.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recommendations.map((rec, i) => {
                      const Icon = categoryIcons[rec.category] || Lightbulb;
                      return (
                        <div key={i} className={`border rounded-lg p-4 ${priorityColors[rec.priority]}`}>
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <Icon className="h-5 w-5" />
                              <div>
                                <h3 className="font-semibold">{rec.title}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">{rec.category}</Badge>
                                  <Badge variant="outline" className="text-xs">{rec.priority} priority</Badge>
                                  <Badge variant="outline" className="text-xs">{rec.estimatedEffort}</Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {rec.confidence} confidence (n={rec.sampleSize})
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">Analysis: </span>
                              <span className="text-gray-600">{rec.analysis}</span>
                            </div>

                            <div className="bg-white/50 rounded p-3">
                              <span className="font-medium text-gray-700">Recommended Action: </span>
                              <span className="text-gray-800">{rec.specificAction}</span>
                            </div>

                            <div>
                              <span className="font-medium text-gray-700">Expected Impact: </span>
                              <span className="text-gray-600">{rec.expectedImpact}</span>
                            </div>

                            {rec.roiProjection && (
                              <div className="bg-green-50 border border-green-200 rounded p-3">
                                <div className="font-medium text-green-800 mb-2">ROI Projection</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>+{rec.roiProjection.projectedAdditionalReplies} replies</div>
                                  <div>+{rec.roiProjection.projectedAdditionalDeals} deals</div>
                                  <div className="col-span-2 font-semibold">
                                    Revenue impact: {rec.roiProjection.projectedRevenueImpact}
                                    <span className="font-normal text-gray-600 ml-2">
                                      (range: {rec.roiProjection.confidenceRange.low} - {rec.roiProjection.confidenceRange.high})
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {rec.implementationSteps?.length > 0 && (
                              <div>
                                <span className="font-medium text-gray-700">Steps to implement:</span>
                                <ol className="list-decimal list-inside mt-1 text-gray-600">
                                  {rec.implementationSteps.map((step, j) => (
                                    <li key={j}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            {rec.dataCitations?.length > 0 && (
                              <div className="text-xs text-gray-500 pt-2 border-t">
                                <span className="font-medium">Data sources: </span>
                                {rec.dataCitations.join(' | ')}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pipeline Metrics Tab */}
          <TabsContent value="pipelines" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Seller Pipeline */}
              <Card className="border-none shadow-sm">
                <CardHeader className="bg-blue-50 rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    Seller Pipeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {isLoading ? (
                    <div className="py-8 flex justify-center">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <MetricBox label="Total Leads" value={sellerMetrics.totalLeads?.toLocaleString() || '0'} />
                        <MetricBox label="Contacted" value={sellerMetrics.contacted?.toLocaleString() || '0'} />
                        <MetricBox label="Replied" value={sellerMetrics.replied?.toLocaleString() || '0'} />
                        <MetricBox label="Interested" value={sellerMetrics.interested?.toLocaleString() || '0'} />
                        <MetricBox label="Contracted" value={sellerMetrics.contracted?.toLocaleString() || '0'} highlight />
                        <MetricBox label="Avg Response Time" value={`${sellerMetrics.avgResponseTime || 0}h`} />
                      </div>

                      {/* Funnel visualization */}
                      <div className="pt-4 border-t">
                        <div className="text-sm font-medium text-gray-600 mb-3">Conversion Funnel</div>
                        <FunnelBar
                          stages={[
                            { label: 'Leads', value: sellerMetrics.totalLeads || 0, color: 'bg-blue-500' },
                            { label: 'Contacted', value: sellerMetrics.contacted || 0, color: 'bg-blue-400' },
                            { label: 'Replied', value: sellerMetrics.replied || 0, color: 'bg-purple-500' },
                            { label: 'Interested', value: sellerMetrics.interested || 0, color: 'bg-amber-500' },
                            { label: 'Contracted', value: sellerMetrics.contracted || 0, color: 'bg-green-500' },
                          ]}
                        />
                      </div>

                      {/* Top sources */}
                      {sellerMetrics.topSources?.length > 0 && (
                        <div className="pt-4 border-t">
                          <div className="text-sm font-medium text-gray-600 mb-2">Top Lead Sources</div>
                          {sellerMetrics.topSources.slice(0, 3).map((src, i) => (
                            <div key={i} className="flex justify-between text-sm py-1">
                              <span>{src.source}</span>
                              <span className="text-gray-500">
                                {src.leads} leads ({pct(src.contractRate)} close rate)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Buyer Pipeline */}
              <Card className="border-none shadow-sm">
                <CardHeader className="bg-green-50 rounded-t-lg">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-green-600" />
                    Buyer Pipeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {isLoading ? (
                    <div className="py-8 flex justify-center">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <MetricBox label="Total Buyers" value={buyerMetrics.totalBuyers?.toLocaleString() || '0'} />
                        <MetricBox label="VIP Buyers" value={buyerMetrics.vipBuyers?.toLocaleString() || '0'} />
                        <MetricBox label="Verified" value={buyerMetrics.verifiedBuyers?.toLocaleString() || '0'} />
                        <MetricBox label="Avg Close Time" value={`${buyerMetrics.avgCloseTime || 0} days`} />
                        <MetricBox label="Active Assignments" value={buyerMetrics.pendingAssignments?.toLocaleString() || '0'} />
                        <MetricBox label="Completed Deals" value={buyerMetrics.completedDeals?.toLocaleString() || '0'} highlight />
                      </div>

                      {/* Buyer tier breakdown */}
                      <div className="pt-4 border-t">
                        <div className="text-sm font-medium text-gray-600 mb-3">Buyer Distribution</div>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-purple-100 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-purple-700">{buyerMetrics.vipBuyers || 0}</div>
                            <div className="text-xs text-purple-600">VIP</div>
                          </div>
                          <div className="flex-1 bg-blue-100 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-blue-700">{buyerMetrics.verifiedBuyers || 0}</div>
                            <div className="text-xs text-blue-600">Verified</div>
                          </div>
                          <div className="flex-1 bg-gray-100 rounded-lg p-3 text-center">
                            <div className="text-2xl font-bold text-gray-700">
                              {(buyerMetrics.totalBuyers || 0) - (buyerMetrics.vipBuyers || 0) - (buyerMetrics.verifiedBuyers || 0)}
                            </div>
                            <div className="text-xs text-gray-600">Prospect</div>
                          </div>
                        </div>
                      </div>

                      {/* Assignment fee */}
                      {buyerMetrics.avgAssignmentFee > 0 && (
                        <div className="pt-4 border-t">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Avg Assignment Fee</span>
                            <span className="text-xl font-bold text-green-600">
                              {money(buyerMetrics.avgAssignmentFee)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Pipeline flow visualization */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRight className="h-5 w-5" />
                  Deal Flow: Seller to Buyer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 py-4">
                  <FlowStage label="Lead Found" value={sellerMetrics.totalLeads || 0} color="bg-blue-100 text-blue-700" />
                  <ArrowRight className="h-6 w-6 text-gray-300 flex-shrink-0" />
                  <FlowStage label="Contacted" value={sellerMetrics.contacted || 0} color="bg-blue-50 text-blue-600" />
                  <ArrowRight className="h-6 w-6 text-gray-300 flex-shrink-0" />
                  <FlowStage label="Interested" value={sellerMetrics.interested || 0} color="bg-purple-100 text-purple-700" />
                  <ArrowRight className="h-6 w-6 text-gray-300 flex-shrink-0" />
                  <FlowStage label="Contracted" value={sellerMetrics.contracted || 0} color="bg-amber-100 text-amber-700" />
                  <ArrowRight className="h-6 w-6 text-gray-300 flex-shrink-0" />
                  <FlowStage label="Assigned" value={buyerMetrics.totalAssignments || 0} color="bg-green-100 text-green-700" />
                  <ArrowRight className="h-6 w-6 text-gray-300 flex-shrink-0" />
                  <FlowStage label="Closed" value={buyerMetrics.completedDeals || 0} color="bg-green-200 text-green-800" />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Timing Analysis Tab */}
          <TabsContent value="timing" className="space-y-6">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-600" />
                  Response Rates by Hour
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="py-12 flex justify-center">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : hourly.length === 0 ? (
                  <div className="py-12 text-center text-gray-500">
                    No timing data available yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-12 gap-1">
                      {hourly.map((h) => {
                        const intensity = Math.min(h.responseRate / 15, 1);
                        const bgColor = h.responseRate >= 10
                          ? `rgba(34, 197, 94, ${0.2 + intensity * 0.6})`
                          : h.responseRate >= 5
                          ? `rgba(234, 179, 8, ${0.2 + intensity * 0.6})`
                          : `rgba(239, 68, 68, ${0.2 + intensity * 0.4})`;
                        return (
                          <div
                            key={h.hour}
                            className="text-center p-2 rounded cursor-pointer hover:ring-2 ring-blue-400 transition"
                            style={{ backgroundColor: bgColor }}
                            title={`${h.hourLabel}: ${pct(h.responseRate)} response rate, ${h.sent} sent`}
                          >
                            <div className="text-xs font-medium">{h.hour}</div>
                            <div className="text-lg font-bold">{pct(h.responseRate)}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.6)' }} />
                        High (10%+)
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(234, 179, 8, 0.5)' }} />
                        Medium (5-10%)
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.4)' }} />
                        Low (&lt;5%)
                      </div>
                    </div>

                    {/* Best/worst times */}
                    <div className="grid md:grid-cols-2 gap-4 pt-4">
                      <div className="bg-green-50 rounded-lg p-4">
                        <div className="font-semibold text-green-700 mb-2">Best Times to Send</div>
                        {hourly
                          .sort((a, b) => b.responseRate - a.responseRate)
                          .slice(0, 3)
                          .map((h) => (
                            <div key={h.hour} className="flex justify-between text-sm py-1">
                              <span>{h.hourLabel}</span>
                              <span className="font-semibold text-green-700">{pct(h.responseRate)}</span>
                            </div>
                          ))}
                      </div>
                      <div className="bg-red-50 rounded-lg p-4">
                        <div className="font-semibold text-red-700 mb-2">Avoid These Times</div>
                        {hourly
                          .filter(h => h.sent >= 10)
                          .sort((a, b) => a.responseRate - b.responseRate)
                          .slice(0, 3)
                          .map((h) => (
                            <div key={h.hour} className="flex justify-between text-sm py-1">
                              <span>{h.hourLabel}</span>
                              <span className="font-semibold text-red-700">{pct(h.responseRate)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function MetricBox({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-green-700' : ''}`}>{value}</div>
    </div>
  );
}

function FunnelBar({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...stages.map(s => s.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((stage, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-20 text-xs text-gray-600 text-right">{stage.label}</div>
          <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${stage.color} rounded-full transition-all duration-500`}
              style={{ width: `${(stage.value / max) * 100}%` }}
            />
          </div>
          <div className="w-16 text-xs font-medium">{stage.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function FlowStage({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex-1 ${color} rounded-lg p-4 text-center`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs mt-1">{label}</div>
    </div>
  );
}

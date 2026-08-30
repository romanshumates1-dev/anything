'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Rocket, Target, Users, Home, DollarSign, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';

interface CampaignPlan {
  targetDeals: number;
  sellersNeeded: number;
  buyersNeeded: number;
  sellersPerDeal: number;
  buyersPerDeal: number;
  sellerConversion: number;
  buyerConversion: number;
  estimatedRevenue: number;
  estimatedCost: number;
  estimatedProfit: number;
  dailyOutreach: number;
  daysToTarget: number;
}

interface InventoryStatus {
  sellers: { available: number; needed: number; feasible: boolean; shortfall: number };
  buyers: { available: number; needed: number; feasible: boolean; shortfall: number };
}

const DEFAULT_ASSIGNMENT_FEE = 10000;
const SMS_COST_PER_MSG = 0.00645;
const EMAIL_COST_PER_MSG = 0.0001;
const TOUCHES_PER_LEAD = 5;

function calculatePlan(targetDeals: number): CampaignPlan {
  const sellerConversion = 0.9 * 0.02 * 0.32 * 0.28 * 0.12 * 0.2;
  const buyerConversion = 0.25 * 0.2 * 0.1;

  const sellersPerDeal = Math.ceil(1 / sellerConversion);
  const buyersPerDeal = Math.ceil(1 / buyerConversion);

  const sellersNeeded = Math.ceil(targetDeals * sellersPerDeal);
  const buyersNeeded = Math.ceil(targetDeals * buyersPerDeal * 1.5);

  const totalOutreach = (sellersNeeded + buyersNeeded) * TOUCHES_PER_LEAD;
  const smsCount = Math.ceil(totalOutreach * 0.6);
  const emailCount = Math.ceil(totalOutreach * 0.4);

  const estimatedCost = (smsCount * SMS_COST_PER_MSG) + (emailCount * EMAIL_COST_PER_MSG);
  const estimatedRevenue = targetDeals * DEFAULT_ASSIGNMENT_FEE;

  const dailyOutreach = 8500;
  const daysToTarget = Math.ceil(totalOutreach / dailyOutreach);

  return {
    targetDeals,
    sellersNeeded,
    buyersNeeded,
    sellersPerDeal,
    buyersPerDeal,
    sellerConversion,
    buyerConversion,
    estimatedRevenue,
    estimatedCost,
    estimatedProfit: estimatedRevenue - estimatedCost,
    dailyOutreach,
    daysToTarget,
  };
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  variant = 'default'
}: {
  icon: any;
  label: string;
  value: string | number;
  subtext?: string;
  variant?: 'default' | 'success' | 'warning';
}) {
  const colors = {
    default: 'text-gray-600',
    success: 'text-green-600',
    warning: 'text-amber-600',
  };

  return (
    <div className="bg-white rounded-lg p-4 border">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${colors[variant]}`} />
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${colors[variant]}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  );
}

export default function CampaignLauncherPage() {
  const { data: session, isPending } = useSession();
  const [targetDeals, setTargetDeals] = useState(10);
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [inventory, setInventory] = useState<InventoryStatus | null>(null);
  const [regions, setRegions] = useState<string[]>(['KY']);
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'planning' | 'launching' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const newPlan = calculatePlan(targetDeals);
    setPlan(newPlan);
    checkInventory(newPlan);
  }, [targetDeals]);

  async function checkInventory(plan: CampaignPlan) {
    try {
      const res = await fetch('/api/lead-finder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDeals: plan.targetDeals }),
      });
      if (res.ok) {
        const data = await res.json();
        setInventory({
          sellers: {
            available: data.inventory?.sellers?.available || 0,
            needed: plan.sellersNeeded,
            feasible: data.inventory?.sellers?.feasible ?? true,
            shortfall: data.inventory?.sellers?.shortfall || 0,
          },
          buyers: {
            available: data.inventory?.buyers?.available || 0,
            needed: plan.buyersNeeded,
            feasible: data.inventory?.buyers?.feasible ?? true,
            shortfall: data.inventory?.buyers?.shortfall || 0,
          },
        });
      }
    } catch (e) {
      console.error('Failed to check inventory:', e);
    }
  }

  const launchMutation = useMutation({
    mutationFn: async () => {
      setLaunchStatus('launching');

      const res = await fetch('/api/campaigns/auto-launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDeals,
          regions,
          autoGenerateLeads: true,
          autoDiscoverBuyers: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to launch campaign');
      }

      return res.json();
    },
    onSuccess: () => {
      setLaunchStatus('success');
    },
    onError: (err: any) => {
      setLaunchStatus('error');
      setErrorMsg(err.message);
    },
  });

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  if (launchStatus === 'success') {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-green-700 mb-2">Campaign Launched!</h2>
              <p className="text-green-600 mb-6">
                Your {targetDeals}-deal campaign is now active. The system will automatically:
              </p>
              <ul className="text-left text-green-700 space-y-2 mb-6 max-w-md mx-auto">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Generate {plan?.sellersNeeded.toLocaleString()} seller leads
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Generate {plan?.buyersNeeded.toLocaleString()} buyer leads
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Start multi-touch outreach sequences
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> AI classify all responses
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Auto-match buyers when sellers sign
                </li>
              </ul>
              <div className="flex gap-4 justify-center">
                <Link href="/campaigns/monitor">
                  <Button>Monitor Campaign</Button>
                </Link>
                <Link href="/analytics">
                  <Button variant="outline">View Analytics</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/campaigns" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to Campaigns
        </Link>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-6 w-6" />
            Campaign Launcher
          </CardTitle>
          <CardDescription>
            Set your target assignment contracts and the system will auto-generate the required seller and buyer leads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            <div>
              <label className="block text-sm font-medium mb-4">
                Target Assignment Contracts: <span className="text-2xl font-bold text-blue-600">{targetDeals}</span>
              </label>
              <Slider
                value={[targetDeals]}
                onValueChange={(v) => setTargetDeals(v[0])}
                min={1}
                max={30}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-2">
                <span>1 deal</span>
                <span>15 deals</span>
                <span>30 deals</span>
              </div>
            </div>

            {plan && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    icon={Home}
                    label="Seller Leads Needed"
                    value={plan.sellersNeeded.toLocaleString()}
                    subtext={`${plan.sellersPerDeal.toLocaleString()} per deal`}
                  />
                  <MetricCard
                    icon={Users}
                    label="Buyer Leads Needed"
                    value={plan.buyersNeeded.toLocaleString()}
                    subtext={`${plan.buyersPerDeal.toLocaleString()} per deal`}
                  />
                  <MetricCard
                    icon={DollarSign}
                    label="Est. Revenue"
                    value={`$${(plan.estimatedRevenue / 1000).toFixed(0)}K`}
                    subtext={`@ $${(DEFAULT_ASSIGNMENT_FEE / 1000).toFixed(0)}K avg fee`}
                    variant="success"
                  />
                  <MetricCard
                    icon={TrendingUp}
                    label="Est. Profit"
                    value={`$${(plan.estimatedProfit / 1000).toFixed(0)}K`}
                    subtext={`Cost: $${plan.estimatedCost.toFixed(0)}`}
                    variant="success"
                  />
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium mb-3">Campaign Timeline</h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">{plan.dailyOutreach.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">Daily outreach capacity</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{plan.daysToTarget}</div>
                      <div className="text-xs text-gray-500">Days to complete</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{((plan.sellersNeeded + plan.buyersNeeded) * TOUCHES_PER_LEAD).toLocaleString()}</div>
                      <div className="text-xs text-gray-500">Total touches</div>
                    </div>
                  </div>
                </div>

                {inventory && (
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="font-medium mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Lead Generation Plan
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Seller Leads</span>
                        <div className="flex items-center gap-2">
                          {inventory.sellers.available >= inventory.sellers.needed ? (
                            <Badge variant="outline" className="bg-green-100 text-green-700">
                              {inventory.sellers.available.toLocaleString()} available
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-100 text-amber-700">
                              Will generate {inventory.sellers.shortfall.toLocaleString()} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Buyer Leads</span>
                        <div className="flex items-center gap-2">
                          {inventory.buyers.available >= inventory.buyers.needed ? (
                            <Badge variant="outline" className="bg-green-100 text-green-700">
                              {inventory.buyers.available.toLocaleString()} available
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-100 text-amber-700">
                              Will generate {inventory.buyers.shortfall.toLocaleString()} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-blue-600 mt-2">
                        Lead Generator will automatically source leads from public records based on proven investor signals
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-green-50 rounded-lg p-4">
                  <h3 className="font-medium mb-3">What Happens When You Launch</h3>
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <h4 className="font-medium text-green-700 mb-2">Seller Pipeline</h4>
                      <ul className="space-y-1 text-green-600">
                        <li>1. Generate distressed seller leads</li>
                        <li>2. Multi-touch outreach (SMS + Email)</li>
                        <li>3. AI classifies all replies</li>
                        <li>4. AI negotiation engine</li>
                        <li>5. Auto contract generation</li>
                        <li>6. Self-hosted e-sign</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-medium text-green-700 mb-2">Buyer Pipeline</h4>
                      <ul className="space-y-1 text-green-600">
                        <li>1. Generate investor buyer leads</li>
                        <li>2. Multi-touch outreach (SMS + Email)</li>
                        <li>3. AI classifies all replies</li>
                        <li>4. Auto-match when seller signs</li>
                        <li>5. VIP window (2hr exclusive)</li>
                        <li>6. Assignment contract + close</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}

            {errorMsg && (
              <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                {errorMsg}
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              onClick={() => launchMutation.mutate()}
              disabled={launchMutation.isPending}
            >
              {launchMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Launching Campaign...
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 mr-2" />
                  Launch {targetDeals}-Deal Campaign
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

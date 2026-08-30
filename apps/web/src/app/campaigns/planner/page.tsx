'use client';

import { useState, useMemo } from 'react';
import { useSession } from '@/lib/auth-client';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calculator, TrendingUp, Users, Repeat, DollarSign, Info, Mail, Phone, MessageSquare } from 'lucide-react';
import Link from 'next/link';

interface CostInputs {
  skipTrace: number;
  dncScrub: number;
  segmentCost: number;
  aiPerConversation: number;
  budget: number;
  contacts: number;
  breadthTouches: number;
  depthSmsTouches: number;
  depthEmailTouches: number;
  depthCallTouches: number;
  conversionRate: number;
  measuredN: number | null;
}

interface ChannelBreakdown {
  sms: number;
  email: number;
  call: number;
}

interface PlanResult {
  label: string;
  contacts: number;
  channels: ChannelBreakdown;
  totalTouches: number;
  acquisitionCost: number;
  smsSendingCost: number;
  emailSendingCost: number;
  callCost: number;
  aiCost: number;
  totalCost: number;
  lambda: number;
  pGte1: number;
  pGte2: number;
  pGte3: number;
  costPerExpectedContract: number;
}

function poisson(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    p *= lambda / (i + 1);
  }
  return p;
}

function poissonCdf(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poisson(lambda, i);
  }
  return sum;
}

function pGte(lambda: number, k: number): number {
  return 1 - poissonCdf(lambda, k - 1);
}

function nForConfidence(confidence: number, kTarget: number, convRate: number): number {
  for (let n = 1; n < 1_000_000; n += 10) {
    const lam = n * convRate;
    if (pGte(lam, kTarget) >= confidence) return n;
  }
  return Infinity;
}

function computePlan(
  label: string,
  contacts: number,
  channels: ChannelBreakdown,
  costs: CostInputs,
): PlanResult {
  const totalTouches = contacts * (channels.sms + channels.email + channels.call);
  const acquisitionCost = contacts * (costs.skipTrace + costs.dncScrub);
  const smsSendingCost = contacts * channels.sms * costs.segmentCost;
  const emailSendingCost = 0;
  const callCost = 0;
  const replyRate = 0.03;
  const touchesPerContact = channels.sms + channels.email + channels.call;
  const aiCost = contacts * replyRate * touchesPerContact * costs.aiPerConversation;
  const totalCost = acquisitionCost + smsSendingCost + emailSendingCost + callCost + aiCost;
  const effectiveRate = costs.conversionRate * (touchesPerContact / 2);
  const lambda = contacts * effectiveRate;
  return {
    label,
    contacts,
    channels,
    totalTouches,
    acquisitionCost,
    smsSendingCost,
    emailSendingCost,
    callCost,
    aiCost,
    totalCost,
    lambda,
    pGte1: pGte(lambda, 1),
    pGte2: pGte(lambda, 2),
    pGte3: pGte(lambda, 3),
    costPerExpectedContract: lambda > 0 ? totalCost / lambda : Infinity,
  };
}

const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctFmt = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function CampaignPlannerPage() {
  const { data: session, isPending } = useSession();

  const [inputs, setInputs] = useState<CostInputs>({
    skipTrace: 0.10,
    dncScrub: 0.005,
    segmentCost: 0.011,
    aiPerConversation: 0.04,
    budget: 500,
    contacts: 1000,
    breadthTouches: 2,
    depthSmsTouches: 4,
    depthEmailTouches: 4,
    depthCallTouches: 2,
    conversionRate: 0.0005,
    measuredN: null,
  });

  const set = (key: keyof CostInputs, value: number | null) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  const plans = useMemo(() => {
    const depthContacts = Math.floor(inputs.contacts / 4);
    const breadth = computePlan(
      'Plan A: Breadth (SMS only)',
      inputs.contacts,
      { sms: inputs.breadthTouches, email: 0, call: 0 },
      inputs,
    );
    const depth = computePlan(
      'Plan B: Depth (multi-channel)',
      depthContacts,
      { sms: inputs.depthSmsTouches, email: inputs.depthEmailTouches, call: inputs.depthCallTouches },
      inputs,
    );
    return { breadth, depth };
  }, [inputs]);

  const totalDepthTouches = inputs.depthSmsTouches + inputs.depthEmailTouches + inputs.depthCallTouches;

  const whatWouldHaveToBeTrue = useMemo(() => {
    const rate = inputs.conversionRate * (totalDepthTouches / 2);
    return {
      n80_1: nForConfidence(0.80, 1, rate),
      n95_1: nForConfidence(0.95, 1, rate),
      n80_3: nForConfidence(0.80, 3, rate),
      n95_3: nForConfidence(0.95, 3, rate),
    };
  }, [inputs.conversionRate, totalDepthTouches]);

  if (isPending) return null;
  if (!session) return null;

  const isMeasured = inputs.measuredN !== null && inputs.measuredN > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/campaigns">
          <Button variant="ghost" size="sm" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <ArrowLeft className="mr-1 h-4 w-4" /> Campaigns
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Campaign Financial Planner</h1>
        <Badge className="ml-2 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
          <Calculator className="mr-1 h-3 w-3" /> What does my next ${inputs.budget} buy?
        </Badge>
      </div>

      <GlassCard className="border-l-4 border-l-[var(--accent-blue)]">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-[var(--accent-blue)] shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">Governing insight:</strong> A NEW contact costs ~$0.09–0.17 (skip-trace + DNC).
            An additional SMS touch costs ~$0.011. Email and manual calls cost <strong className="text-[var(--color-success)]">$0</strong>.
            Depth across free channels multiplies touches without multiplying cost.
            ~80% of wholesale contracts close on follow-up between day 31–180.
          </div>
        </div>
      </GlassCard>

      {/* Inputs */}
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <DollarSign className="h-5 w-5 text-[var(--color-success)]" /> Per-Unit Costs & Parameters
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <Label className="text-[var(--text-secondary)]">Skip-trace ($/contact)</Label>
              <Input type="number" step="0.01" min="0" value={inputs.skipTrace}
                onChange={(e) => set('skipTrace', parseFloat(e.target.value) || 0)}
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label className="text-[var(--text-secondary)]">DNC scrub ($/contact)</Label>
              <Input type="number" step="0.001" min="0" value={inputs.dncScrub}
                onChange={(e) => set('dncScrub', parseFloat(e.target.value) || 0)}
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label className="text-[var(--text-secondary)]">SMS segment ($/msg)</Label>
              <Input type="number" step="0.001" min="0" value={inputs.segmentCost}
                onChange={(e) => set('segmentCost', parseFloat(e.target.value) || 0)}
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label className="text-[var(--text-secondary)]">AI ($/conversation)</Label>
              <Input type="number" step="0.01" min="0" value={inputs.aiPerConversation}
                onChange={(e) => set('aiPerConversation', parseFloat(e.target.value) || 0)}
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
            </div>
            <div>
              <Label className="text-[var(--text-secondary)]">Budget ($)</Label>
              <Input type="number" step="50" min="0" value={inputs.budget}
                onChange={(e) => set('budget', parseFloat(e.target.value) || 0)}
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <p className="mb-2 text-sm font-medium text-[var(--accent-blue)]">Plan A (Breadth): SMS-only, wide net</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <Label className="text-[var(--text-secondary)]">Total contacts</Label>
                <Input type="number" step="100" min="1" value={inputs.contacts}
                  onChange={(e) => set('contacts', parseInt(e.target.value) || 1)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
              </div>
              <div>
                <Label className="text-[var(--text-secondary)]">SMS touches per contact</Label>
                <Input type="number" step="1" min="1" max="5" value={inputs.breadthTouches}
                  onChange={(e) => set('breadthTouches', parseInt(e.target.value) || 1)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <p className="mb-2 text-sm font-medium text-[var(--color-success)]">
              Plan B (Depth): {Math.floor(inputs.contacts / 4)} contacts × {totalDepthTouches} touches across channels
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="flex items-center gap-1 text-[var(--text-secondary)]"><MessageSquare className="h-3 w-3" /> SMS touches</Label>
                <Input type="number" step="1" min="0" max="12" value={inputs.depthSmsTouches}
                  onChange={(e) => set('depthSmsTouches', parseInt(e.target.value) || 0)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">${inputs.segmentCost}/msg</p>
              </div>
              <div>
                <Label className="flex items-center gap-1 text-[var(--text-secondary)]"><Mail className="h-3 w-3" /> Email touches</Label>
                <Input type="number" step="1" min="0" max="12" value={inputs.depthEmailTouches}
                  onChange={(e) => set('depthEmailTouches', parseInt(e.target.value) || 0)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
                <p className="mt-0.5 text-[10px] text-[var(--color-success)] font-medium">$0.00/msg (free)</p>
              </div>
              <div>
                <Label className="flex items-center gap-1 text-[var(--text-secondary)]"><Phone className="h-3 w-3" /> Call touches</Label>
                <Input type="number" step="1" min="0" max="6" value={inputs.depthCallTouches}
                  onChange={(e) => set('depthCallTouches', parseInt(e.target.value) || 0)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
                <p className="mt-0.5 text-[10px] text-[var(--color-success)] font-medium">$0.00 (your minutes)</p>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <Label className="flex items-center gap-1 text-[var(--text-secondary)]">
                  Conversion rate
                  <Badge className={`ml-1 text-[10px] ${isMeasured ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'}`}>
                    {isMeasured ? `MEASURED (n=${inputs.measuredN})` : 'BENCHMARK'}
                  </Badge>
                </Label>
                <Input type="number" step="0.0001" min="0" max="1" value={inputs.conversionRate}
                  onChange={(e) => set('conversionRate', parseFloat(e.target.value) || 0)}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
              </div>
              <div>
                <Label className="text-[var(--text-secondary)]">Measured sample (n, blank=benchmark)</Label>
                <Input type="number" step="1" min="0" placeholder="Leave blank for benchmark"
                  value={inputs.measuredN ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    set('measuredN', v ? parseInt(v) || null : null);
                  }}
                  className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Side-by-side Plans */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlanCard plan={plans.breadth} icon={<Users className="h-5 w-5" />} color="blue" winner={plans.breadth.costPerExpectedContract < plans.depth.costPerExpectedContract} isMeasured={isMeasured} />
        <PlanCard plan={plans.depth} icon={<Repeat className="h-5 w-5" />} color="green" winner={plans.depth.costPerExpectedContract <= plans.breadth.costPerExpectedContract} isMeasured={isMeasured} />
      </div>

      {/* What Would Have To Be True */}
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-[var(--accent-purple)]" /> What Would Have To Be True
        </h3>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          Contacts needed (at depth plan&apos;s effective rate) for target confidence:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-left text-[var(--text-muted)]">
                <th className="p-2">Target</th>
                <th className="p-2">80% confidence</th>
                <th className="p-2">95% confidence</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border-subtle)]">
                <td className="p-2 font-medium text-[var(--text-primary)]">&ge;1 contract</td>
                <td className="p-2 font-mono text-[var(--text-secondary)]">{whatWouldHaveToBeTrue.n80_1.toLocaleString()} contacts</td>
                <td className="p-2 font-mono text-[var(--text-secondary)]">{whatWouldHaveToBeTrue.n95_1.toLocaleString()} contacts</td>
              </tr>
              <tr>
                <td className="p-2 font-medium text-[var(--text-primary)]">&ge;3 contracts</td>
                <td className="p-2 font-mono text-[var(--text-secondary)]">{whatWouldHaveToBeTrue.n80_3.toLocaleString()} contacts</td>
                <td className="p-2 font-mono text-[var(--text-secondary)]">{whatWouldHaveToBeTrue.n95_3.toLocaleString()} contacts</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          <Badge className={`mr-1 text-[10px] ${isMeasured ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'}`}>
            {isMeasured ? `MEASURED (n=${inputs.measuredN})` : 'BENCHMARK (unverified for this account)'}
          </Badge>
          Base conversion: {(inputs.conversionRate * 100).toFixed(3)}%.
          Effective with {totalDepthTouches} touches: {((inputs.conversionRate * totalDepthTouches / 2) * 100).toFixed(3)}%.
        </p>
      </GlassCard>

      {/* Budget Feasibility */}
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Budget Feasibility at ${inputs.budget}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 p-4">
            <p className="text-sm font-medium text-[var(--accent-blue)]">Breadth (Plan A)</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {plans.breadth.totalCost <= inputs.budget
                ? `Fits budget (${money(plans.breadth.totalCost)} of ${money(inputs.budget)})`
                : `Over budget by ${money(plans.breadth.totalCost - inputs.budget)} — reduce contacts to ~${Math.floor(inputs.budget / (plans.breadth.totalCost / inputs.contacts))}`
              }
            </p>
          </div>
          <div className="rounded-lg bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 p-4">
            <p className="text-sm font-medium text-[var(--color-success)]">Depth (Plan B)</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              {plans.depth.totalCost <= inputs.budget
                ? `Fits budget (${money(plans.depth.totalCost)} of ${money(inputs.budget)})`
                : `Over budget by ${money(plans.depth.totalCost - inputs.budget)} — reduce contacts to ~${Math.floor(inputs.budget / (plans.depth.totalCost / plans.depth.contacts))}`
              }
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function PlanCard({ plan, icon, color, winner, isMeasured }: {
  plan: PlanResult;
  icon: React.ReactNode;
  color: 'blue' | 'green';
  winner?: boolean;
  isMeasured: boolean;
}) {
  const winnerClass = winner ? 'ring-2 ring-[var(--color-success)]/50' : '';
  const touchesPerContact = plan.channels.sms + plan.channels.email + plan.channels.call;
  return (
    <GlassCard className={`${winnerClass}`}>
      <h3 className={`text-lg font-semibold flex items-center gap-2 mb-4 ${color === 'blue' ? 'text-[var(--accent-blue)]' : 'text-[var(--color-success)]'}`}>
        {icon} {plan.label}
        {winner && <Badge className="ml-auto bg-[var(--color-success)]/10 text-[var(--color-success)] text-xs">Lower $/contract</Badge>}
      </h3>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Contacts" value={plan.contacts.toLocaleString()} />
          <Stat label="Touches / contact" value={String(touchesPerContact)} />
          <Stat label="Total touches" value={plan.totalTouches.toLocaleString()} />
          <Stat label="Acquisition cost" value={money(plan.acquisitionCost)} />
        </div>

        {/* Channel breakdown */}
        <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-xs">
          <p className="mb-1 font-medium text-[var(--text-secondary)]">Channel mix per contact:</p>
          <div className="flex gap-3 text-[var(--text-muted)]">
            {plan.channels.sms > 0 && <span>{plan.channels.sms} SMS ({money(plan.smsSendingCost)})</span>}
            {plan.channels.email > 0 && <span className="text-[var(--color-success)]">{plan.channels.email} email ($0)</span>}
            {plan.channels.call > 0 && <span className="text-[var(--color-success)]">{plan.channels.call} calls ($0)</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="SMS sending cost" value={money(plan.smsSendingCost)} />
          <Stat label="AI cost (est.)" value={money(plan.aiCost)} />
          <Stat label="Total cost" value={money(plan.totalCost)} bold />
          <Stat label="Expected contracts (λ)" value={plan.lambda.toFixed(2)} />
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-2">
          <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">Poisson probabilities:</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="P(≥1)" value={pctFmt(plan.pGte1)} />
            <Stat label="P(≥2)" value={pctFmt(plan.pGte2)} />
            <Stat label="P(≥3)" value={pctFmt(plan.pGte3)} />
          </div>
        </div>
        <div className="border-t border-[var(--border-subtle)] pt-2 text-sm">
          <Stat label="Cost per expected contract" value={plan.lambda > 0 ? money(plan.costPerExpectedContract) : '∞'} bold />
        </div>
        <p className="text-[10px] text-[var(--text-muted)]">
          <Badge className={`text-[9px] ${isMeasured ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'}`}>
            {isMeasured ? 'MEASURED' : 'BENCHMARK'}
          </Badge>{' '}
          Conversion inputs are {isMeasured ? 'from your account data' : 'unverified industry benchmarks'}.
        </p>
      </div>
    </GlassCard>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono ${bold ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>{value}</p>
    </div>
  );
}

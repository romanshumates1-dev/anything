'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, ArrowLeft, Rocket, Save, Clock, ShieldCheck, TestTube, DollarSign } from 'lucide-react';
import Link from 'next/link';

type WizardStep = 'basics' | 'sending' | 'followups' | 'compliance';

interface CampaignForm {
  // Step 1 - Basics
  name: string;
  direction: 'SELLER' | 'BUYER';
  contactSource: 'csv' | 'paste' | 'crm';
  consentMode: 'unverified' | 'inbound' | 'consented';
  openingMessage: string;
  contactListId?: string;
  pastedContacts: string;
  
  // Step 2 - Sending
  dailyVolumeMin: number;
  dailyVolumeMax: number;
  durationDays: number;
  startDate: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  
  // Step 3 - Follow-ups & AI
  followUps: Array<{ body: string; delayHours: number }>;
  aiNegotiationEnabled: boolean;
  aiValuationEnabled: boolean;
  resurrectionEnabled: boolean;
  abVariantsEnabled: boolean;
  
  // Step 4 - Compliance & Safety
  dncScrubEnabled: boolean;
  litigatorScrubEnabled: boolean;
  testMode: boolean;
  budgetCap?: number;
  selectedTestPhones: string[];
}

const DEFAULT_FORM: CampaignForm = {
  name: '',
  direction: 'SELLER',
  contactSource: 'csv',
  consentMode: 'unverified',
  openingMessage: '',
  pastedContacts: '',
  dailyVolumeMin: 50,
  dailyVolumeMax: 50,
  durationDays: 7,
  startDate: '',
  sendWindowStart: '09:00',
  sendWindowEnd: '19:00',
  timezone: 'America/New_York',
  followUps: [
    { body: '', delayHours: 24 },
    { body: '', delayHours: 48 },
  ],
  aiNegotiationEnabled: true,
  aiValuationEnabled: true,
  resurrectionEnabled: true,
  abVariantsEnabled: false,
  dncScrubEnabled: true,
  litigatorScrubEnabled: true,
  testMode: false,
  selectedTestPhones: [],
};

export default function CampaignWizardPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>('basics');
  const [form, setForm] = useState<CampaignForm>(DEFAULT_FORM);
  const [showDncConfirm, setShowDncConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segmentCount, setSegmentCount] = useState(1);

  // Queries
  const { data: contactLists } = useQuery({
    queryKey: ['contact-lists'],
    queryFn: async () => {
      const res = await fetch('/api/contact-lists');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const { data: testPhones } = useQuery({
    queryKey: ['test-phones'],
    queryFn: async () => {
      const res = await fetch('/api/test-phones');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  // Effects
  useEffect(() => {
    if (!session) {
      redirect('/account/signin');
    }
  }, [session]);

  useEffect(() => {
    const len = form.openingMessage.length;
    if (len <= 160) setSegmentCount(1);
    else if (len <= 320) setSegmentCount(2);
    else if (len <= 480) setSegmentCount(3);
    else setSegmentCount(Math.ceil(len / 160));
  }, [form.openingMessage]);

  // Default DNC based on consent mode
  useEffect(() => {
    if (form.contactSource === 'crm' && (form.consentMode === 'inbound' || form.consentMode === 'consented')) {
      setForm(f => ({ ...f, dncScrubEnabled: false }));
    } else if (!form.testMode) {
      setForm(f => ({ ...f, dncScrubEnabled: true }));
    }
  }, [form.consentMode, form.testMode]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: CampaignForm) => {
      const res = await fetch('/api/outreach/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: data.direction,
          name: data.name,
          dailyVolumeMax: data.dailyVolumeMax,
          durationDays: data.durationDays,
          openingMessage: data.openingMessage,
          followUps: data.followUps.filter(f => f.body.trim()),
          contacts: data.pastedContacts.split('\n').filter(Boolean),
          testMode: data.testMode,
          dncScrubEnabled: data.dncScrubEnabled,
          litigatorScrubEnabled: data.litigatorScrubEnabled,
          aiNegotiationEnabled: data.aiNegotiationEnabled,
          aiValuationEnabled: data.aiValuationEnabled,
          resurrectionEnabled: data.resurrectionEnabled,
          abVariantsEnabled: data.abVariantsEnabled,
          budgetCap: data.budgetCap,
          contactListId: data.contactListId,
          selectedTestPhones: data.selectedTestPhones,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create campaign');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      redirect('/campaigns');
    },
  });

  const saveDraft = () => {
    createMutation.mutate(form);
  };

  const launch = () => {
    createMutation.mutate(form);
  };

  const nextStep = () => {
    setError(null);
    if (step === 'basics') {
      if (!form.name.trim()) return setError('Campaign name is required');
      if (!form.openingMessage.trim()) return setError('Opening message is required');
    }
    setStep(s => {
      if (s === 'basics') return 'sending';
      if (s === 'sending') return 'followups';
      return 'compliance';
    });
  };

  const prevStep = () => {
    setStep(s => {
      if (s === 'sending') return 'basics';
      if (s === 'followups') return 'sending';
      return 'followups';
    });
  };

  const toggleDnc = () => {
    if (form.dncScrubEnabled) {
      setShowDncConfirm(true);
    } else {
      setForm(f => ({ ...f, dncScrubEnabled: true }));
    }
  };

  const confirmDncOff = async () => {
    setShowDncConfirm(false);
    setForm(f => ({ ...f, dncScrubEnabled: false }));
    
    // Record DNC-off compliance audit
    try {
      await fetch('/api/compliance/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DNC_SCRUB_DISABLED',
          campaignId: form.contactListId || 'new-campaign',
          confirmationText: 'I confirm these contacts have an existing business relationship or documented consent. I accept TCPA liability for any resulting violations.',
        }),
      });
    } catch (error) {
      console.error('Failed to record DNC audit:', error);
    }
  };

  const addFollowUp = () => {
    if (form.followUps.length < 5) {
      setForm(f => ({ ...f, followUps: [...f.followUps, { body: '', delayHours: 24 }] }));
    }
  };

  const removeFollowUp = (index: number) => {
    setForm(f => ({ ...f, followUps: f.followUps.filter((_, i) => i !== index) }));
  };

  const updateFollowUp = (index: number, field: 'body' | 'delayHours', value: string | number) => {
    setForm(f => ({
      ...f,
      followUps: f.followUps.map((fu, i) => i === index ? { ...fu, [field]: value } : fu),
    }));
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const steps: { key: WizardStep; label: string; short: string }[] = [
    { key: 'basics', label: 'Basics', short: '1' },
    { key: 'sending', label: 'Sending', short: '2' },
    { key: 'followups', label: 'Follow-ups & AI', short: '3' },
    { key: 'compliance', label: 'Compliance', short: '4' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <Link href="/campaigns" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Campaigns
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">New Campaign</h1>
          <p className="text-gray-500 mt-1">Only step 1 is required. Everything else has sensible defaults.</p>
        </header>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => i <= currentStepIndex && setStep(s.key)}
                disabled={i > currentStepIndex}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  step === s.key
                    ? 'bg-black text-white'
                    : i <= currentStepIndex
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                }`}
              >
                {s.short}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < steps.length - 1 && <div className="h-px bg-gray-200 flex-1" />}
            </div>
          ))}
        </div>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {/* Step 1 - Basics */}
        {step === 'basics' && (
          <Card className="border-none shadow-sm">
            <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Campaign Name *</Label>
                <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Q1 Seller Outreach" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="direction">Direction *</Label>
                <Select value={form.direction} onValueChange={(v: 'SELLER' | 'BUYER') => setForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SELLER">Seller (we're buying)</SelectItem>
                    <SelectItem value="BUYER">Buyer (we're selling)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Contact Source</Label>
                <Select value={form.contactSource} onValueChange={(v: 'csv' | 'paste' | 'crm') => setForm(f => ({ ...f, contactSource: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV Upload</SelectItem>
                    <SelectItem value="paste">Paste Numbers</SelectItem>
                    <SelectItem value="crm">CRM / Existing List</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.contactSource === 'crm' && (
                <div className="space-y-2">
                  <Label>Contact List</Label>
                  <Select value={form.contactListId} onValueChange={v => {
                    setForm(f => ({ ...f, contactListId: v }));
                    const list = contactLists?.find((l: any) => l.id === v);
                    if (list) setForm(f => ({ ...f, consentMode: list.consent_mode }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select a list…" /></SelectTrigger>
                    <SelectContent>
                      {(contactLists || []).map((l: any) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.consent_mode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(form.contactSource === 'paste') && (
                <div className="space-y-2">
                  <Label htmlFor="paste">Paste Phone Numbers (one per line)</Label>
                  <Textarea
                    id="paste"
                    rows={6}
                    value={form.pastedContacts}
                    onChange={e => setForm(f => ({ ...f, pastedContacts: e.target.value }))}
                    placeholder="+1 (555) 000-0000&#10;+1 (555) 000-0001"
                  />
                  <p className="text-xs text-gray-500">{form.pastedContacts.split('\n').filter(Boolean).length} numbers</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="opening">Opening Message *</Label>
                <Textarea
                  id="opening"
                  rows={4}
                  value={form.openingMessage}
                  onChange={e => setForm(f => ({ ...f, openingMessage: e.target.value }))}
                  placeholder="Hi {name}, I'm interested in {address} in {city}…"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{form.openingMessage.length} chars</p>
                  <Badge variant={segmentCount > 1 ? 'destructive' : 'outline'}>
                    {segmentCount} segment{segmentCount > 1 ? 's' : ''} = {segmentCount}× cost
                  </Badge>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={nextStep}>Next: Sending →</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2 - Sending */}
        {step === 'sending' && (
          <Card className="border-none shadow-sm">
            <CardHeader><CardTitle>Sending Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Daily Volume</Label>
                  <span className="text-sm font-medium">{form.dailyVolumeMin}–{form.dailyVolumeMax} msgs/day</span>
                </div>
                <Slider
                  min={form.direction === 'SELLER' ? 50 : 50}
                  max={form.direction === 'SELLER' ? 5000 : 1000}
                  step={50}
                  value={[form.dailyVolumeMin, form.dailyVolumeMax]}
                  onValueChange={([min, max]) => setForm(f => ({ ...f, dailyVolumeMin: min, dailyVolumeMax: max }))}
                />
                <p className="text-xs text-gray-500">Caps: {form.direction === 'SELLER' ? '50–5,000' : '50–1,000'} per day</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="duration">Duration (days)</Label>
                <Input
                  type="number"
                  id="duration"
                  min={1}
                  max={form.direction === 'SELLER' ? 120 : 30}
                  value={form.durationDays}
                  onChange={e => setForm(f => ({ ...f, durationDays: Number(e.target.value) }))}
                />
                <p className="text-xs text-gray-500">Max: {form.direction === 'SELLER' ? 120 : '30'} days</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="start">Start Date & Time</Label>
                <Input
                  type="datetime-local"
                  id="start"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
                <p className="text-xs text-gray-500">Default: tomorrow 8:00 AM</p>
              </div>

              <div className="space-y-2">
                <Label>Send Window (hard-clamped 8am–9pm)</Label>
                <div className="flex gap-4">
                  <Input type="time" value={form.sendWindowStart} onChange={e => setForm(f => ({ ...f, sendWindowStart: e.target.value }))} />
                  <Input type="time" value={form.sendWindowEnd} onChange={e => setForm(f => ({ ...f, sendWindowEnd: e.target.value }))} />
                </div>
                <p className="text-xs text-gray-500">Only sends between 8am–9pm. Window cannot exceed these bounds.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tz">Timezone</Label>
                <Input id="tz" value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} />
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={prevStep}>← Back</Button>
                <Button onClick={nextStep}>Next: Follow-ups →</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3 - Follow-ups & AI */}
        {step === 'followups' && (
          <Card className="border-none shadow-sm">
            <CardHeader><CardTitle>Follow-ups & AI</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Follow-up Sequence</Label>
                  {form.followUps.length < 5 && (
                    <Button size="sm" variant="outline" onClick={addFollowUp}>+ Add</Button>
                  )}
                </div>
                {form.followUps.map((fu, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Follow-up {i + 1}</span>
                      {i >= 2 && (
                        <Button size="sm" variant="ghost" onClick={() => removeFollowUp(i)}>Remove</Button>
                      )}
                    </div>
                    <Textarea
                      rows={2}
                      value={fu.body}
                      onChange={e => updateFollowUp(i, 'body', e.target.value)}
                      placeholder={`Follow-up message ${i + 1}…`}
                    />
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <Input
                        type="number"
                        min={1}
                        max={168}
                        value={fu.delayHours}
                        onChange={e => updateFollowUp(i, 'delayHours', Number(e.target.value))}
                        className="w-24"
                      />
                      <span className="text-sm text-gray-500">hours after previous</span>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-gray-500">Defaults: 2 pre-written follow-ups. You can edit or delete down to zero.</p>
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>AI Negotiation</Label>
                    <p className="text-xs text-gray-500">AI auto-responds to replies (default ON)</p>
                  </div>
                  <Switch checked={form.aiNegotiationEnabled} onCheckedChange={v => setForm(f => ({ ...f, aiNegotiationEnabled: v }))} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>AI Valuation Suggestions</Label>
                    <p className="text-xs text-gray-500">Suggest price ranges during negotiation</p>
                  </div>
                  <Switch checked={form.aiValuationEnabled} onCheckedChange={v => setForm(f => ({ ...f, aiValuationEnabled: v }))} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Resurrection Eligibility</Label>
                    <p className="text-xs text-gray-500">Cold leads may re-enter 30/60/90-day re-engagement</p>
                  </div>
                  <Switch checked={form.resurrectionEnabled} onCheckedChange={v => setForm(f => ({ ...f, resurrectionEnabled: v }))} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>A/B Variants</Label>
                    <p className="text-xs text-gray-500">Test multiple message variants</p>
                  </div>
                  <Switch checked={form.abVariantsEnabled} onCheckedChange={v => setForm(f => ({ ...f, abVariantsEnabled: v }))} />
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={prevStep}>← Back</Button>
                <Button onClick={nextStep}>Next: Compliance →</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4 - Compliance & Safety */}
        {step === 'compliance' && (
          <Card className="border-none shadow-sm">
            <CardHeader><CardTitle>Compliance & Safety</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Compliance defaults</AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  <p>Opt-out enforcement and TCPA quiet hours (8am–9pm) are hard-wired and cannot be disabled.</p>
                  <p>DNC scrubbing is ON by default for unverified lists.</p>
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <Label>DNC Scrubbing</Label>
                  <p className="text-xs text-gray-500">{form.dncScrubEnabled ? 'Enabled — contacts will be scrubbed against DNC list' : 'Disabled — estimated 15–25% higher deliverability risk'}</p>
                </div>
                <Switch checked={form.dncScrubEnabled} onCheckedChange={toggleDnc} />
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <Label>Litigator List Scrub</Label>
                  <p className="text-xs text-gray-500">Block known litigators (default ON)</p>
                </div>
                <Switch checked={form.litigatorScrubEnabled} onCheckedChange={v => setForm(f => ({ ...f, litigatorScrubEnabled: v }))} />
              </div>

              <div className={`border rounded-lg p-3 ${form.testMode ? 'bg-amber-50 border-amber-200' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className={form.testMode ? 'text-amber-800' : ''}>🧪 Personal Test Mode</Label>
                    <p className="text-xs text-gray-500">
                      {form.testMode ? 'ON — will only send to verified test numbers' : 'Send safely to your own phone first'}
                    </p>
                  </div>
                  <Switch checked={form.testMode} onCheckedChange={v => setForm(f => ({ ...f, testMode: v }))} />
                </div>
                {form.testMode && (
                  <div className="mt-3 space-y-2">
                    <Label>Verified Test Numbers</Label>
                    <div className="flex flex-wrap gap-2">
                      {(testPhones || []).filter((p: any) => p.verified).map((p: any) => (
                        <Badge key={p.id} variant="outline" className="bg-amber-100 text-amber-800">
                          {p.phone}
                        </Badge>
                      ))}
                      {(testPhones || []).filter((p: any) => !p.verified).length > 0 && (
                        <p className="text-xs text-amber-600">Unverified numbers won't be used in test mode.</p>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">Test mode auto-caps: ≤20 msgs/day, ≤3 days duration.</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Budget Cap (optional)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="budget"
                    type="number"
                    className="pl-9"
                    placeholder="No limit"
                    value={form.budgetCap || ''}
                    onChange={e => setForm(f => ({ ...f, budgetCap: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
                <p className="text-xs text-gray-500">Auto-pauses when projected SMS + AI spend hits this amount.</p>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={prevStep}>← Back</Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveDraft} disabled={createMutation.isPending}>
                    <Save className="h-4 w-4 mr-1" /> Save Draft
                  </Button>
                  <Button onClick={launch} disabled={createMutation.isPending}>
                    <Rocket className="h-4 w-4 mr-1" /> Launch Campaign
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* DNC Confirmation Modal */}
        {showDncConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="max-w-md mx-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  Disable DNC Scrubbing?
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertTitle>Legal Risk Warning</AlertTitle>
                  <AlertDescription className="text-sm">
                    You are about to send SMS to numbers that may be on the National Do Not Call Registry.
                    This may violate TCPA and expose you to liability of $500–$1,500 per violation.
                  </AlertDescription>
                </Alert>
                <p className="text-sm text-gray-700">
                  I confirm these contacts have an existing business relationship or documented consent.
                  I accept TCPA liability for any resulting violations.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowDncConfirm(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={confirmDncOff}>I Confirm, Disable DNC</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
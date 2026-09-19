/**
 * Campaign Automation Settings
 *
 * Configuration panel for campaign automation:
 * - Regional targeting (zip, county, state) with include/exclude support
 * - Property type filtering
 * - Price range targeting
 * - Send timing and days
 * - Automation levels and thresholds
 */
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  HomeIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CpuChipIcon,
  BellIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { RegionSelector, Region as RegionSelectorRegion } from './RegionSelector';

interface Region {
  type: 'zip' | 'county' | 'state' | 'ZIP' | 'COUNTY' | 'STATE' | 'CITY' | 'MSA';
  value: string;
  include?: boolean;
  name?: string;
}

interface CampaignSettings {
  regions: Region[];
  propertyTypes: string[];
  priceRange: { min: number; max: number };
  sendWindow: { start: string; end: string };
  sendDays: string[];
  touchDelays: number[];
  automationLevel: 'manual' | 'semi_auto' | 'full_auto';
  autoSendEnabled: boolean;
  autoNegotiateEnabled: boolean;
  autoContractEnabled: boolean;
  humanReviewThreshold: number;
  maxAutoCounters: number;
  responseTimeoutHours: number;
  maxTouches: number;
  aiTone: string;
  aiPersonalizationLevel: string;
  abTestingEnabled: boolean;
}

interface CampaignAutomationSettingsProps {
  campaignId: string;
  initialSettings?: Partial<CampaignSettings>;
  onSave?: (settings: Partial<CampaignSettings>) => void;
}

const DEFAULT_SETTINGS: CampaignSettings = {
  regions: [],
  propertyTypes: ['single_family', 'multi_family', 'condo'],
  priceRange: { min: 0, max: 100000000 }, // $0 to $1M
  sendWindow: { start: '09:00', end: '17:00' },
  sendDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  touchDelays: [0, 2, 5, 10],
  automationLevel: 'semi_auto',
  autoSendEnabled: false,
  autoNegotiateEnabled: false,
  autoContractEnabled: false,
  humanReviewThreshold: 10000000, // $100k
  maxAutoCounters: 3,
  responseTimeoutHours: 72,
  maxTouches: 4,
  aiTone: 'professional',
  aiPersonalizationLevel: 'high',
  abTestingEnabled: false,
};

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'multi_family', label: 'Multi Family' },
  { value: 'condo', label: 'Condo/Townhouse' },
  { value: 'land', label: 'Vacant Land' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mobile', label: 'Mobile Home' },
];

const DAYS_OF_WEEK = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

const AI_TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual & Friendly' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'empathetic', label: 'Empathetic' },
];

export function CampaignAutomationSettings({
  campaignId,
  initialSettings,
  onSave,
}: CampaignAutomationSettingsProps) {
  const [settings, setSettings] = useState<CampaignSettings>({
    ...DEFAULT_SETTINGS,
    ...initialSettings,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/campaigns/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settings',
          campaignId,
          settings,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save settings');
      }

      toast.success('Settings saved successfully');
      onSave?.(settings);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePropertyType = (type: string) => {
    const types = settings.propertyTypes.includes(type)
      ? settings.propertyTypes.filter((t) => t !== type)
      : [...settings.propertyTypes, type];
    setSettings({ ...settings, propertyTypes: types });
  };

  const toggleSendDay = (day: string) => {
    const days = settings.sendDays.includes(day)
      ? settings.sendDays.filter((d) => d !== day)
      : [...settings.sendDays, day];
    setSettings({ ...settings, sendDays: days });
  };

  // Convert regions between formats
  const handleRegionsChange = (newRegions: RegionSelectorRegion[]) => {
    // Convert RegionSelector format to settings format
    const converted: Region[] = newRegions.map((r) => ({
      type: r.type.toLowerCase() as Region['type'],
      value: r.value,
      include: r.include,
      name: r.name,
    }));
    setSettings({ ...settings, regions: converted });
  };

  // Convert settings regions to RegionSelector format
  const regionSelectorValue: RegionSelectorRegion[] = settings.regions.map((r) => ({
    type: (r.type.toUpperCase() as RegionSelectorRegion['type']),
    value: r.value,
    include: r.include !== false,
    name: r.name,
  }));

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Regional Targeting - Enhanced Component */}
      <Card>
        <CardContent className="pt-6">
          <RegionSelector
            value={regionSelectorValue}
            onChange={handleRegionsChange}
            campaignId={campaignId}
            showEstimate={true}
            showSavedTerritories={true}
          />
        </CardContent>
      </Card>

      {/* Property Type Filtering */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HomeIcon className="h-5 w-5" />
            Property Types
          </CardTitle>
          <CardDescription>
            Select which property types to include in this campaign.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PROPERTY_TYPES.map((type) => (
              <button
                key={type.value}
                onClick={() => togglePropertyType(type.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  settings.propertyTypes.includes(type.value)
                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                } border`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Price Range */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CurrencyDollarIcon className="h-5 w-5" />
            Price Range
          </CardTitle>
          <CardDescription>
            Filter leads by estimated property value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Minimum ($)</Label>
              <Input
                type="number"
                value={settings.priceRange.min / 100}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    priceRange: { ...settings.priceRange, min: Number(e.target.value) * 100 },
                  })
                }
              />
            </div>
            <div>
              <Label>Maximum ($)</Label>
              <Input
                type="number"
                value={settings.priceRange.max / 100}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    priceRange: { ...settings.priceRange, max: Number(e.target.value) * 100 },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Send Timing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockIcon className="h-5 w-5" />
            Send Timing
          </CardTitle>
          <CardDescription>
            Configure when messages should be sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Time</Label>
              <Input
                type="time"
                value={settings.sendWindow.start}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    sendWindow: { ...settings.sendWindow, start: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label>End Time</Label>
              <Input
                type="time"
                value={settings.sendWindow.end}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    sendWindow: { ...settings.sendWindow, end: e.target.value },
                  })
                }
              />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Send Days</Label>
            <div className="flex gap-1">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.value}
                  onClick={() => toggleSendDay(day.value)}
                  className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                    settings.sendDays.includes(day.value)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">
              Touch Delays (days between messages): {settings.touchDelays.join(', ')}
            </Label>
            <Input
              value={settings.touchDelays.join(', ')}
              onChange={(e) => {
                const delays = e.target.value.split(',').map((d) => parseInt(d.trim())).filter((d) => !isNaN(d));
                if (delays.length > 0) {
                  setSettings({ ...settings, touchDelays: delays });
                }
              }}
              placeholder="0, 2, 5, 10"
            />
            <p className="text-xs text-gray-500 mt-1">
              Comma-separated days. First touch is immediate (0), then 2 days later, etc.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Automation Level */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CpuChipIcon className="h-5 w-5" />
            Automation Level
          </CardTitle>
          <CardDescription>
            Control how much the system does automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Send Messages</Label>
                <p className="text-sm text-gray-500">
                  Automatically send scheduled outreach messages
                </p>
              </div>
              <Switch
                checked={settings.autoSendEnabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, autoSendEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Negotiate</Label>
                <p className="text-sm text-gray-500">
                  AI responds to questions and handles basic negotiations
                </p>
              </div>
              <Switch
                checked={settings.autoNegotiateEnabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, autoNegotiateEnabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Contract</Label>
                <p className="text-sm text-gray-500">
                  Automatically send contracts when deal is agreed
                </p>
              </div>
              <Switch
                checked={settings.autoContractEnabled}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, autoContractEnabled: checked })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellIcon className="h-5 w-5" />
            Escalation Thresholds
          </CardTitle>
          <CardDescription>
            When to escalate to human review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Human Review Threshold ($)</Label>
            <Input
              type="number"
              value={settings.humanReviewThreshold / 100}
              onChange={(e) =>
                setSettings({ ...settings, humanReviewThreshold: Number(e.target.value) * 100 })
              }
            />
            <p className="text-xs text-gray-500 mt-1">
              Deals above this value require human approval
            </p>
          </div>

          <div>
            <Label>Max Auto Counter-Offers</Label>
            <Slider
              value={[settings.maxAutoCounters]}
              onValueChange={(value) =>
                setSettings({ ...settings, maxAutoCounters: value[0] })
              }
              min={1}
              max={10}
              step={1}
            />
            <p className="text-sm text-gray-600 mt-1">
              {settings.maxAutoCounters} counter-offers before human review
            </p>
          </div>

          <div>
            <Label>Response Timeout (hours)</Label>
            <Input
              type="number"
              value={settings.responseTimeoutHours}
              onChange={(e) =>
                setSettings({ ...settings, responseTimeoutHours: Number(e.target.value) })
              }
            />
            <p className="text-xs text-gray-500 mt-1">
              Mark as unresponsive after this many hours with no reply
            </p>
          </div>

          <div>
            <Label>Max Touches</Label>
            <Slider
              value={[settings.maxTouches]}
              onValueChange={(value) =>
                setSettings({ ...settings, maxTouches: value[0] })
              }
              min={1}
              max={10}
              step={1}
            />
            <p className="text-sm text-gray-600 mt-1">
              {settings.maxTouches} total outreach attempts per lead
            </p>
          </div>
        </CardContent>
      </Card>

      {/* AI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5" />
            AI Settings
          </CardTitle>
          <CardDescription>
            Configure AI message generation behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Message Tone</Label>
            <Select
              value={settings.aiTone}
              onValueChange={(value) => setSettings({ ...settings, aiTone: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_TONES.map((tone) => (
                  <SelectItem key={tone.value} value={tone.value}>
                    {tone.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Personalization Level</Label>
            <Select
              value={settings.aiPersonalizationLevel}
              onValueChange={(value) => setSettings({ ...settings, aiPersonalizationLevel: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low - Simple variable substitution</SelectItem>
                <SelectItem value="medium">Medium - Some AI customization</SelectItem>
                <SelectItem value="high">High - Full AI personalization</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>A/B Testing</Label>
              <p className="text-sm text-gray-500">
                Test message variants to optimize performance
              </p>
            </div>
            <Switch
              checked={settings.abTestingEnabled}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, abTestingEnabled: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setSettings({ ...DEFAULT_SETTINGS, ...initialSettings })}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

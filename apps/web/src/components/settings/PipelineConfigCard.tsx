'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, RotateCcw } from 'lucide-react';

interface PipelineConfig {
  organizationId: string;
  dealAutoApproveMaxCents: number;
  contractAutoSend: boolean;
  autoContinueLowRiskHours: number;
  autoContinueNormalRiskHours: number;
  autoContinueEnabled: boolean;
  notificationMode: 'IMMEDIATE' | 'BATCH' | 'DIGEST';
  digestHour: number;
  digestTimezone: string;
  smsNotifications: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  autoLeadScoring: boolean;
  autoCampaignAssignment: boolean;
  autoResponseClassification: boolean;
  autoNegotiation: boolean;
  autoContractGeneration: boolean;
}

export function PipelineConfigCard() {
  const queryClient = useQueryClient();
  const [localConfig, setLocalConfig] = useState<Partial<PipelineConfig>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['pipeline-config'],
    queryFn: async () => {
      const res = await fetch('/api/pipeline?include_config=true');
      if (!res.ok) throw new Error('Failed to fetch config');
      const json = await res.json();
      return json.config as PipelineConfig;
    },
  });

  const saveConfig = useMutation({
    mutationFn: async (updates: Partial<PipelineConfig>) => {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_config', config: updates }),
      });
      if (!res.ok) throw new Error('Failed to save config');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-config'] });
      setLocalConfig({});
      setHasChanges(false);
    },
  });

  const updateField = <K extends keyof PipelineConfig>(field: K, value: PipelineConfig[K]) => {
    setLocalConfig((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const resetChanges = () => {
    setLocalConfig({});
    setHasChanges(false);
  };

  const effectiveConfig = { ...config, ...localConfig };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Configuration</CardTitle>
        <CardDescription>
          Configure how the automated pipeline handles leads, negotiations, and contracts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto-Approval Threshold */}
        <div className="space-y-2">
          <Label htmlFor="dealThreshold">Auto-Approve Deals Up To</Label>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">$</span>
            <Input
              id="dealThreshold"
              type="number"
              value={(effectiveConfig.dealAutoApproveMaxCents || 0) / 100}
              onChange={(e) =>
                updateField('dealAutoApproveMaxCents', Number(e.target.value) * 100)
              }
              className="w-32"
            />
          </div>
          <p className="text-xs text-gray-500">
            Deals above this amount will require manual approval
          </p>
        </div>

        {/* Notification Mode */}
        <div className="space-y-2">
          <Label htmlFor="notificationMode">Notification Mode</Label>
          <Select
            value={effectiveConfig.notificationMode}
            onValueChange={(v) => updateField('notificationMode', v as PipelineConfig['notificationMode'])}
          >
            <SelectTrigger id="notificationMode" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IMMEDIATE">Immediate</SelectItem>
              <SelectItem value="BATCH">Batch (Hourly)</SelectItem>
              <SelectItem value="DIGEST">Daily Digest</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500">
            How often to send notifications for pending actions
          </p>
        </div>

        {/* Digest Time (only if DIGEST mode) */}
        {effectiveConfig.notificationMode === 'DIGEST' && (
          <div className="space-y-2">
            <Label htmlFor="digestHour">Daily Digest Time</Label>
            <Select
              value={String(effectiveConfig.digestHour)}
              onValueChange={(v) => updateField('digestHour', Number(v))}
            >
              <SelectTrigger id="digestHour" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Auto-Continue Settings */}
        <div className="border-t pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="autoContinue">Auto-Continue</Label>
              <p className="text-xs text-gray-500">
                Automatically proceed with low-risk actions if not reviewed
              </p>
            </div>
            <Switch
              id="autoContinue"
              checked={effectiveConfig.autoContinueEnabled}
              onCheckedChange={(v) => updateField('autoContinueEnabled', v)}
            />
          </div>

          {effectiveConfig.autoContinueEnabled && (
            <div className="grid grid-cols-2 gap-4 pl-4">
              <div className="space-y-1">
                <Label htmlFor="lowRiskHours" className="text-xs">Low Risk (hours)</Label>
                <Input
                  id="lowRiskHours"
                  type="number"
                  value={effectiveConfig.autoContinueLowRiskHours}
                  onChange={(e) => updateField('autoContinueLowRiskHours', Number(e.target.value))}
                  className="w-20"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="normalRiskHours" className="text-xs">Normal Risk (hours)</Label>
                <Input
                  id="normalRiskHours"
                  type="number"
                  value={effectiveConfig.autoContinueNormalRiskHours}
                  onChange={(e) => updateField('autoContinueNormalRiskHours', Number(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>
          )}
        </div>

        {/* Notification Channels */}
        <div className="border-t pt-4 space-y-4">
          <Label>Notification Channels</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Email Notifications</span>
              <Switch
                checked={effectiveConfig.emailNotifications}
                onCheckedChange={(v) => updateField('emailNotifications', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">SMS Notifications (Urgent Only)</span>
              <Switch
                checked={effectiveConfig.smsNotifications}
                onCheckedChange={(v) => updateField('smsNotifications', v)}
              />
            </div>
          </div>
        </div>

        {/* Automation Toggles */}
        <div className="border-t pt-4 space-y-4">
          <Label>Pipeline Automation</Label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Lead Scoring</span>
                <p className="text-xs text-gray-500">Score and categorize leads automatically</p>
              </div>
              <Switch
                checked={effectiveConfig.autoLeadScoring}
                onCheckedChange={(v) => updateField('autoLeadScoring', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Campaign Assignment</span>
                <p className="text-xs text-gray-500">Assign leads to campaigns based on criteria</p>
              </div>
              <Switch
                checked={effectiveConfig.autoCampaignAssignment}
                onCheckedChange={(v) => updateField('autoCampaignAssignment', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Response Classification</span>
                <p className="text-xs text-gray-500">AI classifies and routes responses</p>
              </div>
              <Switch
                checked={effectiveConfig.autoResponseClassification}
                onCheckedChange={(v) => updateField('autoResponseClassification', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Negotiation</span>
                <p className="text-xs text-gray-500">AI handles negotiation within bounds</p>
              </div>
              <Switch
                checked={effectiveConfig.autoNegotiation}
                onCheckedChange={(v) => updateField('autoNegotiation', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Contract Generation</span>
                <p className="text-xs text-gray-500">Generate contracts when deals are accepted</p>
              </div>
              <Switch
                checked={effectiveConfig.autoContractGeneration}
                onCheckedChange={(v) => updateField('autoContractGeneration', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">Auto Contract Send</span>
                <p className="text-xs text-gray-500">Send contracts without manual approval</p>
              </div>
              <Switch
                checked={effectiveConfig.contractAutoSend}
                onCheckedChange={(v) => updateField('contractAutoSend', v)}
              />
            </div>
          </div>
        </div>

        {/* Save/Reset Buttons */}
        {hasChanges && (
          <div className="flex gap-2 pt-4 border-t">
            <Button
              onClick={() => saveConfig.mutate(localConfig)}
              disabled={saveConfig.isPending}
            >
              {saveConfig.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
            <Button variant="outline" onClick={resetChanges}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

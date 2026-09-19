# Campaign API Contract

## TypeScript Type Definitions

This document provides portable type definitions for mobile (React Native/Expo) and desktop (Electron) clients.

---

## Core Types

```typescript
// ============================================================================
// Campaign Status and States
// ============================================================================

export type CampaignStatus = 
  | 'draft' 
  | 'scheduled' 
  | 'launched' 
  | 'paused' 
  | 'completed' 
  | 'archived';

export type OutreachCampaignStatus = 'ACTIVE' | 'PAUSED';

export type ContactStatus =
  | 'QUEUED'
  | 'SENT'
  | 'ENGAGED'
  | 'NEGOTIATING'
  | 'CONTRACT_SENT'
  | 'CONTRACTED'
  | 'COLD'
  | 'OPTED_OUT'
  | 'INVALID_NUMBER'
  | 'UNRESPONSIVE';

export type ResponseClassification =
  | 'interested'
  | 'not_interested'
  | 'counter_offer'
  | 'question'
  | 'objection'
  | 'opt_out'
  | 'spam';

// ============================================================================
// Campaign Configuration Types
// ============================================================================

export type ObjectiveType = 'deals' | 'leads' | 'appointments';
export type LeadSourceType = 'import' | 'finder' | 'existing';
export type ChannelType = 'phone' | 'sms' | 'email' | 'voicemail' | 'directMail';
export type AITone = 'professional' | 'friendly' | 'urgent' | 'empathetic' | 'casual';
export type PersonalizationLevel = 'low' | 'medium' | 'high';
export type AutomationLevel = 'manual' | 'semi_auto' | 'full_auto';

export interface CampaignObjective {
  type: ObjectiveType;
  target: number;
  market: string;
  budget?: number; // cents
}

export interface LeadSourceConfig {
  type: LeadSourceType;
  criteria?: Record<string, unknown>;
  listId?: string;
  importFile?: string;
  count?: number;
}

export interface QualificationFilters {
  propertyTypes?: string[];
  minEquity?: number;
  maxAge?: number;
  distressIndicators?: string[];
  priceRange?: { min: number; max: number };
  ownershipDuration?: { min?: number; max?: number };
}

export interface QualificationConfig {
  enabled: boolean;
  scoring: boolean;
  minScore?: number;
  filters: QualificationFilters;
}

export interface ChannelConfig {
  phone: boolean;
  sms: boolean;
  email: boolean;
  voicemail?: boolean;
  directMail?: boolean;
}

export interface PhaseCondition {
  type: 'response_received' | 'status_changed' | 'score_above' | 'time_elapsed';
  value: string | number;
  action: 'skip' | 'stop' | 'branch';
}

export interface CampaignPhase {
  id: string;
  order: number;
  channel: ChannelType;
  enabled: boolean;
  delay: number; // hours
  template?: string;
  templateName?: string;
  useAI: boolean;
  retryOnFail: boolean;
  maxRetries?: number;
  conditions?: PhaseCondition[];
}

export interface SendingWindows {
  start: string; // "HH:MM"
  end: string;
  days: number[]; // 0-6, Sunday=0
  timezone?: string;
}

export interface AIMessagingConfig {
  enabled: boolean;
  tone?: AITone;
  customPrompt?: string;
  personalizationLevel?: PersonalizationLevel;
  includePropertyDetails?: boolean;
  includeMarketData?: boolean;
  useAbTesting?: boolean;
}

export interface TimingConfig {
  sendingWindows: SendingWindows;
  delays: { min: number; max: number };
  dailyCap: number;
  contactFrequency: number;
  respectDoNotDisturb?: boolean;
  pauseOnHolidays?: boolean;
}

export interface BudgetConfig {
  maxCredits: number;
  maxProviderSpend: number; // cents
  warningThreshold: number; // 0-100
  dailyLimit?: number;
  pauseOnLimit?: boolean;
}

export interface CampaignConfig {
  objective: CampaignObjective;
  leadSource: LeadSourceConfig;
  qualification: QualificationConfig;
  channels: ChannelConfig;
  sequence: CampaignPhase[];
  aiMessaging: AIMessagingConfig;
  timing: TimingConfig;
  budget: BudgetConfig;
  name?: string;
  description?: string;
  tags?: string[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface Campaign {
  id: number;
  name: string;
  status: CampaignStatus;
  message_template: string;
  config?: CampaignConfig;
  settings?: Record<string, unknown>;
  member_count?: number;
  sent_count?: number;
  lead_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CostEstimate {
  credits: number;
  providerCost: number; // cents
  breakdown: Record<string, number>;
  perLead: number;
  projectedROI?: number;
}

export interface ValidationError {
  step: number;
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  step: number;
  field: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface CreateCampaignResponse extends Campaign {
  costEstimate?: CostEstimate;
  validation?: { warnings: ValidationWarning[] };
}

export interface LaunchResponse {
  status: 'launched';
  queued: number;
  skipped: number;
}

export interface ArchiveResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// Automation Types
// ============================================================================

export interface CampaignSettings {
  regions: Array<{ type: 'zip' | 'county' | 'state'; value: string }>;
  propertyTypes: string[];
  priceRange: { min: number; max: number };
  sendWindow: { start: string; end: string };
  sendDays: string[];
  touchDelays: number[];
  automationLevel: AutomationLevel;
  autoSendEnabled: boolean;
  autoNegotiateEnabled: boolean;
  autoContractEnabled: boolean;
  humanReviewThreshold: number;
  maxAutoCounters: number;
  responseTimeoutHours: number;
  maxTouches: number;
  aiTone: AITone;
  aiPersonalizationLevel: PersonalizationLevel;
  abTestingEnabled: boolean;
}

export interface AutomationState {
  currentTouch: number;
  nextTouchScheduledAt: string | null;
  lastTouchAt: string | null;
  lastResponseAt: string | null;
  responseClassification: ResponseClassification | null;
  interestScore: number | null;
  negotiationStage: string | null;
  counterOfferCount: number;
  routedToNegotiation: boolean;
  routedToHuman: boolean;
  humanEscalationReason: string | null;
  outcome: string | null;
}

export interface CampaignMetrics {
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

export interface HumanAttentionItem {
  type: 'escalation' | 'high_value_deal' | 'complex_negotiation' | 'stuck_lead';
  contactId: string;
  campaignId: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  context: Record<string, unknown>;
  createdAt: string;
}

export interface AutomationDashboard {
  campaigns: Array<{
    id: string;
    name: string;
    direction: string;
    status: OutreachCampaignStatus;
    automation_enabled: boolean;
    last_automation_run: string | null;
    automation_paused_reason: string | null;
    total_contacts: number;
    pending_human_review: number;
    in_negotiation: number;
    contracts_signed: number;
  }>;
  attentionItems: HumanAttentionItem[];
  summary: {
    totalActiveCampaigns: number;
    totalAutomationEnabled: number;
    totalPendingHumanReview: number;
    totalInNegotiation: number;
  };
}

// ============================================================================
// Monitor Types
// ============================================================================

export interface QualityMetrics {
  bounceRate: string;
  complaintRate: string;
  unsubRate: string;
  deliveryRate: string;
  openRate: string;
  clickRate: string;
}

export interface QualityGate {
  threshold: number;
  current: number;
  status: 'ok' | 'warning' | 'critical';
}

export interface MonitorResponse {
  timestamp: string;
  campaign: {
    status: 'ACTIVE' | 'PAUSED';
    dailyTarget: number;
    dailySent: number;
    progress: string;
    feeRange: { min: number; max: number };
  };
  jobs: {
    pending?: number;
    processing?: number;
    completed?: number;
    failed?: number;
    total?: number;
    breakdown: Array<{
      status: string;
      count: number;
      send_jobs: number;
      health_jobs: number;
      email_jobs: number;
    }>;
  };
  queue: {
    queued?: number;
    sent?: number;
    completed?: number;
    total?: number;
    breakdown: Array<{
      status: string;
      count: number;
      total_value: number;
      avg_touch: number;
    }>;
  };
  emails: {
    today: {
      sent: number;
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      complained: number;
      unsubscribed: number;
      failed: number;
      total: number;
    };
    quality: QualityMetrics;
    gates: {
      bounce: QualityGate;
      complaint: QualityGate;
      unsub: QualityGate;
    };
  };
  warmup: {
    dailyLimit: number;
    paused: boolean;
    pausedReason?: string;
    updatedAt?: string;
  };
  health: {
    lastCheck: string | null;
    status: string;
    interval: string;
  };
  errors: Array<{
    id: string;
    type: string;
    message: string;
    attempts: string;
    when: string;
  }>;
  hourlyVolume: Array<{ hour: string; count: number }>;
  regional: Array<{ state: string; count: number; avg_value: number }>;
}

// ============================================================================
// Error Types
// ============================================================================

export interface APIError {
  error: string;
  message?: string;
}

export interface LimitExceededError extends APIError {
  error: 'limit_exceeded';
  upgradeReason?: string;
  current: number;
  limit: number;
  requested?: number;
  remaining?: number;
  isFreeTier: boolean;
}

export interface ValidationFailedError extends APIError {
  error: 'validation_failed';
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface MessagingAgreementError extends APIError {
  error: 'messaging_agreement_required';
}

export interface OutreachNotActiveError extends APIError {
  error: 'outreach_not_active';
  smsActive: boolean;
  emailActive: boolean;
}

// ============================================================================
// Request Types
// ============================================================================

export interface CreateCampaignRequest {
  config?: Partial<CampaignConfig>;
  name?: string;
  message_template?: string;
}

export interface UpdateCampaignRequest {
  name?: string;
  template?: Record<string, unknown>;
  status?: CampaignStatus;
}

export interface AutomationActionRequest {
  action: 'enable' | 'disable' | 'settings';
  campaignId: string;
  reason?: string;
  settings?: Partial<CampaignSettings>;
}

// ============================================================================
// Utility Constants
// ============================================================================

export const CHANNEL_COSTS: Record<ChannelType, number> = {
  phone: 10,
  sms: 1,
  email: 0.1,
  voicemail: 3,
  directMail: 50,
};

export const AI_COST_MULTIPLIER = 1.2;
export const PROVIDER_COST_PER_CREDIT = 2; // cents

export const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: '#6B7280',      // gray
  scheduled: '#3B82F6',  // blue
  launched: '#10B981',   // green
  paused: '#F59E0B',     // yellow
  completed: '#8B5CF6',  // purple
  archived: '#374151',   // dark gray
};

export const CONTACT_STATUS_COLORS: Record<ContactStatus, string> = {
  QUEUED: '#6B7280',
  SENT: '#3B82F6',
  ENGAGED: '#10B981',
  NEGOTIATING: '#F59E0B',
  CONTRACT_SENT: '#8B5CF6',
  CONTRACTED: '#059669',
  COLD: '#EF4444',
  OPTED_OUT: '#DC2626',
  INVALID_NUMBER: '#9CA3AF',
  UNRESPONSIVE: '#9CA3AF',
};
```

---

## API Endpoint Reference

| Method | Endpoint | Request | Response |
|--------|----------|---------|----------|
| GET | /api/campaigns | - | Campaign[] |
| GET | /api/campaigns/[id] | - | Campaign |
| POST | /api/campaigns | CreateCampaignRequest | CreateCampaignResponse |
| PATCH | /api/campaigns/[id] | UpdateCampaignRequest | Campaign |
| DELETE | /api/campaigns/[id] | - | ArchiveResponse |
| POST | /api/campaigns/[id]/launch | - | LaunchResponse |
| GET | /api/campaigns/automation | ?campaignId, ?view | AutomationDashboard |
| POST | /api/campaigns/automation | AutomationActionRequest | { success: boolean } |
| GET | /api/campaigns/monitor | - | MonitorResponse |

---

## Validation Error Codes

| Code | Description |
|------|-------------|
| OBJECTIVE_TYPE_REQUIRED | Objective type not specified |
| OBJECTIVE_TARGET_INVALID | Target must be positive |
| OBJECTIVE_MARKET_REQUIRED | Market/region required |
| LEAD_SOURCE_TYPE_REQUIRED | Lead source type required |
| LEAD_SOURCE_LIST_REQUIRED | List ID required for existing leads |
| QUALIFICATION_SCORE_INVALID | Min score must be 0-100 |
| QUALIFICATION_EQUITY_INVALID | Min equity must be 0-100 |
| CHANNELS_NONE_ENABLED | At least one channel required |
| SEQUENCE_EMPTY | At least one phase required |
| SEQUENCE_NONE_ENABLED | At least one phase must be enabled |
| SEQUENCE_CHANNEL_DISABLED | Phase uses disabled channel |
| SEQUENCE_TEMPLATE_REQUIRED | Non-phone phase needs template or AI |
| SEQUENCE_DELAY_INVALID | Delay cannot be negative |
| AI_PROMPT_TOO_LONG | Custom prompt exceeds 1000 chars |
| TIMING_WINDOW_REQUIRED | Sending window required |
| TIMING_START_INVALID | Start time must be HH:MM |
| TIMING_END_INVALID | End time must be HH:MM |
| TIMING_DAYS_REQUIRED | At least one send day required |
| TIMING_DAY_INVALID | Days must be 0-6 |
| TIMING_CAP_INVALID | Daily cap must be positive |
| TIMING_FREQUENCY_INVALID | Frequency cannot be negative |
| BUDGET_CREDITS_INVALID | Max credits cannot be negative |
| BUDGET_SPEND_INVALID | Max spend cannot be negative |
| BUDGET_THRESHOLD_INVALID | Threshold must be 0-100 |

---

## HTTP Status Codes

| Code | Meaning | Common Scenarios |
|------|---------|------------------|
| 200 | Success | Normal responses |
| 400 | Bad Request | Validation errors, invalid data |
| 401 | Unauthorized | No session, expired token |
| 402 | Payment Required | Tier limit exceeded |
| 403 | Forbidden | No org, agreement required, outreach not active |
| 404 | Not Found | Campaign doesn't exist or wrong org |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Server Error | Server error |

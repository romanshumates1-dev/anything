# Campaign System Cross-Platform Guide

## Overview

DealFlow AI's campaign system enables automated multi-touch outreach for real estate wholesaling. This guide documents the API contracts and requirements for mobile and desktop clients.

---

## API Endpoints

### Campaign List
```
GET /api/campaigns
Authorization: Bearer <token>
```

**Response:**
```json
{
  "campaigns": [
    {
      "id": 123,
      "name": "Phoenix Sellers Q3",
      "status": "launched",
      "message_template": "Hi {{name}}, interested in selling...",
      "config": { /* CampaignConfig object */ },
      "settings": { /* Engine settings */ },
      "member_count": 500,
      "sent_count": 150,
      "created_at": "2026-09-01T00:00:00Z",
      "updated_at": "2026-09-15T12:00:00Z"
    }
  ]
}
```

### Campaign Detail
```
GET /api/campaigns/[id]
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 123,
  "name": "Phoenix Sellers Q3",
  "status": "launched",
  "message_template": "...",
  "config": { /* Full CampaignConfig */ },
  "settings": { /* Full engine settings */ },
  "lead_count": 500,
  "created_at": "2026-09-01T00:00:00Z",
  "updated_at": "2026-09-15T12:00:00Z"
}
```

### Create Campaign
```
POST /api/campaigns
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body (Builder Config):**
```json
{
  "config": {
    "name": "Phoenix Sellers Q3",
    "objective": { "type": "deals", "target": 10, "market": "Phoenix, AZ" },
    "leadSource": { "type": "finder", "count": 500 },
    "qualification": { "enabled": true, "scoring": true, "minScore": 60 },
    "channels": { "phone": false, "sms": true, "email": true },
    "sequence": [
      { "id": "1", "order": 0, "channel": "sms", "enabled": true, "delay": 0, "useAI": true }
    ],
    "aiMessaging": { "enabled": true, "tone": "professional", "personalizationLevel": "medium" },
    "timing": {
      "sendingWindows": { "start": "09:00", "end": "17:00", "days": [1,2,3,4,5] },
      "delays": { "min": 4, "max": 24 },
      "dailyCap": 100
    },
    "budget": { "maxCredits": 5000, "warningThreshold": 80 }
  }
}
```

**Legacy Request Body:**
```json
{
  "name": "Campaign Name",
  "message_template": "Hi {{name}}, I noticed you own {{address}}..."
}
```

**Response:**
```json
{
  "id": 123,
  "name": "Phoenix Sellers Q3",
  "status": "draft",
  "costEstimate": {
    "credits": 1500,
    "providerCost": 3000,
    "breakdown": { "sms": 500, "email": 50 },
    "perLead": 3
  },
  "validation": { "warnings": [] }
}
```

**Error Response (402 - Limit Exceeded):**
```json
{
  "error": "limit_exceeded",
  "message": "Campaign limit reached for your tier",
  "current": 5,
  "limit": 5,
  "isFreeTier": true,
  "upgradeReason": "Upgrade to Pro for unlimited campaigns"
}
```

### Update Campaign
```
PATCH /api/campaigns/[id]
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "template": { /* updated template */ },
  "status": "paused"
}
```

**Valid Status Values:** `draft`, `scheduled`, `launched`, `paused`, `completed`

### Delete Campaign (Archive)
```
DELETE /api/campaigns/[id]
Authorization: Bearer <token>
```

**Notes:**
- Cannot delete active (launched/scheduled) campaigns
- Soft deletes (archives) the campaign
- Cancels any pending jobs

**Response:**
```json
{
  "success": true,
  "message": "Campaign archived successfully"
}
```

### Launch Campaign
```
POST /api/campaigns/[id]/launch
Authorization: Bearer <token>
```

**Prerequisites:**
- User must have accepted Messaging Compliance Agreement
- At least one outreach channel (SMS or Email) must be verified and active

**Response:**
```json
{
  "status": "launched",
  "queued": 485,
  "skipped": 15
}
```

**Error Responses:**

*Messaging Agreement Required (403):*
```json
{
  "error": "messaging_agreement_required",
  "message": "You must accept the Messaging Compliance Agreement before activating a campaign."
}
```

*Outreach Not Active (403):*
```json
{
  "error": "outreach_not_active",
  "message": "At least one outreach channel must be verified and active",
  "smsActive": false,
  "emailActive": false
}
```

*Limit Exceeded (402):*
```json
{
  "error": "limit_exceeded",
  "message": "SMS limit exceeded for your tier",
  "current": 450,
  "limit": 500,
  "requested": 100,
  "remaining": 50
}
```

### Campaign Automation
```
GET /api/campaigns/automation?campaignId=[id]&view=dashboard
Authorization: Bearer <token>
```

**Query Params:**
- `campaignId` - Specific campaign (optional)
- `view` - One of: `dashboard`, `attention`, `metrics`, `status`

**Response (Dashboard):**
```json
{
  "campaigns": [...],
  "attentionItems": [...],
  "summary": {
    "totalActiveCampaigns": 3,
    "totalAutomationEnabled": 2,
    "totalPendingHumanReview": 5,
    "totalInNegotiation": 12
  }
}
```

### Enable/Disable Automation
```
POST /api/campaigns/automation
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "action": "enable",  // or "disable" or "settings"
  "campaignId": "123",
  "reason": "Pausing for review",  // optional, for disable
  "settings": { /* CampaignSettings for "settings" action */ }
}
```

### Campaign Monitor (Real-time)
```
GET /api/campaigns/monitor
Authorization: Bearer <token>
```

**Response:**
```json
{
  "timestamp": "2026-09-15T12:00:00Z",
  "campaign": {
    "status": "ACTIVE",
    "dailyTarget": 150000,
    "dailySent": 45000,
    "progress": "30.0"
  },
  "jobs": { "pending": 100, "processing": 5, "completed": 500, "failed": 2 },
  "queue": { "queued": 5000, "sent": 3000, "completed": 2000 },
  "emails": {
    "today": { "sent": 500, "delivered": 480, "opened": 120, "clicked": 30 },
    "quality": { "bounceRate": "2.00", "complaintRate": "0.050", "deliveryRate": "96.0" },
    "gates": {
      "bounce": { "threshold": 5, "current": 2.0, "status": "ok" },
      "complaint": { "threshold": 0.1, "current": 0.05, "status": "ok" }
    }
  },
  "warmup": { "dailyLimit": 500, "paused": false },
  "errors": [...],
  "hourlyVolume": [...]
}
```

---

## Campaign States

### State Machine

```
                +----------+
                |          |
                v          |
+-------+     +----------+ |     +-----------+
| draft | --> | scheduled| ---> | launched  |
+-------+     +----------+       +-----------+
    |              |                  |
    |              |                  v
    |              |            +---------+
    |              +----------> | paused  |
    |                           +---------+
    |                                |
    v                                v
+-----------+                  +-----------+
| archived  |                  | completed |
+-----------+                  +-----------+
```

### Campaign Status Values

| Status | Description | Allowed Transitions |
|--------|-------------|---------------------|
| `draft` | Campaign created, not yet configured | scheduled, archived |
| `scheduled` | Campaign configured, awaiting launch | launched, paused, archived |
| `launched` | Campaign actively sending messages | paused, completed |
| `paused` | Campaign temporarily stopped | launched, completed |
| `completed` | Campaign finished all sends | archived |
| `archived` | Campaign soft-deleted | (terminal) |

### Outreach Campaign Status (Automation System)

| Status | Description |
|--------|-------------|
| `ACTIVE` | Automation running, processing leads |
| `PAUSED` | Automation temporarily stopped |

---

## Contact States

### Contact Status Values (campaign_contacts)

| Status | Description |
|--------|-------------|
| `QUEUED` | Lead assigned, awaiting first touch |
| `SENT` | Initial message sent, awaiting response |
| `ENGAGED` | Lead has responded |
| `NEGOTIATING` | Active price/terms negotiation |
| `CONTRACT_SENT` | Contract sent to lead |
| `CONTRACTED` | Contract signed |
| `COLD` | Lead marked not interested |
| `OPTED_OUT` | Lead requested opt-out |
| `INVALID_NUMBER` | Phone number invalid |
| `UNRESPONSIVE` | No response after max touches |

### Response Classifications

| Classification | Description | Action |
|----------------|-------------|--------|
| `interested` | Lead wants to proceed | Route to negotiation |
| `not_interested` | Lead declines | Mark cold, stop outreach |
| `counter_offer` | Lead proposes different terms | Handle counter or escalate |
| `question` | Lead asks for more info | AI response or escalate |
| `objection` | Lead raises concern | AI response or escalate |
| `opt_out` | Lead requests removal | Handle opt-out compliance |
| `spam` | Message is spam | Ignore |

---

## Campaign Builder Configuration

### 10-Step Builder Flow

1. **Objective** - Campaign goal (deals/leads/appointments)
2. **Lead Source** - Import, finder, or existing leads
3. **Qualification** - Scoring and filtering criteria
4. **Channels** - Phone, SMS, email selection
5. **Sequence** - Multi-touch outreach phases
6. **AI Messaging** - Tone and personalization
7. **Timing** - Send windows and frequency
8. **Budget** - Credit and spending limits
9. **Review** - Summary and validation (UI only)
10. **Launch** - Activation (UI only)

### CampaignConfig Type

```typescript
interface CampaignConfig {
  // Step 1: Objective
  objective: {
    type: 'deals' | 'leads' | 'appointments';
    target: number;
    market: string;
    budget?: number; // cents
  };

  // Step 2: Lead Source
  leadSource: {
    type: 'import' | 'finder' | 'existing';
    criteria?: Record<string, unknown>;
    listId?: string;
    importFile?: string;
    count?: number;
  };

  // Step 3: Qualification
  qualification: {
    enabled: boolean;
    scoring: boolean;
    minScore?: number; // 0-100
    filters: {
      propertyTypes?: string[];
      minEquity?: number; // percentage
      maxAge?: number; // days
      distressIndicators?: string[];
      priceRange?: { min: number; max: number }; // cents
      ownershipDuration?: { min?: number; max?: number }; // years
    };
  };

  // Step 4: Channels
  channels: {
    phone: boolean;
    sms: boolean;
    email: boolean;
    voicemail?: boolean;
    directMail?: boolean;
  };

  // Step 5: Sequence
  sequence: CampaignPhase[];

  // Step 6: AI Messaging
  aiMessaging: {
    enabled: boolean;
    tone?: 'professional' | 'friendly' | 'urgent' | 'empathetic' | 'casual';
    customPrompt?: string; // max 1000 chars
    personalizationLevel?: 'low' | 'medium' | 'high';
    includePropertyDetails?: boolean;
    includeMarketData?: boolean;
    useAbTesting?: boolean;
  };

  // Step 7: Timing
  timing: {
    sendingWindows: {
      start: string; // "HH:MM"
      end: string;
      days: number[]; // 0=Sunday through 6=Saturday
      timezone?: string; // IANA timezone
    };
    delays: {
      min: number; // hours
      max: number;
    };
    dailyCap: number;
    contactFrequency: number; // days between same lead
    respectDoNotDisturb?: boolean;
    pauseOnHolidays?: boolean;
  };

  // Step 8: Budget
  budget: {
    maxCredits: number;
    maxProviderSpend: number; // cents
    warningThreshold: number; // 0-100 percentage
    dailyLimit?: number;
    pauseOnLimit?: boolean;
  };

  // Metadata
  name?: string;
  description?: string;
  tags?: string[];
}

interface CampaignPhase {
  id: string;
  order: number;
  channel: 'phone' | 'sms' | 'email' | 'voicemail' | 'directMail';
  enabled: boolean;
  delay: number; // hours after previous phase
  template?: string;
  templateName?: string;
  useAI: boolean;
  retryOnFail: boolean;
  maxRetries?: number;
  conditions?: PhaseCondition[];
}

interface PhaseCondition {
  type: 'response_received' | 'status_changed' | 'score_above' | 'time_elapsed';
  value: string | number;
  action: 'skip' | 'stop' | 'branch';
}
```

### Cost Estimation

| Channel | Credits per Send |
|---------|-----------------|
| SMS | 1 |
| Email | 0.1 |
| Voicemail | 3 |
| Phone Call | 10 |
| Direct Mail | 50 |

**AI Personalization:** +20% cost multiplier
**Provider Cost:** $0.02 per credit

---

## Mobile UI Requirements

### Campaigns List Screen
- Campaign cards showing:
  - Campaign name and status badge
  - Progress bar (sent/total)
  - Quick stats: sent count, response rate
  - Last activity timestamp
- Status color coding:
  - Draft: Gray
  - Scheduled: Blue
  - Launched/Active: Green
  - Paused: Yellow
  - Completed: Purple
  - Archived: Dark gray
- Pull-to-refresh
- Quick actions: Launch, Pause, View Details

### Campaign Detail View
- Header with name, status, and action buttons
- Stats cards:
  - Total leads
  - Messages sent
  - Response rate
  - Interested count
- Progress visualization
- Sequence timeline showing phases
- Recent activity feed
- Quick pause/resume toggle

### Campaign Builder (Mobile)
- Step-by-step wizard flow
- One step per screen with progress indicator
- Validation feedback inline
- Summary screen before launch
- Cost estimate display
- Credits balance display

### Required UI States
- Loading states for all API calls
- Error handling with retry options
- Empty states for no campaigns
- Offline mode indicator (read-only)

---

## Desktop UI Requirements

### Multi-Column Dashboard
- Left sidebar: Campaign list with filters
- Center: Selected campaign details
- Right: Real-time metrics and alerts
- Bulk operations toolbar

### Detailed Analytics
- Response rate charts over time
- Channel performance comparison
- Geographic breakdown (regional map)
- Cost per acquisition trends
- A/B test results

### Bulk Operations
- Multi-select campaigns
- Bulk pause/resume
- Bulk archive
- Export campaign data (CSV)

### Campaign Builder (Desktop)
- All 8 steps visible in tabs
- Side-by-side preview
- Template editor with syntax highlighting
- Live cost estimation
- Lead preview with filters

### Advanced Features
- Keyboard shortcuts
- Custom column views
- Saved filters
- Campaign duplication
- Template library access

---

## Credits Display

### Credit Balance Widget
```json
{
  "balance": 5000,
  "used": 1500,
  "limit": 10000,
  "tier": "pro",
  "renewsAt": "2026-10-01T00:00:00Z"
}
```

### Display Requirements
- Show current balance prominently
- Usage progress bar
- Warning when <20% remaining
- Link to upgrade/purchase

---

## Error Handling

### Common Error Codes

| Code | Meaning | UI Action |
|------|---------|-----------|
| 401 | Unauthorized | Redirect to login |
| 402 | Payment Required | Show upgrade modal |
| 403 | Forbidden | Show permission error |
| 404 | Not Found | Show not found state |
| 429 | Rate Limited | Show retry with backoff |
| 500 | Server Error | Show error with retry |

### Validation Errors
- Display inline at field level
- Show all errors before submission
- Auto-scroll to first error
- Clear errors on field change

---

## WebSocket Events (Future)

```typescript
// Campaign status change
{ type: 'campaign.status', campaignId: '123', status: 'launched' }

// New response received
{ type: 'campaign.response', campaignId: '123', contactId: '456', classification: 'interested' }

// Attention item created
{ type: 'attention.new', item: { ... } }

// Credit balance change
{ type: 'credits.balance', balance: 4500, delta: -500 }
```

---

## Best Practices

### Mobile
1. Cache campaign list for offline viewing
2. Batch API calls when possible
3. Use optimistic updates for quick actions
4. Show skeleton loaders during fetch
5. Support dark mode for all screens

### Desktop
1. Use virtualized lists for large campaign counts
2. Implement keyboard navigation
3. Support browser back/forward
4. Auto-save draft state
5. Enable column resizing/hiding

### Both Platforms
1. Consistent status colors across platforms
2. Same validation rules client-side
3. Unified error message format
4. Shared type definitions (see packages/shared)
5. Feature parity for core actions

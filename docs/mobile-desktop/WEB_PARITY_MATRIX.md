# DealFlowAI Web Parity Matrix

> Last Updated: 2026-09-16
>
> This document catalogs all web capabilities and their implementation status across Desktop (Electron) and Mobile (React Native/Expo) platforms.

## Platform Overview

| Platform | Technology | Status | Notes |
|----------|------------|--------|-------|
| **Web** | Next.js 14 (App Router) | Production | 85 pages, 60+ API endpoints |
| **Desktop** | Electron (shell wrapper) | Production | Wraps web app, adds native features |
| **Mobile** | React Native/Expo | MVP | Single dashboard screen only |

---

## Legend

| Symbol | Meaning |
|--------|---------|
| PASS | Fully implemented |
| PARTIAL | Partially implemented |
| MISSING | Not implemented |
| N/A | Not applicable for platform |
| ? | Status unknown/needs verification |

---

## Core Features

### Authentication (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Email/Password Sign In | PASS | PASS | PASS | PASS | P0 | Mobile uses WebView auth |
| Sign Up | PASS | PASS | PASS | PASS | P0 | Mobile uses WebView auth |
| Forgot Password | PASS | PASS | PASS | PASS | P0 | Via WebView |
| Reset Password | PASS | PASS | PASS | PASS | P0 | Via WebView |
| Sign Out | PASS | PASS | PASS | PASS | P0 | |
| Social Auth (OAuth) | PASS | PASS | PASS | PASS | P0 | Dev shim available |
| Session Persistence | PASS | PASS | PASS | PASS | P0 | Mobile: SecureStore |
| RBAC (Admin/Member) | PASS | PASS | MISSING | MISSING | P1 | Mobile lacks role UI |

### Dashboard (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Main Dashboard | PASS | PASS | PARTIAL | PARTIAL | P0 | Mobile: basic stats only |
| Dashboard Stats (API) | PASS | PASS | PASS | PASS | P0 | Mobile fetches /api/dashboard/stats |
| Pipeline Overview | PASS | PASS | MISSING | MISSING | P0 | /dashboard/pipeline |
| Actions Panel | PASS | PASS | MISSING | MISSING | P1 | /dashboard/actions |
| Readiness Check | PASS | PASS | MISSING | MISSING | P2 | /dashboard/readiness |
| System Health Widget | PASS | PASS | PARTIAL | PARTIAL | P1 | Mobile: hardcoded status |

### Campaigns (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Campaigns List | PASS | PASS | MISSING | MISSING | P0 | /campaigns |
| Campaign Builder/Wizard | PASS | PASS | MISSING | MISSING | P0 | /campaigns/wizard |
| Campaign Launcher | PASS | PASS | MISSING | MISSING | P0 | /campaigns/launcher |
| Campaign Monitor | PASS | PASS | MISSING | MISSING | P0 | /campaigns/monitor |
| Campaign Planner | PASS | PASS | MISSING | MISSING | P1 | /campaigns/planner |
| Campaign Automation | PASS | PASS | MISSING | MISSING | P1 | /(dashboard)/campaigns/[id]/automation |
| Campaign API | PASS | PASS | MISSING | MISSING | P0 | Full CRUD + launch/profit/pipeline |

### Leads Management (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Leads List | PASS | PASS | MISSING | MISSING | P0 | /leads |
| Lead Import | PASS | PASS | MISSING | MISSING | P0 | /leads/import |
| Lead Finder | PASS | PASS | MISSING | MISSING | P0 | /lead-finder |
| Lead Detail View | PASS | PASS | MISSING | MISSING | P0 | |
| Manage Leads Button | N/A | N/A | PARTIAL | PARTIAL | P0 | Mobile: UI only, no action |
| Leads API | PASS | PASS | MISSING | MISSING | P0 | |

### CRM (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| CRM Dashboard | PASS | PASS | MISSING | MISSING | P0 | /crm |
| Contact Management | PASS | PASS | MISSING | MISSING | P0 | API: /api/crm |
| Contact Lists | PASS | PASS | MISSING | MISSING | P1 | API: /api/contact-lists |

### Inbox & Conversations (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Inbox | PASS | PASS | MISSING | MISSING | P0 | /inbox |
| Lead Conversation | PASS | PASS | MISSING | MISSING | P0 | /inbox/[leadId] |
| Conversations API | PASS | PASS | MISSING | MISSING | P0 | API: /api/conversations |

### Contracts (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Contracts List | PASS | PASS | MISSING | MISSING | P0 | /contracts |
| Contract Generation | PASS | PASS | MISSING | MISSING | P1 | API: /api/contracts |
| E-Sign Integration | PASS | PASS | MISSING | MISSING | P1 | API: /api/esign |

### Buyers (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Buyers List | PASS | PASS | MISSING | MISSING | P1 | /buyers |
| Buyers API | PASS | PASS | MISSING | MISSING | P1 | API: /api/buyers |

### Approvals (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Approvals Dashboard | PASS | PASS | MISSING | MISSING | P1 | /approvals |
| Approvals API | PASS | PASS | MISSING | MISSING | P1 | API: /api/approvals |

### Analytics (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Analytics Dashboard | PASS | PASS | MISSING | MISSING | P1 | /analytics |
| Advanced Analytics | PASS | PASS | MISSING | MISSING | P1 | /analytics/advanced |
| AI Recommendations | PASS | PASS | MISSING | MISSING | P2 | API: /api/analytics/ai-recommendations |

### Billing & Credits (P0 - Critical)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Billing Settings | PASS | PASS | MISSING | MISSING | P0 | /settings/billing |
| Credits System | PASS | PASS | MISSING | MISSING | P0 | API: /api/credits |
| In-App Purchase | N/A | N/A | PASS | PASS | P0 | Mobile: RevenueCat |
| Payments API | PASS | PASS | MISSING | MISSING | P0 | API: /api/payments |
| Subscriptions | PASS | PASS | MISSING | MISSING | P0 | API: /api/subscriptions |
| Payouts | PASS | PASS | MISSING | MISSING | P1 | /payouts |
| Withdrawals | PASS | PASS | MISSING | MISSING | P1 | API: /api/withdrawals |

### Settings (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| General Settings | PASS | PASS | MISSING | MISSING | P1 | /settings |
| User Management | PASS | PASS | MISSING | MISSING | P1 | /settings/users |
| Outreach Settings | PASS | PASS | MISSING | MISSING | P1 | /settings/outreach |
| SMS Settings | PASS | PASS | MISSING | MISSING | P1 | /settings/outreach/sms |
| Email Settings | PASS | PASS | MISSING | MISSING | P1 | /settings/outreach/email |
| SMS Verify | PASS | PASS | MISSING | MISSING | P1 | /settings/outreach/sms/verify |
| Email Verify | PASS | PASS | MISSING | MISSING | P1 | /settings/outreach/email/verify |

### Profile (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| User Profile | PASS | PASS | MISSING | MISSING | P2 | /profile |
| Profile API | PASS | PASS | MISSING | MISSING | P2 | API: /api/user |

### Gamification (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Achievements | PASS | PASS | MISSING | MISSING | P2 | /achievements |
| Leaderboard | PASS | PASS | MISSING | MISSING | P2 | /leaderboard |

### Monitor (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Monitor Dashboard | PASS | PASS | MISSING | MISSING | P1 | /monitor |
| Pipeline Monitor | PASS | PASS | MISSING | MISSING | P1 | /monitor/pipeline |
| Profit Monitor | PASS | PASS | MISSING | MISSING | P1 | /monitor/profit |
| Calculator | PASS | PASS | MISSING | MISSING | P2 | /monitor/calculator |
| Monitor Analytics | PASS | PASS | MISSING | MISSING | P2 | /monitor/analytics |

### Admin (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Admin Dashboard | PASS | PASS | MISSING | MISSING | P1 | /admin |
| User Admin | PASS | PASS | MISSING | MISSING | P1 | /admin/users |
| Billing Admin | PASS | PASS | MISSING | MISSING | P1 | /admin/billing |
| Reviews Admin | PASS | PASS | MISSING | MISSING | P2 | /admin/reviews |
| Compliance Admin | PASS | PASS | MISSING | MISSING | P1 | /admin/compliance |
| Audit Admin | PASS | PASS | MISSING | MISSING | P1 | /admin/audit |
| Feedback Admin | PASS | PASS | MISSING | MISSING | P2 | /admin/feedback |
| Audience Admin | PASS | PASS | MISSING | MISSING | P2 | /admin/audience |

### Reports & Templates (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Reports | PASS | PASS | MISSING | MISSING | P2 | /reports |
| Templates | PASS | PASS | MISSING | MISSING | P2 | /templates |

### Funnel & Optimization (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Funnel View | PASS | PASS | MISSING | MISSING | P2 | /funnel |
| Optimization Dashboard | PASS | PASS | MISSING | MISSING | P2 | /optimization/dashboard |

### Feedback & Support (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Feedback | PASS | PASS | MISSING | MISSING | P2 | /feedback |
| Support API | PASS | PASS | MISSING | MISSING | P2 | API: /api/support |

### Onboarding (P1 - High)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| Welcome Flow | PASS | PASS | MISSING | MISSING | P1 | /welcome |

### System (P2 - Medium)

| Web Capability | Web Status | Desktop | Android | iOS | Priority | Notes |
|---------------|------------|---------|---------|-----|----------|-------|
| System Health | PASS | PASS | MISSING | MISSING | P2 | /system-health |

---

## Marketing Pages (Web Only)

| Page | Web Status | Desktop | Android | iOS | Notes |
|------|------------|---------|---------|-----|-------|
| Landing Page | PASS | PASS | N/A | N/A | /(marketing) |
| About | PASS | PASS | N/A | N/A | |
| Features | PASS | PASS | N/A | N/A | |
| Pricing | PASS | PASS | N/A | N/A | |
| How It Works | PASS | PASS | N/A | N/A | |
| FAQ | PASS | PASS | N/A | N/A | |
| Contact | PASS | PASS | N/A | N/A | |
| Reviews | PASS | PASS | N/A | N/A | |
| Trust | PASS | PASS | N/A | N/A | |
| Compliance | PASS | PASS | N/A | N/A | |
| Cash Offer | PASS | PASS | N/A | N/A | |

---

## Legal Pages (Web Only)

| Page | Web Status | Desktop | Android | iOS | Notes |
|------|------------|---------|---------|-----|-------|
| Terms | PASS | PASS | N/A | N/A | |
| Privacy | PASS | PASS | N/A | N/A | |
| Acceptable Use | PASS | PASS | N/A | N/A | |
| SMS Terms | PASS | PASS | N/A | N/A | |
| Refunds | PASS | PASS | N/A | N/A | |
| Cookies | PASS | PASS | N/A | N/A | |
| Disclaimers | PASS | PASS | N/A | N/A | |
| E-Sign | PASS | PASS | N/A | N/A | |
| DMCA | PASS | PASS | N/A | N/A | |
| Accept | PASS | PASS | N/A | N/A | |

---

## API Capabilities

| API Endpoint Category | Count | Desktop | Android | iOS | Notes |
|----------------------|-------|---------|---------|-----|-------|
| Achievements | 1 | PASS | MISSING | MISSING | |
| Actions | 1 | PASS | MISSING | MISSING | |
| Admin | 1 | PASS | MISSING | MISSING | |
| Agents | 1 | PASS | MISSING | MISSING | |
| AI Providers | 1 | PASS | MISSING | MISSING | |
| Alerts | 1 | PASS | MISSING | MISSING | |
| Analytics | 2 | PASS | MISSING | MISSING | |
| Approvals | 1 | PASS | MISSING | MISSING | |
| Audit | 1 | PASS | MISSING | MISSING | |
| Auth | 1 | PASS | PASS | PASS | |
| Bank Accounts | 1 | PASS | MISSING | MISSING | |
| Billing | 1 | PASS | MISSING | MISSING | |
| Buyers | 1 | PASS | MISSING | MISSING | |
| Campaigns | 1 | PASS | MISSING | MISSING | |
| Compliance | 2 | PASS | MISSING | MISSING | |
| Comps | 1 | PASS | MISSING | MISSING | |
| Consent | 1 | PASS | MISSING | MISSING | |
| Contact | 1 | PASS | MISSING | MISSING | |
| Contact Lists | 1 | PASS | MISSING | MISSING | |
| Contracts | 1 | PASS | MISSING | MISSING | |
| Conversations | 1 | PASS | MISSING | MISSING | |
| Conversion | 1 | PASS | MISSING | MISSING | |
| Credits | 1 | PASS | MISSING | MISSING | |
| CRM | 1 | PASS | MISSING | MISSING | |
| Cron | 1 | PASS | MISSING | MISSING | |
| Dashboard | 1 | PASS | PARTIAL | PARTIAL | Mobile: stats only |
| Deals | 1 | PASS | MISSING | MISSING | |
| Debrief | 1 | PASS | MISSING | MISSING | |
| Duplicates | 1 | PASS | MISSING | MISSING | |
| Earnings | 1 | PASS | MISSING | MISSING | |
| Email | 1 | PASS | MISSING | MISSING | |
| E-Sign | 1 | PASS | MISSING | MISSING | |
| Eval | 1 | PASS | MISSING | MISSING | |
| Feedback | 1 | PASS | MISSING | MISSING | |
| Free Tier | 1 | PASS | MISSING | MISSING | |
| Funnel | 1 | PASS | MISSING | MISSING | |
| Gateway | 1 | PASS | MISSING | MISSING | |
| Imports | 1 | PASS | MISSING | MISSING | |
| Inbound | 1 | PASS | MISSING | MISSING | |
| Integrations | 1 | PASS | MISSING | MISSING | |
| Jobs | 1 | PASS | MISSING | MISSING | |
| JV | 1 | PASS | MISSING | MISSING | |
| Leaderboard | 1 | PASS | MISSING | MISSING | |
| Lead Finder | 1 | PASS | MISSING | MISSING | |
| Leads | 1 | PASS | MISSING | MISSING | |
| Legal | 1 | PASS | MISSING | MISSING | |
| Marketing | 1 | PASS | MISSING | MISSING | |
| Negotiation | 1 | PASS | MISSING | MISSING | |
| OpenAPI | 1 | PASS | MISSING | MISSING | |
| Optimization | 1 | PASS | MISSING | MISSING | |
| Organizations | 1 | PASS | MISSING | MISSING | |
| Outreach | 1 | PASS | MISSING | MISSING | |
| Payments | 1 | PASS | MISSING | MISSING | |
| Pipeline | 1 | PASS | MISSING | MISSING | |
| Portal | 1 | PASS | MISSING | MISSING | |
| Prospects | 1 | PASS | MISSING | MISSING | |
| Ratelimit | 1 | PASS | MISSING | MISSING | |
| Referral | 2 | PASS | MISSING | MISSING | |
| Regions | 1 | PASS | MISSING | MISSING | |
| Reviews | 1 | PASS | MISSING | MISSING | |
| Services | 1 | PASS | MISSING | MISSING | |
| Session | 1 | PASS | PASS | PASS | |
| Settings | 1 | PASS | MISSING | MISSING | |
| Simulator | 1 | PASS | MISSING | MISSING | |
| SMS | 1 | PASS | MISSING | MISSING | |
| Subscriptions | 1 | PASS | MISSING | MISSING | |
| Support | 1 | PASS | MISSING | MISSING | |
| System | 1 | PASS | MISSING | MISSING | |
| Templates | 1 | PASS | MISSING | MISSING | |
| Territories | 1 | PASS | MISSING | MISSING | |
| Test Phones | 1 | PASS | MISSING | MISSING | |
| Twilio Accounts | 1 | PASS | MISSING | MISSING | |
| Usage | 1 | PASS | MISSING | MISSING | |
| User | 1 | PASS | MISSING | MISSING | |
| V1 (API Docs) | 1 | PASS | MISSING | MISSING | |
| Withdrawals | 1 | PASS | MISSING | MISSING | |

---

## Desktop-Specific Features

| Feature | Status | Notes |
|---------|--------|-------|
| System Tray | PASS | Minimize to tray, quick actions |
| Native Menu | PASS | Application menu with shortcuts |
| Deep Links (dealflow://) | PASS | Protocol handler |
| Keyboard Shortcuts | PASS | Cmd/Ctrl+1-7 for navigation |
| Auto-Update | PASS | electron-updater |
| Offline Handling | PASS | Offline fallback page |
| Window State Persistence | PASS | Remembers size/position |
| Theme Support | PASS | Light/dark/system |
| Zoom Control | PASS | In-app zoom adjustment |

---

## Mobile-Specific Features

| Feature | Android | iOS | Notes |
|---------|---------|-----|-------|
| In-App Purchase | PASS | PASS | RevenueCat integration |
| Push Notifications | MISSING | MISSING | Polyfill present but not implemented |
| Camera Access | MISSING | MISSING | Polyfill present but not implemented |
| Maps Integration | MISSING | MISSING | Polyfill present but not implemented |
| Secure Token Storage | PASS | PASS | SecureStore |
| Native Navigation | PASS | PASS | expo-router |
| Error Boundary | PASS | PASS | Crash recovery |
| WebView Auth | PASS | PASS | OAuth flow |

---

## Gap Analysis Summary

### Critical Gaps (P0)

| Gap | Platforms Affected | Effort Estimate |
|-----|--------------------|-----------------|
| Campaigns Module | Android, iOS | Large |
| Leads Management | Android, iOS | Large |
| CRM | Android, iOS | Large |
| Inbox/Conversations | Android, iOS | Large |
| Billing UI (native) | Android, iOS | Medium |

### High Priority Gaps (P1)

| Gap | Platforms Affected | Effort Estimate |
|-----|--------------------|-----------------|
| Contracts | Android, iOS | Medium |
| Settings | Android, iOS | Medium |
| Analytics | Android, iOS | Medium |
| Monitor | Android, iOS | Medium |
| Admin Panel | Android, iOS | Large |
| Onboarding/Welcome | Android, iOS | Small |

### Medium Priority Gaps (P2)

| Gap | Platforms Affected | Effort Estimate |
|-----|--------------------|-----------------|
| Profile | Android, iOS | Small |
| Achievements/Leaderboard | Android, iOS | Small |
| Reports/Templates | Android, iOS | Medium |
| Funnel/Optimization | Android, iOS | Medium |
| Feedback | Android, iOS | Small |

---

## Statistics

| Metric | Web | Desktop | Android | iOS |
|--------|-----|---------|---------|-----|
| Total Pages | 85 | 85 | 1 | 1 |
| API Endpoints Available | 60+ | 60+ | 2 | 2 |
| Feature Parity | 100% | 100% | ~5% | ~5% |
| Platform-Specific Features | - | 9 | 4 | 4 |

### Page Count by Category

| Category | Count |
|----------|-------|
| Marketing | 15 |
| Legal | 10 |
| Dashboard | 4 |
| Campaigns | 5 |
| Admin | 8 |
| Settings | 6 |
| Authentication | 4 |
| Core Features | 33+ |

---

## Recommendations

### Short-term (MVP Mobile)

1. Add navigation to key screens (Campaigns, Leads, Inbox)
2. Implement Campaigns list view
3. Implement Leads list view
4. Add basic Settings page

### Medium-term

1. Full Campaign management (create, edit, launch)
2. Lead detail views and actions
3. Inbox with conversation view
4. Billing management native UI

### Long-term

1. Full feature parity with web
2. Offline-first capabilities
3. Push notifications
4. Camera/document scanning for contracts

# DealFlowAI Cross-Platform Architecture

## Executive Summary

DealFlowAI operates as a cross-platform real estate wholesaling automation platform with three client applications (web, desktop, mobile) sharing a unified Next.js API backend. This document defines the architectural principles, current implementation state, and integration patterns for maintaining consistency across all platforms.

---

## Current State Assessment

### Web Application

| Attribute | Value |
|-----------|-------|
| Technology | Next.js 16.2 + React 19 |
| Location | `apps/web/` |
| Status | **Production Ready (10/10)** |
| API Routes | 50+ REST endpoints |
| Auth | Better Auth with RBAC |
| Database | Neon PostgreSQL (serverless) |
| Testing | Vitest (unit) + Playwright (E2E) |

The web application serves as the primary development target and defines the canonical API contract that desktop and mobile clients consume.

### Desktop Application

| Attribute | Value |
|-----------|-------|
| Technology | Electron 33.3 (shell wrapper) |
| Location | `apps/desktop/` |
| Status | **Production Ready (9/10)** |
| Packaging | NSIS (Win), DMG (macOS), AppImage/deb/rpm (Linux) |
| Auto-Update | electron-updater via GitHub Releases |
| Deep Links | `dealflow://` protocol |

**Architecture Pattern:** Native shell around Next.js web app (same model as Slack, Linear, Notion).

Key capabilities:
- System tray integration
- Global keyboard shortcuts (Cmd/Ctrl+N, Cmd/Ctrl+1-7)
- Persistent window state
- Offline fallback page
- Background auto-updates
- Code signing ready (macOS notarization, Windows Authenticode)

**Security posture:**
- Context isolation: `contextIsolation: true`
- Node disabled in renderer: `nodeIntegration: false`
- Sandbox enforced: `sandbox: true`
- Navigation locked to origin allowlist
- Strict CSP on local pages

### Mobile Applications

| Attribute | Value |
|-----------|-------|
| Technology | Expo SDK 54 + React Native 0.81 |
| Location | `apps/mobile/` |
| Status | **Scaffolded (4/10)** |
| iOS | Configured, needs DealFlow customization |
| Android | Configured, needs DealFlow customization |
| Build System | EAS Build (Expo Application Services) |

**Current state:**
- Expo Router for file-based navigation
- React Query (`@tanstack/react-query`) for data fetching
- Sentry integration for crash reporting
- RevenueCat (`react-native-purchases`) for IAP
- Google Ads SDK ready
- Basic app structure with `src/app/`, `src/components/`, `src/utils/`

**Gaps requiring implementation:**
- DealFlow API client integration
- Better Auth mobile flow
- Campaign management screens
- Lead management screens
- Contract viewer
- Push notification handling for outreach alerts

---

## Recommended Architecture

```
                         +---------------------------+
                         |    DEALFLOWAI BACKEND     |
                         |      (Next.js API)        |
                         |                           |
                         |  - /api/auth/*           |
                         |  - /api/campaigns/*      |
                         |  - /api/leads/*          |
                         |  - /api/credits/*        |
                         |  - /api/contracts/*      |
                         |  - /api/analytics/*      |
                         +------------+--------------+
                                      |
                                      | REST/JSON
                                      |
           +--------------------------+-------------------------+
           |                          |                         |
           v                          v                         v
    +-------------+           +---------------+         +----------------+
    |    WEB      |           |    DESKTOP    |         |     MOBILE     |
    |  (Next.js)  |           |  (Electron)   |         | (React Native) |
    |             |           |               |         |                |
    | SSR + CSR   |           | Shell wrapper |         |    Native UI   |
    | Full UI     |           | loads web app |         |  + offline     |
    +-------------+           +---------------+         +----------------+
                                                               |
                                                    +----------+----------+
                                                    |                     |
                                                    v                     v
                                              +---------+           +---------+
                                              | ANDROID |           |   iOS   |
                                              |  (APK)  |           |  (IPA)  |
                                              +---------+           +---------+
```

---

## Shared Code Strategy

### 1. API Client Layer

All platforms share TypeScript types for API requests/responses.

**Location:** Create `packages/api-types/` or export from `apps/web/src/types/api.ts`

```typescript
// Shared type definitions
export interface SessionData {
  userId: string;
  email: string;
  name?: string;
  role?: 'ADMIN' | 'MEMBER';
}

export interface CreditsResponse {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
  tier: string;
  costs: Record<string, number>;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  leadsCount: number;
  messagessSent: number;
  // ... full schema
}
```

### 2. State Management

| Platform | Solution | Rationale |
|----------|----------|-----------|
| Web | React Query + URL state | SSR-compatible, deduped |
| Desktop | Same as web (shell) | Inherits web state |
| Mobile | React Query + Zustand | RN-compatible, offline |

**React Query configuration (shared pattern):**

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
});
```

### 3. Authentication Flow

**Better Auth Token Flow:**

```
+----------+     +----------+     +----------+
|  Client  | --> |  /api/   | --> | Database |
| (any)    |     | auth/*   |     |          |
+----------+     +----------+     +----------+
     |                |
     |  Set-Cookie    |
     | <------------  |
     |                |
     | Authorization: |
     | Bearer <token> |
     | ------------> |
```

**Platform-specific storage:**

| Platform | Token Storage | Session Refresh |
|----------|---------------|-----------------|
| Web | HTTP-only cookies | Automatic (Better Auth) |
| Desktop | Electron cookies (same origin) | Automatic |
| Mobile | `expo-secure-store` | Manual refresh on 401 |

### 4. Credit System

**Principle:** Backend is authoritative. Clients cache for display only.

```typescript
// Mobile/Desktop: Poll or subscribe to credit balance
const { data: credits } = useQuery({
  queryKey: ['credits'],
  queryFn: () => api.get('/credits'),
  staleTime: 1000 * 30, // Refresh every 30s
});

// Optimistic updates DISABLED for credits
// Always wait for server confirmation before updating UI
```

**Credit sync events:**
1. On app launch: Fetch current balance
2. On action completion: Refetch balance
3. On background (mobile): Refetch when foregrounded
4. On push notification: Refetch if credit-related

---

## Key Architectural Principles

### 1. Backend is Authoritative for Entitlements

```typescript
// CORRECT: Check server-side
const subscription = await getSubscriptionStatus(organizationId);
const canAccess = tierHasFeature(subscription.tier, 'advancedAnalytics');

// INCORRECT: Client-side feature checks
if (localTier >= 'BUSINESS') { /* WRONG - can be spoofed */ }
```

All feature gates are enforced at the API layer. Clients render based on server responses.

### 2. Credits Synchronized from Server

The client never computes credit balances locally. All mutations go through:

```
POST /api/credits/deduct  - Deduct credits for action
POST /api/credits/purchase - Purchase credits
GET  /api/credits          - Read current balance
```

### 3. Campaign State from Backend

Campaign status changes only via API:

```
POST /api/campaigns/[id]/launch  - Start campaign
POST /api/campaigns/[id]/pause   - Pause campaign
POST /api/campaigns/[id]/resume  - Resume campaign
```

Clients poll or use WebSocket for real-time updates.

### 4. No Client-Side Business Logic Duplication

| Logic Type | Location | Clients |
|------------|----------|---------|
| Credit calculation | Backend | Display only |
| Tier feature checks | Backend | Render gates |
| Message validation | Backend | Input hints |
| Compliance rules | Backend | Error display |

---

## Platform-Specific Implementation Notes

### Web (apps/web/)

**Build command:** `yarn build`
**Dev server:** `yarn dev` (port 4000)

Primary target for all feature development. API routes defined here are consumed by all platforms.

### Desktop (apps/desktop/)

**Build command:** `yarn desktop:dist`
**Dev command:** `yarn desktop:dev`

The desktop app is a thin Electron wrapper:
- Loads `https://app.dealflow.ai` (prod) or `http://localhost:4000` (dev)
- Adds native menu, tray, shortcuts
- No business logic duplication

**Offline handling:**
```typescript
// src/renderer/offline.html loads when network unavailable
// Shows cached data + retry button
```

### Mobile (apps/mobile/)

**Build command:** `eas build --platform all`
**Dev command:** `expo start`

**Required implementations:**

1. **API Client Setup**
```typescript
// src/utils/api.ts
import * as SecureStore from 'expo-secure-store';

const api = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL,
  
  async fetch(path: string, options: RequestInit = {}) {
    const token = await SecureStore.getItemAsync('auth_token');
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });
  },
};
```

2. **Screen Mapping (Priority Order)**

| Screen | API Endpoint | Priority |
|--------|--------------|----------|
| Dashboard | `/api/dashboard/*` | P0 |
| Campaigns List | `GET /api/campaigns` | P0 |
| Campaign Detail | `GET /api/campaigns/[id]` | P0 |
| Leads List | `GET /api/leads` | P1 |
| Lead Detail | `GET /api/leads/[id]` | P1 |
| Credits | `GET /api/credits` | P1 |
| Contracts | `GET /api/contracts` | P2 |
| Analytics | `GET /api/analytics/*` | P2 |
| Settings | Various | P2 |

3. **Push Notifications**

```typescript
// expo-notifications integration
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Register device token with backend
POST /api/devices { token, platform: 'ios' | 'android' }
```

---

## Security Considerations

### API Authentication

All API routes require authentication via Better Auth:

```typescript
// Every API route starts with:
const session = await auth.api.getSession({ headers: await headers() });
if (!session) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### Mobile-Specific Security

| Concern | Mitigation |
|---------|------------|
| Token storage | `expo-secure-store` (Keychain/Keystore) |
| Certificate pinning | Implement for production builds |
| Root/jailbreak detection | Optional, via `expo-device` |
| Screenshot prevention | Platform-specific flags |

### Desktop-Specific Security

Already implemented in Electron shell:
- Context isolation
- Sandbox mode
- Navigation restrictions
- Permission denials

---

## Data Synchronization Patterns

### Optimistic Updates (Safe)

```typescript
// Safe for non-critical UI updates
const updateCampaignName = useMutation({
  mutationFn: (name) => api.patch(`/campaigns/${id}`, { name }),
  onMutate: async (name) => {
    await queryClient.cancelQueries(['campaign', id]);
    const previous = queryClient.getQueryData(['campaign', id]);
    queryClient.setQueryData(['campaign', id], (old) => ({ ...old, name }));
    return { previous };
  },
  onError: (err, name, context) => {
    queryClient.setQueryData(['campaign', id], context.previous);
  },
});
```

### Pessimistic Updates (Required)

```typescript
// Required for credits, payments, compliance actions
const launchCampaign = useMutation({
  mutationFn: () => api.post(`/campaigns/${id}/launch`),
  onSuccess: () => {
    queryClient.invalidateQueries(['campaign', id]);
    queryClient.invalidateQueries(['credits']);
  },
  // NO optimistic update - wait for server confirmation
});
```

---

## Testing Strategy

| Platform | Unit | Integration | E2E |
|----------|------|-------------|-----|
| Web | Vitest | Vitest + MSW | Playwright |
| Desktop | N/A (shell) | N/A | Spectron/Playwright |
| Mobile | Jest | Jest + MSW | Detox |

**API contract testing:**

```typescript
// Shared test utilities
describe('Campaign API Contract', () => {
  it('returns consistent shape across versions', async () => {
    const response = await fetch('/api/campaigns');
    const data = await response.json();
    
    expect(data).toMatchSchema(CampaignListSchema);
  });
});
```

---

## Deployment Pipeline

```
+----------+     +---------+     +------------+
|   Code   | --> |   CI    | --> |  Release   |
|  Push    |     | (tests) |     |            |
+----------+     +---------+     +------------+
                      |
         +------------+------------+
         |            |            |
         v            v            v
    +--------+   +--------+   +--------+
    |  Web   |   |Desktop |   | Mobile |
    | Vercel |   | GitHub |   |  EAS   |
    |        |   |Releases|   | Build  |
    +--------+   +--------+   +--------+
```

### Release Channels

| Channel | Web | Desktop | Mobile |
|---------|-----|---------|--------|
| Development | localhost | localhost | Expo Go |
| Staging | staging.dealflow.ai | Beta release | Internal TestFlight/Internal Track |
| Production | app.dealflow.ai | GitHub Release | App Store/Play Store |

---

## Migration Path for Mobile

### Phase 1: Foundation (Week 1-2)
- [ ] Create DealFlow API client in `apps/mobile/src/utils/api.ts`
- [ ] Implement Better Auth flow with token storage
- [ ] Create base navigation structure
- [ ] Implement auth screens (login, signup, forgot password)

### Phase 2: Core Screens (Week 3-4)
- [ ] Dashboard with quick stats
- [ ] Campaigns list and detail
- [ ] Basic lead management
- [ ] Credits display

### Phase 3: Advanced Features (Week 5-6)
- [ ] Push notifications
- [ ] Offline data caching
- [ ] Contract viewer (PDF)
- [ ] Analytics dashboards

### Phase 4: Polish (Week 7-8)
- [ ] Performance optimization
- [ ] Accessibility audit
- [ ] App Store/Play Store submission
- [ ] Beta testing program

---

## Version Compatibility Matrix

| Backend Version | Web | Desktop | Mobile |
|-----------------|-----|---------|--------|
| v1.0.x | v1.0.x | v1.0.x | v1.0.x |

All clients must match the major version of the backend API. Minor version differences are supported with graceful degradation.

---

## Appendix A: API Endpoint Reference

Core endpoints consumed by all platforms:

```
Authentication:
  POST /api/auth/sign-in
  POST /api/auth/sign-up
  POST /api/auth/sign-out
  GET  /api/auth/session

Campaigns:
  GET    /api/campaigns
  POST   /api/campaigns
  GET    /api/campaigns/[id]
  PATCH  /api/campaigns/[id]
  DELETE /api/campaigns/[id]
  POST   /api/campaigns/[id]/launch
  POST   /api/campaigns/[id]/pause

Leads:
  GET    /api/leads
  POST   /api/leads
  GET    /api/leads/[id]
  PATCH  /api/leads/[id]

Credits:
  GET    /api/credits
  POST   /api/credits/purchase
  POST   /api/credits/deduct

Contracts:
  GET    /api/contracts
  GET    /api/contracts/[id]
  POST   /api/contracts/[id]/sign

Analytics:
  GET    /api/analytics/advanced
  GET    /api/dashboard/quick-stats
  GET    /api/dashboard/funnel
```

---

## Appendix B: Environment Variables

### Web (.env)
```bash
DATABASE_URL=
BETTER_AUTH_SECRET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

### Desktop (.env)
```bash
DEALFLOW_APP_URL=https://app.dealflow.ai
```

### Mobile (.env)
```bash
EXPO_PUBLIC_API_URL=https://app.dealflow.ai/api
SENTRY_DSN=
```

---

*Document generated: 2026-09-16*
*Architecture version: 1.0*

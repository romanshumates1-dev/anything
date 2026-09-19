# Cross-Platform Testing Guide

> Last Updated: 2026-09-16
>
> Comprehensive testing requirements for DealFlowAI across Web, Desktop (Electron), and Mobile (React Native/Expo) platforms.

---

## Web Baseline

| Test Type | Count | Framework | Status |
|-----------|-------|-----------|--------|
| Unit Tests | 2,036 | Vitest | PASSING |
| Test Files | 169 | Vitest | PASSING |
| Skipped Tests | 23 | Vitest | Expected |
| Todo Tests | 30 | Vitest | Backlog |
| E2E Tests | 2 specs | Playwright | PASSING |

### Test File Distribution

| Category | Files | Coverage |
|----------|-------|----------|
| API Utils | 65+ | Core business logic |
| Services | 15+ | Background services |
| API Routes | 60+ | Endpoint contracts |
| Integration | 5+ | Cross-service flows |
| Security | 3 | Auth, credits, access |
| Compliance | 3+ | DNC, opt-out, messaging |

### Key Test Suites

- **Credit Security** (`credits.test.ts`): Negative balance prevention, race conditions, overflow protection
- **Tier Limits** (`tierLimits.test.ts`): Subscription enforcement, free tier fallbacks
- **Concurrency** (`concurrency.test.ts`): Parallel operation safety
- **Auth/Access** (`auth.test.ts`, `access-control.test.ts`): RBAC enforcement

---

## Desktop Testing

### Current State

The desktop app (`apps/desktop/`) is an Electron wrapper around the web application:

| Component | Test Framework | Status |
|-----------|----------------|--------|
| Main Process | None | UNVERIFIED |
| Renderer | None | UNVERIFIED (uses web) |
| IPC Handlers | None | UNVERIFIED |
| Native Features | None | UNVERIFIED |

### Recommended Setup

```bash
# Package.json additions
{
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "electron": "^28.0.0",
    "vitest": "^1.0.0"
  }
}
```

### Test Types Required

| Type | Framework | Purpose |
|------|-----------|---------|
| Unit | Vitest | Main process logic, IPC handlers |
| Integration | Vitest | Window management, state sync |
| E2E | Playwright + Electron | Full app launch, user flows |

### E2E Configuration (Playwright for Electron)

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    // Launch Electron app
    launchOptions: {
      executablePath: './dist/DealFlowAI.exe',
    },
  },
});
```

---

## Mobile Testing (React Native/Expo)

### Current State

The mobile app (`apps/mobile/`) is an Expo-based React Native application:

| Component | Test Framework | Status |
|-----------|----------------|--------|
| Components | None | UNVERIFIED |
| Screens | None | UNVERIFIED |
| API Integration | None | UNVERIFIED |
| Navigation | None | UNVERIFIED |

### Recommended Setup

```bash
# Package.json additions
{
  "devDependencies": {
    "jest": "^29.0.0",
    "@testing-library/react-native": "^12.0.0",
    "detox": "^20.0.0"
  }
}
```

### Test Types Required

| Type | Framework | Purpose |
|------|-----------|---------|
| Unit | Jest | Utils, hooks, pure functions |
| Component | React Native Testing Library | UI components, interactions |
| E2E | Detox | iOS/Android real device flows |

### Detox Configuration

```javascript
// .detoxrc.js
module.exports = {
  testRunner: {
    args: { '$0': 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 }
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/DealFlowAI.app',
      build: 'xcodebuild -workspace ios/DealFlowAI.xcworkspace ...'
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug'
    }
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { type: 'iPhone 15' } },
    emulator: { type: 'android.emulator', device: { avdName: 'Pixel_7' } }
  },
  configurations: {
    'ios.sim.debug': { device: 'simulator', app: 'ios.debug' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' }
  }
};
```

---

## Required E2E Flows (All Platforms)

### Flow 1: Authentication

**Steps:**
1. Navigate to signup page
2. Complete registration form
3. Verify account creation
4. Sign out
5. Login with credentials
6. Verify dashboard access
7. Logout
8. Verify session cleared

**Verification Points:**
- Session token stored correctly (Web: cookie, Mobile: SecureStore)
- RBAC role applied correctly
- Redirect flows work
- Error states handled

| Platform | Status | Notes |
|----------|--------|-------|
| Web | LIVE VERIFIED | journey.spec.ts covers wizard+launch |
| Desktop | SANDBOX VERIFIED | Inherits web auth via WebView |
| Android | MOCK VERIFIED | WebView auth shim |
| iOS | MOCK VERIFIED | WebView auth shim |

### Flow 2: Campaign Creation

**Steps:**
1. Login as authenticated user
2. Navigate to /campaigns
3. Click "New Campaign" / open wizard
4. Step 1: Configure name + contacts
5. Step 2: Set follow-up cadence
6. Step 3: Configure compliance
7. Step 4: Review + enable test mode
8. Launch campaign
9. Verify ACTIVE status in DB
10. Verify campaign appears in list with TEST badge

**Verification Points:**
- All wizard steps validate correctly
- Campaign persists to database
- Status transitions DRAFT -> ACTIVE
- Test mode prevents real sends
- Credits checked before launch

| Platform | Status | Notes |
|----------|--------|-------|
| Web | LIVE VERIFIED | journey.spec.ts full flow |
| Desktop | SANDBOX VERIFIED | Inherits web functionality |
| Android | UNVERIFIED | No campaign UI |
| iOS | UNVERIFIED | No campaign UI |

### Flow 3: Cross-Device Sync

**Steps:**
1. Desktop: Login and launch campaign
2. Mobile: Login same account
3. Mobile: Verify campaign visible
4. Mobile: Pause campaign
5. Desktop: Verify paused status
6. Desktop: Resume campaign
7. Mobile: Verify active status

**Verification Points:**
- Real-time sync (WebSocket or polling)
- Status changes propagate < 5 seconds
- Optimistic UI updates
- Conflict resolution (last-write-wins)

| Platform | Status | Notes |
|----------|--------|-------|
| Web <-> Web | MOCK VERIFIED | API layer works |
| Desktop <-> Mobile | UNVERIFIED | Mobile lacks campaign UI |
| Mobile <-> Mobile | UNVERIFIED | No multi-device test |

### Flow 4: Credit Safety

**Steps:**
1. Setup: Org with 100 credits
2. Concurrent: Fire 10 parallel deductions of 20 credits each
3. Verify: Exactly 5 succeed, 5 fail with INSUFFICIENT_CREDITS
4. Verify: Balance is exactly 0 (never negative)
5. Verify: No lost updates (all transactions logged)

**Verification Points:**
- Atomic deductions (CTE-based)
- No negative balance ever
- Idempotency keys prevent double-charge
- Integer overflow protected
- Audit trail complete

| Platform | Status | Notes |
|----------|--------|-------|
| API | MOCK VERIFIED | credits.test.ts, concurrency.test.ts |
| Web | SANDBOX VERIFIED | UI shows balance correctly |
| Desktop | SANDBOX VERIFIED | Inherits web |
| Mobile | UNVERIFIED | No credit UI |

### Flow 5: Tier Enforcement

**Steps:**
1. Setup: Org on "Free" tier (10 leads/month)
2. Attempt: Create lead #11
3. Verify: 403 response with upgrade prompt
4. Attempt: Access Pro-only feature
5. Verify: 403 response with tier gate
6. Action: Upgrade to Starter tier
7. Verify: Previously blocked actions now succeed

**Verification Points:**
- Tier limits enforced at API level
- Graceful degradation with upgrade prompts
- Plan changes take effect immediately
- No bypass via direct API calls

| Platform | Status | Notes |
|----------|--------|-------|
| API | MOCK VERIFIED | tierLimits.test.ts |
| Web | SANDBOX VERIFIED | Upgrade modals work |
| Desktop | SANDBOX VERIFIED | Inherits web |
| Android | UNVERIFIED | No tier UI |
| iOS | UNVERIFIED | No tier UI |

---

## Verification Levels

| Level | Definition | Requirements |
|-------|------------|--------------|
| **LIVE VERIFIED** | Tested on real devices/services | Production-like env, real network, real auth |
| **SANDBOX VERIFIED** | Tested in isolated test environment | Test DB, mocked external services |
| **MOCK VERIFIED** | Tested with mocked dependencies | Unit/integration tests, no real services |
| **UNVERIFIED** | Not tested | Requires implementation |

---

## Test Environment Matrix

| Environment | Web | Desktop | Android | iOS |
|-------------|-----|---------|---------|-----|
| Local Dev | localhost:4000 | Electron dev | Expo Go | Expo Go |
| CI | GitHub Actions | GitHub Actions | EAS Build | EAS Build |
| Staging | staging.dealflowai.com | N/A | TestFlight | TestFlight |
| Production | app.dealflowai.com | Auto-update | Play Store | App Store |

---

## CI Pipeline Integration

### Web Tests (Current)

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: yarn install
      - run: yarn vitest run
      - run: yarn playwright test
```

### Desktop Tests (Proposed)

```yaml
jobs:
  desktop-test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd apps/desktop && yarn install
      - run: cd apps/desktop && yarn test
      - run: cd apps/desktop && yarn build
      - run: cd apps/desktop && yarn test:e2e
```

### Mobile Tests (Proposed)

```yaml
jobs:
  mobile-test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd apps/mobile && yarn install
      - run: cd apps/mobile && yarn test
      - uses: expo/expo-github-action@v8
      - run: cd apps/mobile && eas build --platform ios --profile preview
      - run: cd apps/mobile && detox test --configuration ios.sim.debug
```

---

## Coverage Goals

| Platform | Unit | Integration | E2E | Target |
|----------|------|-------------|-----|--------|
| Web API | 85% | 70% | 5 flows | Current |
| Web UI | 60% | 50% | 5 flows | Q4 2026 |
| Desktop | 40% | 30% | 3 flows | Q4 2026 |
| Android | 50% | 30% | 5 flows | Q1 2027 |
| iOS | 50% | 30% | 5 flows | Q1 2027 |

---

## Priority Implementation Order

### Phase 1 (Immediate)

1. **Mobile Authentication E2E** - Detox test for WebView auth flow
2. **Desktop Main Process Unit Tests** - IPC handlers, window management
3. **Cross-Device Sync API Tests** - Real-time update verification

### Phase 2 (Q4 2026)

1. **Mobile Dashboard Integration** - API response validation
2. **Desktop Native Features** - Auto-update, notifications
3. **Credit Safety E2E** - Full concurrent deduction scenarios

### Phase 3 (Q1 2027)

1. **Mobile Campaign Management** - Full CRUD flows
2. **Mobile Inbox/Conversations** - Real-time messaging
3. **Cross-Platform Regression Suite** - Unified test harness

---

## Test Data Management

### Fixtures

```typescript
// shared/test-fixtures.ts
export const testOrg = {
  id: 'org_test_00000000-0000-0000-0000-000000000001',
  name: 'E2E Test Org',
  tier: 'starter',
  credits: 1000,
};

export const testUser = {
  email: 'e2e@dealflowai.test',
  password: 'TestPassword123!',
  role: 'ADMIN',
};

export const testCampaign = {
  name: 'E2E Test Campaign',
  contacts: ['+15025550001', '+15025550002'],
  opening: 'Test opening message',
  testMode: true,
};
```

### Database Seeding

```bash
# Before E2E runs
yarn db:seed:test

# After E2E runs
yarn db:clean:test
```

---

## Related Documentation

- [WEB_PARITY_MATRIX.md](./WEB_PARITY_MATRIX.md) - Feature parity status
- [ANDROID_STATUS.md](./ANDROID_STATUS.md) - Android implementation status
- [IOS_STATUS.md](./IOS_STATUS.md) - iOS implementation status
- [CAMPAIGN_API_CONTRACT.md](./CAMPAIGN_API_CONTRACT.md) - API specifications
- [BILLING_CROSS_PLATFORM.md](./BILLING_CROSS_PLATFORM.md) - Billing integration

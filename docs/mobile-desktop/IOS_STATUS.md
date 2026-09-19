# DealFlowAI iOS Application Status Report

> Generated: 2026-09-16
> Author: AGENT E - iOS Engineer

---

## Executive Summary

The DealFlowAI iOS application exists as part of a cross-platform React Native/Expo mobile app located at `apps/mobile/`. The app shares its codebase with Android and is currently in **MVP/scaffolded state** with approximately **5% feature parity** with the web application. Authentication works via WebView with Keychain storage, and a basic dashboard exists, but critical business features (campaigns, leads, inbox, contracts) are not yet implemented.

**Important:** iOS builds require macOS with Xcode. The project has no dedicated `ios/` directory - Expo generates native iOS code at build time via EAS Build.

---

## Current State

### Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | React Native | 0.81.4 |
| Tooling | Expo SDK | 54.0.34 |
| Navigation | expo-router | 6.0.11 |
| State Management | Zustand + React Query | 5.0.3 / 5.72.2 |
| Authentication | Better Auth (WebView) | Custom |
| Secure Storage | expo-secure-store | 15.0.8 |
| Build System | EAS Build | CLI >= 15.0.15 |
| Language | TypeScript | 5.9.2 |

### Project Structure

```
apps/mobile/
  app.json              # Expo config (includes iOS settings)
  eas.json              # EAS Build profiles
  package.json          # Dependencies
  src/
    app/
      _layout.tsx       # Root layout with auth
      index.tsx         # Dashboard screen
      +not-found.tsx    # 404 handler
    components/
      KeyboardAvoidingAnimatedView.tsx
    utils/
      auth/             # Authentication utilities
        useAuth.ts      # Auth hook
        useAuthModal.tsx
        AuthWebView.tsx # WebView OAuth flow
        getSession.ts   # JWT helper
        store.ts        # Zustand auth store (iOS Keychain)
      iap/              # In-app purchase utils
      useUpload.ts
      usePreventBack.ts
      useHandleStreamResponse.ts
    __create/           # Platform scaffolding
      anything-menu.ios.tsx  # iOS-specific menu
      analytics.ts
      ErrorBoundary.tsx
      fetch.ts
```

### iOS-Specific Configuration

**app.json (iOS section):**
```json
{
  "ios": {
    "supportsTablet": true,
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false
    }
  },
  "plugins": [
    ["expo-build-properties", {
      "ios": {
        "useFrameworks": "static"
      }
    }]
  ]
}
```

**Current Issues:**
- No bundle identifier configured (needs `ai.dealflow.mobile`)
- No deep link configuration for `dealflow://` URL scheme
- No APNs push notification setup
- No App Store Connect configuration
- No Apple signing credentials in EAS
- Generic app name ("Anything mobile app") needs DealFlow branding

### Expo Plugins (iOS-Relevant)

| Plugin | Purpose | Configuration |
|--------|---------|---------------|
| expo-router | File-based navigation | sitemap disabled |
| expo-splash-screen | Launch screen | 200px icon, contain |
| expo-audio | Audio recording | Enabled |
| expo-build-properties | iOS frameworks | Static linking |
| expo-video | Video playback | PiP + background |
| expo-font | Custom fonts | Enabled |
| expo-secure-store | Keychain access | Enabled |
| expo-web-browser | OAuth WebView | Enabled |
| @sentry/react-native/expo | Crash reporting | Enabled |
| react-native-google-mobile-ads | Ads | Test ID configured |

### Secure Storage Configuration

The iOS implementation uses hardened Keychain settings:

```typescript
// From src/utils/auth/store.ts
export const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: 'anything-auth',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
```

This configuration:
- Pins to stable Keychain service name (survives build migrations)
- Allows access after device first unlock (avoids TestFlight failures)
- Disables biometric requirement (avoids TurboModule exceptions on iOS 26)

---

## Feature Coverage

### Implemented (PASS)

| Feature | Implementation | Notes |
|---------|----------------|-------|
| Authentication (Sign In/Out) | WebView + SecureStore | Works with Better Auth |
| Session Persistence | expo-secure-store | JWT stored in iOS Keychain |
| Basic Dashboard | Single screen | Shows stats, system health |
| Dashboard Stats API | /api/dashboard/stats | Fetches via authFetch |
| Error Boundary | ErrorBoundary.tsx | Crash recovery |
| In-App Purchase SDK | RevenueCat | Configured with test App ID |
| Google Ads SDK | react-native-google-mobile-ads | Test ID: ca-app-pub-3940256099942544~1458002511 |
| Sentry Integration | @sentry/react-native | Crash reporting |
| iOS Platform Menu | anything-menu.ios.tsx | iOS-specific UI |

### Partially Implemented (PARTIAL)

| Feature | Status | Gap |
|---------|--------|-----|
| Dashboard | Basic stats only | Missing pipeline, actions, readiness |
| System Health Widget | Hardcoded values | Should fetch from /api/system |
| Manage Leads Button | UI element exists | No navigation/action |

### Not Implemented (MISSING)

| Feature | Priority | Effort | API Endpoint |
|---------|----------|--------|--------------|
| **Campaigns List** | P0 | Large | GET /api/campaigns |
| **Campaign Builder** | P0 | Large | POST /api/campaigns |
| **Campaign Monitor** | P0 | Medium | GET /api/campaigns/[id] |
| **Campaign Launch** | P0 | Medium | POST /api/campaigns/[id]/launch |
| **Leads List** | P0 | Large | GET /api/leads |
| **Lead Import** | P0 | Medium | POST /api/leads/import |
| **Lead Detail** | P0 | Medium | GET /api/leads/[id] |
| **Lead Finder** | P0 | Large | /api/lead-finder |
| **CRM Dashboard** | P0 | Large | GET /api/crm |
| **Inbox** | P0 | Large | GET /api/conversations |
| **Conversation View** | P0 | Large | GET /api/conversations/[id] |
| **Contracts List** | P1 | Medium | GET /api/contracts |
| **Credits Display** | P1 | Small | GET /api/credits |
| **Billing Settings** | P1 | Medium | GET /api/billing |
| **Analytics** | P1 | Medium | GET /api/analytics/advanced |
| **Settings** | P1 | Medium | Various |
| **Admin Panel** | P1 | Large | /api/admin/* |
| **Push Notifications** | P1 | Medium | APNs integration |
| **Deep Links** | P1 | Small | dealflow:// URL scheme |
| **Offline Support** | P2 | Large | Local caching |

---

## Build Instructions

### Prerequisites

1. **macOS** with Xcode 15+ installed (iOS builds cannot run on Windows/Linux)
2. Apple Developer account ($99/year for App Store)
3. Node.js 18+
4. Yarn 4.x (project uses Yarn Berry)
5. EAS CLI: `npm install -g eas-cli`
6. Expo account: https://expo.dev

### Development Build

```bash
# Navigate to mobile app
cd apps/mobile

# Install dependencies
yarn install

# Start Metro bundler
npx expo start

# For iOS Simulator (macOS only)
npx expo start --ios

# Or press 'i' in Metro terminal
```

### EAS Build (Release)

```bash
# Login to Expo
eas login

# Build development IPA (internal testing)
eas build --platform ios --profile development

# Build preview IPA (internal distribution)
eas build --platform ios --profile preview

# Build production IPA (App Store)
eas build --platform ios --profile production
```

### Signing Configuration

**Required for any iOS build:**

1. **Apple Developer Account**
   - Enroll at https://developer.apple.com
   - Create App ID: `ai.dealflow.mobile`
   - Create provisioning profiles

2. **EAS Credentials Setup**
   ```bash
   # Interactive credential management
   eas credentials --platform ios
   
   # Options:
   # - Let EAS manage (recommended for teams)
   # - Upload existing certificates
   ```

3. **App Store Connect Setup**
   - Create app record
   - Configure TestFlight
   - Prepare metadata and screenshots

### TestFlight Distribution

```bash
# Build and submit to TestFlight
eas submit --platform ios --profile production

# Or configure auto-submit in eas.json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "your@apple.id",
        "ascAppId": "123456789"
      }
    }
  }
}
```

---

## iOS-Specific Considerations

### App Store Compliance

| Requirement | Status | Action Needed |
|-------------|--------|---------------|
| App Privacy Manifest | MISSING | Add privacy labels for data collection |
| Export Compliance | PASS | ITSAppUsesNonExemptEncryption: false |
| Sign In with Apple | MISSING | Required if other social login exists |
| IDFA (Ad Tracking) | MISSING | ATT prompt needed for Google Ads |
| Minimum iOS Version | Default | Expo 54 targets iOS 15.1+ |

### Privacy Manifest Requirements (iOS 17+)

Add to `app.json`:
```json
{
  "expo": {
    "ios": {
      "privacyManifests": {
        "NSPrivacyAccessedAPITypes": [
          {
            "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
            "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
          }
        ]
      }
    }
  }
}
```

### App Tracking Transparency (ATT)

Required for Google Mobile Ads:
```bash
# Install ATT plugin
npx expo install expo-tracking-transparency
```

Add to `app.json`:
```json
{
  "plugins": [
    ["expo-tracking-transparency", {
      "userTrackingPermission": "This allows us to show you personalized ads."
    }]
  ]
}
```

### Keychain Security

Current implementation handles iOS edge cases:

1. **First Unlock Protection**: Uses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` to prevent auth failures on locked devices
2. **Stable Service Name**: Pinned to `anything-auth` to survive EAS build migrations
3. **No Biometric**: Avoids Face ID/Touch ID entitlement requirements and TurboModule crashes
4. **Graceful Fallback**: 3-second timeout prevents infinite loading on Keychain failures

---

## Gap Analysis

### Critical Gaps (P0 - Must Have for MVP)

| Gap | Impact | Recommended Action |
|-----|--------|-------------------|
| No Campaign Management | Users cannot view/create campaigns | Build CampaignList, CampaignDetail screens |
| No Lead Management | Users cannot manage leads | Build LeadList, LeadDetail screens |
| No Inbox | Users cannot view conversations | Build Inbox, ConversationView screens |
| Bundle ID Not Configured | App cannot be submitted | Set `bundleIdentifier: "ai.dealflow.mobile"` |
| No Bottom Navigation | Only one screen accessible | Implement tab navigator |

### High Priority Gaps (P1)

| Gap | Impact | Recommended Action |
|-----|--------|-------------------|
| No Credits Display | Users cannot see balance | Add credits badge/screen |
| No Settings | Users cannot configure app | Build Settings stack |
| No Push Notifications | Users miss alerts | Implement APNs with expo-notifications |
| No Deep Links | Cannot navigate from external | Configure URL scheme dealflow:// |
| No Contracts View | Users cannot view contracts | Build ContractList, PDF viewer |
| No Sign In with Apple | App Store rejection risk | Implement Apple OAuth |

### Medium Priority Gaps (P2)

| Gap | Impact | Recommended Action |
|-----|--------|-------------------|
| No Offline Support | App unusable without network | Implement AsyncStorage caching |
| No Analytics | Users cannot view performance | Build Analytics screen |
| No Profile | Users cannot edit profile | Build Profile screen |
| No Gamification | Missing engagement features | Build Achievements, Leaderboard |

---

## Recommended Next Steps

### Phase 1: Foundation (1-2 weeks)

1. **Update app.json for DealFlow branding**
   ```json
   {
     "expo": {
       "name": "DealFlow AI",
       "ios": {
         "bundleIdentifier": "ai.dealflow.mobile",
         "supportsTablet": true,
         "infoPlist": {
           "ITSAppUsesNonExemptEncryption": false,
           "CFBundleURLTypes": [{
             "CFBundleURLSchemes": ["dealflow"]
           }]
         }
       }
     }
   }
   ```

2. **Add navigation structure** (same as Android - shared code)
   ```
   src/app/
     (tabs)/
       _layout.tsx        # Tab navigator
       index.tsx          # Dashboard
       campaigns.tsx      # Campaigns list
       leads.tsx          # Leads list
       inbox.tsx          # Inbox
       more.tsx           # Settings/Profile
     campaigns/
       [id].tsx           # Campaign detail
     leads/
       [id].tsx           # Lead detail
     inbox/
       [leadId].tsx       # Conversation
   ```

3. **Set up Apple Developer credentials**
   ```bash
   eas credentials --platform ios
   ```

### Phase 2: Core Screens (2-3 weeks)

Same implementation as Android (shared React Native code):

1. Build Campaigns List
2. Build Leads List  
3. Build Inbox
4. Build Credits display

### Phase 3: iOS-Specific Features (2-3 weeks)

1. **Push Notifications (APNs)**
   ```bash
   # Already installed: expo-notifications
   # Configure APNs key in EAS
   eas credentials --platform ios
   ```

2. **Sign In with Apple** (App Store requirement)
   ```bash
   npx expo install expo-apple-authentication
   ```

3. **App Tracking Transparency**
   ```bash
   npx expo install expo-tracking-transparency
   ```

4. **Deep Linking**
   - Configure Universal Links (AASA file)
   - Configure URL scheme

### Phase 4: App Store Submission (1-2 weeks)

1. Prepare App Store screenshots (6.5", 5.5" iPhones + iPad)
2. Write App Store description
3. Configure privacy policy URL
4. Submit for TestFlight review
5. External beta testing
6. App Store submission

---

## Dependencies Analysis

### Production Dependencies (iOS-Relevant)

| Package | Purpose | Status |
|---------|---------|--------|
| expo | Framework | OK |
| expo-router | Navigation | OK |
| expo-secure-store | Keychain storage | OK |
| expo-notifications | APNs (not implemented) | Installed |
| expo-linking | URL schemes | OK |
| expo-web-browser | OAuth WebView | OK |
| react-native-purchases | RevenueCat IAP | OK |
| @sentry/react-native | Crash reporting | OK |
| react-native-google-mobile-ads | Ads | OK |

### Missing Dependencies (Recommended for iOS)

| Package | Purpose |
|---------|---------|
| expo-apple-authentication | Sign In with Apple |
| expo-tracking-transparency | ATT for ads |
| expo-store-review | Request App Store reviews |
| react-native-pdf | PDF viewer for contracts |

---

## Environment Configuration

### Current Environment Variables

```bash
# apps/mobile/.env
EXPO_PUBLIC_API_URL=https://3c4875f3-9199-4618-9698-0b1e4669bbab.created.app
EXPO_PUBLIC_HOST=3c4875f3-9199-4618-9698-0b1e4669bbab.created.app
```

### Required for Production

```bash
# DealFlow production
EXPO_PUBLIC_API_URL=https://app.dealflow.ai
EXPO_PUBLIC_HOST=app.dealflow.ai

# Sentry
SENTRY_DSN=<sentry-dsn>

# RevenueCat (iOS-specific key)
REVENUECAT_API_KEY=<revenuecat-ios-key>
```

---

## Security Considerations

### Current Security Posture

| Aspect | Status | Notes |
|--------|--------|-------|
| Token Storage | PASS | expo-secure-store (iOS Keychain) |
| Auth Flow | PASS | WebView with session capture |
| HTTPS Only | PASS | API calls use HTTPS |
| Keychain Accessibility | PASS | AFTER_FIRST_UNLOCK protection |
| Certificate Pinning | MISSING | Recommended for production |
| Jailbreak Detection | MISSING | Optional via expo-device |
| App Transport Security | PASS | Default enforced |

### Recommended Security Enhancements

1. **Certificate Pinning** for API calls
2. **Jailbreak Detection** (optional, via expo-device)
3. **Token Refresh** on 401 responses
4. **Biometric Authentication** for sensitive actions (optional)

---

## Estimated Timeline to MVP

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Foundation | 2 weeks | Navigation, API client, branding, Apple credentials |
| Core Screens | 3 weeks | Campaigns, Leads, Inbox (shared with Android) |
| iOS-Specific | 2 weeks | Sign In with Apple, APNs, ATT |
| App Store Prep | 2 weeks | Screenshots, metadata, TestFlight |
| Review & Launch | 1 week | App Store review process |
| **Total** | **10 weeks** | Production-ready iOS app |

**Note:** iOS development requires macOS. If the team is Windows-based, consider:
- Remote Mac (MacStadium, AWS EC2 Mac)
- EAS Build handles compilation remotely
- Local testing requires macOS or Expo Go

---

## Comparison: iOS vs Android Status

| Aspect | Android | iOS |
|--------|---------|-----|
| Build Environment | Any OS (EAS) | macOS required for local |
| Feature Parity | ~5% | ~5% |
| Authentication | PASS | PASS |
| Dashboard | PARTIAL | PARTIAL |
| IAP SDK | RevenueCat | RevenueCat |
| Push Notifications | FCM (not impl) | APNs (not impl) |
| Store Submission | Play Store | App Store |
| Required Auth | - | Sign In with Apple |
| Privacy Compliance | - | Privacy Manifest, ATT |
| Signing | Keystore | Apple Certificates |

---

## Conclusion

The DealFlowAI iOS app shares its codebase with Android via React Native/Expo, providing a solid cross-platform foundation. Authentication and basic dashboard functionality work, with the Keychain implementation being production-hardened for iOS edge cases.

**Immediate Priorities:**
1. Configure bundle identifier and Apple Developer credentials
2. Add navigation structure (shared code with Android)
3. Build Campaign and Lead management screens

**iOS-Specific Requirements:**
1. Sign In with Apple (App Store requirement)
2. App Tracking Transparency (for Google Ads)
3. Privacy Manifest (iOS 17+)
4. APNs push notifications

**Build Considerations:**
- iOS builds require macOS with Xcode, but EAS Build can compile remotely
- TestFlight distribution is simpler than Play Store internal tracks
- App Store review process typically takes 1-3 days

The shared codebase means most development work benefits both platforms. The focus should be on completing core features (campaigns, leads, inbox) which will work on both iOS and Android simultaneously.

---

*Document version: 1.0*
*Platform: iOS (React Native/Expo)*
*Architecture: Cross-platform with Android*
*macOS Required: Yes (for local builds and Simulator)*

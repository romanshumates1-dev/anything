# Human Acceptance Checklist

**Status:** PARTIAL - Code paths verified, manual steps required

---

## Verified (Code-Path) ✅

| Step | Status | Evidence |
|------|--------|----------|
| Build desktop app | ✅ Verified | `apps/desktop/release/win-unpacked/DealFlow AI.exe` (188 MB) |
| Authentication flow code | ✅ Verified | `lib/auth.ts` with better-auth |
| Organization creation code | ✅ Verified | `organizations` table + API routes |
| User invitation code | ✅ Verified | Routes tested in `admin/users/route.test.ts` |
| Subscription code | ✅ Verified | Stripe webhook + 3 subscription tables |
| Twilio connection code | ✅ Verified | `twilio-adapter.ts` + `sms-gateway.ts` |
| Quota enforcement code | ✅ Verified | `rateLimit.test.ts` (13 tests pass) |

---

## Manual Steps Required (Human Action) 🔄

| Step | Requirements | Status |
|------|--------------|--------|
| Register a new account | Deployed backend, email support | ⏳ Pending |
| Log in | Deployed backend, better-auth configured | ⏳ Pending |
| Create an organization | Live database, user authenticated | ⏳ Pending |
| Invite another user | Live database, org exists | ⏳ Pending |
| Purchase subscription | Stripe test mode, webhook endpoint | ⏳ Pending |
| Connect Twilio account | Valid Twilio credentials | ⏳ Pending |
| Complete 10DLC approval | Twilio Console - A2P registration | ⏳ **BLOCKER** - Regulatory process |
| Send one real SMS | 10DLC approved, valid recipient | ⏳ Pending (blocked by #7) |
| Verify SMS arrival | Check recipient phone | ⏳ Pending (blocked by #8) |
| Verify delivery callback | Twilio webhook configured | ⏳ Pending (blocked by #8) |
| Verify usage/billing | Stripe test transaction | ⏳ Pending (blocked by #5) |
| Verify quota enforcement | Live rate limiting active | ⏳ Pending (blocked by #1) |
| Install on clean Windows machine | Administrator privileges | ⏳ Pending |
| Connect desktop to production backend | Deployed backend URL | ⏳ Pending |
| Repeat core workflow | All above steps complete | ⏳ Pending |

---

## Prerequisites for Manual Testing

1. **Deploy production backend:**
   ```cmd
   cd d:\anything\apps\web
   yarn dev
   ```

2. **Launch desktop locally:**
   ```cmd
   cd d:\anything\apps\desktop
   node dist/main/main.js
   ```

3. **For SMS testing:**
   - Complete Twilio 10DLC registration in Console
   - Configure `PUBLIC_WEBHOOK_URL` (ngrok tunnel)
   - Add verified recipient phone number

4. **For desktop testing on clean machine:**
   - Run as Administrator (for NSIS installer)
   - Or use unpacked build: `apps/desktop/release/win-unpacked/DealFlow AI.exe`

---

## Known Blockers

1. **10DLC Approval** - Required by Twilio for A2P messaging
   - Process takes 1-3 business days
   - Requires business information submission
   - Campaign template approval needed

2. **Administrator Privileges** - Windows NSIS installer
   - winCodeSign creates symlinks requiring admin
   - Workaround: Use unpacked `win-unpacked/DealFlow AI.exe`
# Gate 2 Demo Runbook — Windows

Prerequisites: Free up disk space (need ~2GB free on C:), install Node 20+, enable Corepack.

## 1. Build Windows Installer (dist:win)

```powershell
cd d:\anything
yarn workspace desktop dist:win
```

**Expected output:**
- Installer lands at: `apps/desktop/release/DealFlow AI-1.0.0-x64-Setup.exe`
- Size: ~85-95 MB
- Build time: ~3-5 minutes

**Verify:**
```powershell
dir apps\desktop\release\*.exe
```

---

## 2. Launch Against localhost:4000 with Seeded Approval

### Step 1: Start the web app
```powershell
cd d:\anything
yarn workspace web dev
```
Wait for: `Ready in Xms` on `http://localhost:4000`

### Step 2: Seed an approval in the database
```powershell
# Connect to your Neon test branch and insert a test approval
psql $env:DATABASE_URL -c "INSERT INTO approvals (org_id, lead_id, type, status, created_at) VALUES (1, 1, 'owner_range', 'pending', NOW()) RETURNING id;"
```

### Step 3: Launch the desktop app
```powershell
cd d:\anything\apps\desktop
yarn start
```

**Expected behavior:**
- App window opens pointing to `http://localhost:4000`
- System tray icon appears with DealFlow AI logo

---

## 3. Notification Fire — Log Line to Look For

**Trigger:** The seeded approval should trigger a notification when the app loads.

**Log line in DevTools Console (F12):**
```
[IPC] ShowNotification: { title: 'New Approval Required', body: 'Owner range approval pending for lead #1' }
```

**OS behavior:** Windows notification toast appears in bottom-right corner with the approval message.

**If no notification fires:**
- Check that `NEXT_PUBLIC_CREATE_BASE_URL` and `ANYTHING_PROJECT_TOKEN` are set in `.env`
- Verify the approval exists: `SELECT * FROM approvals WHERE status = 'pending';`

---

## 4. Badge Change Trigger

**Trigger:** Add a second approval to see the badge count update.

```powershell
psql $env:DATABASE_URL -c "INSERT INTO approvals (org_id, lead_id, type, status, created_at) VALUES (1, 2, 'contract', 'pending', NOW());"
```

**Expected behavior:**
- System tray tooltip changes from "DealFlow AI" to "DealFlow AI — 2 approvals pending"
- Badge count on taskbar icon shows "2" (Windows 10/11)

**Log line in DevTools Console:**
```
[IPC] UpdateBadge: { count: 2 }
```

---

## 5. Two-Instance Test (Single-Instance Lock)

**Step 1:** With the first instance running, open a new PowerShell window:
```powershell
cd d:\anything\apps\desktop
yarn start
```

**Expected behavior:**
- Second instance exits immediately (no new window)
- First instance window comes to focus
- DevTools Console in first instance shows:
```
[main] second-instance triggered — focusing existing window
```

**Verify single-instance lock:**
```powershell
# Check that only one electron process is running
Get-Process | Where-Object { $_.ProcessName -like '*electron*' } | Select-Object Id, ProcessName
```
Should show only one electron process.

---

## 6. Lighthouse Audit

### Prerequisites
```powershell
# Install Lighthouse CLI globally
npm install -g lighthouse
```

### Run on /home
```powershell
# Start the web app in production mode
cd d:\anything
yarn workspace web build
yarn workspace web start

# In another window, run Lighthouse
lighthouse http://localhost:4000 --output=json --output-path=lighthouse-home.json --chrome-flags="--headless"
```

### Run on /pricing
```powershell
lighthouse http://localhost:4000/pricing --output=json --output-path=lighthouse-pricing.json --chrome-flags="--headless"
```

**Expected scores:**
- SEO: ≥95
- Accessibility: ≥90
- Best Practices: ≥90
- Performance: reported (target ≥70)

**View results:**
```powershell
# Open the JSON reports
code lighthouse-home.json
code lighthouse-pricing.json
```

---

## 7. Marketing Playwright Spec

### Prerequisites
```powershell
cd d:\anything\apps\web
yarn add -D @playwright/test@1.61.1
yarn playwright install --with-deps chromium
```

### Run the marketing spec
```powershell
cd d:\anything\apps\web
yarn playwright test e2e/marketing.spec.ts
```

**Expected output:**
```
✓ e2e/marketing.spec.ts (X tests)
  ✓ homepage loads with correct title
  ✓ pricing page shows 3 tiers
  ✓ features page lists all features
  ...
```

**If tests fail:**
- Check that the web app is running: `curl http://localhost:4000`
- Verify marketing routes exist: `dir apps\web\src\app\(marketing)`

---

## Troubleshooting

### Disk full errors (ENOSPC)
```powershell
# Clean up yarn cache
yarn cache clean

# Clean up electron-builder cache
Remove-Item -Recurse -Force $env:LOCALAPPDATA\electron-builder\Cache
```

### Port 4000 already in use
```powershell
# Find and kill the process
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

### Playwright chromium download fails
```powershell
# Set proxy if behind corporate firewall
$env:HTTPS_PROXY = "http://your-proxy:8080"
yarn playwright install chromium
```

### Desktop app won't start
```powershell
# Rebuild the app
cd d:\anything\apps\desktop
yarn build
yarn start
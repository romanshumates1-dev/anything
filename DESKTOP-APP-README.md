# DealFlow AI Desktop Application

## Installation

**Windows Installer:** `DealFlow-AI-Setup.exe` (79 MB)

Double-click to install. The app will be installed to your user directory.

---

## Pipeline Operations (Built-in)

The desktop app includes all pipeline operations from the web system:

| Operation | Description | Command |
|-----------|-------------|---------|
| **Daily Operations** | Run daily campaign batch | `window.pipeline.dailyOps(config)` |
| **Autonomous Operator** | Auto-run until target appointments | `window.pipeline.autonomous(config)` |
| **Conversion Engine** | Generate conversion action plan | `window.pipeline.conversion(config)` |
| **Deal Finalization** | Push deals to close | `window.pipeline.deals(config)` |
| **Pipeline Force** | Force all leads to progress | `window.pipeline.force(config)` |
| **Conversation Audit** | Audit all active conversations | `window.pipeline.audit(config)` |
| **MVP Validation** | Run full E2E validation | `window.pipeline.validate(config)` |
| **Follow-ups** | Execute follow-up emails | `window.pipeline.followups(config, count)` |
| **Production Warmup** | Run warmup email batch | `window.pipeline.warmup(config, count)` |

---

## Configuration

Set up your credentials in the app or via environment:

```javascript
const config = {
  smtpUser: 'your-email@gmail.com',
  smtpPass: 'your-app-password',
  databaseUrl: 'postgresql://...',
  testEmail: 'your-email@gmail.com'
};
```

---

## Using Pipeline Operations

### From DevTools Console (F12)

```javascript
// Run daily operations
const config = {
  smtpUser: 'romanshumates1@gmail.com',
  smtpPass: 'your-app-password',
  databaseUrl: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  testEmail: 'romanshumates1@gmail.com'
};

// Daily ops
await window.pipeline.dailyOps(config);

// Autonomous operator (targets 10-30 appointments)
await window.pipeline.autonomous(config);

// Conversion engine
await window.pipeline.conversion(config);

// Force pipeline progression
await window.pipeline.force(config);
```

### Listen to Output

```javascript
// Listen to real-time output
window.pipeline.onOutput(({ text, type }) => {
  console.log(`[${type}] ${text}`);
});

// Listen to completion
window.pipeline.onComplete(({ script, success, output }) => {
  console.log(`${script} completed: ${success ? 'SUCCESS' : 'FAILED'}`);
});
```

---

## File Locations

| File | Location |
|------|----------|
| **Installer (x64)** | `D:\anything\DealFlow-AI-Setup.exe` |
| **Installer (ARM64)** | `apps\desktop\release\DealFlow AI-1.0.1-arm64-Setup.exe` |
| **Unpacked (x64)** | `apps\desktop\release\win-unpacked\` |
| **Web Scripts** | `apps\web\scripts\` |

---

## Available Scripts

All web scripts are accessible from the desktop app:

- `daily-operations.mjs` - Daily send batch
- `autonomous-operator.mjs` - Auto appointment generator
- `conversion-engine.mjs` - Conversion action planner
- `deal-finalization-engine.mjs` - Deal closer
- `pipeline-force-action.mjs` - Force progression
- `conversation-audit.mjs` - Conversation analyzer
- `mvp-e2e-validation.mjs` - System validation
- `scale-architecture-audit.mjs` - Scale readiness
- `execute-followups.mjs` - Follow-up sender
- `production-warmup.mjs` - Warmup sender

---

## Build from Source

```bash
cd apps/desktop
npm install
npm run dist:win   # Windows
npm run dist:mac   # macOS
npm run dist:linux # Linux
```

---

## Version

- **App Version:** 1.0.1
- **Electron:** 33.3.0
- **Node:** Built-in

---

Built: 2026-07-31

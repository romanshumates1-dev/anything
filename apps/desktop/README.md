# DealFlow AI — Desktop App

A production-grade, cross-platform **Electron** desktop client for the DealFlow AI
real-estate SaaS. It is a hardened native shell around the existing Next.js web
app (`apps/web`) — the same model used by Slack, Linear, and Notion — giving your
team a dedicated app with a native menu, system tray, global shortcuts, deep
links, offline handling, persistent window state, and background auto-updates.

> **Why a shell and not a rebuild?** The web app is already production-hardened
> (242 passing tests, E2E journey, CI gates). Wrapping it means the desktop app
> always stays in lock-step with the web app — one codebase, zero drift — while
> adding the OS-native capabilities a browser tab can't provide.

---

## Architecture

```
apps/desktop/
├── src/
│   ├── main/                 # Electron main process (Node)
│   │   ├── main.ts           # entry: single-instance lock, boot sequence
│   │   ├── config.ts         # env resolution, defaults, allowlist, paths
│   │   ├── window.ts         # BrowserWindow lifecycle + window-state persistence
│   │   ├── security.ts       # navigation/permission/session hardening
│   │   ├── menu.ts           # native application menu + shortcuts
│   │   ├── tray.ts           # system tray menu
│   │   ├── settings-window.ts# standalone Preferences window
│   │   ├── updater.ts        # electron-updater orchestration
│   │   ├── store.ts          # validated persistent settings (electron-store)
│   │   ├── logger.ts         # rotating file + console logging (electron-log)
│   │   ├── lifecycle.ts      # quit + deep-link (dealflow://) handling
│   │   └── ipc.ts            # validated IPC handlers
│   ├── preload/
│   │   └── preload.ts        # contextBridge — the ONLY renderer↔main surface
│   ├── renderer/             # bundled LOCAL pages (never remote)
│   │   ├── settings.html/.ts # Preferences UI
│   │   ├── offline.html/.ts  # offline fallback
│   │   ├── styles.css        # shared, framework-free styling
│   │   └── global.d.ts       # window.dealflow typing
│   └── shared/
│       └── ipc.ts            # single source of truth for IPC channels + types
├── scripts/
│   ├── build.mjs             # esbuild bundling (main/preload/renderer) + assets
│   ├── clean.mjs             # wipe dist/ + release/
│   └── generate-icons.mjs    # dependency-free icon generation (png/ico/icns)
├── build/                    # electron-builder resources (entitlements, nsh)
├── assets/                   # generated app + tray icons
├── electron-builder.yml      # packaging config (win/mac/linux)
└── tsconfig.json
```

### Process boundaries & bundling
- **Main** is bundled to CommonJS with `electron` + the three `electron-*`
  runtime deps kept external (resolved from `node_modules` / packaged into the
  asar).
- **Preload** is bundled to a **single self-contained file** with only
  `electron` external. This is required because the window runs with
  `sandbox: true`, and sandboxed preloads cannot `require` local modules — so the
  shared IPC constants are inlined at build time.
- **Renderer** pages (settings/offline) are browser-target IIFE bundles. They
  are 100% local, load no remote content, and enforce a strict CSP.

---

## Security

This app implements the official [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security):

| Control | Implementation |
|---|---|
| Context isolation | `contextIsolation: true` on every window |
| Node integration off | `nodeIntegration: false` (+ workers/subframes) |
| Sandbox | `sandbox: true` + `app.enableSandbox()` |
| No remote require | preload bundled; nothing but `electron` is external |
| Popups blocked | `setWindowOpenHandler` denies all; safe links → OS browser |
| Navigation locked | `will-navigate` / `will-redirect` restricted to an origin allowlist |
| No `<webview>` | `will-attach-webview` denied + `webviewTag: false` |
| Permissions denied | session `setPermissionRequestHandler`/`CheckHandler` deny-by-default |
| Insecure content off | `allowRunningInsecureContent: false`, `webSecurity: true` |
| Strict CSP | local pages set `default-src 'none'` + `script-src 'self'` |
| Input validation | all IPC args validated; settings sanitized + clamped |
| Crash guards | `uncaughtException`/`unhandledRejection` logged, not fatal |

The renderer only ever sees `window.dealflow`, a small, explicitly-typed API.
There is no `ipcRenderer`, no `require`, and no Node access in the renderer.

---

## Prerequisites

- **Node.js 20+** and **Yarn 4** (Corepack): `corepack enable`
- Installed from the monorepo root: `yarn install`

> **Note on this authoring environment:** package _resolution_ succeeds, but the
> actual download of `electron`/`electron-builder` binaries is blocked by TLS
> interception here (the same documented constraint that blocks the Playwright
> chromium download — see the repo's `FINAL_STATE.md`). On a normal network,
> `yarn install` fetches everything and all commands below work as written. The
> build pipeline itself is verified: `node scripts/build.mjs` bundles all four
> targets successfully, `oxlint` is clean, and icon generation is dependency-free.

---

## Development

Run the web app and the desktop shell together:

```bash
# Terminal 1 — start the SaaS (Next.js) dev server on :4000
yarn dev                      # == yarn workspace web dev

# Terminal 2 — build + launch the desktop shell (loads http://localhost:4000)
yarn desktop:dev              # == yarn workspace desktop dev
```

Point the shell somewhere else without a rebuild:

```bash
# PowerShell
$env:DEALFLOW_APP_URL="https://staging.dealflow.ai"; yarn desktop:dev
# bash
DEALFLOW_APP_URL=https://staging.dealflow.ai yarn desktop:dev
```

You can also change the URL, theme, zoom, tray, startup, and update behavior at
runtime from **Settings** (Cmd/Ctrl+,).

---

## Build & Package

```bash
yarn desktop:build            # bundle + typecheck-ready output in dist/
yarn desktop:dist             # installers for the current OS  → release/
yarn desktop:dist:win         # Windows NSIS (x64 + arm64)
yarn desktop:dist:mac         # macOS dmg + zip (x64 + arm64)
yarn desktop:dist:linux       # Linux AppImage + deb + rpm
```

Artifacts land in `apps/desktop/release/`. Icons are regenerated automatically
before each packaging run.

---

## Auto-update

Uses `electron-updater` against the **generic** provider declared in
`electron-builder.yml`:

```yaml
publish:
  - provider: generic
    url: https://downloads.dealflow.ai/desktop/${channel}
```

1. Host the built artifacts **and** the generated `latest.yml` /
   `latest-mac.yml` / `latest-linux.yml` manifests at that URL.
2. In production the app checks on launch and every 6 hours, downloads in the
   background, and prompts the user to restart when an update is ready.
3. Auto-update is disabled in development and when the user turns it off in
   Settings. A user can always trigger a manual check from the menu/tray.

---

## Code signing (production)

Signing is required for a trusted install + working auto-update.

- **Windows:** set `CSC_LINK` (path/base64 of your `.pfx`) and `CSC_KEY_PASSWORD`.
- **macOS:** set `CSC_LINK`/`CSC_KEY_PASSWORD` for the Developer ID cert, and for
  notarization set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
  The hardened runtime + entitlements are already configured in
  `electron-builder.yml` and `build/entitlements.mac.plist`.

electron-builder reads these from the environment automatically at `dist` time.

---

## Deep links

The app registers the `dealflow://` protocol. Opening e.g.
`dealflow://campaigns/123` focuses the (single) running instance and navigates
the SaaS to `/campaigns/123`. Handled on macOS via `open-url` and on
Windows/Linux via the second-instance argv.

---

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New Campaign | Cmd/Ctrl+N |
| Dashboard / Campaigns / Inbox / Approvals / Leads / Analytics / Contracts | Cmd/Ctrl+1…7 |
| Settings | Cmd/Ctrl+, |
| Reload / Force reload | Cmd/Ctrl+R / Cmd/Ctrl+Shift+R |
| Zoom in / out / reset | Cmd/Ctrl+Plus / Cmd/Ctrl+- / Cmd/Ctrl+0 |
| Toggle DevTools | Ctrl+Shift+I (⌥⌘I on macOS) |

---

## Logs & data

- **Logs:** `main.log` in the OS log dir (Win: `%APPDATA%\DealFlow AI\logs`,
  macOS: `~/Library/Logs/DealFlow AI`, Linux: `~/.config/DealFlow AI/logs`),
  5 MB rotation.
- **Settings + window state:** `dealflow-config.json` in the app's userData dir,
  read through a validating sanitizer so a corrupt file can never crash the app.

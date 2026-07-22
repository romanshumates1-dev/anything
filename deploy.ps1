# ─────────────────────────────────────────────────────────────────────────────
# DealFlow AI — one-command PROD-LOCAL deploy (v6 §4a). Idempotent, safe re-run.
#   .\deploy.ps1               auto: docker if the engine responds, else node
#   .\deploy.ps1 -Mode node    force node + worker processes (no Docker)
#   .\deploy.ps1 -Mode docker  force compose prod profile
#
# Steps: build → migrate → start → poll /api/system/health until green (fail
# RED + exit 1, never open a broken tab) → open browser. Prints WHICH path ran.
# ─────────────────────────────────────────────────────────────────────────────
param(
  [ValidateSet('auto', 'docker', 'node')] [string]$Mode = 'auto',
  [int]$HealthTimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$webDir = Join-Path $root 'apps\web'
$port   = 4000
$base   = "http://localhost:$port"

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Fail($m) { Say ''; Say "  X $m" 'Red'; exit 1 }

# ── resolve mode ─────────────────────────────────────────────────────────────
$dockerOk = $false
try { docker info 2>$null | Out-Null; $dockerOk = ($LASTEXITCODE -eq 0) } catch {}
if ($Mode -eq 'auto') { $Mode = if ($dockerOk) { 'docker' } else { 'node' } }
if ($Mode -eq 'docker' -and -not $dockerOk) { Fail 'Docker requested but the engine is not responding (start Docker Desktop or use -Mode node).' }

Say ''
Say '  DealFlow AI - prod-local deploy' 'Cyan'
Say "  mode: $Mode" 'Yellow'

if (-not (Test-Path (Join-Path $webDir '.env'))) { Fail "apps/web/.env missing - copy .env.example and fill DATABASE_URL etc." }

# ── migrate (idempotent; same runner CI and DEPLOY.md use) ───────────────────
Say '  > migrate (idempotent)...' 'Yellow'
Push-Location $webDir
& cmd.exe /c 'node --env-file=.env scripts\migrate.mjs'
$mig = $LASTEXITCODE
Pop-Location
if ($mig -ne 0) { Fail "migrations failed (exit $mig)" }

if ($Mode -eq 'docker') {
  # ── docker path: build via compose, start prod profile ─────────────────────
  Say '  > docker compose build (first run can take several minutes)...' 'Yellow'
  & docker compose --profile prod build
  if ($LASTEXITCODE -ne 0) { Fail "docker build failed (exit $LASTEXITCODE)" }
  Say '  > docker compose --profile prod up -d ...' 'Yellow'
  & docker compose --profile prod up -d
  if ($LASTEXITCODE -ne 0) { Fail "compose up failed (exit $LASTEXITCODE)" }
} else {
  # ── node path: next build + next start + worker.mjs, detached ──────────────
  # Idempotent: kill any prior prod processes on the port first.
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {} }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'next start|worker\.mjs' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  Start-Sleep -Seconds 1

  Say '  > next build (production)...' 'Yellow'
  Push-Location $webDir
  & cmd.exe /c 'yarn build'
  $b = $LASTEXITCODE
  Pop-Location
  if ($b -ne 0) { Fail "next build failed (exit $b)" }

  Say '  > checking client bundle for leaked secrets...' 'Yellow'
  Push-Location $webDir
  & cmd.exe /c 'node --env-file=.env scripts\check-secrets-in-bundle.mjs'
  $sec = $LASTEXITCODE
  Pop-Location
  if ($sec -ne 0) { Fail 'secrets-in-bundle check failed - a secret value or secret-shaped literal was found in the client bundle (see output above). Never opening a broken/leaking build.' }

  Say '  > starting next start (:4000) + worker...' 'Yellow'
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'yarn start' -WorkingDirectory $webDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $webDir 'prod-app.log') -RedirectStandardError (Join-Path $webDir 'prod-app.err.log')
  # worker polls the app URL; APP_URL localhost since both run on this host
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "set APP_URL=$base&& node --env-file=.env scripts\worker.mjs" -WorkingDirectory $webDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $webDir 'prod-worker.log') -RedirectStandardError (Join-Path $webDir 'prod-worker.err.log')
}

# ── health gate: never open a broken tab ─────────────────────────────────────
Say "  > waiting for $base/api/system/health (up to ${HealthTimeoutSec}s)..." 'Yellow'
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-RestMethod -Uri "$base/api/system/health" -TimeoutSec 5 -ErrorAction Stop
    if ($r.ok -eq $true) { $healthy = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 2000
  Write-Host '.' -NoNewline -ForegroundColor DarkGray
}
Write-Host ''

if (-not $healthy) {
  Say '  X health check FAILED - not opening a broken tab.' 'Red'
  if ($Mode -eq 'docker') { & docker compose --profile prod logs --tail 20 }
  else { Get-Content (Join-Path $webDir 'prod-app.log') -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say "     $_" 'DarkGray' } }
  Fail 'deploy did not become healthy'
}

Say "  + HEALTHY ($Mode path)" 'Green'
Start-Process $base
Say "  + opened $base" 'Green'
Say ''

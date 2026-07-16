# ─────────────────────────────────────────────────────────────────────────────
# DealFlow AI — one-command local launch (MVP v2, P1)
#   .\launch.ps1        (or double-click launch.bat)
#   .\launch.ps1 -Clean (force a cold rebuild)
#
# Boots the full local dev stack, health-checks it, and only then opens the
# browser. NEVER opens a broken tab: if /api/system/health doesn't report
# ok:true it prints the failing service in red, tails the log, and exits 1.
#
# Stack note: there is NO local Redis/Postgres to boot — Postgres is Neon
# (cloud) and the job queue is the Postgres `jobs` table. "Workers" = the
# jobs-dev drain loop (polls /api/jobs/process every 3s).
#
# Two hard-won behaviours, both from observed failures (not theory):
#  1. yarn on Windows is a .cmd shim — Start-Process cannot exec it directly
#     ("%1 is not a valid Win32 application"), so children go via cmd.exe /c.
#  2. A stale/poisoned .next manifest makes routes 404 (Turbopack writes a
#     corrupt .next/dev/types/routes.d.ts if files change under a live server).
#     Observed: /api/system/health 404 -> not-found page. So on a failed health
#     check we clear .next and retry ONCE before declaring failure.
#
# Timeout note (deliberate deviation from the spec's 15s): Next 16 + Turbopack
# cold-compiles in ~20-40s here; 15s would fail spuriously. Intent kept — fail
# loudly, never open a broken tab.
# ─────────────────────────────────────────────────────────────────────────────
param([switch]$Clean)

$ErrorActionPreference = 'Stop'
$root    = $PSScriptRoot
$webDir  = Join-Path $root 'apps\web'
$nextDir = Join-Path $webDir '.next'
$port    = 4000
$baseUrl = "http://localhost:$port"
$devLog  = Join-Path $webDir 'dev-launch.log'
$jobsLog = Join-Path $webDir 'jobs-launch.log'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say ""; Say "  X $msg" 'Red'; Say ""; exit 1 }

function Stop-Stack {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      try { Stop-Process -Id $_ -Force -ErrorAction Stop } catch {}
    }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'next|corepack.*dev|jobs-dev|postcss' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  Start-Sleep -Seconds 2
}

function Start-Stack {
  $env:YARN_TMP_FOLDER = $null
  $env:ELECTRON_RUN_AS_NODE = $null
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','yarn dev' -WorkingDirectory $webDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError "$devLog.err"
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','node --env-file=.env scripts/jobs-dev.mjs' -WorkingDirectory $webDir -WindowStyle Hidden `
    -RedirectStandardOutput $jobsLog -RedirectStandardError "$jobsLog.err"
}

function Wait-Healthy([int]$sec) {
  $deadline = (Get-Date).AddSeconds($sec)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri "$baseUrl/api/system/health" -TimeoutSec 5 -ErrorAction Stop
      $last = $r
      if ($r.ok -eq $true) { Write-Host ""; return $r }
    } catch { }
    Start-Sleep -Milliseconds 1500
    Write-Host "." -NoNewline -ForegroundColor DarkGray
  }
  Write-Host ""
  return $last
}

Say ""
Say "  DealFlow AI - local launch" 'Cyan'
Say "  ---------------------------" 'DarkGray'

Stop-Stack
if ($Clean -and (Test-Path $nextDir)) {
  Say "  > -Clean: removing .next" 'Yellow'
  Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Say "  > installing dependencies (first run, takes a minute)..." 'Yellow'
  Push-Location $root; & cmd.exe /c 'yarn install'; $code = $LASTEXITCODE; Pop-Location
  if ($code -ne 0) { Fail "yarn install failed (exit $code)" }
  Say "  + dependencies installed" 'Green'
}

Say "  > starting web (:$port) + jobs worker..." 'Yellow'
Start-Stack
# 180s, not 90s: MEASURED — a cold Turbopack build of this app lands between
# 90s and 150s here. At 90s the readiness loop timed out on a perfectly healthy
# cold build and fell into the self-heal, which rebuilt from scratch AGAIN
# (~4min total). The clear-and-retry below is for a POISONED manifest, not for
# "the build is simply still running".
Say "  > waiting for /api/system/health (up to 180s; cold build ~2min)..." 'Yellow'
$health = Wait-Healthy 180

# Self-heal the known poisoned-manifest failure, then retry once.
if (-not $health -or $health.ok -ne $true) {
  Say "  ~ unhealthy - clearing a possibly-stale .next manifest and retrying once" 'Yellow'
  Stop-Stack
  if (Test-Path $nextDir) { Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue }
  Start-Stack
  Say "  > rebuilding + waiting (up to 150s)..." 'Yellow'
  $health = Wait-Healthy 150
}

if (-not $health -or $health.ok -ne $true) {
  Say "  X health check FAILED - not opening a broken tab." 'Red'
  if ($health -and $health.services) {
    foreach ($k in $health.services.PSObject.Properties.Name) {
      $v = $health.services.$k
      Say ("     {0,-6} {1}" -f $k, $(if ($v) { 'ok' } else { 'FAILING' })) $(if ($v) { 'Green' } else { 'Red' })
    }
  }
  Say "  --- last lines of $devLog ---" 'DarkGray'
  if (Test-Path $devLog) { Get-Content $devLog -Tail 12 | ForEach-Object { Say "     $_" 'DarkGray' } }
  Fail "stack did not become healthy"
}

# ── Status table ─────────────────────────────────────────────────────────────
# Liveness comes from the PUBLIC health probe ({ok, services} — zero config).
# Drivers + beta flags are CONFIG, so they are NOT published there; this local
# dev-only reader pulls them straight from .env + the DB on this machine.
$cfg = @{}
try {
  Push-Location (Join-Path $PSScriptRoot 'apps/web')
  $lines = & cmd.exe /c "node --env-file=.env scripts/launch-status.mjs" 2>$null
  Pop-Location
  foreach ($line in $lines) {
    if ($line -match '^\s*([^=]+)=(.*)$') { $cfg[$Matches[1].Trim()] = $Matches[2].Trim() }
  }
} catch { }

Say ""
Say "  SERVICE   STATUS   DRIVER" 'Cyan'
Say "  -------   ------   ------" 'DarkGray'
foreach ($k in $health.services.PSObject.Properties.Name) {
  $v = $health.services.$k
  $d = '-'
  if ($k -eq 'ai')  { $d = $(if ($cfg['ai'])  { $cfg['ai'] }  else { '?' }) }
  if ($k -eq 'sms') { $d = $(if ($cfg['sms']) { $cfg['sms'] } else { '?' }) }
  Say ("  {0,-9} {1,-8} {2}" -f $k, $(if ($v) { 'ok' } else { 'down' }), $d) $(if ($v) { 'Green' } else { 'Yellow' })
}
Say ""
Say "  BETA FLAGS" 'Cyan'
Say "  ----------" 'DarkGray'
$flagKeys = @($cfg.Keys | Where-Object { $_ -like 'flag.*' } | Sort-Object)
if ($flagKeys.Count -gt 0) {
  foreach ($fk in $flagKeys) {
    $name = $fk -replace '^flag\.', ''
    $on = ($cfg[$fk] -eq 'on')
    Say ("  {0,-18} {1}" -f $name, $(if ($on) { 'ON' } else { 'off' })) $(if ($on) { 'Green' } else { 'DarkGray' })
  }
} else {
  Say "  (status reader unavailable - flags visible in Settings -> Beta Integrations)" 'DarkGray'
}
Say ""
Say "  web    $baseUrl" 'Green'
Say "  logs   $devLog / $jobsLog" 'DarkGray'
Say ""

Start-Process $baseUrl
Say "  + opened $baseUrl" 'Green'
Say ""

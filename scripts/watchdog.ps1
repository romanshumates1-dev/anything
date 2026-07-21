# ─────────────────────────────────────────────────────────────────────────────
# DealFlow AI — host watchdog (v6 P3b-ii). Runs OUTSIDE the app process, so it
# catches app-process death that the in-app deadman cannot see.
#
#   .\scripts\watchdog.ps1              one check (wire to a Scheduled Task)
#   .\scripts\watchdog.ps1 -IntervalSec 60   loop mode
#
# On health failure: ONE alert per outage window (state file dedupe) — a direct
# Twilio REST call when creds exist (mock-safe: without creds it logs the alert
# it WOULD send). On recovery: one "restored" notice, state cleared.
#
# Scheduled Task template (run once as the owner):
#   schtasks /Create /TN "DealFlowWatchdog" /SC MINUTE /MO 2 ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File D:\anything\scripts\watchdog.ps1" /F
#
# HONEST LIMITATION (documented in DEPLOY.md): a fully-off machine cannot report
# itself. This watchdog covers app-process death while the OS is up; a free
# external monitor (UptimeRobot / GH Actions schedule) is the only true deadman.
# ─────────────────────────────────────────────────────────────────────────────
param(
  [string]$HealthUrl = 'http://localhost:4000/api/system/health',
  [int]$IntervalSec = 0,           # 0 = single check (Scheduled Task mode)
  [string]$StateFile = "$env:TEMP\dealflow-watchdog-state.txt"
)

$ErrorActionPreference = 'SilentlyContinue'

function Send-OwnerAlert([string]$Body) {
  # Env-only creds (never hardcoded). Reads apps/web/.env when process env is empty.
  $envFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'apps\web\.env'
  $get = {
    param($name)
    $v = [Environment]::GetEnvironmentVariable($name)
    if (-not $v -and (Test-Path $envFile)) {
      $line = Select-String -Path $envFile -Pattern "^$name=" | Select-Object -First 1
      if ($line) { $v = ($line.Line -split '=', 2)[1].Trim('"') }
    }
    $v
  }
  $sid  = & $get 'TWILIO_ACCOUNT_SID'
  $tok  = & $get 'TWILIO_AUTH_TOKEN'
  $from = & $get 'TWILIO_FROM_NUMBER'
  $to   = & $get 'OWNER_NUMBER'

  if ($sid -and $tok -and $from -and $to) {
    # Direct REST call — no app dependency (the app may be the thing that died).
    $pair  = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${sid}:${tok}"))
    try {
      Invoke-RestMethod -Method Post `
        -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json" `
        -Headers @{ Authorization = "Basic $pair" } `
        -Body @{ To = $to; From = $from; Body = $Body } | Out-Null
      Write-Host "[watchdog] SMS alert sent to owner."
    } catch {
      Write-Host "[watchdog] Twilio call failed: $($_.Exception.Message) — alert body was: $Body"
    }
  } else {
    # Mock-safe: no creds -> log what WOULD have been sent (verifiable in tests).
    Write-Host "[watchdog] (mock) WOULD SEND owner SMS: $Body"
  }
}

function Invoke-Check {
  $ok = $false
  try {
    $r = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 8
    if ($r.ok -eq $true) { $ok = $true }
  } catch {}

  $wasDown = Test-Path $StateFile

  if (-not $ok -and -not $wasDown) {
    # New outage window: alert ONCE, mark state.
    "down since $(Get-Date -Format o)" | Out-File $StateFile -Encoding utf8
    Send-OwnerAlert "DealFlow ALERT: app health check FAILED at $(Get-Date -Format 'HH:mm'). $HealthUrl unreachable or degraded."
    Write-Host "[watchdog] DOWN -> alerted (state recorded)."
  } elseif (-not $ok -and $wasDown) {
    Write-Host "[watchdog] still down (already alerted this outage — no repeat)."
  } elseif ($ok -and $wasDown) {
    Remove-Item $StateFile -Force
    Send-OwnerAlert "DealFlow RESTORED: app healthy again at $(Get-Date -Format 'HH:mm')."
    Write-Host "[watchdog] RESTORED -> recovery notice sent, state cleared."
  } else {
    Write-Host "[watchdog] healthy."
  }
}

if ($IntervalSec -gt 0) {
  Write-Host "[watchdog] loop mode every ${IntervalSec}s against $HealthUrl"
  while ($true) { Invoke-Check; Start-Sleep -Seconds $IntervalSec }
} else {
  Invoke-Check
}

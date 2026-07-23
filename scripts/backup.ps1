# backup.ps1 — PostgreSQL backup with retention (Windows PowerShell)
#
# Usage: .\scripts\backup.ps1 [-Days 30]
# Creates a pg_dump of the DATABASE_URL and stores it in backups/ with retention.
# Requires DATABASE_URL to be set in the environment or .env file.

param(
    [int]$Days = 30
)

$ErrorActionPreference = 'Stop'

# Load environment variables from .env if exists
$envFile = Join-Path $PSScriptRoot "..\apps\web\.env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    foreach ($line in $envContent) {
        if ($line -match '^([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
    Write-Error "DATABASE_URL is not set. Please configure it in apps/web/.env"
    exit 1
}

# Parse connection string
if ($databaseUrl -match 'postgresql://([^:]+):([^@]+)@([^/]+)/(.+)') {
    $dbUser = $matches[1]
    $dbPass = $matches[2]
    $dbHost = $matches[3]
    $dbName = $matches[4]
} else {
    Write-Error "Failed to parse DATABASE_URL"
    exit 1
}

# Create backups directory
$backupDir = Join-Path $PSScriptRoot "..\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

# Generate backup filename with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$filename = "dealflow_backup_$timestamp.sql"
$filepath = Join-Path $backupDir $filename

Write-Host "[backup] Creating backup of $dbName..."

# Run pg_dump
$env:PGPASSWORD = $dbPass
& pg_dump -h $dbHost -U $dbUser -d $dbName -f $filepath -Fc

if ($LASTEXITCODE -eq 0) {
    $size = (Get-Item $filepath).Length
    Write-Host "[backup] Created $filename ($([math]::Round($size/1MB, 2)) MB)"
} else {
    Write-Error "pg_dump failed with exit code $LASTEXITCODE"
    exit 1
}

# Apply retention
Write-Host "[backup] Applying $Days-day retention..."
$cutoffDate = (Get-Date).AddDays(-$Days)
Get-ChildItem $backupDir -Filter "*.sql" | Where-Object { $_.CreationTime -lt $cutoffDate } | Remove-Item
$retainedCount = (Get-ChildItem $backupDir -Filter "*.sql").Count
Write-Host "[backup] Retained $retainedCount backup(s)"

# Clear password from environment
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

Write-Host "[backup] Done"
# restore.ps1 — PostgreSQL restore with confirmation (Windows PowerShell)
#
# Usage: .\scripts\restore.ps1 -File "backups\dealflow_backup_20260718_123456.sql" [-Force]
# Restores a pg_dump backup to the DATABASE_URL. Requires confirmation by default.
# Warning: This will CLEAR all existing data!

param(
    [Parameter(Mandatory=$true)]
    [string]$File,

    [switch]$Force
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

# Resolve backup file path
$backupPath = $File
if (-not (Test-Path $backupPath)) {
    $backupPath = Join-Path $PSScriptRoot "..\backups\$File"
}

if (-not (Test-Path $backupPath)) {
    Write-Error "Backup file not found: $File"
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

Write-Host "[restore] Backup file: $backupPath"
Write-Host "[restore] Target database: $dbName"
Write-Host "[restore] WARNING: This will CLEAR all existing data in the database!"

# Ask for confirmation unless -Force is specified
if (-not $Force) {
    $confirmation = Read-Host "Type 'YES' to confirm restore (or press Ctrl+C to cancel)"
    if ($confirmation -ne 'YES') {
        Write-Host "[restore] Cancelled"
        exit 0
    }
}

# Drop and recreate database to ensure clean state
Write-Host "[restore] Dropping existing database..."
$env:PGPASSWORD = $dbPass
& psql -h $dbHost -U $dbUser -d "postgres" -c "DROP DATABASE IF EXISTS $dbName"
& psql -h $dbHost -U $dbUser -d "postgres" -c "CREATE DATABASE $dbName"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to prepare database"
    exit 1
}

# Restore from backup
Write-Host "[restore] Restoring backup..."
& pg_restore -h $dbHost -U $dbUser -d $dbName -Fc $backupPath

if ($LASTEXITCODE -eq 0) {
    Write-Host "[restore] Restore completed successfully"
} else {
    Write-Error "pg_restore failed with exit code $LASTEXITCODE"
    exit 1
}

# Clear password from environment
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

Write-Host "[restore] Done"
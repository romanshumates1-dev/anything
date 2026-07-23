# deploy.ps1 — One-command deploy for DealFlow AI
#
# Usage: .\scripts\deploy.ps1
# Runs typecheck, builds the web app, and deploys to the configured platform.
# Set VERCEL_TOKEN in the environment for automated Vercel deployment.

$ErrorActionPreference = 'Stop'

# Step 1: Load environment
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

Write-Host "[deploy] Starting deploy..."

# Step 2: Typecheck
Write-Host "[deploy] Running typecheck..."
Push-Location $PSScriptRoot
try {
    $output = & yarn workspace web typecheck 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Typecheck failed"
        exit 1
    }
    Write-Host "[deploy] Typecheck passed"
} finally {
    Pop-Location
}

# Step 3: Build web app
Write-Host "[deploy] Building web app..."
& yarn workspace web build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed"
    exit 1
}
Write-Host "[deploy] Build succeeded"

# Step 4: Deploy to Vercel (if token is set)
if ($env:VERCEL_TOKEN) {
    Write-Host "[deploy] Deploying to Vercel..."
    $envCmd = "VERCEL_TOKEN=$($env:VERCEL_TOKEN)"
    & cmd /c "$envCmd && cd apps/web && vercel --prod --confirm"

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Vercel deploy failed"
        exit 1
    }
    Write-Host "[deploy] Vercel deploy succeeded"
} else {
    Write-Host "[deploy] No VERCEL_TOKEN — skipping Vercel deploy. Run 'vercel --prod' manually in apps/web"
}

# Step 5: Build desktop (optional)
if ($env:BUILD_DESKTOP -eq '1') {
    Write-Host "[deploy] Building desktop..."
    & yarn workspace desktop build

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Desktop build failed"
        exit 1
    }
    Write-Host "[deploy] Desktop build succeeded"
    Write-Host "[deploy] Check apps/desktop/release/ for the installer"
}

Write-Host "[deploy] Deploy complete!"
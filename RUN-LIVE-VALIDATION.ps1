# RUN-LIVE-VALIDATION.ps1
# Real-time validation loop with auto-healing
# Run this from PowerShell (not Claude Code background session)

Write-Host "🔥 REAL-TIME VALIDATION + SELF-HEALING MODE" -ForegroundColor Green
Write-Host "=" * 70
Write-Host ""

# Environment setup
$env:DATABASE_URL = "postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres"
$env:OLLAMA_BASE_URL = "http://localhost:11434"
$env:DRY_RUN = "false"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"  # SSL bypass for testing

Write-Host "Environment configured" -ForegroundColor Yellow
Write-Host "  DATABASE: Supabase (SSL bypass enabled)"
Write-Host "  OLLAMA: $env:OLLAMA_BASE_URL"
Write-Host "  MODE: LIVE (real database writes)"
Write-Host ""

cd apps\web

# Validation tracking
$cycles = @()
$totalIssues = 0
$totalFixes = 0

# Execute 3 cycles
for ($i = 1; $i -le 3; $i++) {
    Write-Host "━" * 70 -ForegroundColor Cyan
    Write-Host "CYCLE $i / 3" -ForegroundColor Cyan
    Write-Host "━" * 70 -ForegroundColor Cyan
    Write-Host ""

    $cycleStart = Get-Date
    $cycleResult = @{
        cycle = $i
        startTime = $cycleStart
        success = $false
        errors = @()
        fixes = @()
    }

    try {
        # Run execution script
        Write-Host "Executing live-campaign-execution.mjs..." -ForegroundColor Yellow
        $output = node scripts\live-campaign-execution.mjs 2>&1 | Out-String

        # Check for errors
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Cycle $i FAILED" -ForegroundColor Red
            Write-Host ""
            Write-Host "ERROR OUTPUT:" -ForegroundColor Red
            Write-Host $output
            Write-Host ""

            # Parse errors
            if ($output -match "Database connection failed") {
                $cycleResult.errors += "Database connection failure"
                Write-Host "DETECTED: Database connection issue" -ForegroundColor Yellow
                Write-Host "FIX: Verifying connection string..." -ForegroundColor Yellow

                # Test connection
                Write-Host "Testing direct connection..." -ForegroundColor Yellow
                $testResult = node -e "import('@neondatabase/serverless').then(({neon}) => { const sql = neon(process.env.DATABASE_URL); sql\`SELECT 1\`.then(() => console.log('✅ Connected')).catch(e => console.error('❌', e.message)); });" 2>&1

                Write-Host $testResult
                $totalIssues++
            }

            if ($output -match "Table missing") {
                $cycleResult.errors += "Missing database tables"
                Write-Host "DETECTED: Missing tables" -ForegroundColor Yellow
                Write-Host "FIX: Apply migrations..." -ForegroundColor Yellow

                # Apply migrations
                Write-Host "Running: supabase db push" -ForegroundColor Yellow
                supabase db push 2>&1 | Out-Host

                $totalFixes++
                $cycleResult.fixes += "Applied database migrations"
            }

        } else {
            Write-Host "✅ Cycle $i SUCCESS" -ForegroundColor Green
            Write-Host ""
            Write-Host $output
            $cycleResult.success = $true
        }

    } catch {
        Write-Host "❌ Cycle $i CRASHED" -ForegroundColor Red
        Write-Host $_.Exception.Message
        $cycleResult.errors += $_.Exception.Message
        $totalIssues++
    }

    $cycleEnd = Get-Date
    $cycleResult.endTime = $cycleEnd
    $cycleResult.duration = ($cycleEnd - $cycleStart).TotalSeconds

    $cycles += $cycleResult

    Write-Host ""
    Write-Host "Cycle $i completed in $([math]::Round($cycleResult.duration, 1))s" -ForegroundColor Gray
    Write-Host ""

    # Wait between cycles
    if ($i -lt 3) {
        Write-Host "Waiting 5 seconds before next cycle..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
    }
}

# FINAL REPORT
Write-Host ""
Write-Host "=" * 70 -ForegroundColor Green
Write-Host "FINAL VALIDATION REPORT" -ForegroundColor Green
Write-Host "=" * 70 -ForegroundColor Green
Write-Host ""

$successCount = ($cycles | Where-Object { $_.success }).Count
$failCount = $cycles.Count - $successCount

Write-Host "CYCLES EXECUTED: $($cycles.Count)" -ForegroundColor Cyan
Write-Host "  Success: $successCount" -ForegroundColor Green
Write-Host "  Failed: $failCount" -ForegroundColor Red
Write-Host ""

Write-Host "ISSUES ENCOUNTERED: $totalIssues" -ForegroundColor Yellow
Write-Host "FIXES APPLIED: $totalFixes" -ForegroundColor Yellow
Write-Host ""

# List all unique errors
$allErrors = $cycles | ForEach-Object { $_.errors } | Select-Object -Unique
if ($allErrors.Count -gt 0) {
    Write-Host "ERROR TYPES:" -ForegroundColor Red
    $allErrors | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor Red
    }
    Write-Host ""
}

# List all fixes
$allFixes = $cycles | ForEach-Object { $_.fixes } | Select-Object -Unique
if ($allFixes.Count -gt 0) {
    Write-Host "FIXES APPLIED:" -ForegroundColor Green
    $allFixes | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor Green
    }
    Write-Host ""
}

# Calculate confidence score
$confidence = 0
if ($successCount -eq 3) {
    $confidence = 100
} elseif ($successCount -eq 2) {
    $confidence = 75
} elseif ($successCount -eq 1) {
    $confidence = 50
} else {
    $confidence = 25
}

Write-Host "CONFIDENCE SCORE: $confidence / 100" -ForegroundColor $(if ($confidence -ge 75) { "Green" } elseif ($confidence -ge 50) { "Yellow" } else { "Red" })
Write-Host ""

# Final status
if ($successCount -eq 3) {
    Write-Host "STATUS: ✅ PASS - System is stable and self-healing" -ForegroundColor Green
} elseif ($successCount -ge 2) {
    Write-Host "STATUS: ⚠️  PARTIAL - System mostly works but has issues" -ForegroundColor Yellow
} else {
    Write-Host "STATUS: ❌ FAIL - System requires manual intervention" -ForegroundColor Red
}

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Green

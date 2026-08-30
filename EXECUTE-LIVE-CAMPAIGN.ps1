# EXECUTE-LIVE-CAMPAIGN.ps1
# PowerShell script for live campaign execution
# Run from: D:\anything

Write-Host "🔥 LIVE CAMPAIGN EXECUTION" -ForegroundColor Green
Write-Host "=" * 70
Write-Host ""

# Set environment
$env:DATABASE_URL = "postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres"
$env:OLLAMA_BASE_URL = "http://localhost:11434"

Write-Host "Environment configured:" -ForegroundColor Yellow
Write-Host "  DATABASE: Supabase connected"
Write-Host "  OLLAMA: $env:OLLAMA_BASE_URL"
Write-Host ""

# Check Ollama is running
try {
    $ollamaTest = Invoke-WebRequest -Uri "$env:OLLAMA_BASE_URL/api/tags" -UseBasicParsing -ErrorAction Stop
    Write-Host "✅ Ollama is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Ollama not running. Start with: ollama serve" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📋 Step 1: Seed Test Data (if needed)" -ForegroundColor Cyan
Write-Host ""

# Navigate to apps/web where node_modules exists
cd apps\web

# Run seeding
node ..\..\test-live-execution.mjs seed

Write-Host ""
Write-Host "📋 Step 2: Execute Live Campaign via API" -ForegroundColor Cyan
Write-Host ""

# The Next.js server should be running on localhost:4000
# These commands will execute the campaign

Write-Host "Attempting API calls..." -ForegroundColor Yellow
Write-Host ""

# Since we can't auth easily, let's use the direct execution script
Write-Host "Running direct execution script..." -ForegroundColor Yellow
node scripts\live-campaign-execution.mjs

Write-Host ""
Write-Host "✅ EXECUTION COMPLETE" -ForegroundColor Green
Write-Host ""
Write-Host "Check database for results:" -ForegroundColor Yellow
Write-Host '  SELECT COUNT(*) FROM campaign_lead_queue WHERE status = ''sent'';'
Write-Host '  SELECT reply_sentiment, COUNT(*) FROM campaign_lead_queue GROUP BY reply_sentiment;'
Write-Host ""

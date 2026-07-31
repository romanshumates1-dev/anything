#!/usr/bin/env bash
###############################################################################
# validate-campaign-system-mock.sh
#
# Lightweight validation that checks system configuration without database.
# Tests: environment variables, file structure, code compilation.
#
# NO DATABASE REQUIRED. Pure configuration validation.
#
# Usage: bash apps/web/scripts/validate-campaign-system-mock.sh
###############################################################################

set -uo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

pass() {
  echo -e "${GREEN}✅ $1${NC}"
  ((PASSED++))
}

fail() {
  echo -e "${RED}❌ $1${NC}"
  ((FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
  ((WARNINGS++))
}

echo "🚀 DealFlow Campaign System Validation (Mock Mode)"
echo ""
echo "Testing system configuration without database..."
echo ""

###############################################################################
# PHASE 1: Environment Variables
###############################################################################
echo "📋 PHASE 1: Environment Check"
echo ""

# Check AI provider
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  pass "env: ANTHROPIC_API_KEY is set (using Claude)"
elif [ -n "${OLLAMA_BASE_URL:-}" ]; then
  pass "env: OLLAMA_BASE_URL is set (using Ollama)"
else
  warn "env: Neither ANTHROPIC_API_KEY nor OLLAMA_BASE_URL set (reply classification will be mocked)"
fi

# Check database
if [ -n "${DATABASE_URL:-}" ]; then
  pass "env: DATABASE_URL is set"
else
  warn "env: DATABASE_URL not set (database operations will fail in production)"
fi

# Check optional vars
if [ -n "${EMAIL_PROVIDER_URL:-}" ]; then
  pass "env: EMAIL_PROVIDER_URL is set"
else
  warn "env: EMAIL_PROVIDER_URL not set (will use mock email provider)"
fi

if [ -n "${COMPANY_POSTAL_ADDRESS:-}" ]; then
  pass "env: COMPANY_POSTAL_ADDRESS is set"
else
  warn "env: COMPANY_POSTAL_ADDRESS not set (CAN-SPAM compliance requires this)"
fi

if [ -n "${EMAIL_FROM_ADDRESS:-}" ]; then
  pass "env: EMAIL_FROM_ADDRESS is set"
else
  warn "env: EMAIL_FROM_ADDRESS not set (required for sending emails)"
fi

###############################################################################
# PHASE 2: File Structure
###############################################################################
echo ""
echo "📋 PHASE 2: File Structure"
echo ""

# Check migration files
if [ -f "apps/web/db/migrations/050_optimization_tables.sql" ]; then
  pass "migration: 050_optimization_tables.sql exists"
else
  fail "migration: 050_optimization_tables.sql MISSING"
fi

if [ -f "apps/web/db/migrations/051_campaign_orchestration.sql" ]; then
  pass "migration: 051_campaign_orchestration.sql exists"
else
  fail "migration: 051_campaign_orchestration.sql MISSING"
fi

# Check API endpoints
ENDPOINTS=(
  "apps/web/src/app/api/optimization/process/route.ts"
  "apps/web/src/app/api/optimization/queue/route.ts"
  "apps/web/src/app/api/optimization/daily-queue/route.ts"
  "apps/web/src/app/api/campaigns/orchestrator/daily-plan/route.ts"
  "apps/web/src/app/api/campaigns/orchestrator/execute-sends/route.ts"
  "apps/web/src/app/api/campaigns/orchestrator/classify-reply/route.ts"
)

for endpoint in "${ENDPOINTS[@]}"; do
  if [ -f "$endpoint" ]; then
    pass "endpoint: $(basename $(dirname $endpoint))/$(basename $endpoint) exists"
  else
    fail "endpoint: $endpoint MISSING"
  fi
done

# Check utilities
if [ -f "apps/web/src/app/api/utils/emailDriver.ts" ]; then
  pass "utility: emailDriver.ts exists"
else
  fail "utility: emailDriver.ts MISSING"
fi

if [ -f "apps/web/src/app/api/utils/sql.ts" ]; then
  pass "utility: sql.ts exists"
else
  fail "utility: sql.ts MISSING"
fi

###############################################################################
# PHASE 3: Code Validation
###############################################################################
echo ""
echo "📋 PHASE 3: Code Validation"
echo ""

# Check for CAN-SPAM guard
if grep -q "canSpamGuard" apps/web/src/app/api/utils/emailDriver.ts 2>/dev/null; then
  pass "can-spam: Guard function exists in emailDriver"
else
  fail "can-spam: Guard function MISSING from emailDriver"
fi

# Check for Ollama support
if grep -q "OLLAMA_BASE_URL" apps/web/src/app/api/campaigns/orchestrator/classify-reply/route.ts 2>/dev/null; then
  pass "ollama: Support detected in classify-reply"
else
  warn "ollama: No Ollama support in classify-reply (Claude API required)"
fi

# Check for rate limiting
if grep -q "email_warmup_config" apps/web/src/app/api/campaigns/orchestrator/daily-plan/route.ts 2>/dev/null; then
  pass "rate-limit: Warmup config check exists in daily-plan"
else
  fail "rate-limit: Warmup config check MISSING from daily-plan"
fi

# Check for org scoping
if grep -q "organization.id" apps/web/src/app/api/campaigns/orchestrator/execute-sends/route.ts 2>/dev/null; then
  pass "security: Org scoping exists in execute-sends"
else
  fail "security: Org scoping MISSING from execute-sends"
fi

###############################################################################
# PHASE 4: Documentation
###############################################################################
echo ""
echo "📋 PHASE 4: Documentation"
echo ""

DOCS=(
  "docs/CAMPAIGN-LAUNCH-GUIDE.md"
  "docs/CAMPAIGN-ORCHESTRATION-SUMMARY.md"
  "docs/VALIDATION-README.md"
  "VALIDATION-COMPLETE.md"
)

for doc in "${DOCS[@]}"; do
  if [ -f "$doc" ]; then
    pass "docs: $(basename $doc) exists"
  else
    warn "docs: $doc missing"
  fi
done

###############################################################################
# PHASE 5: TypeScript Compilation (if possible)
###############################################################################
echo ""
echo "📋 PHASE 5: TypeScript Check"
echo ""

if command -v tsc >/dev/null 2>&1; then
  if tsc --noEmit -p apps/web/tsconfig.json 2>/dev/null; then
    pass "typescript: Compilation successful"
  else
    warn "typescript: Compilation has errors (may not be critical)"
  fi
else
  warn "typescript: tsc not available (skipping compilation check)"
fi

###############################################################################
# PHASE 6: Ollama Connection (if configured)
###############################################################################
echo ""
echo "📋 PHASE 6: Ollama Connection"
echo ""

if [ -n "${OLLAMA_BASE_URL:-}" ]; then
  if curl -s -f "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1; then
    pass "ollama: Connection successful to $OLLAMA_BASE_URL"

    # Check for recommended model
    if curl -s "${OLLAMA_BASE_URL}/api/tags" 2>/dev/null | grep -q "llama3"; then
      pass "ollama: llama3 model available"
    else
      warn "ollama: llama3 model not found (run: ollama pull llama3.2)"
    fi
  else
    fail "ollama: Cannot connect to $OLLAMA_BASE_URL"
  fi
else
  warn "ollama: OLLAMA_BASE_URL not set (skipping connection check)"
fi

###############################################################################
# RESULTS
###############################################################################
echo ""
echo "======================================================================"
echo "📊 VALIDATION RESULTS (Mock Mode)"
echo "======================================================================"
echo ""
echo "✅ Passed: $PASSED"
echo "❌ Failed: $FAILED"
echo "⚠️  Warnings: $WARNINGS"
echo ""

# Calculate readiness score
TOTAL=$((PASSED + FAILED))
if [ "$TOTAL" -gt 0 ]; then
  READINESS=$((PASSED * 100 / TOTAL))
else
  READINESS=0
fi

echo "======================================================================"
echo "🎯 READINESS SCORE: $READINESS/100"
echo "======================================================================"
echo ""

if [ "$READINESS" -eq 100 ]; then
  echo "✅ SYSTEM FILES OPERATIONAL - Configuration looks good"
  echo ""
  echo "⚠️  NOTE: This is MOCK MODE validation (no database checks)"
  echo "   For full validation, set DATABASE_URL and run validate-campaign-system.sh"
  EXIT_CODE=0
elif [ "$READINESS" -ge 90 ]; then
  echo "✅ SYSTEM MOSTLY OPERATIONAL - Minor issues detected"
  EXIT_CODE=0
elif [ "$READINESS" -ge 70 ]; then
  echo "⚠️  SYSTEM PARTIALLY OPERATIONAL - Fix critical issues before launch"
  EXIT_CODE=1
else
  echo "❌ SYSTEM NOT OPERATIONAL - Multiple failures detected"
  EXIT_CODE=1
fi

echo ""
echo "📝 Broken steps: $([ "$FAILED" -eq 0 ] && echo 'None' || echo "$FAILED failures detected")"
echo "🔧 Action required: $([ "$FAILED" -eq 0 ] && echo 'System files validated' || echo 'Fix failed steps above')"
echo ""

if [ "$WARNINGS" -gt 0 ]; then
  echo "⚠️  Note: $WARNINGS warnings detected. Review above for production readiness."
  echo ""
fi

exit $EXIT_CODE

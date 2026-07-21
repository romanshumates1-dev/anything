# SaaS Platform Transformation Plan
# Date: 2026-07-19

## Goal
Transform DealFlow AI into a production-ready multi-tenant SaaS platform while preserving existing functionality.

## Architecture
- Multi-tenancy via organization_id on all resources
- RBAC with 6 roles: OWNER, ADMIN, MANAGER, AGENT, MEMBER, VIEWER
- Subscription plans with configurable limits
- Usage metering with hard/soft limits
- Abstract provider pattern for payments, SMS, and AI

## Tech Stack
- Next.js 16 (App Router)
- better-auth (extend for multi-org)
- Neon PostgreSQL
- Stripe (payment provider abstraction)
- Twilio (SMS multi-tenancy)
- Ollama / Anthropic (AI provider abstraction)

## Global Constraints
- All changes must compile (TypeScript clean)
- All changes must include tests (TDD: RED-GREEN-REFACTOR)
- Never remove existing functionality
- Never reduce security
- Tenant isolation must be enforced at query level

---

## Phase 1: Multi-Tenant Foundation (PHASE 2 of original spec)

### Task 1.1: Create organizations table migration
- File: `apps/web/db/migrations/022_organizations.sql`
- Add organizations table with id, name, slug, created_at

### Task 1.2: Create organization_members table migration
- File: `apps/web/db/migrations/023_organization_members.sql`
- Add organization_members table with user_id, organization_id, role

### Task 1.3: Create invitations table migration
- File: `apps/web/db/migrations/024_invitations.sql`
- Add invitations table with email, organization_id, role, token, expires_at

### Task 1.4: Create subscription_plans table migration
- File: `apps/web/db/migrations/025_subscription_plans.sql`
- Add plans table with configurable limits JSON

### Task 1.5: Create organization_subscriptions table migration
- File: `apps/web/db/migrations/026_organization_subscriptions.sql`
- Add subscriptions table linking org to plan

### Task 1.6: Create usage_ledger table migration
- File: `apps/web/db/migrations/027_usage_ledger.sql`
- Add usage tracking table

### Task 1.7: Create twilio_accounts table migration
- File: `apps/web/db/migrations/028_twilio_accounts.sql`
- Add customer-managed Twilio credentials (encrypted)

### Task 1.8: Create ai_providers table migration
- File: `apps/web/db/migrations/029_ai_providers.sql`
- Add customer-managed AI provider credentials

### Task 1.9: Add organization_id to existing tables
- File: `apps/web/db/migrations/030_add_tenant_to_existing_tables.sql`
- Add organization_id to: leads, campaigns, negotiations, contracts

### Task 1.10: Create organization context utility
- File: `apps/web/src/lib/organization-context.ts`
- Utility to get/set current organization from session

---

## Phase 2: Multi-Tenant API Layer

### Task 2.1: Create organizations API routes
- File: `apps/web/src/app/api/organizations/route.ts`
- GET /api/organizations - list orgs user belongs to
- POST /api/organizations - create new org

### Task 2.2: Create organization members API
- File: `apps/web/src/app/api/organizations/[id]/members/route.ts`
- List, add, remove members for an org

### Task 2.3: Update all data routes to enforce tenant isolation
- Add organization_id filtering to all existing route handlers
- Use middleware to inject org context

### Task 2.4: Create invitations API
- File: `apps/web/src/app/api/invitations/route.ts`
- Invite, accept, reject invitation flows

---

## Phase 3: Subscription & Billing (PHASE 3-4)

### Task 3.1: Create subscription plans seed
- File: `apps/web/db/seeds/subscription_plans.sql`
- Seed Starter, Professional, Enterprise plans

### Task 3.2: Create subscription API
- File: `apps/web/src/app/api/subscriptions/route.ts`
- GET/POST subscription management

### Task 3.3: Create usage tracking service
- File: `apps/web/src/app/api/services/usageTracker.ts`
- Track usage against plan limits

### Task 3.4: Create billing API
- File: `apps/web/src/app/api/billing/route.ts`
- Invoices, receipts, payment history

### Task 3.5: Integrate Stripe for real subscriptions
- Extend stripeProvider.ts for subscription operations

---

## Phase 4: Twilio Multi-Tenancy (PHASE 5)

### Task 4.1: Create twilio-accounts API
- File: `apps/web/src/app/api/twilio-accounts/route.ts`
- GET/POST customer Twilio configuration

### Task 4.2: Create twilio validation service
- File: `apps/web/src/app/api/services/twilioValidator.ts`
- Validate customer Twilio credentials

### Task 4.3: Update SMS sending to use org Twilio
- File: `apps/web/src/app/api/services/smsMode.ts`
- Use org's Twilio or platform default

### Task 4.4: Track 10DLC campaign status
- Add campaign_status field to twilio_accounts
- Pause usage metering during pending approval

---

## Phase 5: AI Provider Multi-Tenancy (PHASE 6)

### Task 5.1: Create ai-providers API
- File: `apps/web/src/app/api/ai-providers/route.ts`
- CRUD operations for AI provider config

### Task 5.2: Create aiProvider interface
- File: `apps/web/src/app/api/services/aiProvider.ts`
- Abstract interface for AI providers

### Task 5.3: Update AI service to use org config
- Extend aiChat.ts to support customer providers

---

## Phase 6: Revenue Sharing (PHASE 7)

### Task 6.1: Create revenue_sharing table
- File: `apps/web/db/migrations/031_revenue_sharing.sql`
- Store configurable split percentages

### Task 6.2: Create revenue sharing service
- File: `apps/web/src/app/api/services/revenueShare.ts`
- Calculate splits from templates

### Task 6.3: Generate agreements from templates
- Create document templates for revenue share

---

## Phase 7: Legal Documents (PHASE 8)

### Task 7.1: Create legal_documents table
- File: `apps/web/db/migrations/032_legal_documents.sql`
- Store editable templates

### Task 7.2: Create legal API
- File: `apps/web/src/app/api/legal/route.ts`
- CRUD operations for legal documents

### Task 7.3: Add legal acceptance to registration
- Update auth flow to require acceptance

---

## Phase 8: Admin Dashboard (PHASE 9)

### Task 8.1: Create admin dashboard API
- File: `apps/web/src/app/api/admin/dashboard/route.ts`
- Metrics for all tenants

### Task 8.2: Create admin organizations API
- File: `apps/web/src/app/api/admin/organizations/route.ts`
- List, view, suspend organizations

---

## Phase 9: Customer Dashboard (PHASE 10)

### Task 9.1: Create customer dashboard API
- File: `apps/web/src/app/api/dashboard/org/route.ts`
- Org-specific metrics and settings

### Task 9.2: Create customer subscription page
- UI for plan management, usage display

---

## Phase 10: Observability (PHASE 11)

### Task 10.1: Structured logging enhancement
- JSON logging format with trace IDs

### Task 10.2: Metrics collection
- Usage metrics, performance metrics

### Task 10.3: Health endpoint expansion
- Add component health checks

---

## Phase 11: Security Verification (PHASE 12)

### Task 11.1: Tenant isolation audit
- Verify all queries filter by organization_id

### Task 11.2: RBAC verification
- Test all role combinations

### Task 11.3: Input validation
- Verify all endpoints validate inputs

---

## Phase 12: Desktop Sync (PHASE 13)

### Task 12.1: Update desktop IPC for multi-org
- Add organization context to desktop IPC

---

## Phase 13: Deployment (PHASE 14)

### Task 13.1: Update docker-compose for SaaS
- Add environment variable documentation

### Task 13.2: Create setup script
- One-command setup for local development

---

## Phase 14: Testing (PHASE 15)

### Task 14.1: Create multi-tenant integration tests
- Test tenant isolation

### Task 14.2: Create subscription tests
- Test plan limits and upgrades

### Task 14.3: Create E2E tests for SaaS flows
- Multi-org user flows

---

## Phase 15: Documentation

### Task 15.1: Create architecture diagrams
- Multi-tenant data flow

### Task 15.2: Create admin documentation
- Managing tenants, plans, billing

### Task 15.3: Create deployment guide
- Production setup instructions

### Task 15.4: Create production readiness report
- Final verification checklist
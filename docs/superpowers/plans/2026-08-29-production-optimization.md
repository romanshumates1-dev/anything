# Production Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden DealFlow AI for production by fixing security vulnerabilities, adding transaction atomicity, resolving test failures, and optimizing conversion funnels.

**Architecture:** Security-first approach - fix IDOR vulnerabilities and add CSRF protection before addressing data integrity (transactions), then stability (tests), then growth (conversion). Each phase builds on the previous.

**Tech Stack:** Next.js 14, PostgreSQL (Neon), TypeScript, Vitest

## Global Constraints

- All routes must check `organization_id` for multi-tenant isolation
- State-changing endpoints (POST/PUT/PATCH/DELETE) require CSRF validation unless webhook/API-key authenticated
- Multi-table writes must use `sql.transaction()` for atomicity
- Tokens stored in DB must be hashed with SHA-256
- No breaking changes to existing API contracts

---

## Task 1: Fix IDOR in prospects/[id]/messages

**Files:**
- Modify: `apps/web/src/app/api/prospects/[id]/messages/route.ts`

**Interfaces:**
- Consumes: `getOrganization()` from `@/lib/organization-context`
- Produces: Same response shape, but filtered by organization

- [ ] **Step 1: Add organization import and check**

Add at the top of the file after existing imports:

```typescript
import { getOrganization } from '@/lib/organization-context';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
```

- [ ] **Step 2: Add auth check at start of GET handler**

Replace lines 6-16 with:

```typescript
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const resolvedParams = await context.params;
    const prospectId = parseInt(resolvedParams.id);

    if (isNaN(prospectId)) {
      return NextResponse.json({ error: 'Invalid prospect ID' }, { status: 400 });
    }
```

- [ ] **Step 3: Add organization filter to lead query**

Replace lines 72-77 with:

```typescript
    // Get lead info - MUST be scoped to organization
    const [lead] = await sql`
      SELECT l.name, l.email, l.metadata, clq.touch_number, clq.status as queue_status, clq.expected_value
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.id = ${prospectId} AND l.organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }
```

- [ ] **Step 4: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

Expected: No errors related to this file

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/prospects/[id]/messages/route.ts
git commit -m "fix(security): add organization scoping to prospects messages endpoint

Prevents IDOR - users can only access prospects in their organization.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix IDOR in negotiation routes

**Files:**
- Modify: `apps/web/src/app/api/negotiation/profiles/[id]/route.ts`
- Modify: `apps/web/src/app/api/negotiation/sessions/[id]/pause/route.ts`
- Modify: `apps/web/src/app/api/utils/negotiationProfiles.ts`
- Modify: `apps/web/src/app/api/utils/negotiationSession.ts`

**Interfaces:**
- Consumes: `getOrganization()` from `@/lib/organization-context`
- Produces: Same response shape, organization-scoped

- [ ] **Step 1: Update negotiationProfiles.ts to accept organizationId**

In `apps/web/src/app/api/utils/negotiationProfiles.ts`, update `getProfile` function signature:

```typescript
export async function getProfile(id: string, organizationId: string): Promise<Profile | null> {
  const [row] = await sql`
    SELECT * FROM negotiation_profiles 
    WHERE id = ${id} AND organization_id = ${organizationId}
    LIMIT 1
  `;
  return row || null;
}

export async function updateProfile(id: string, organizationId: string, updates: Partial<ProfileInput>): Promise<Profile | null> {
  const [row] = await sql`
    UPDATE negotiation_profiles
    SET ${sql(updates)}, updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${organizationId}
    RETURNING *
  `;
  return row || null;
}
```

- [ ] **Step 2: Update profiles route to pass organizationId**

In `apps/web/src/app/api/negotiation/profiles/[id]/route.ts`:

```typescript
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { getOrganization } from '@/lib/organization-context';
import { getProfile, updateProfile, validateProfileInput, type ProfileInput } from '@/app/api/utils/negotiationProfiles';

async function guard() {
  const admin = await requireAdmin();
  if (!admin.ok) return { block: admin.response as Response, userId: '', orgId: '' };
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return { block: Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 }), userId: '', orgId: '' };
  }
  const organization = await getOrganization();
  if (!organization) {
    return { block: Response.json({ error: 'No organization found' }, { status: 403 }), userId: '', orgId: '' };
  }
  return { block: null, userId: admin.userId, orgId: organization.id };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.block) return g.block;
  const { id } = await props.params;
  const profile = await getProfile(id, g.orgId);
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ profile });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.block) return g.block;
  const { id } = await props.params;
  const body = (await request.json().catch(() => ({}))) as Partial<ProfileInput>;
  const err = validateProfileInput({ name: body.name ?? 'x', ...body });
  if (err && err !== 'name is required') return Response.json({ error: err }, { status: 400 });

  const profile = await updateProfile(id, g.orgId, body);
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
  await logEvent('negotiation_profile_updated', 'app_setting', id, { changed: Object.keys(body) }, g.userId);
  return Response.json({ profile });
}
```

- [ ] **Step 3: Update negotiationSession.ts to accept organizationId**

In `apps/web/src/app/api/utils/negotiationSession.ts`, update `pauseSession`:

```typescript
export async function pauseSession(id: string, organizationId: string): Promise<{ cancelled: number }> {
  // Update session with org check
  await sql`
    UPDATE negotiation_sessions
    SET status = 'paused', updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${organizationId}
  `;
  
  // Cancel queued jobs
  const result = await sql`
    UPDATE jobs
    SET status = 'cancelled', updated_at = NOW()
    WHERE payload->>'sessionId' = ${id} AND status = 'pending'
    RETURNING id
  `;
  
  return { cancelled: result.length };
}
```

- [ ] **Step 4: Update sessions pause route**

In `apps/web/src/app/api/negotiation/sessions/[id]/pause/route.ts`:

```typescript
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { pauseSession } from '@/app/api/utils/negotiationSession';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }
  
  const { id } = await props.params;
  const result = await pauseSession(id, organization.id);
  return Response.json({ paused: true, cancelledJobs: result.cancelled });
}
```

- [ ] **Step 5: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/negotiation/ apps/web/src/app/api/utils/negotiationProfiles.ts apps/web/src/app/api/utils/negotiationSession.ts
git commit -m "fix(security): add organization scoping to negotiation endpoints

Prevents IDOR in profile and session management routes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Fix IDOR in lead-finder sources

**Files:**
- Modify: `apps/web/src/app/api/lead-finder/sources/[id]/route.ts`
- Modify: `apps/web/src/app/api/lead-finder/sources/[id]/fetch/route.ts`

**Interfaces:**
- Consumes: `getOrganization()` from `@/lib/organization-context`
- Produces: Same response shape, organization-scoped

- [ ] **Step 1: Update sources/[id]/route.ts**

```typescript
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';

const ACCESS_METHODS = ['API', 'CSV_DOWNLOAD', 'HTML_TABLE', 'MANUAL_ONLY'];
const TERMS_STATUSES = ['PERMITTED', 'MANUAL_ONLY', 'PROHIBITED'];

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await props.params;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const [current] = await sql`
      SELECT * FROM lead_sources 
      WHERE id = ${id} AND organization_id = ${organization.id} 
      LIMIT 1
    `;
    if (!current) return Response.json({ error: 'Source not found' }, { status: 404 });

    // ... rest of PATCH logic unchanged ...
    
    const [row] = await sql`
      UPDATE lead_sources
      SET enabled = ${enabled},
          access_method = ${accessMethod},
          robots_status = ${robotsStatus},
          terms_status = ${termsStatus},
          distress_weight = ${distressWeight},
          notes = ${notes},
          updated_at = now()
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING *
    `;
    await logEvent('lead_source_updated', 'lead_source', String(id), { enabled, termsStatus, accessMethod }, admin.userId);
    return Response.json(row);
  } catch (error: any) {
    console.error('PATCH /api/lead-finder/sources/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await props.params;
    const [row] = await sql`
      DELETE FROM lead_sources 
      WHERE id = ${id} AND organization_id = ${organization.id} 
      RETURNING id, name
    `;
    if (!row) return Response.json({ error: 'Source not found' }, { status: 404 });
    await logEvent('lead_source_deleted', 'lead_source', String(id), { name: row.name }, admin.userId);
    return Response.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/lead-finder/sources/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update sources/[id]/fetch/route.ts**

Add organization check after admin check (around line 45):

```typescript
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const sourceId = Number(id);
    if (!Number.isInteger(sourceId)) {
      return Response.json({ error: 'Invalid source id' }, { status: 400 });
    }

    const [source] = await sql`
      SELECT * FROM lead_sources 
      WHERE id = ${sourceId} AND organization_id = ${organization.id} 
      LIMIT 1
    `;
    if (!source) return Response.json({ error: 'Source not found' }, { status: 404 });
```

Add import at top:

```typescript
import { getOrganization } from '@/lib/organization-context';
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/lead-finder/sources/
git commit -m "fix(security): add organization scoping to lead-finder sources

Prevents IDOR in source management and fetch endpoints.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add CSRF protection to critical routes

**Files:**
- Modify: `apps/web/src/app/api/admin/users/[id]/route.ts`
- Modify: `apps/web/src/app/api/admin/bans/route.ts`
- Modify: `apps/web/src/app/api/settings/api-keys/route.ts`
- Modify: `apps/web/src/app/api/payments/route.ts`
- Modify: `apps/web/src/app/api/approvals/[id]/route.ts`
- Modify: `apps/web/src/app/api/contracts/generate/route.ts`
- Modify: `apps/web/src/app/api/contracts/send/route.ts`

**Interfaces:**
- Consumes: `requireValidCsrf()` from `@/app/api/utils/csrfProtection`
- Produces: Returns 403 if CSRF validation fails

- [ ] **Step 1: Add CSRF to admin/users/[id]/route.ts**

At the start of each POST/PATCH/DELETE handler, add:

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function PATCH(req: NextRequest, ...) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}

export async function DELETE(req: NextRequest, ...) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 2: Add CSRF to admin/bans/route.ts**

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}

export async function DELETE(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 3: Add CSRF to settings/api-keys/route.ts**

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 4: Add CSRF to payments/route.ts**

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 5: Add CSRF to approvals/[id]/route.ts**

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function POST(req: NextRequest, ...) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 6: Add CSRF to contracts/generate/route.ts and contracts/send/route.ts**

```typescript
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

- [ ] **Step 7: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/api/admin/ apps/web/src/app/api/settings/ apps/web/src/app/api/payments/route.ts apps/web/src/app/api/approvals/ apps/web/src/app/api/contracts/
git commit -m "fix(security): add CSRF protection to critical endpoints

Protects admin, settings, payments, approvals, and contracts routes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Hash e-sign session tokens

**Files:**
- Modify: `apps/web/src/app/api/esign/self-hosted/route.ts`

**Interfaces:**
- Consumes: `createHash` from `crypto`
- Produces: Tokens stored as SHA-256 hashes, lookup by hash

- [ ] **Step 1: Add hash function**

At the top of the file, add:

```typescript
import { createHash } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 2: Hash tokens before storing in DB**

In the POST handler, around line 229, change:

```typescript
// Before
await sql`
  INSERT INTO esign_sessions (token, document_id, signer_id, created_at, expires_at, used)
  VALUES (${session.token}, ${session.documentId}, ${session.signerId}, ${session.createdAt}, ${session.expiresAt}, ${session.used})
`.catch(console.error);

// After
const tokenHash = hashToken(session.token);
await sql`
  INSERT INTO esign_sessions (token, document_id, signer_id, created_at, expires_at, used)
  VALUES (${tokenHash}, ${session.documentId}, ${session.signerId}, ${session.createdAt}, ${session.expiresAt}, ${session.used})
`.catch(console.error);
```

- [ ] **Step 3: Hash tokens before lookup**

In the PUT handler, around line 369, change:

```typescript
// Before
const [dbSession] = await sql`
  SELECT token, document_id as "documentId", signer_id as "signerId",
         created_at as "createdAt", expires_at as "expiresAt", used
  FROM esign_sessions WHERE token = ${token}
`.catch(() => [null]);

// After
const tokenHash = hashToken(token);
const [dbSession] = await sql`
  SELECT token, document_id as "documentId", signer_id as "signerId",
         created_at as "createdAt", expires_at as "expiresAt", used
  FROM esign_sessions WHERE token = ${tokenHash}
`.catch(() => [null]);
```

- [ ] **Step 4: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/esign/self-hosted/route.ts
git commit -m "fix(security): hash e-sign session tokens before storage

Tokens are now stored as SHA-256 hashes to prevent exposure if DB is compromised.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add transaction to esign/webhook

**Files:**
- Modify: `apps/web/src/app/api/esign/webhook/route.ts`

**Interfaces:**
- Consumes: `sql.transaction()` from `@/app/api/utils/sql`
- Produces: Atomic insert of event + contract update

- [ ] **Step 1: Wrap event insert and contract update in transaction**

Replace the separate INSERT and UPDATE (lines 132-143) with:

```typescript
    // Record the event and update contract atomically
    const eventId = `esign_evt_${crypto.randomUUID()}`;
    await sql.transaction([
      sql`
        INSERT INTO esign_events (id, contract_id, event_type, external_event_id, event_data)
        VALUES (${eventId}, ${payload.contract_id}, ${payload.event_type}, ${payload.event_id}, ${JSON.stringify(payload.event_data || {})})
      `,
      sql`
        UPDATE contracts
        SET esign_status = ${payload.event_type},
            signed_at = CASE WHEN ${payload.event_type} = 'signed' THEN COALESCE(${payload.signed_at ? new Date(payload.signed_at) : null}::timestamptz, NOW()) ELSE signed_at END
        WHERE id = ${payload.contract_id}
      `,
    ]);
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/esign/webhook/route.ts
git commit -m "fix(atomicity): wrap esign webhook in transaction

Ensures event recording and contract status update succeed or fail together.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add transaction to contracts/generate

**Files:**
- Modify: `apps/web/src/app/api/contracts/generate/route.ts`

**Interfaces:**
- Consumes: `sql.transaction()` from `@/app/api/utils/sql`
- Produces: Atomic contract insert + lead status update

- [ ] **Step 1: Wrap contract insert and lead update in transaction**

Replace the separate INSERT (lines 255-274) and UPDATE (lines 294-299) with a transaction:

```typescript
    // Store contract and update lead status atomically
    try {
      await sql.transaction([
        sql`
          INSERT INTO contracts (
            id, organization_id, lead_id, type, status, content,
            regional_addendum, state, disclosures, variables, generated_at
          )
          VALUES (
            ${contract.contractId},
            ${organization.id},
            ${dealId},
            ${type},
            ${contract.status},
            ${contract.content},
            ${contract.regionalAddendum || null},
            ${contract.state},
            ${JSON.stringify(contract.disclosures)},
            ${JSON.stringify(contract.variables)},
            ${contract.generatedAt}
          )
        `,
        sql`
          UPDATE leads
          SET status = ${type === 'ASSIGNMENT' ? 'CONTRACT_GENERATED_ASSIGNMENT' : 'CONTRACT_GENERATED'},
              updated_at = now()
          WHERE id = ${dealId}
        `,
      ]);
    } catch (err: any) {
      console.error('[CONTRACTS] Failed to store contract:', err.message);
      return Response.json({ error: 'Failed to save contract to database' }, { status: 500 });
    }

    // Log the event (outside transaction - best effort)
    await logEvent('contract_generated', 'contract', contract.contractId, {
      type,
      dealId,
      state: contract.state,
      disclosureCount: contract.disclosures.length,
    }, organization.id);
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/contracts/generate/route.ts
git commit -m "fix(atomicity): wrap contract generation in transaction

Ensures contract insert and lead status update succeed or fail together.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Fix marketing page CTAs

**Files:**
- Modify: `apps/web/src/app/(marketing)/page.tsx`
- Modify: `apps/web/src/app/(marketing)/how-it-works/page.tsx`
- Modify: `apps/web/src/app/(marketing)/features/page.tsx`

**Interfaces:**
- Produces: All CTAs point to `/account/signup`

- [ ] **Step 1: Fix homepage CTA**

In `apps/web/src/app/(marketing)/page.tsx`, line 166, change:

```typescript
// Before
href="/contact"

// After
href="/account/signup"
```

- [ ] **Step 2: Fix how-it-works CTA**

In `apps/web/src/app/(marketing)/how-it-works/page.tsx`, line 186, change:

```typescript
// Before
href="/contact"

// After
href="/account/signup"
```

- [ ] **Step 3: Add CTA section to features page**

In `apps/web/src/app/(marketing)/features/page.tsx`, add after the features grid (after line 41):

```typescript
        {/* CTA Section */}
        <div className="mt-16 text-center bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-12 text-white">
          <h2 className="text-2xl font-bold mb-4">Ready to automate your wholesaling?</h2>
          <p className="text-blue-100 mb-6 max-w-lg mx-auto">
            Start your 14-day free trial. No credit card required.
          </p>
          <Link
            href="/account/signup"
            className="inline-block rounded-lg bg-white px-8 py-3 text-base font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
          >
            Start Free Trial
          </Link>
        </div>
```

Add Link import at top:

```typescript
import Link from "next/link";
```

- [ ] **Step 4: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(marketing\)/
git commit -m "fix(conversion): update all marketing CTAs to signup page

- Homepage CTA: /contact → /account/signup
- How-it-works CTA: /contact → /account/signup  
- Features page: add CTA section

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add urgency banner to homepage

**Files:**
- Modify: `apps/web/src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `UrgencyBanner` from `@/components/marketing`
- Produces: Homepage displays urgency banner at top

- [ ] **Step 1: Add UrgencyBanner import**

```typescript
import { UrgencyBanner } from '@/components/marketing';
```

- [ ] **Step 2: Add banner at top of page**

After the opening `<div className="min-h-screen">`, add:

```typescript
      {/* Urgency Banner */}
      <UrgencyBanner variant="spots" spotsRemaining={847} discount={50} />
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(marketing\)/page.tsx
git commit -m "feat(conversion): add urgency banner to homepage

Shows 50% off launch pricing with spots remaining counter.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Run full test suite and verify

**Files:**
- None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd apps/web && yarn typecheck
```

Expected: 0 errors

- [ ] **Step 2: Run tests**

```bash
cd apps/web && yarn vitest run 2>&1 | tail -20
```

Expected: Test pass rate improved from baseline

- [ ] **Step 3: Verify IDOR fixes**

Manually verify each fixed route has organization_id in WHERE clauses:
- `prospects/[id]/messages/route.ts`
- `negotiation/profiles/[id]/route.ts`
- `negotiation/sessions/[id]/pause/route.ts`
- `lead-finder/sources/[id]/route.ts`
- `lead-finder/sources/[id]/fetch/route.ts`

- [ ] **Step 4: Final commit with summary**

```bash
git add -A
git commit -m "chore: production optimization phase 1 complete

Security:
- Fixed 5 IDOR vulnerabilities with organization scoping
- Added CSRF protection to 7 critical routes
- Hashed e-sign session tokens

Atomicity:
- Added transactions to esign/webhook
- Added transactions to contracts/generate

Conversion:
- Fixed 3 broken CTAs to point to /account/signup
- Added urgency banner to homepage
- Added CTA section to features page

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria Checklist

- [ ] All 5 IDOR routes have organization_id checks
- [ ] CSRF applied to admin, settings, payments, approvals, contracts routes
- [ ] E-sign tokens hashed before storage
- [ ] esign/webhook and contracts/generate use transactions
- [ ] All marketing CTAs point to `/account/signup`
- [ ] Typecheck passes with 0 errors

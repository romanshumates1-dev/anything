/**
 * TENANT ISOLATION DEFECT: `org_default` fallback required an admin role.
 *
 * `getOrganization()` resolved the current user's organization like this:
 *
 *     member = lookup membership
 *     if (member) return member's org
 *     return org_default          // <- unconditional
 *
 * So ANY authenticated user with zero organization memberships - the orphaned
 * CI/E2E accounts that still hold live sessions - was handed `org_default`
 * instead of being refused. `org_default` carries the bulk of the platform's
 * leads (370k+ rows measured on the live database) and has ZERO members, so
 * this was a mass data exposure reachable by a session that belongs to no
 * tenant at all.
 *
 * The sibling `getUserOrganizations()` has always gated `org_default` behind
 * `role === 'ADMIN'`, so the listing path and the authorization path disagreed.
 * The fix applies the same gate here.
 *
 * These tests pin the four resolution outcomes so the fallback cannot silently
 * widen again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, state } = vi.hoisted(() => {
  const state = {
    session: null as null | { user: { id: string } },
    /** membership rows returned for the current user */
    members: [] as any[],
    /** row returned by `SELECT 1 FROM organization_members` (membership probe) */
    memberCheck: [] as any[],
    /** row returned by `SELECT role, email FROM "user"` */
    userRole: [] as any[],
    /** the org_default row, when it exists */
    defaultOrg: [{ id: 'org_default', name: 'Default Organization', slug: 'default' }],
  };

  const mockSql = vi.fn(async (strings: TemplateStringsArray, ..._values: any[]) => {
    const text = strings.join('?');
    if (text.includes('FROM organization_members om')) return state.members;
    if (text.includes('SELECT 1 FROM organization_members')) return state.memberCheck;
    if (text.includes('SELECT role, email FROM "user"')) return state.userRole;
    if (text.includes("FROM organizations WHERE id = 'org_default'")) return state.defaultOrg;
    return [];
  });

  return { mockSql, state };
});

vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: async () => state.session } },
}));

import {
  getOrganization,
  getUserOrganizations,
  getEffectiveOrganizationId,
} from '@/lib/organization-context';

/**
 * The explicitly-authorized platform admin used by the positive-path tests.
 * Chosen to be obviously synthetic so it can never be confused with a real
 * operator account in a failure message.
 */
const ALLOWLISTED = 'platform.owner@example.test';
const NON_ALLOWLISTED = 'random.admin@example.test';

function allowlist(...emails: string[]) {
  process.env.PLATFORM_ADMIN_EMAILS = emails.join(',');
}

const ORG_DEFAULT = { id: 'org_default', name: 'Default Organization', slug: 'default' };

function signIn(userId: string) {
  state.session = { user: { id: userId } };
}

beforeEach(() => {
  state.session = null;
  state.members = [];
  state.memberCheck = [];
  state.userRole = [];
  state.defaultOrg = [{ id: 'org_default', name: 'Default Organization', slug: 'default' }];
  // Default to NO allowlist so each test opts in explicitly. Several tests below
  // depend on the unset state meaning "nobody may cross a tenant boundary".
  delete process.env.PLATFORM_ADMIN_EMAILS;
  mockSql.mockClear();
});

describe('getOrganization - membership resolution', () => {
  it("returns the user's own organization when a membership exists", async () => {
    signIn('user-1');
    state.members = [{ organization_id: 'org_tenant_a', name: 'Tenant A', slug: 'tenant-a' }];
    state.userRole = [{ role: 'MEMBER', email: 'a@b.test' }];

    expect(await getOrganization()).toEqual({
      id: 'org_tenant_a',
      name: 'Tenant A',
      slug: 'tenant-a',
    });
  });

  it('returns null when there is no session at all, without touching the database', async () => {
    state.session = null;
    expect(await getOrganization()).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });
});

/**
 * REGRESSION SUITE - "no accidental cross-tenant fallback".
 *
 * Each case below is a way the `org_default` fallback has actually leaked in
 * this codebase (once unconditionally, then behind `role === 'ADMIN'`), or a
 * bypass of the current guard. `org_default` carries the bulk of the platform's
 * leads (370k+ rows measured live), so each is a mass data exposure, not a
 * cosmetic issue.
 */
describe('REGRESSION: no accidental cross-tenant fallback to org_default', () => {
  it('1. orphaned NORMAL user (MEMBER) cannot reach org_default', async () => {
    signIn('orphan-member');
    state.members = [];
    state.userRole = [{ role: 'MEMBER', email: 'orphan@example.test' }];
    allowlist(ALLOWLISTED);

    expect(await getOrganization()).toBeNull();
    // The org_default row must never even be requested on this path.
    expect(
      mockSql.mock.calls.some((c) => c[0].join('?').includes("id = 'org_default'"))
    ).toBe(false);
  });

  it('2. orphaned ADMIN not on the allowlist cannot reach org_default', async () => {
    // The exact production scenario: role=ADMIN, no organization, not authorised.
    signIn('orphan-admin');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: NON_ALLOWLISTED }];
    allowlist(ALLOWLISTED);

    expect(await getOrganization()).toBeNull();
  });

  it('2b. orphaned ADMIN with NO allowlist configured cannot reach org_default', async () => {
    signIn('orphan-admin');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: NON_ALLOWLISTED }];

    expect(await getOrganization()).toBeNull();
  });

  it('3. orphaned OWNER cannot reach org_default', async () => {
    signIn('orphan-owner');
    state.members = [];
    state.userRole = [{ role: 'OWNER', email: 'owner@example.test' }];
    allowlist('owner@example.test');

    expect(await getOrganization()).toBeNull();
  });

  it('3b. allowlisted email with non-ADMIN role cannot reach org_default', async () => {
    signIn('demoted');
    state.members = [];
    state.userRole = [{ role: 'MEMBER', email: ALLOWLISTED }];
    allowlist(ALLOWLISTED);

    expect(await getOrganization()).toBeNull();
  });

  it('4. unauthenticated request cannot reach org_default', async () => {
    state.session = null;
    allowlist(ALLOWLISTED);

    expect(await getOrganization()).toBeNull();
  });

  it('4b. a database failure fails CLOSED rather than granting org_default', async () => {
    signIn('db-down');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: ALLOWLISTED }];
    allowlist(ALLOWLISTED);
    mockSql.mockImplementationOnce(async () => {
      throw new Error('connection terminated');
    });

    expect(await getOrganization()).toBeNull();
  });

  it('5. user of org A cannot reach org B via getEffectiveOrganizationId', async () => {
    signIn('user-a');
    state.members = [{ organization_id: 'org_tenant_a', name: 'A', slug: 'a' }];
    state.userRole = [{ role: 'MEMBER', email: 'a@example.test' }];
    state.memberCheck = []; // not a member of B

    expect(await getEffectiveOrganizationId('org_tenant_b')).toBe('org_tenant_a');
  });

  it('6. admin surface cannot override tenant boundaries', async () => {
    // Holding ADMIN inside one tenant must not license reading another.
    signIn('admin-of-a');
    state.members = [{ organization_id: 'org_tenant_a', name: 'A', slug: 'a' }];
    state.userRole = [{ role: 'ADMIN', email: NON_ALLOWLISTED }];
    state.memberCheck = [];
    allowlist(ALLOWLISTED);

    expect(await getEffectiveOrganizationId('org_tenant_b')).toBe('org_tenant_a');
  });

  it('7. an allowlisted platform admin IS granted an explicit org id', async () => {
    // Positive control: without this the suite would also pass if the allowlist
    // were simply ignored, so the authorized path must be proven to work.
    signIn('platform-owner');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: ALLOWLISTED }];
    state.memberCheck = [];
    allowlist(ALLOWLISTED);

    expect(await getEffectiveOrganizationId('org_some_other_tenant')).toBe(
      'org_some_other_tenant'
    );
  });

  it('8. the listing path cannot bypass this', async () => {
    // getUserOrganizations synthesised a fake org_default membership for any
    // role=ADMIN user, advertising a tenant the user was never a member of.
    allowlist(ALLOWLISTED);
    state.userRole = [{ role: 'ADMIN', email: NON_ALLOWLISTED }];

    expect(await getUserOrganizations('random-admin')).toEqual([]);
  });

  it('8b. the allowlisted platform admin DOES get org_default in the listing', async () => {
    // Both paths must agree, or the switcher and the authorization decision
    // disagree - which is the original defect.
    allowlist(ALLOWLISTED);
    state.userRole = [{ role: 'ADMIN', email: ALLOWLISTED }];

    expect(await getUserOrganizations('platform-owner')).toEqual([
      { userId: 'platform-owner', organizationId: 'org_default', role: 'ADMIN' },
    ]);
  });

  it('9. session reuse cannot bypass this - a real membership always wins', async () => {
    signIn('platform-owner-with-org');
    state.members = [{ organization_id: 'org_tenant_z', name: 'Z', slug: 'z' }];
    state.userRole = [{ role: 'ADMIN', email: ALLOWLISTED }];
    allowlist(ALLOWLISTED);

    expect(await getOrganization()).toEqual({ id: 'org_tenant_z', name: 'Z', slug: 'z' });
  });

  it('10. a populated org_default row cannot bypass this', async () => {
    signIn('plain-member');
    state.members = [];
    state.userRole = [{ role: 'MEMBER', email: 'plain@example.test' }];
    state.defaultOrg = [ORG_DEFAULT];

    expect(await getOrganization()).toBeNull();
  });

  it('allowlist matching ignores case and surrounding whitespace', async () => {
    signIn('platform-owner');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: 'Platform.Owner@Example.test' }];
    allowlist('  platform.owner@EXAMPLE.test  ');

    expect(await getOrganization()).toEqual(ORG_DEFAULT);
  });

  it('a whitespace-only allowlist grants nobody', async () => {
    signIn('platform-owner');
    state.members = [];
    state.userRole = [{ role: 'ADMIN', email: ALLOWLISTED }];
    process.env.PLATFORM_ADMIN_EMAILS = ' , , ';

    expect(await getOrganization()).toBeNull();
  });
});

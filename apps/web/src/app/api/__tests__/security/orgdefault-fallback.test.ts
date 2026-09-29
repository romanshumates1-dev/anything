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
    /** row returned by `SELECT role FROM "user"` */
    userRole: [] as any[],
    /** the org_default row, when it exists */
    defaultOrg: [{ id: 'org_default', name: 'Default Organization', slug: 'default' }],
  };

  const mockSql = vi.fn(async (strings: TemplateStringsArray, ..._values: any[]) => {
    const text = strings.join('?');
    if (text.includes('FROM organization_members om')) return state.members;
    if (text.includes('SELECT role FROM "user"')) return state.userRole;
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

import { getOrganization } from '@/lib/organization-context';

function signIn(userId: string) {
  state.session = { user: { id: userId } };
}

beforeEach(() => {
  state.session = null;
  state.members = [];
  state.userRole = [];
  state.defaultOrg = [{ id: 'org_default', name: 'Default Organization', slug: 'default' }];
  mockSql.mockClear();
});

describe('getOrganization - org_default fallback is admin-only', () => {
  it('returns the user\'s own organization when a membership exists', async () => {
    signIn('user-1');
    state.members = [
      { organization_id: 'org_tenant_a', name: 'Tenant A', slug: 'tenant-a' },
    ];
    state.userRole = [{ role: 'MEMBER' }];

    const org = await getOrganization();
    expect(org).toEqual({ id: 'org_tenant_a', name: 'Tenant A', slug: 'tenant-a' });
    // A member must never fall through to the role check / org_default.
    expect(mockSql.mock.calls.some(c => c[0].join('?').includes('SELECT role FROM "user"'))).toBe(
      false
    );
  });

  it('DEFECT FIX: membership-less non-admin gets null, NOT org_default', async () => {
    // Pre-fix this returned org_default and granted access to 370k+ leads.
    signIn('orphan-member');
    state.members = [];
    state.userRole = [{ role: 'MEMBER' }];

    const org = await getOrganization();
    expect(org).toBeNull();
  });

  it('membership-less user with NO role row gets null (fail closed)', async () => {
    signIn('ghost');
    state.members = [];
    state.userRole = []; // user row missing entirely

    expect(await getOrganization()).toBeNull();
  });

  it('membership-less platform ADMIN still resolves org_default', async () => {
    // Mirrors getUserOrganizations, which has always granted org_default to
    // role === 'ADMIN'. The two paths must not disagree.
    signIn('admin-user');
    state.members = [];
    state.userRole = [{ role: 'ADMIN' }];

    const org = await getOrganization();
    expect(org).toEqual({ id: 'org_default', name: 'Default Organization', slug: 'default' });
  });

  it('membership-less ADMIN with no org_default row gets null', async () => {
    signIn('admin-user');
    state.members = [];
    state.userRole = [{ role: 'ADMIN' }];
    state.defaultOrg = [];

    expect(await getOrganization()).toBeNull();
  });

  it('returns null when there is no session at all', async () => {
    state.session = null;
    expect(await getOrganization()).toBeNull();
    // Must not even query the database.
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('never resolves an organization for a membership-less non-admin even when org_default exists', async () => {
    // Regression guard specifically for "org_default exists and is populated".
    signIn('orphan-probe');
    state.members = [];
    state.userRole = [{ role: 'MEMBER' }];
    state.defaultOrg = [{ id: 'org_default', name: 'Default Organization', slug: 'default' }];

    expect(await getOrganization()).toBeNull();
    // The org_default row must not have been requested on this path.
    expect(
      mockSql.mock.calls.some(c => c[0].join('?').includes("id = 'org_default'"))
    ).toBe(false);
  });
});

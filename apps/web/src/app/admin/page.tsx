import Link from 'next/link';
import sql from '@/app/api/utils/sql';

async function getCounts() {
  try {
    const [[users], [banned], [pendingReviews], [suppressions], [audits]] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM "user"`,
      sql`SELECT COUNT(*)::int AS n FROM "user" WHERE banned = true OR (suspended_until IS NOT NULL AND suspended_until > now())`,
      sql`SELECT COUNT(*)::int AS n FROM reviews WHERE status = 'pending'`,
      sql`SELECT COUNT(*)::int AS n FROM compliance_records WHERE type = 'opt-out'`,
      sql`SELECT COUNT(*)::int AS n FROM admin_audit_log`,
    ]);
    return {
      users: users.n, banned: banned.n, pendingReviews: pendingReviews.n,
      suppressions: suppressions.n, audits: audits.n,
    };
  } catch {
    return null;
  }
}

const CARD = 'rounded-xl border bg-white p-6 shadow-sm';

export default async function AdminOverview() {
  const c = await getCounts();
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Overview</h1>
      {!c ? (
        <p className="text-gray-500">Could not load metrics.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/admin/users" className={CARD}>
            <p className="text-sm text-gray-500">Users</p>
            <p className="text-3xl font-bold text-gray-900">{c.users}</p>
            <p className="text-xs text-gray-400 mt-1">{c.banned} banned/suspended</p>
          </Link>
          <Link href="/admin/reviews" className={CARD}>
            <p className="text-sm text-gray-500">Reviews pending</p>
            <p className="text-3xl font-bold text-gray-900">{c.pendingReviews}</p>
          </Link>
          <Link href="/admin/compliance" className={CARD}>
            <p className="text-sm text-gray-500">Suppressed numbers</p>
            <p className="text-3xl font-bold text-gray-900">{c.suppressions}</p>
          </Link>
          <Link href="/admin/audit" className={CARD}>
            <p className="text-sm text-gray-500">Audit entries</p>
            <p className="text-3xl font-bold text-gray-900">{c.audits}</p>
          </Link>
        </div>
      )}
    </div>
  );
}

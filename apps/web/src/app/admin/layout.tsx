import Link from 'next/link';
import { requireAdminPage } from './adminGuard';

export const metadata = { title: 'Admin', robots: { index: false } };

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/reviews', label: 'Reviews' },
  { href: '/admin/billing', label: 'Billing & Refunds' },
  { href: '/admin/compliance', label: 'Compliance' },
  { href: '/admin/audit', label: 'Audit Log' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-bold text-gray-900">Admin</Link>
            <nav className="flex gap-4">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-sm text-gray-600 hover:text-blue-700">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="text-xs text-gray-500">{admin.email}</div>
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}

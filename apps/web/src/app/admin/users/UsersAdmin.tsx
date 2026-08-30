'use client';

import { useEffect, useState, useCallback } from 'react';

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  banned: boolean;
  ban_reason: string | null;
  suspended_until: string | null;
  active_sessions: number;
  last_login_at: string | null;
};

function statusOf(u: User): { label: string; cls: string } {
  if (u.banned) return { label: 'Banned', cls: 'bg-red-100 text-red-700' };
  if (u.suspended_until && new Date(u.suspended_until).getTime() > Date.now())
    return { label: 'Suspended', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Active', cls: 'bg-green-100 text-green-700' };
}

export function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (label: string, fn: () => Promise<Response>) => {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok ? `${label}: done` : `${label}: ${body?.error || res.status}`);
      if (res.ok) await load();
    } catch (e: any) {
      setMsg(`${label}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const ban = (u: User) => {
    const reason = prompt(`Ban ${u.email} — reason (required):`);
    if (!reason) return;
    act(`ban ${u.email}`, () => fetch('/api/admin/bans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: u.id, action: 'ban', reason }) }));
  };
  const suspend = (u: User) => {
    const reason = prompt(`Suspend ${u.email} — reason (required):`);
    if (!reason) return;
    const hours = Number(prompt('Duration in hours:', '24')) || 24;
    act(`suspend ${u.email}`, () => fetch('/api/admin/bans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: u.id, action: 'suspend', reason, durationHours: hours }) }));
  };
  const unban = (u: User) => act(`unban ${u.email}`, () => fetch(`/api/admin/bans?userId=${u.id}`, { method: 'DELETE' }));
  const kick = (u: User) => act(`kick ${u.email}`, () => fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revokeSessions: true }) }));
  const forceReset = (u: User) => {
    if (!confirm(`Force password reset for ${u.email}?`)) return;
    act(`reset ${u.email}`, () => fetch(`/api/admin/users/${u.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'force_password_reset' }) }));
  };
  const gdpr = (u: User) => {
    if (!confirm(`GDPR anonymize ${u.email}? This scrubs PII and bans the account (financial records preserved).`)) return;
    act(`gdpr ${u.email}`, () => fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' }));
  };
  const setRole = (u: User) => {
    const role = u.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
    if (!confirm(`Change ${u.email} to ${role}?`)) return;
    act(`role ${u.email}`, () => fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) }));
  };

  const filtered = users.filter((u) => (u.email + (u.name || '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Users ({users.length})</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email/name"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      {msg && <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{msg}</div>}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Sessions</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((u) => {
                const st = statusOf(u);
                const active = st.label === 'Active';
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{u.email}</div>
                      {u.name && <div className="text-xs text-gray-400">{u.name}</div>}
                    </td>
                    <td className="px-4 py-2">{u.role}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      {u.ban_reason && <div className="text-xs text-gray-400 mt-0.5">{u.ban_reason}</div>}
                    </td>
                    <td className="px-4 py-2">{u.active_sessions}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {active ? (
                          <>
                            <button disabled={!!busy} onClick={() => ban(u)} className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100">Ban</button>
                            <button disabled={!!busy} onClick={() => suspend(u)} className="rounded bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100">Suspend</button>
                          </>
                        ) : (
                          <button disabled={!!busy} onClick={() => unban(u)} className="rounded bg-green-50 px-2 py-1 text-green-700 hover:bg-green-100">Unban</button>
                        )}
                        <button disabled={!!busy} onClick={() => kick(u)} className="rounded bg-gray-100 px-2 py-1 text-gray-700 hover:bg-gray-200">Kick</button>
                        <button disabled={!!busy} onClick={() => forceReset(u)} className="rounded bg-gray-100 px-2 py-1 text-gray-700 hover:bg-gray-200">Reset PW</button>
                        <button disabled={!!busy} onClick={() => setRole(u)} className="rounded bg-gray-100 px-2 py-1 text-gray-700 hover:bg-gray-200">{u.role === 'ADMIN' ? 'Demote' : 'Promote'}</button>
                        <button disabled={!!busy} onClick={() => gdpr(u)} className="rounded bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100">GDPR Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

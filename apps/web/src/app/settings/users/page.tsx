'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { toast } from 'sonner';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  created_at: string;
  last_login_at: string | null;
  active_sessions: number;
}

/**
 * Admin-only user management: list accounts, promote/demote, revoke sessions.
 * The UI is a convenience — every action is authorized server-side in
 * /api/admin/users (requireAdmin + last-admin guard); non-admins get a 403
 * here and are told so.
 */
export default function UsersAdminPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const {
    data: users,
    isLoading,
    error,
  } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users');
      if (res.status === 403) throw new Error('forbidden');
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
    enabled: !!session,
    retry: 0,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      role,
      revokeSessions,
    }: {
      id: string;
      role?: 'ADMIN' | 'MEMBER';
      revokeSessions?: boolean;
    }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, revokeSessions }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Update failed');
      }
      return res.json();
    },
    onSuccess: (data: { email: string; role: string; sessionsRevoked: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success(
        `${data.email} → ${data.role}${data.sessionsRevoked ? ' (sessions revoked)' : ''}`
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (error?.message === 'forbidden') {
    return (
      <div className="p-6 max-w-3xl">
        <Alert>
          <ShieldOff className="h-4 w-4" />
          <AlertTitle>Admin only</AlertTitle>
          <AlertDescription>
            User management requires the ADMIN role. Ask an existing administrator to grant you
            access.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6" />
        <h1 className="text-2xl font-semibold">Users &amp; Access</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Platform access
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Only ADMIN accounts can use the platform (MIN_ACCESS_ROLE). New signups from an allowed
            email domain start as MEMBER and wait on the pending-access page until promoted here.
            The last remaining admin can never be demoted.
          </p>

          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-users-table">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Last login</th>
                    <th className="py-2 pr-4">Sessions</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((u) => (
                    <tr key={u.id} className="border-b last:border-0" data-testid={`user-row-${u.email}`}>
                      <td className="py-2 pr-4">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-gray-500">{u.email}</div>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-gray-600">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">{u.active_sessions}</td>
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        {u.role === 'MEMBER' ? (
                          <Button
                            size="sm"
                            onClick={() => updateMutation.mutate({ id: u.id, role: 'ADMIN' })}
                            disabled={updateMutation.isPending}
                          >
                            Promote to admin
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateMutation.mutate({ id: u.id, role: 'MEMBER' })}
                            disabled={updateMutation.isPending}
                          >
                            Demote to member
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateMutation.mutate({ id: u.id, revokeSessions: true })}
                          disabled={updateMutation.isPending}
                        >
                          Revoke sessions
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

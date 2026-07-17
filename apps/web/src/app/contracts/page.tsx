'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText } from 'lucide-react';
import InspectionClockChip from '@/components/contracts/InspectionClockChip';

export default function ContractsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => {
      const res = await fetch('/api/contracts');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Contracts</h1>
          <p className="text-gray-500 mt-1">Manage and track contracts</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : !contracts || contracts.length === 0 ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No contracts yet.</p>
              <p className="text-sm text-gray-400 mt-1">Contracts will appear here after deals are agreed.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {contracts.map((contract: any) => (
              <Card key={contract.id} className="border-none shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Contract #{contract.id}</CardTitle>
                    <Badge variant="outline" className={
                      contract.status === 'PENDING_SIGNATURE' ? 'bg-amber-50 text-amber-700' :
                      contract.status === 'SIGNED' ? 'bg-green-50 text-green-700' :
                      'bg-gray-50 text-gray-600'
                    }>
                      {contract.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {/* Phase V-R: inspection-window countdown (7–14 days to assign) */}
                  <InspectionClockChip
                    createdAt={contract.created_at}
                    inspectionDays={contract.inspection_days}
                    assignedAt={contract.assigned_at}
                  />
                  <p className="text-sm text-gray-500">Direction: {contract.direction}</p>
                  <p className="text-sm text-gray-500">Created: {new Date(contract.created_at).toLocaleDateString()}</p>
                  {contract.signed_at && (
                    <p className="text-sm text-gray-500">Signed: {new Date(contract.signed_at).toLocaleDateString()}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
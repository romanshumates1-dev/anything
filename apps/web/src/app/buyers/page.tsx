'use client';

import { redirect } from 'next/navigation';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, CheckCircle, XCircle } from 'lucide-react';

interface Buyer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  zip_codes?: string[];
  min_price?: number;
  max_price?: number;
  property_types?: string[];
  verified: boolean;
  created_at: string;
}

export default function BuyersPage() {
  const { data: session, isPending: authLoading } = useSession();

  // Defect #41. `GET /api/buyers` responds with `{ buyers: [...] }`, but this
  // query did `return res.json()` typed as `Buyer[]`. The object was handed to
  // `buyers.map(...)`, which threw `TypeError: buyers.map is not a function`
  // and took down the whole page (caught by the error boundary).
  //
  // Two things were wrong, not one: the response shape was ignored, AND a
  // non-OK response was swallowed into `[]`, so a genuine API failure would
  // have rendered as "no buyers yet" - an empty state faking a success. Errors
  // are now surfaced so a broken endpoint cannot look like an empty account.
  const {
    data: buyersData,
    isLoading,
    error: buyersError,
  } = useQuery<Buyer[]>({
    queryKey: ['buyers'],
    queryFn: async () => {
      const res = await fetch('/api/buyers');
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (payload && (payload as { error?: string }).error) ||
            `Buyers request failed (${res.status})`
        );
      }
      const list = (payload as { buyers?: unknown } | null)?.buyers;
      if (!Array.isArray(list)) {
        throw new Error('Buyers response was not a list');
      }
      return list as Buyer[];
    },
    enabled: !!session,
  });

  const buyers: Buyer[] = buyersData ?? [];

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  // A failed request must not look like an empty buyer network - that is how a
  // broken endpoint hides behind a plausible empty state.
  if (buyersError) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Could not load buyers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {buyersError instanceof Error
                ? buyersError.message
                : 'Unknown error loading buyers.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8" />
          <h1 className="text-3xl font-bold">Buyer Network</h1>
        </div>
        <Badge variant="outline">{buyers.length} buyers</Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : buyers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No buyers in your network yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {buyers.map((buyer) => (
            <Card key={buyer.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{buyer.name}</CardTitle>
                  {buyer.verified ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">{buyer.email}</p>
                {buyer.phone && <p>{buyer.phone}</p>}
                {buyer.zip_codes && buyer.zip_codes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {buyer.zip_codes.slice(0, 5).map((zip) => (
                      <Badge key={zip} variant="secondary" className="text-xs">
                        {zip}
                      </Badge>
                    ))}
                    {buyer.zip_codes.length > 5 && (
                      <Badge variant="secondary" className="text-xs">
                        +{buyer.zip_codes.length - 5}
                      </Badge>
                    )}
                  </div>
                )}
                {(buyer.min_price || buyer.max_price) && (
                  <p className="text-muted-foreground">
                    ${buyer.min_price?.toLocaleString() || 0} - $
                    {buyer.max_price?.toLocaleString() || 'No max'}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

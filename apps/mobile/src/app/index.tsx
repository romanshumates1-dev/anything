import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '@/utils/auth/useAuth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Users,
  AlertTriangle,
  Activity,
  ShieldCheck,
  LogOut,
  ChevronRight,
} from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/utils/auth/getSession';

export default function MobileDashboard() {
  const { auth, signIn, signOut, isReady } = useAuth();
  const insets = useSafeAreaInsets();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await authFetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!auth,
  });

  if (!isReady) return null;

  if (!auth) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: 'white',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 40,
        }}
      >
        <ShieldCheck size={64} color="#357AFF" style={{ marginBottom: 24 }} />
        <Text style={{ fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 }}>
          DealFlow AI
        </Text>
        <Text style={{ fontSize: 16, color: '#6B7280', textAlign: 'center', marginBottom: 32 }}>
          Production-grade real estate automation. Sign in to manage your deal flow.
        </Text>
        <TouchableOpacity
          onPress={() => signIn()}
          style={{
            backgroundColor: '#357AFF',
            paddingVertical: 16,
            paddingHorizontal: 40,
            borderRadius: 12,
            width: '100%',
          }}
        >
          <Text style={{ color: 'white', fontSize: 18, fontWeight: '600', textAlign: 'center' }}>
            Sign In
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const statCards = [
    { name: 'Total Leads', value: stats?.totalLeads || 0, icon: Users, color: '#3B82F6' },
    {
      name: 'Requires Human',
      value: stats?.requiresHuman || 0,
      icon: AlertTriangle,
      color: '#F59E0B',
    },
    { name: 'Pending Jobs', value: stats?.pendingJobs || 0, icon: Activity, color: '#8B5CF6' },
    { name: 'Audit Logs', value: stats?.auditCount || 0, icon: ShieldCheck, color: '#10B981' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB', paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 32,
          }}
        >
          <View>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#111827' }}>Dashboard</Text>
            <Text style={{ fontSize: 14, color: '#6B7280' }}>{auth.user.email}</Text>
          </View>
          <TouchableOpacity onPress={() => signOut()}>
            <LogOut size={24} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
          {statCards.map((stat) => (
            <View
              key={stat.name}
              style={{
                width: '48%',
                backgroundColor: 'white',
                padding: 16,
                borderRadius: 16,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 2,
                elevation: 2,
              }}
            >
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}
              >
                <Text style={{ fontSize: 12, color: '#6B7280' }}>{stat.name}</Text>
                <stat.icon size={16} color={stat.color} />
              </View>
              {statsLoading ? (
                <ActivityIndicator size="small" color={stat.color} />
              ) : (
                <Text style={{ fontSize: 20, fontWeight: 'bold' }}>{stat.value}</Text>
              )}
            </View>
          ))}
        </View>

        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>System Health</Text>
          <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16 }}>
            {[
              { name: 'Database', status: 'Operational', color: '#10B981' },
              { name: 'AI Orchestrator', status: 'Operational', color: '#10B981' },
              { name: 'Job Queue', status: 'Active', color: '#10B981' },
            ].map((item, idx) => (
              <View
                key={item.name}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderBottomWidth: idx === 2 ? 0 : 1,
                  borderBottomColor: '#F3F4F6',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }}
                  />
                  <Text style={{ fontSize: 15, color: '#374151' }}>{item.name}</Text>
                </View>
                <Text style={{ fontSize: 14, color: item.color, fontWeight: '500' }}>
                  {item.status}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={{
            backgroundColor: 'white',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 20,
            borderRadius: 16,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Users size={24} color="#357AFF" />
            <Text style={{ fontSize: 16, fontWeight: '600' }}>Manage Leads</Text>
          </View>
          <ChevronRight size={20} color="#D1D5DB" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

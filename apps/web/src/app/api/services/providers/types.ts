export interface ProviderConfig {
  id: string;
  name: string;
  type: 'sms' | 'email' | 'phone' | 'ai';
  enabled: boolean;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: Date;
  latency?: number;
  error?: string;
}

export interface ProviderUsage {
  requests: number;
  cost: number;
  period: string;
}

export interface BaseProvider {
  readonly id: string;
  readonly type: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
  getUsage(): Promise<ProviderUsage>;
}

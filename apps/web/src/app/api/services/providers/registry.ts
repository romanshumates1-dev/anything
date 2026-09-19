import type { BaseProvider, ProviderHealth } from './types';

class ProviderRegistry {
  private providers = new Map<string, BaseProvider>();

  register(provider: BaseProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  get(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }

  getByType(type: string): BaseProvider[] {
    return Array.from(this.providers.values()).filter(p => p.type === type);
  }

  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  async healthCheckAll(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>();
    for (const [id, provider] of this.providers) {
      try {
        results.set(id, await provider.healthCheck());
      } catch (error) {
        results.set(id, {
          status: 'down',
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  async connectAll(): Promise<void> {
    const promises = Array.from(this.providers.values()).map(p => p.connect());
    await Promise.all(promises);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.providers.values()).map(p => p.disconnect());
    await Promise.all(promises);
  }
}

export const providerRegistry = new ProviderRegistry();

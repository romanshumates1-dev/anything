'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Cpu, Cloud, Plug, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface AiConfig {
  provider: 'anthropic' | 'ollama';
  ollamaBaseUrl: string;
  ollamaModel: string;
  source: 'db' | 'env' | 'default';
  defaults?: { ollamaBaseUrl: string; ollamaModel: string };
}

export default function AiProviderCard() {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<'anthropic' | 'ollama'>('anthropic');
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('llama3.1:8b');
  const [status, setStatus] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const { data, isLoading } = useQuery<AiConfig>({
    queryKey: ['ai-provider'],
    queryFn: async () => {
      const res = await fetch('/api/settings/ai-provider');
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
  });

  useEffect(() => {
    if (data) {
      setProvider(data.provider);
      setBaseUrl(data.ollamaBaseUrl || 'http://localhost:11434');
      setModel(data.ollamaModel || 'llama3.1:8b');
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/ai-provider', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, ollamaBaseUrl: baseUrl, ollamaModel: model }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'save failed');
      return res.json();
    },
    onSuccess: () => {
      toast.success(`AI provider set to ${provider === 'ollama' ? 'Local (Ollama)' : 'Anthropic'}`);
      qc.invalidateQueries({ queryKey: ['ai-provider'] });
      setStatus(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/system/ai-status');
      setStatus(await res.json());
    } catch (e: any) {
      setStatus({ reachable: false, detail: String(e?.message || e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
          <Plug className="h-5 w-5" />
          AI Provider
          {data && (
            <Badge variant="outline" className="ml-2 font-normal border-[var(--border-subtle)] text-[var(--text-muted)]">
              active: {data.provider === 'ollama' ? `Local - ${data.ollamaModel}` : 'Anthropic'} ({data.source})
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
          <AlertTitle className="text-[var(--text-primary)]">Use hosted Claude, or run a local model for free</AlertTitle>
          <AlertDescription className="text-xs text-[var(--text-muted)]">
            Choose the Anthropic API (best quality, needs credits) or a local open-source model via
            Ollama (no per-message cost; needs a machine with 6-8 GB free RAM). The app&apos;s negotiator/
            classifier uses whichever is selected here.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setProvider('anthropic')}
                className={`text-left border rounded-lg p-3 transition-all ${provider === 'anthropic' ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] hover:border-[var(--border-medium)]'}`}
              >
                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]"><Cloud className="h-4 w-4" /> Anthropic (hosted)</div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Claude API with credits. Highest quality.</p>
              </button>
              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`text-left border rounded-lg p-3 transition-all ${provider === 'ollama' ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] hover:border-[var(--border-medium)]'}`}
              >
                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]"><Cpu className="h-4 w-4" /> Local (Ollama)</div>
                <p className="text-xs text-[var(--text-muted)] mt-1">Self-hosted open model. Free per message.</p>
              </button>
            </div>

            {provider === 'ollama' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--text-secondary)]">Ollama base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-[var(--text-secondary)]">Model (6-8 GB)</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1:8b" className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="btn-gradient">
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save
              </Button>
              <Button variant="outline" onClick={test} disabled={testing} className="border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
                {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plug className="h-4 w-4 mr-1" />}Test connection
              </Button>
            </div>

            {status && (
              <Alert className={status.reachable ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10' : 'border-[var(--color-error)]/30 bg-[var(--color-error)]/10'}>
                <AlertTitle className={`text-sm ${status.reachable ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>{status.reachable ? 'Reachable' : 'Not reachable'}</AlertTitle>
                <AlertDescription className="text-xs text-[var(--text-muted)]">{status.detail}</AlertDescription>
              </Alert>
            )}

            <div>
              <button type="button" className="text-xs text-[var(--text-muted)] flex items-center gap-1 hover:text-[var(--text-secondary)]" onClick={() => setShowGuide((s) => !s)}>
                {showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                How to launch a local model with Ollama
              </button>
              {showGuide && (
                <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded-lg p-3 space-y-1 font-mono border border-[var(--border-subtle)]">
                  <div className="text-[var(--text-muted)]"># 1. Install Ollama (ollama.com/download), then:</div>
                  <div>ollama serve                # starts the local server on :11434</div>
                  <div>ollama pull llama3.1:8b      # ~4.7 GB; or qwen2.5:7b / mistral:7b</div>
                  <div className="font-sans pt-1 text-[var(--text-muted)]">2. Set provider = Local (Ollama) above, Save, then Test connection.</div>
                  <div className="font-sans text-[var(--text-muted)]">3. For prod (Vercel can&apos;t reach localhost): expose Ollama over HTTPS with auth (Cloudflare Tunnel free, or a VPS) and point the base URL there.</div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

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
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          AI Provider
          {data && (
            <Badge variant="outline" className="ml-2 font-normal">
              active: {data.provider === 'ollama' ? `Local · ${data.ollamaModel}` : 'Anthropic'} ({data.source})
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Use hosted Claude, or run a local model for free</AlertTitle>
          <AlertDescription className="text-xs">
            Choose the Anthropic API (best quality, needs credits) or a local open-source model via
            Ollama (no per-message cost; needs a machine with ~6–8 GB free RAM). The app's negotiator/
            classifier uses whichever is selected here — behavior is identical, only the backend changes.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-30" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setProvider('anthropic')}
                className={`text-left border rounded-lg p-3 ${provider === 'anthropic' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2 font-medium"><Cloud className="h-4 w-4" /> Anthropic (hosted)</div>
                <p className="text-xs text-gray-500 mt-1">Claude API with credits. Highest quality.</p>
              </button>
              <button
                type="button"
                onClick={() => setProvider('ollama')}
                className={`text-left border rounded-lg p-3 ${provider === 'ollama' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2 font-medium"><Cpu className="h-4 w-4" /> Local (Ollama)</div>
                <p className="text-xs text-gray-500 mt-1">Self-hosted open model. Free per message.</p>
              </button>
            </div>

            {provider === 'ollama' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Ollama base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Model (6–8 GB)</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="llama3.1:8b" />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save
              </Button>
              <Button variant="outline" onClick={test} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plug className="h-4 w-4 mr-1" />}Test connection
              </Button>
            </div>

            {status && (
              <Alert className={status.reachable ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}>
                <AlertTitle className="text-sm">{status.reachable ? '✅ Reachable' : '❌ Not reachable'}</AlertTitle>
                <AlertDescription className="text-xs">{status.detail}</AlertDescription>
              </Alert>
            )}

            <div>
              <button type="button" className="text-xs text-gray-500 flex items-center gap-1" onClick={() => setShowGuide((s) => !s)}>
                {showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                How to launch a local model with Ollama
              </button>
              {showGuide && (
                <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-3 space-y-1 font-mono">
                  <div># 1. Install Ollama (ollama.com/download), then:</div>
                  <div>ollama serve                # starts the local server on :11434</div>
                  <div>ollama pull llama3.1:8b      # ~4.7 GB; or qwen2.5:7b / mistral:7b</div>
                  <div className="font-sans pt-1 text-gray-500">2. Set provider = Local (Ollama) above, Save, then Test connection.</div>
                  <div className="font-sans text-gray-500">3. For prod (Vercel can't reach localhost): expose Ollama over HTTPS with auth (Cloudflare Tunnel free, or a VPS) and point the base URL there. See DEPLOY.md §7c — set OLLAMA_API_KEY so the endpoint isn't open.</div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

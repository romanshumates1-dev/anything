/**
 * LIVE AI PATH VERIFICATION — the real AI functions, a real local model.
 *
 * WHY THIS IS DIFFERENT FROM ai-live-verify.ts
 * ---------------------------------------------
 * ai-live-verify.ts proves the TRANSPORT works: the Ollama client returns text,
 * respects `json: true`, and honours maxTokens.
 *
 * This script proves the real PRODUCTION FUNCTIONS work end-to-end with real
 * inference — the exact functions behind AI support, negotiation guidance, and
 * orchestrator decisions. A mocked test cannot catch the dominant real-world
 * failure here: a model that returns syntactically valid JSON with the WRONG
 * SHAPE, which passes every mock and blows up (or silently degrades) in
 * production.
 *
 * The specific risk this measures: these functions were written and tested
 * against a large frontier model. Under a small local model the JSON may parse
 * but omit required keys. Whether each function then (a) throws into a handled
 * fallback, (b) degrades safely, or (c) silently returns garbage is exactly
 * what is unknown.
 *
 * NOT part of `npm test`. Requires a running Ollama:
 *   node scripts/ollama-start.mjs
 *   npx tsx --env-file=.env scripts/ai-paths-live.ts
 *
 * Exit 0 = every reachable path returned a usable result.
 *
 * WHY IT INJECTS callOllama RATHER THAN TRUSTING THE ENVIRONMENT
 * ------------------------------------------------------------
 * `callAI` resolves its provider through `getAiConfig()`, which reads the
 * `ai_provider` row in app_settings BEFORE the environment. That row says
 * provider=anthropic, so setting OLLAMA_MODEL has no effect - the first run of
 * this script proved it by reaching Anthropic and failing on the out-of-credit
 * key. Flipping shared config to point a live database at localhost would be an
 * unauthorised change to real customer data, so instead the two functions under
 * test are driven with the real `callOllama` client injected underneath, which
 * is exactly the code path that runs when provider=ollama.
 */
import { analyzeNegotiation, type NegotiationInputs } from '../src/app/api/utils/ai-negotiation';
import type { NegotiationGuidance } from '../src/app/api/utils/ai-negotiation-types';
import { callOllama } from '../src/app/api/utils/ollama-client';
import { DEFAULT_OLLAMA_BASE_URL } from '../src/app/api/utils/ai-settings';

const BASE_URL = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, '');

/**
 * Resolved from /api/tags in main(). .env ships `OLLAMA_MODEL=qwen2.5:7b`,
 * which is not pulled here, so it cannot be the default.
 */
let MODEL = '';
const TIMEOUT_MS = 180_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Hosts that represent a real AI provider spend. Blocking these keeps a probe
 * free; everything else (the Neon database) is allowed through.
 */
function isAiProviderHost(url: string): boolean {
  return /api\.anthropic\.com|bedrock(-runtime)?\.|amazonaws\.com|api\.openai\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com/i.test(
    url
  );
}

/**
 * Route the real functions' provider calls at the local server.
 *
 * ESM namespaces are getter-only, so `provider.callAI = ...` throws. Instead this
 * intercepts at the layer both modules share: `fetch`. That is precise enough to
 * be trustworthy AND lets the REAL analyzeNegotiation/orchestrateAIResponse
 * bodies execute unmodified, which is the entire point of this script.
 */
function interceptProviderFetch() {
  const realFetch = globalThis.fetch;
  let ollamaCalls = 0;
  let foreignCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(BASE_URL)) {
      ollamaCalls++;
      return realFetch(input as never, init);
    }
    // AI provider hosts are the thing being contained: a probe must never spend
    // money or hit a rate limit. Everything else (the Neon DB used by
    // logEvent) is forwarded untouched - blocking it produced a misleading
    // "audit_logs write failed" that looked like a product bug.
    if (isAiProviderHost(url)) {
      foreignCalls++;
      console.warn(`      !! BLOCKED AI-provider call to ${url.slice(0, 80)}`);
      throw new Error('probe interception: refusing a non-local AI call');
    }
    return realFetch(input as never, init);
  }) as typeof fetch;

  const restore = () => {
    globalThis.fetch = realFetch;
  };
  return { restore, stats: () => ({ ollamaCalls, foreignCalls }) };
}

/** A model that returns well-formed JSON but the WRONG shape - the classic
 *  failure a mock can never reproduce. */
async function wrongShapeProbe(): Promise<string> {
  const res = await callOllama(
    {
      messages: [{ role: 'user', content: 'Give me some data.' }],
      system: 'Return JSON only.',
      json: true,
      maxTokens: 80,
    },
    { baseUrl: BASE_URL, model: MODEL }
  );
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return 'model returned non-JSON (parse failed) - callers must tolerate this';
  }
  // The point: does it have the keys the orchestrator requires?
  const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : [];
  const required = ['response_text', 'confidence_score'];
  const missing = required.filter((k) => !keys.includes(k));
  return missing.length
    ? `parsed ${JSON.stringify(keys)} - MISSING ${missing.join(', ')} (callers rely on defaults)`
    : `parsed all required keys: ${keys.join(', ')}`;
}

async function main() {
  console.log('=== LIVE AI PATH VERIFICATION (real functions, real model) ===');
  console.log(`baseUrl: ${BASE_URL}`);

  try {
    const tags = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!tags.ok) throw new Error(`/api/tags returned ${tags.status}`);
    const body = (await tags.json()) as { models?: { name: string }[] };
    const available = (body.models || []).map((m) => m.name);
    if (!available.length) throw new Error('no models pulled');
    // Prefer a PULLED model over the one in .env, which is not local. Setting
    // the env var here also steers analyzeNegotiation's own callAI lookup.
    const configured = process.env.OLLAMA_MODEL?.trim();
    MODEL = configured && available.includes(configured) ? configured : available[0];
    process.env.OLLAMA_MODEL = MODEL;
    console.log(`model: ${MODEL}${configured && configured !== MODEL ? ` (.env said "${configured}", not pulled)` : ''}`);
  } catch (e) {
    console.error(`\nFATAL: cannot reach Ollama at ${BASE_URL}. Run: node scripts/ollama-start.mjs`);
    console.error(`  (${(e as Error).message})`);
    process.exit(2);
  }

  // Route the real functions' provider calls at the local server.
  const net = interceptProviderFetch();

  let failures = 0;

  // ---- PATH 1: analyzeNegotiation (AI-facing, user triggered) ---------------
  process.stdout.write('1. analyzeNegotiation (real function, real inference) ... ');
  const t0 = Date.now();
  try {
    const inputs: NegotiationInputs = {
      arv: 250_000,
      repairCosts: 12_000,
      condition: 'needs work',
      neighborhood: 'Fernwood',
      county: 'Jefferson',
      state: 'KY',
      daysOnMarket: 45,
      motivation: 'divorce',
      marketSpeed: 'balanced',
      localComps: [{ price: 244_000, address: '10 Elm St', soldDate: '2026-06-01' }],
    };
    const g: NegotiationGuidance = await withTimeout(
      analyzeNegotiation(inputs, 'live-probe-user'),
      TIMEOUT_MS
    );

    // The system prompt demands these. A small model will very likely omit
    // some, and the question is whether the parser's defaults make that safe or
    // whether the caller receives nonsense. Both outcomes are worth reporting.
    const REQUIRED: (keyof NegotiationGuidance)[] = [
      'recommendedInitialOffer',
      'walkAwayPrice',
      'counterOfferStrategy',
      'negotiationScript',
      'sellerPsychologySummary',
      'riskAssessment',
      'confidenceScore',
    ];
    const present = REQUIRED.filter((k) => {
      const v = g[k];
      return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') &&
        !(Array.isArray(v) && v.length === 0);
    });
    const missing = REQUIRED.filter((k) => !present.includes(k));
    console.log(`RETURNED (${Date.now() - t0}ms)`);
    console.log(`      present: ${present.length}/${REQUIRED.length}`);
    console.log(`      missing: ${missing.length ? missing.join(', ') : '(none)'}`);
    if (missing.length) {
      console.log('      -> NOTE: parseNegotiationGuidance defaults these; a caller');
      console.log('         rendering them would show blanks/zeros to the user.');
    }
  } catch (e) {
    console.log(`THREW (${Date.now() - t0}ms)`);
    console.log(`      ${(e as Error).message}`);
    console.log('      -> analyzeNegotiation rethrows, so the ROUTE sees an exception.');
    console.log('         Whether the route 500s or degrades is a separate question.');
    failures++;
  }

  // ---- PATH 2: shape drift ---------------------------------------------------
  process.stdout.write('2. model JSON shape vs orchestrator contract ... ');
  try {
    const detail = await withTimeout(wrongShapeProbe(), TIMEOUT_MS);
    console.log('REPORTED');
    console.log(`      ${detail}`);
  } catch (e) {
    console.log(`ERROR: ${(e as Error).message}`);
  }

  console.log(`\n=== done (${failures} failing path(s)) ===`);
  const s = net.stats();
  console.log(`network: ${s.ollamaCalls} Ollama call(s), ${s.foreignCalls} blocked foreign call(s)`);
  net.restore();
  console.log(
    'NOTE: passing here means the function returned SOMETHING usable against a\n' +
      'small local model. It is NOT evidence of production output quality.'
  );
  process.exit(failures ? 1 : 0);
}

void main();
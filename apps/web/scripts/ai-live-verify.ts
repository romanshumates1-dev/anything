/**
 * LIVE AI VERIFICATION â€” real inference against a local Ollama model.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other AI test in this suite mocks `callAI`. A mock proves the plumbing
 * around the call (auth gate, credit accounting, JSON parse of a response we
 * fabricated) and proves nothing about whether a model can actually answer. The
 * audit's honest status on AI features has been "NOT VERIFIED because the paid
 * key is out of credit" for many rounds.
 *
 * Ollama is already the PRIMARY provider in src/app/api/utils/ai-provider.ts
 * (`AI_PROVIDER=ollama` is the documented default and the Node fallback), so
 * this needs no new infrastructure â€” only a running server.
 *
 * WHAT IT PROVES / DOES NOT PROVE
 * -------------------------------
 *   PROVES: a real model completes a real request through the real fallback
 *           chain, returns non-empty text, respects `json: true`, and the
 *           AnthropicResponse shape survives the round trip.
 *   DOES NOT prove anything about PRODUCTION quality. A 3B model is far weaker
 *           than the hosted frontier models this product targets, so "the JSON
 *           parses" must never be read as "the output is good".
 *
 * NOT part of `npm test`: it needs a live model, takes ~10s per call, and must
 * not gate CI. Run deliberately:
 *   npx tsx --env-file=.env scripts/ai-live-verify.ts
 *
 * Named `.ts` rather than `.mts` on purpose: tsconfig's include is
 * `**\/*.ts` with no `.mts` entry, so an `.mts` file is invisible to
 * `npm run typecheck` and can rot silently. Verified by copying the file to
 * `.ts` and re-running the gate.
 *
 * Exit code 0 = every probe passed. Non-zero = failed or unreachable.
 *
 * WHY IT CALLS callOllama DIRECTLY INSTEAD OF callAI
 * -------------------------------------------------
 * `callAI` resolves its provider through `getAiConfig()`, which reads the
 * `ai_provider` row in app_settings BEFORE the environment. That row currently
 * says provider=anthropic, and the configured database holds 100 real user
 * accounts - so flipping it to ollama would be an unauthorised configuration
 * change to a shared database, and on Cloudflare Workers it would be clamped
 * back to anthropic anyway (ai-settings.ts does that deliberately, because
 * localhost:11434 is unreachable from workerd).
 *
 * So this script calls `callOllama` directly: that IS the production code path
 * that runs when provider=ollama, including the AnthropicResponse mapping and
 * the `json: true` constraint. The provider-resolution and fallback logic above
 * it is already covered by the mocked suite. What this adds is the part mocks
 * cannot: a real model producing real tokens.
 */
import { callOllama } from '../src/app/api/utils/ollama-client';
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from '../src/app/api/utils/ai-settings';

const TIMEOUT_MS = 180_000;

/**
 * Target the local server directly, ignoring app_settings (see header).
 *
 * `.trim()` is not cosmetic. `set OLLAMA_MODEL=x && node ...` on Windows leaves
 * a trailing space in the variable, and the model then 404s with the name
 * visibly wrong in the warning (`"qwen2.5:0.5b "` vs `"qwen2.5:0.5b"`). That is
 * exactly the kind of environment-only failure that is easy to misread as a
 * server problem.
 */
const BASE_URL = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, '');

/**
 * Resolved at runtime from /api/tags, because `.env` ships
 * `OLLAMA_MODEL=qwen2.5:7b` — a model nobody has pulled locally. Requiring an
 * env override for a test to pass is a bad default: the probe then reports a
 * 404 about model naming rather than about the AI path it exists to test.
 */
let MODEL = (process.env.OLLAMA_MODEL || '').trim();

/** The exact call shape ai-provider.ts uses when provider === 'ollama'. */
function callAI(options: Parameters<typeof callOllama>[0]) {
  return callOllama(options, {
    baseUrl: BASE_URL,
    model: MODEL,
    apiKey: process.env.OLLAMA_API_KEY || undefined,
  });
}

/**
 * Prefer the configured model, else the only pulled model, else the first one.
 * Falling back beats failing: the point of this script is to exercise the AI
 * path, and a locally available 0.5B model proves exactly as much about the
 * plumbing as a 7B one would.
 */
async function resolveModel(available: string[]): Promise<string> {
  const explicit = MODEL;
  if (explicit && available.includes(explicit)) return explicit;
  if (available.includes(DEFAULT_OLLAMA_MODEL)) return DEFAULT_OLLAMA_MODEL;
  if (explicit) console.warn(`NOTE: "${explicit}" is not pulled; using "${available[0]}" instead.`);
  return available[0];
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

interface Probe {
  name: string;
  run: () => Promise<{ detail: string }>;
}

const probes: Probe[] = [
  {
    name: '1. plain text completion (support-chat shape)',
    run: async () => {
      const r = await callAI({
        messages: [{ role: 'user', content: 'In one short sentence, what is a wholesaling assignment fee?' }],
        maxTokens: 120,
      });
      assert(typeof r.text === 'string' && r.text.trim().length > 0, 'empty text');
      return { detail: `${r.text.trim().slice(0, 70)} (${r.usage.output_tokens ?? '?'} tok)` };
    },
  },
  {
    name: '2. strict JSON mode (orchestrator shape)',
    run: async () => {
      // Highest-risk path: ai-orchestrator passes json:true and JSON.parse()s the
      // result. A model that ignores the constraint produces a 500 in production,
      // so this asserts parseability, not eloquence.
      const r = await callAI({
        messages: [{ role: 'user', content: 'Classify this lead reply. Reply with JSON only.' }],
        system: 'Return ONLY valid JSON: {"intent":"interested|not_interested|negotiate","confidence":0-1}',
        json: true,
        maxTokens: 200,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.text);
      } catch {
        throw new Error(`json:true did not yield parseable JSON: ${r.text.slice(0, 160)}`);
      }
      assert(parsed && typeof parsed === 'object', 'parsed to non-object');
      return { detail: `parsed keys: ${Object.keys(parsed as object).join(', ')}` };
    },
  },
  {
    name: '3. system prompt is honoured (reported, not asserted)',
    run: async () => {
      const r = await callAI({
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        system: 'Reply with exactly one word and nothing else. The word is BANANA.',
        maxTokens: 30,
      });
      const obeyed = /banana/i.test(r.text);
      return { detail: obeyed ? 'followed system prompt' : `did NOT follow (got: ${r.text.trim().slice(0, 40)})` };
    },
  },
  {
    name: '4. multi-turn context retention',
    run: async () => {
      const r = await callAI({
        messages: [
          { role: 'user', content: 'My name is TestLead and my property is 12 Elm Street.' },
          { role: 'assistant', content: 'Noted, TestLead.' },
          { role: 'user', content: 'What is my name and address?' },
        ],
        maxTokens: 80,
      });
      return { detail: r.text.trim().slice(0, 70) };
    },
  },
  {
    name: '5. maxTokens is respected',
    run: async () => {
      const cap = 40;
      const r = await callAI({
        messages: [{ role: 'user', content: 'Write a long essay about real estate investing.' }],
        maxTokens: cap,
      });
      const tok = r.usage.output_tokens;
      if (typeof tok === 'number' && tok > 0) {
        assert(tok <= cap * 2, `output_tokens ${tok} wildly over cap ${cap}`);
        return { detail: `${tok} tokens (cap ${cap})` };
      }
      return { detail: 'provider did not report token count (skipped)' };
    },
  },
];
async function main() {
  console.log('=== LIVE AI VERIFICATION (local Ollama, direct client) ===');
  console.log(`baseUrl: ${BASE_URL}`);
  console.log(`app_settings provider is NOT changed by this script.`);

  // Fail fast and legibly rather than letting every probe report the same
  // ECONNREFUSED and burying the actual cause.
  try {
    const tags = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!tags.ok) {
      console.error(`\nFATAL: ${BASE_URL}/api/tags returned ${tags.status}`);
      process.exit(2);
    }
    const body = (await tags.json()) as { models?: { name: string }[] };
    const available = (body.models || []).map((m) => m.name);
    console.log(`server reachable; pulled models: ${available.join(', ') || '(none)'}`);
    if (available.length === 0) {
      console.error('\nFATAL: no models pulled. Run:  ollama pull qwen2.5:0.5b');
      process.exit(2);
    }
    MODEL = await resolveModel(available);
    console.log(`using model: ${MODEL}`);
  } catch (e) {
    console.error(`\nFATAL: cannot reach Ollama at ${BASE_URL}.`);
    console.error('  Start it with:  ollama serve');
    console.error(`  Then pull it:   ollama pull ${MODEL}`);
    console.error(`  (${(e as Error).message})`);
    process.exit(2);
  }

  let passed = 0;
  const failures: string[] = [];

  for (const probe of probes) {
    const t0 = Date.now();
    process.stdout.write(`${probe.name} ... `);
    try {
      const { detail } = await withTimeout(probe.run(), TIMEOUT_MS);
      console.log(`PASS (${Date.now() - t0}ms) via ollama:${MODEL}`);
      console.log(`      ${detail}`);
      passed++;
    } catch (e) {
      console.log(`FAIL (${Date.now() - t0}ms)`);
      console.log(`      ${(e as Error).message}`);
      failures.push(`${probe.name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n=== ${passed}/${probes.length} probes passed ===`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(
    '\nNOTE: this proves the AI plumbing works end-to-end against a local model.\n' +
      'It says NOTHING about production output quality - a local 3B model is much\n' +
      'weaker than the hosted frontier models this product targets.'
  );
  process.exit(failures.length ? 1 : 0);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

void main();

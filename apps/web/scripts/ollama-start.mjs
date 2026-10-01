/**
 * Start the local Ollama server used by scripts/ai-live-verify.ts.
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Ollama is a per-developer-machine dependency, not a repo artifact, so the
 * environment it needs has to be written down somewhere. This box needs three
 * non-default settings, each of which cost a debugging cycle to discover:
 *
 *   OLLAMA_MODELS=D:\ollama\models
 *     The default is ~/.ollama, i.e. C:. This machine has 1.8 GB free on C:,
 *     which cannot hold a model. Override with OLLAMA_ROOT.
 *
 *   OLLAMA_LOAD_TIMEOUT=30m
 *     The 5m default timed out here ("Load failed: timed out") AFTER the model
 *     had already loaded onto the GPU - so it looks like a hang, not a failure.
 *
 *   OLLAMA_KEEP_ALIVE=30m
 *     Avoids reloading the model between probes; the 5m default unloads it
 *     while a human is reading output.
 *
 * USAGE
 *   node scripts/ollama-start.mjs                 # start if not already up
 *   node scripts/ollama-start.mjs --status        # just report
 *   node scripts/ollama-start.mjs --pull qwen2.5:0.5b
 *
 * Override the install location with OLLAMA_ROOT (default D:\ollama).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.OLLAMA_ROOT || 'D:\\ollama';
const EXE = join(ROOT, 'ollama.exe');
const BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').trim().replace(/\/+$/, '');

async function isUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function tags() {
  const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

const args = process.argv.slice(2);

if (args[0] === '--status') {
  const up = await isUp();
  console.log(`server: ${up ? 'UP' : 'DOWN'} (${BASE_URL})`);
  if (up) console.log(`models: ${((await tags()).models || []).map((m) => m.name).join(', ') || '(none)'}`);
  process.exit(up ? 0 : 1);
}

if (args[0] === '--pull') {
  if (!(await isUp())) {
    console.error('server is not running - start it first without --pull');
    process.exit(2);
  }
  const model = args[1];
  if (!model) {
    console.error('usage: ollama-start.mjs --pull <model>');
    process.exit(2);
  }
  console.log(`pulling ${model} (this box shows tls: bad record MAC on large transfers;`);
  console.log('a retry loop around this is normal and it does eventually complete)...');
  const p = spawn(EXE, ['pull', model], {
    env: { ...process.env, OLLAMA_MODELS: join(ROOT, 'models') },
    stdio: 'inherit',
  });
  p.on('exit', (code) => process.exit(code ?? 1));
} else {
  if (!existsSync(EXE)) {
    console.error(`ollama.exe not found at ${EXE}`);
    console.error('Set OLLAMA_ROOT, or install Ollama and re-run.');
    process.exit(2);
  }
  if (await isUp()) {
    console.log(`already running at ${BASE_URL}`);
    process.exit(0);
  }

  const env = {
    ...process.env,
    OLLAMA_MODELS: join(ROOT, 'models'),
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_LOAD_TIMEOUT: process.env.OLLAMA_LOAD_TIMEOUT || '30m',
    OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || '30m',
  };
  console.log(`starting ollama serve (models=${env.OLLAMA_MODELS}, load_timeout=${env.OLLAMA_LOAD_TIMEOUT})`);
  const p = spawn(EXE, ['serve'], { env, stdio: 'inherit', detached: true });

  // Poll rather than trusting the child's first output line.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) {
      console.log(`up at ${BASE_URL}`);
      p.unref();
      process.exit(0);
    }
  }
  console.error('server did not come up within 30s');
  process.exit(1);
}
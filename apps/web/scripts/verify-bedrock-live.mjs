#!/usr/bin/env node
/**
 * GATE 1 EVIDENCE — Bedrock discovery + live call through the app's own client.
 *
 * 1) LIST: call Bedrock ListFoundationModels and print all Anthropic model IDs
 *    so we never hardcode a dead string. Evidence = paste the ACTUAL IDs.
 * 2) SELECT: if BEDROCK_MODEL_NEGOTIATE is among them, use it; otherwise pick the
 *    strongest available Anthropic model and report plainly.
 * 3) CALL: real Converse call via the SDK; prints model id + token counts.
 *
 *   npx tsx --env-file=.env scripts/verify-bedrock-live.mjs
 */
import { createHash, createHmac } from 'node:crypto';
import { callBedrock, getBedrockConfig } from '../src/app/api/utils/bedrock-client.ts';

const line = (s = '') => console.log(s);
let failures = 0;
function assert(label, ok, detail = '') {
  if (!ok) failures++;
  line(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function mask(v) {
  if (!v) return '(empty)';
  if (v.length <= 8) return v.slice(0, 4) + '****';
  return v.slice(0, 6) + '****' + v.slice(-4);
}

function listFoundationModels(region, accessKeyId, secretAccessKey, sessionToken) {
  const host = `bedrock.${region}.amazonaws.com`;
  const path = '/foundation-models';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const headers = {
    'content-type': 'application/json',
    host,
    'x-amz-date': amzDate,
  };
  if (sessionToken) headers['x-amz-security-token'] = sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join('');
  const sha256Hex = (data) => createHash('sha256').update(data, 'utf8').digest('hex');
  const canonicalRequest = ['GET', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 'bedrock');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const url = `https://${host}${path}`;
  return fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }).then(async (res) => {
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new Error(`ListFoundationModels HTTP ${res.status}: ${raw.slice(0, 400)}`);
    }
    return res.json();
  });
}

async function main() {
  line('═══════════════════════════════════════════════════════════════');
  line('  GATE 1 — BEDROCK DISCOVERY + LIVE CALL THROUGH THE APP CLIENT');
  line('═══════════════════════════════════════════════════════════════');

  const cfg = getBedrockConfig();
  if (!cfg) {
    line('  ❌ BLOCKED: BEDROCK_MODEL_NEGOTIATE / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not all set in .env');
    process.exit(1);
  }
  line(`  region      : ${cfg.region}`);
  line(`  modelId     : ${cfg.modelId}`);
  line(`  credentials : present (${mask(cfg.accessKeyId)})`);
  line();

  let selectedModelId = cfg.modelId;

  line('─── LEG 1: ListFoundationModels ──────────────────────────────');
  let listed;
  try {
    listed = await listFoundationModels(cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.sessionToken);
  } catch (e) {
    line(`  ❌ FAIL  ListFoundationModels threw: ${e?.message ?? e}`);
    process.exit(1);
  }
  const summaries = Array.isArray(listed?.modelSummaries) ? listed.modelSummaries : [];
  const anthropic = summaries.filter((m) => (m?.modelId || '').toLowerCase().includes('anthropic'));
  line(`  total models returned : ${summaries.length}`);
  line(`  anthropic models found: ${anthropic.length}`);
  for (const m of summaries.slice(0, 40)) {
    line(`    • ${m.modelId}  provider=${m.providerName}  status=${m?.modelLifecycle?.status || '-'}`);
  }
  if (summaries.length > 40) line(`    … and ${summaries.length - 40} more`);
  if (anthropic.length) {
    line(`  Anthropic models:`);
    for (const m of anthropic.slice(0, 20)) {
      line(`    • ${m.modelId}  provider=${m.providerName}  status=${m?.modelLifecycle?.status || '-'}`);
    }
  }
  const hinted = anthropic.find((m) => m.modelId === cfg.modelId);
  if (!hinted) {
    line(`  Note: BEDROCK_MODEL_NEGOTIATE='${cfg.modelId}' is NOT in the returned list. Selecting strongest available Anthropic model instead.`);
    const sorted = anthropic.slice().sort((a, b) => {
      const aActive = (a?.modelLifecycle?.status || '') === 'ACTIVE';
      const bActive = (b?.modelLifecycle?.status || '') === 'ACTIVE';
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (b.modelId || '').localeCompare(a.modelId || '');
    });
    selectedModelId = sorted[0]?.modelId || selectedModelId;
  } else {
    line(`  Hinted model is available: ${hinted.modelId}`);
  }
  line(`  selected model         : ${selectedModelId}`);
  line();

  line('─── LEG 2: real Converse call via SDK ─────────────────────────');
  let res;
  try {
    res = await callBedrock(
      { messages: [{ role: 'user', content: 'Reply with exactly: BEDROCK_WIRED' }], maxTokens: 32 },
      { ...cfg, modelId: selectedModelId }
    );
  } catch (e) {
    line(`  ❌ FAIL  call threw: ${e?.message ?? e}`);
    line();
    line('  If this is AccessDeniedException, the model is entitled but not yet');
    line('  servable — set BEDROCK_MODEL_NEGOTIATE to a model that invokes today.');
    process.exit(1);
  }

  assert('returned non-empty text', Boolean(res.text), JSON.stringify(res.text.slice(0, 40)));
  assert('echoes the selected model id', res.model === selectedModelId, res.model);
  assert('reports input tokens', res.usage.input_tokens > 0, `in=${res.usage.input_tokens}`);
  assert('reports output tokens', res.usage.output_tokens > 0, `out=${res.usage.output_tokens}`);
  assert('shape matches AnthropicResponse', Array.isArray(res.contentBlocks) && typeof res.stopReason === 'string');
  line();
  line('  RECEIPT:');
  line(`    model=${res.model}`);
  line(`    stopReason=${res.stopReason}`);
  line(`    tokens in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
  line(`    text=${JSON.stringify(res.text.slice(0, 80))}`);
  line();

  line('─── LEG 3: no-fallback rule (bad model must THROW, not degrade) ───');
  try {
    await callBedrock(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 },
      { ...cfg, modelId: 'anthropic.this-model-does-not-exist' }
    );
    assert('bad model id throws', false, 'it returned instead of throwing');
  } catch (e) {
    assert('bad model id throws (no silent fallback)', true, e?.constructor?.name);
  }
  line();

  line('═══════════════════════════════════════════════════════════════');
  line(failures === 0 ? '  ✅ BEDROCK PROVIDER LIVE' : `  ❌ ${failures} FAILURE(S)`);
  line('═══════════════════════════════════════════════════════════════');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
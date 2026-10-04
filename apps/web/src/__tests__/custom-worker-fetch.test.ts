/**
 * Tests for the fetch wrapper in `custom-worker.ts`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Worker exported `fetch: handler.fetch` directly. Nothing observed a
 * thrown error at the entry point, so an unhandled throw inside the OpenNext
 * handler — which is exactly what the intermittent homepage 500 is — produced a
 * bare 500 with no log line, no request identity, and nothing in `wrangler tail`.
 * That is the single biggest reason the homepage-500 investigation stalled: the
 * failure left no evidence behind.
 *
 * These tests pin the contract the wrapper must keep:
 *   1. a successful response passes through UNTOUCHED (status, headers, body),
 *   2. a thrown error is logged with enough identity to find it in tail,
 *   3. a thrown error becomes a real 500 rather than an opaque worker error,
 *   4. the log never contains a credential or session cookie,
 *   5. the response to the client never contains the internal error message.
 *
 * (5) matters as much as the logging: the internal message can contain SQL
 * fragments, provider payloads or filesystem paths, and this handler is
 * reachable unauthenticated on `/`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The generated OpenNext worker is a build artifact and cannot be imported in
// a test environment. Mock it before importing the module under test.
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

// From src/__tests__, the `@` alias (rooted at src/) resolves `../custom-worker`
// to apps/web/custom-worker.ts. The generated worker is a build artifact and is
// mocked before import.
vi.mock('../../.open-next/worker.js', () => ({ default: { fetch: mockFetch } }));

import worker from '../../custom-worker';

type FetchEnv = Record<string, string | undefined>;
type FetchCtx = { waitUntil(p: Promise<unknown>): void };

const req = (path = '/', headers: Record<string, string> = {}) =>
  new Request(`https://dealswiftautomation.com${path}`, { headers });

const env: FetchEnv = {};
const ctx: FetchCtx = { waitUntil: () => {} };

let logs: unknown[][];
let errors: unknown[][];
let origLog: typeof console.log;
let origError: typeof console.error;

beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  errors = [];
  origLog = console.log;
  origError = console.error;
  console.log = (...a: unknown[]) => logs.push(a);
  console.error = (...a: unknown[]) => errors.push(a);
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
});

const callFetch = () => (worker.fetch as (r: Request, e: FetchEnv, c: FetchCtx) => Promise<Response>)(req(), env, ctx);

describe('custom-worker fetch wrapper — pass-through', () => {
  it('returns the underlying response object itself, not a copy', async () => {
    const res = new Response('ok', { status: 200, headers: { 'x-test': 'yes' } });
    mockFetch.mockResolvedValue(res);

    const out = await callFetch();

    // Identity matters: rebuilding the response could drop a streaming body or
    // a Set-Cookie header on a path that is not under test here.
    expect(out).toBe(res);
    expect(out.status).toBe(200);
    expect(out.headers.get('x-test')).toBe('yes');
  });

  it('passes non-2xx responses through unchanged, including 404', async () => {
    const res = new Response('nope', { status: 404 });
    mockFetch.mockResolvedValue(res);
    expect((await callFetch()).status).toBe(404);
  });

  it('does not log a line for a normal request', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    await callFetch();
    expect(errors).toHaveLength(0);
  });

  it('forwards the request, env and ctx to the underlying handler', async () => {
    mockFetch.mockResolvedValue(new Response('ok'));
    const r = req('/dashboard');
    const e: FetchEnv = { SOME_SECRET: 'v' };
    const c: FetchCtx = { waitUntil: () => {} };
    await (worker.fetch as (a: Request, b: FetchEnv, c: FetchCtx) => Promise<Response>)(r, e, c);
    expect(mockFetch).toHaveBeenCalledWith(r, e, c);
  });
});

describe('custom-worker fetch wrapper — thrown errors', () => {
  it('logs the error with request identity so it is findable in wrangler tail', async () => {
    mockFetch.mockRejectedValue(new TypeError('components.ComponentMod.handler is not a function'));

    await callFetch();

    expect(errors.length).toBeGreaterThan(0);
    const line = errors.map((a) => a.join(' ')).join('\n');
    // Method + path + build id are what make a tail line findable later.
    expect(line).toContain('GET');
    expect(line).toContain('/');
  });

  it('logs the underlying error object, not just a generic message', async () => {
    const boom = new TypeError('components.ComponentMod.handler is not a function');
    mockFetch.mockRejectedValue(boom);
    await callFetch();
    const flattened = errors.flat();
    expect(flattened).toContain(boom);
  });

  it('returns a real 500 instead of letting the worker throw', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const res = await callFetch();
    expect(res.status).toBe(500);
  });

  it('does NOT leak the internal error message to the client', async () => {
    mockFetch.mockRejectedValue(new Error('SELECT * FROM "user" failed: password abc123'));
    const res = await callFetch();
    const body = await res.text();
    expect(body).not.toContain('SELECT');
    expect(body).not.toContain('password');
    expect(body).not.toContain('abc123');
  });

  it('returns valid JSON so a client never sees an empty body', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const res = await callFetch();
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toBeTypeOf('object');
  });

  it('never logs cookies or authorization headers', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    await (worker.fetch as (r: Request, e: FetchEnv, c: FetchCtx) => Promise<Response>)(
      req('/', {
        cookie: 'better-auth.session_token=SUPERSECRETVALUE',
        authorization: 'Bearer LEAKYBEARERTOKEN',
      }),
      env,
      ctx,
    );
    const log = errors.map((a) => a.join(' ')).join('\n');
    expect(log).not.toContain('SUPERSECRETVALUE');
    expect(log).not.toContain('LEAKYBEARERTOKEN');
    expect(log).not.toContain('better-auth');
  });

  it('survives a non-Error rejection value', async () => {
    mockFetch.mockRejectedValue('a bare string');
    const res = await callFetch();
    expect(res.status).toBe(500);
    // Must not itself throw while reporting the failure.
    await expect(res.text()).resolves.toBeTypeOf('string');
  });
});
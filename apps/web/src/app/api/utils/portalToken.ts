import { createHmac } from 'node:crypto';
import { timingSafeSecretEqual } from '@/app/api/utils/secretCompare';

/**
 * Signed links for the public seller portal (2026-09-26).
 *
 * WHY: the portal is reachable without a session, so the URL *is* the credential.
 * The previous scheme was plain base64url("leadId:action:ts") — no signature — so
 * anyone who knew or guessed a lead id could mint their own "valid" link, and the
 * offer route additionally accepted a bare ?leadId= with no token at all. That made
 * anonymous cross-tenant reads and mutations possible.
 *
 * FORMAT: base64url("leadId:action:ts") + "." + HMAC-SHA256(payload, secret).
 * Fails CLOSED: without PORTAL_TOKEN_SECRET (or CRON_SECRET as fallback) no token
 * can be minted or verified, so the portal falls back to session auth only.
 */
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // links expire after 14 days

function tokenSecret(): string | null {
  return process.env.PORTAL_TOKEN_SECRET || process.env.CRON_SECRET || null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signPortalToken(
  leadId: string,
  action: string,
  ts: number = Date.now()
): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const payload = `${leadId}:${action}:${ts}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, secret)}`;
}

export function verifyPortalToken(
  token: string | null | undefined
): { leadId: string; action: string; ts: number } | null {
  const secret = tokenSecret();
  if (!secret) return null; // fail closed
  if (typeof token !== 'string' || token.length === 0) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return null;

  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  const [leadId, action, tsRaw] = parts;
  const ts = Number(tsRaw);
  if (!leadId || !action || !Number.isFinite(ts)) return null;

  if (!timingSafeSecretEqual(providedSig, sign(payload, secret))) return null;
  if (Date.now() - ts > TOKEN_TTL_MS) return null; // stale link
  if (ts - Date.now() > 60_000) return null; // implausible future timestamp

  return { leadId, action, ts };
}

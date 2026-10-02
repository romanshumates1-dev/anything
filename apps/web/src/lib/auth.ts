/**
 * ⚠ ANYTHING PLATFORM — DO NOT REWRITE THIS FILE ⚠
 *
 * Shipped v2 better-auth configuration. The hooks.before middleware (backfills
 * `name` from email), bearer() plugin (mobile Authorization: Bearer flow),
 * trustedOrigins list, and socialProviders block are ALL load-bearing. A prior
 * AI removed the name backfill and broke every signup with [body.name]
 * validation errors. DO NOT simplify this config without understanding why each
 * piece is present.
 *
 *   Safe:   add user fields to `user.additionalFields`, tune session options.
 *   Unsafe: removing hooks.before, the bearer plugin, or trustedOrigins;
 *           changing cookie attributes (sameSite:'none' is required for
 *           mobile iframes); changing the database pool; hand-editing the
 *           socialProviders block (the platform injects the OAuth credentials
 *           via env vars when a provider is enabled in project settings).
 */
import { Pool, neon, neonConfig } from '@neondatabase/serverless';
import { argon2Verify } from 'argon2-wasm-edge';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { verifyPassword } from 'better-auth/crypto';
import { bearer } from 'better-auth/plugins';
import { isCloudflareWorkers, resolveWebSocketConstructor } from '@/lib/websocket';
import { createWorkersAuthDatabase } from '@/lib/workers-auth-database';

import {
  ROLE_ADMIN,
  ROLE_MEMBER,
  isSeedAdminEmail,
} from '@/app/api/utils/access-control';
import { runWithDbRetry } from '@/app/api/utils/dbRetry';
import { checkSignupAllowed } from '@/app/api/utils/signup-restrictions';
import { isEmailDomainAllowedEffective } from '@/app/api/utils/email-domain-policy';
import { isAccessDenied } from '@/lib/user-status';

// Runtime-agnostic: global WebSocket on workerd / Node >= 22, `ws` on Node 20.
// See src/lib/websocket.ts for why this is not a plain `import ws from 'ws'`
// (that import is what blocked the Cloudflare Workers build).
neonConfig.webSocketConstructor = resolveWebSocketConstructor() as never;

/**
 * ⚠ `poolQueryViaFetch` ON WORKERS — fixes 12 production 500s (2026-10-01)
 * ---------------------------------------------------------------------
 * On Cloudflare Workers, `@neondatabase/serverless`'s WebSocket transport is
 * fundamentally incompatible with the module-level `Pool` below.
 *
 * WHAT WAS BROKEN, MEASURED IN PRODUCTION: every authenticated route that
 * touches this pool returned HTTP 500 on the deployed Worker while returning
 * 200 under `next start`. 12 of 25 probed routes were affected, including the
 * most basic ones — `/api/session`, `/api/earnings`, `/api/campaigns`,
 * `/api/achievements`, `/api/user/preferences`, `/api/tax/*`,
 * `/api/dashboard/funnel`, `/api/analytics/advanced`, `/api/system/*`.
 * `wrangler tail` showed the cause verbatim:
 *
 *   Error: Cannot perform I/O on behalf of a different request. I/O objects
 *   (such as streams, request/response bodies, and others) created in the
 *   context of one request handler cannot be accessed from a different
 *   request's handler. (I/O type: Native)
 *   Error: The Workers runtime canceled this request because it detected that
 *   your Worker's code had hung and would never generate a response.
 *
 * That second message is the "Worker exceeded resource limits" symptom the
 * product kept hitting: the request never completes, so the runtime kills it.
 *
 * WHY: workerd ties every I/O object to the request that created it. A
 * WebSocket opened while serving request A is A's object, so when the module
 * scope reuses that same pool for request B, B is touching A's socket and
 * workerd throws. Under Node there is no such rule, which is exactly why local
 * testing never saw this — it is invisible to `next start`, to the unit suite,
 * and to the browser-QA harness.
 *
 * THE FIX: on workerd, better-auth is given an HTTP-backed pg-shaped pool
 * (see `workers-auth-database.ts`) instead of this WebSocket pool. Every query
 * becomes a self-contained fetch created and consumed inside the request that
 * issued it, so there is no cross-request I/O object at all.
 *
 * It is applied ONLY on workerd, behind `isCloudflareWorkers()`: the WebSocket
 * path stays in place on Node, where it is faster, supports real interactive
 * transactions, and is safe because long-lived sockets are not request-scoped.
 * Changing the Node path as well would be an unmeasured behaviour change to a
 * code path that currently works.
 *
 * TWO EARLIER ATTEMPTS FAILED. Both are recorded so they are not repeated:
 *
 *   eca7071  `neonConfig.poolQueryViaFetch = true` — deployed, still 12 x 500.
 *            CANNOT work: `NeonPool.query` short-circuits to the WebSocket
 *            whenever `hasFetchUnsupportedListeners` is set. That flag is
 *            latched true by ANY `.on(event, ...)` subscription on the pool,
 *            and better-auth subscribes to pool events. The HTTP path is
 *            therefore unreachable no matter what this setting says, and there
 *            is no API to clear the flag.
 *
 *   acc5277  `database = { query }` on Workers — deployed, signup went 500
 *            with "Failed to initialize database adapter". CANNOT work:
 *            better-auth runs the value through `createKyselyAdapter`, which
 *            requires a recognised Kysely dialect. A plain object has no
 *            dialect. Verified in @better-auth/kysely-adapter:
 *            `if ("connect" in db) dialect = new PostgresDialect({pool: db})`.
 *
 * The contract that DOES work was read from the installed source, not guessed,
 * and is pinned by `src/lib/__tests__/workers-auth-database.test.ts`.
 */
if (isCloudflareWorkers()) {
  // Retained only so the WebSocket pool below is never handed to better-auth
  // on workerd. It has no effect on NeonPool.query's branch selection.
  neonConfig.poolQueryViaFetch = true;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// The database better-auth is given.
//
// Node keeps the pooled WebSocket client: it is faster, supports real
// interactive transactions, and long-lived sockets are safe there.
//
// workerd gets the HTTP-backed pg-shaped pool instead, because a module-scope
// WebSocket cannot be reused across requests (see the note above). The `connect`
// key is what makes better-auth build a PostgresDialect around it; the shape is
// pinned by src/lib/__tests__/workers-auth-database.test.ts.
//
// `runWithDbRetry` is threaded through so the Workers path keeps the same
// bounded transient-error protection the Node path has, which is what stops a
// blip from surfacing to the user as a random sign-out.
const database = isCloudflareWorkers()
  ? createWorkersAuthDatabase(neon(process.env.DATABASE_URL ?? ''), runWithDbRetry)
  : pool;

// RANDOM SIGN-OUT FIX: better-auth's internal session reads (getSession →
// session table) and the databaseHooks below all flow through pool.query.
// A transient Neon connection error there surfaces as a 401, which the
// client renders as a random sign-out. Wrap (not replace) the query method
// with the same bounded transient-error retry used by utils/sql.ts.
// NOTE: this does NOT change pool configuration (connectionString, etc.) —
// the load-bearing pool setup above is untouched.
const boundPoolQuery = pool.query.bind(pool) as unknown as (
  ...args: unknown[]
) => Promise<unknown>;
(pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (
  ...args: unknown[]
) => runWithDbRetry(() => boundPoolQuery(...args));

// Origins we accept auth requests from. Include every URL the app may be
// served under so better-auth's CSRF check doesn't reject legitimate requests
// as "Invalid origin". The request's own origin + known sandbox / published
// URLs + the mobile iframe proxy URL are all listed here.
// Ghost-protocol: NEXT_PUBLIC_CREATE_BASE_URL was an auth remnant (removed).
const trustedOrigins = [
  process.env.BETTER_AUTH_URL,
  process.env.EXPO_PUBLIC_PROXY_BASE_URL,
  process.env.NEXT_PUBLIC_CREATE_HOST
    ? `https://${process.env.NEXT_PUBLIC_CREATE_HOST}`
    : null,
].filter((v): v is string => Boolean(v));

// Social providers self-activate when the platform has injected their OAuth
// credentials (set in project settings → Authentication, pushed in as env
// vars). A provider with missing credentials is simply not registered, so the
// corresponding sign-in button never reaches a half-configured backend.
const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
    ? {
        apple: {
          clientId: process.env.APPLE_CLIENT_ID,
          clientSecret: process.env.APPLE_CLIENT_SECRET,
          // Required to verify the identity token from native "Sign in with
          // Apple"; harmless when only web is used.
          ...(process.env.APPLE_APP_BUNDLE_IDENTIFIER
            ? {
                appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER,
              }
            : {}),
        },
      }
    : {}),
};

async function verifyCompatiblePassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}) {
  if (hash.startsWith('$argon2')) {
    return argon2Verify({
      hash,
      password,
    });
  }

  return verifyPassword({
    hash,
    password,
  });
}

export const auth = betterAuth({
  database,
  trustedOrigins,
  socialProviders,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      verify: verifyCompatiblePassword,
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Domain lock, layer 1 (register) + layer 2 (login): reject any
      // email/password sign-up or sign-in whose domain is not allowlisted
      // (ALLOWED_EMAIL_DOMAINS, default dealswiftautomation.com) BEFORE any
      // account/session work happens. Social + other paths are covered by the
      // databaseHooks below, so no single bypass grants access.
      if (ctx.path === '/sign-up/email' || ctx.path === '/sign-in/email') {
        const body = ctx.body as { email?: unknown } | undefined;
        if (!body || typeof body.email !== 'string' || !(await isEmailDomainAllowedEffective(body.email))) {
          throw new APIError('FORBIDDEN', {
            message: 'Access restricted: this platform is limited to authorized email domains.',
          });
        }
      }

      // Runtime signup restriction check (admin-configurable via app_settings).
      // Only applies to sign-up; sign-in uses the static domain allowlist above.
      if (ctx.path === '/sign-up/email') {
        const body = ctx.body as { email?: unknown } | undefined;
        if (body && typeof body.email === 'string') {
          const signupCheck = await checkSignupAllowed(body.email);
          if (!signupCheck.allowed) {
            throw new APIError('FORBIDDEN', {
              message: signupCheck.message || 'Signups are currently restricted. Contact admin for access.',
            });
          }
        }
      }

      // better-auth's /sign-up/email schema requires `name`. Generated user apps
      // often collect only email+password, so backfill a name from the email
      // local-part to keep signup working without a visible name field.
      if (ctx.path !== '/sign-up/email') return;
      const body = ctx.body as { email?: unknown; name?: unknown } | undefined;
      if (!body || typeof body.email !== 'string') return;
      if (typeof body.name === 'string' && body.name.trim().length > 0) return;
      const derived = body.email.split('@')[0];
      body.name = derived && derived.length > 0 ? derived : 'User';
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Domain lock at the account boundary: no out-of-domain user row is
        // ever created, regardless of the auth path (email, social, future
        // plugins). Also the ADMIN seed: SEED_ADMIN_EMAILS (default the
        // owner, roman.shumate@dealswiftautomation.com) get role ADMIN on
        // first signup — idempotent by construction (runs once per create,
        // never duplicates; migration 005 upgrades a pre-existing row).
        before: async (user) => {
          if (!(await isEmailDomainAllowedEffective(user.email))) {
            throw new APIError('FORBIDDEN', {
              message: 'Access restricted: this platform is limited to authorized email domains.',
            });
          }
          // Runtime signup restriction check (admin-configurable via app_settings)
          const signupCheck = await checkSignupAllowed(user.email);
          if (!signupCheck.allowed) {
            throw new APIError('FORBIDDEN', {
              message: signupCheck.message || 'Signups are currently restricted. Contact admin for access.',
            });
          }
          return {
            data: { ...user, role: isSeedAdminEmail(user.email) ? ROLE_ADMIN : ROLE_MEMBER },
          };
        },
        // Auto-create personal organization for new users so they have org
        // context on first API call (prevents 403 from getOrganization null).
        after: async (user) => {
          try {
            // Generate unique IDs
            const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
            const memberId = `om_${crypto.randomUUID().replace(/-/g, '')}`;
            const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;

            // Derive org name and slug from email
            const emailLocal = user.email.split('@')[0];
            const orgName = `${user.name || emailLocal}'s Workspace`;
            // Create slug: lowercase, alphanumeric/hyphens only, max 50 chars
            const orgSlug = `${emailLocal.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${orgId.slice(-8)}`;

            // Create organization
            // `owner_user_id` is NOT NULL (defect #31): omitting it made this
            // INSERT fail for EVERY new signup, and the catch below swallowed
            // the error, so new users ended up with no organization at all and
            // every org-scoped API answered 403 "No organization found".
            await pool.query(
              `INSERT INTO organizations (id, name, slug, owner_user_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, NOW(), NOW())`,
              [orgId, orgName, orgSlug, user.id]
            );

            // Add user as OWNER
            await pool.query(
              `INSERT INTO organization_members (id, user_id, organization_id, role, created_at)
               VALUES ($1, $2, $3, 'OWNER', NOW())`,
              [memberId, user.id, orgId]
            );

            // Create free tier subscription (14-day trial)
            await pool.query(
              `INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, trial_ends_at, created_at)
               VALUES ($1, $2, 'plan_free', 'trial', NOW() + INTERVAL '14 days', NOW())`,
              [subId, orgId]
            );

            console.log(`[Auth] Auto-created org ${orgId} for new user ${user.id}`);
          } catch (err) {
            // Log but don't fail user creation - org can be created later via
            // POST /api/organizations if this fails (e.g., slug collision)
            console.error('[Auth] Failed to auto-create org for user:', user.id, err);
          }
        },
      },
    },
    session: {
      create: {
        // Domain lock, layer 2 (session): even if an out-of-domain account
        // somehow exists in the DB, it can never mint a session. Fresh DB
        // read — no trust in the incoming object. Also the ban gate (Phase 4):
        // a banned or currently-suspended user cannot mint a new session, so a
        // fresh login attempt is rejected server-side.
        // WHY THE ADAPTER LOOKUP COMES FIRST (defect #30): this hook used to
        // read the user with the module-level `pool` only. During SIGN-UP the
        // user row is created in the same request, inside better-auth's own
        // transaction, so a different connection could not see it: the lookup
        // returned no row, this hook returned false, and every signup failed
        // with FAILED_TO_CREATE_SESSION — no new user could ever register,
        // which is why authenticated E2E had never been run. better-auth passes
        // the auth context as the second argument, so `internalAdapter` resolves
        // the user on the SAME connection/transaction as the insert. The pool
        // read remains the fallback for sign-in and any path without the
        // adapter, and an unresolvable user still fails CLOSED.
        before: async (session, hookCtx) => {
          const internalAdapter = (
            hookCtx as unknown as {
              context?: {
                internalAdapter?: { findUserById?: (id: string) => Promise<unknown> };
              };
            }
          )?.context?.internalAdapter;

          type UserRow = {
            email: string;
            banned?: boolean | null;
            suspended_until?: Date | string | null;
          };
          let u: UserRow | null = null;

          if (typeof internalAdapter?.findUserById === 'function') {
            try {
              u = (await internalAdapter.findUserById(session.userId)) as UserRow | null;
            } catch (err) {
              // Fall through to the pool read: a transient adapter error must
              // not be the reason a legitimate sign-up is refused.
              console.error('[Auth] session hook adapter lookup failed:', err);
            }
          }

          if (!u) {
            const { rows } = await pool.query(
              'SELECT email, banned, suspended_until FROM "user" WHERE id = $1 LIMIT 1',
              [session.userId]
            );
            u = rows[0] as UserRow | undefined ?? null;
          }

          if (!u) {
            console.error(
              `[Auth] session.create.before: user ${session.userId} not resolvable; refusing session`
            );
            return false;
          }
          if (!(await isEmailDomainAllowedEffective(u.email))) return false;
          // `banned` is NOT NULL in the schema, but the adapter may return it as
          // null/undefined for a shape it does not know; normalize rather than
          // widening isAccessDenied's parameter type.
          if (
            isAccessDenied({
              banned: Boolean(u.banned),
              suspended_until: u.suspended_until ?? null,
            })
          ) {
            return false;
          }
          return { data: session };
        },
      },
    },
  },
  advanced: {
    cookiePrefix: 'better-auth',
    defaultCookieAttributes: {
      sameSite: 'none', // Required for iframes
      secure: true,
      httpOnly: true,
      path: '/',
    },
    cookies: {
      sessionToken: {
        attributes: {
          sameSite: 'none', // Required for iframes
          secure: true,
        },
      },
    },
  },
  session: {
    // Cookie cache DISABLED intentionally. When enabled, better-auth serves the
    // session (and its role) from a signed `session_data` cookie WITHOUT reading
    // the DB for maxAge seconds. With RBAC that is a security hole: an admin who
    // demotes a user or revokes their sessions (DELETE FROM session, see
    // api/admin/users/[id]) would NOT actually cut off access — getSession would
    // keep returning the cached session until the cookie's maxAge expired (was 7
    // days). The DB session table is the single source of truth, so every
    // getSession must hit it and revocation/demotion takes effect next request.
    cookieCache: {
      enabled: false,
    },
  },
  user: {
    additionalFields: {
      image: {
        type: 'string',
        required: false,
      },
      // Platform role (ADMIN | MEMBER). input:false means clients can NEVER
      // set it through sign-up/update bodies — it is assigned server-side by
      // the user.create hook above and changed only via /api/admin/users.
      role: {
        type: 'string',
        required: false,
        defaultValue: ROLE_MEMBER,
        input: false,
      },
    },
  },
  // Enable Authorization: Bearer <session-token> so mobile apps (which can't
  // carry cookies through a WebView) authenticate API calls with the token
  // returned from /api/auth/token.
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;

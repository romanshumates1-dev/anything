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
import { Pool, neonConfig } from '@neondatabase/serverless';
import { argon2Verify } from 'argon2-wasm-edge';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { verifyPassword } from 'better-auth/crypto';
import { bearer } from 'better-auth/plugins';
import { resolveWebSocketConstructor } from '@/lib/websocket';

import {
  ROLE_ADMIN,
  ROLE_MEMBER,
  isEmailDomainAllowed,
  isSeedAdminEmail,
} from '@/app/api/utils/access-control';
import { checkSignupAllowed } from '@/app/api/utils/signup-restrictions';
import { isAccessDenied } from '@/lib/user-status';

// Runtime-agnostic: global WebSocket on workerd / Node >= 22, `ws` on Node 20.
// See src/lib/websocket.ts for why this is not a plain `import ws from 'ws'`
// (that import is what blocked the Cloudflare Workers build).
neonConfig.webSocketConstructor = resolveWebSocketConstructor() as never;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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
  database: pool,
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
        if (!body || typeof body.email !== 'string' || !isEmailDomainAllowed(body.email)) {
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
          if (!isEmailDomainAllowed(user.email)) {
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
            await pool.query(
              `INSERT INTO organizations (id, name, slug, created_at)
               VALUES ($1, $2, $3, NOW())`,
              [orgId, orgName, orgSlug]
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
        before: async (session) => {
          const { rows } = await pool.query(
            'SELECT email, banned, suspended_until FROM "user" WHERE id = $1 LIMIT 1',
            [session.userId]
          );
          const u = rows[0];
          if (!u || !isEmailDomainAllowed(u.email)) return false;
          if (isAccessDenied(u)) return false;
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

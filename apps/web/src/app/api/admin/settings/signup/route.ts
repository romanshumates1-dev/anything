/**
 * Admin Signup Restrictions API
 *
 * GET  /api/admin/settings/signup - Get current signup restriction settings
 * PUT  /api/admin/settings/signup - Update signup restriction settings (admin only)
 *
 * Settings stored in app_settings with key 'signup_restrictions'.
 */
import { requireAdmin } from '@/app/api/utils/authz';
import sql from '@/app/api/utils/sql';
import {
  getEmailDomainPolicy,
  _resetEmailDomainPolicyCache,
} from '@/app/api/utils/email-domain-policy';

const SETTINGS_KEY = 'signup_restrictions';

interface SignupRestrictions {
  signup_restricted: boolean;
  allowed_email_domains: string[];
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    // Return the EFFECTIVE policy (database setting when present, environment
    // allowlist fallback otherwise) so the admin UI can never display a state
    // that differs from what middleware/auth actually enforce.
    const policy = await getEmailDomainPolicy();
    return Response.json({
      signup_restricted: policy.restricted,
      allowed_email_domains: policy.domains,
      source: policy.source,
    });
  } catch (error) {
    console.error('GET /api/admin/settings/signup error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const { signup_restricted, allowed_email_domains } = body;

    // Validate input
    if (typeof signup_restricted !== 'boolean') {
      return Response.json(
        { error: 'signup_restricted must be a boolean' },
        { status: 400 }
      );
    }

    if (!Array.isArray(allowed_email_domains)) {
      return Response.json(
        { error: 'allowed_email_domains must be an array' },
        { status: 400 }
      );
    }

    // Validate each domain
    const normalizedDomains: string[] = [];
    for (const domain of allowed_email_domains) {
      if (typeof domain !== 'string') {
        return Response.json(
          { error: 'Each domain must be a string' },
          { status: 400 }
        );
      }
      const normalized = domain.trim().toLowerCase();
      if (!normalized) continue;
      // Basic domain format validation
      if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(normalized)) {
        return Response.json(
          { error: `Invalid domain format: ${domain}` },
          { status: 400 }
        );
      }
      if (!normalizedDomains.includes(normalized)) {
        normalizedDomains.push(normalized);
      }
    }

    // Ensure at least one domain when restrictions are enabled
    if (signup_restricted && normalizedDomains.length === 0) {
      return Response.json(
        { error: 'At least one allowed domain is required when signup is restricted' },
        { status: 400 }
      );
    }

    const settings: SignupRestrictions = {
      signup_restricted,
      allowed_email_domains: normalizedDomains,
    };

    await sql`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (${SETTINGS_KEY}, ${JSON.stringify(settings)}, ${admin.userId}, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `;

    // Log to admin audit log
    await sql`
      INSERT INTO admin_audit_log (action, target_type, target_id, details, performed_by)
      VALUES (
        'signup_restrictions_updated',
        'app_setting',
        ${SETTINGS_KEY},
        ${JSON.stringify({ signup_restricted, domain_count: normalizedDomains.length })},
        ${admin.userId}
      )
    `;

    // Make the toggle visible to THIS instance immediately; other runtime
    // instances converge within the policy cache TTL (10 s).
    _resetEmailDomainPolicyCache();

    return Response.json({ ...settings, source: 'database' });
  } catch (error) {
    console.error('PUT /api/admin/settings/signup error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

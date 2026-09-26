/**
 * Signup Restrictions — admin-configurable signup gate (app_settings).
 *
 * Since the 2026-09-24 dual-authority fix this module DELEGATES to
 * `email-domain-policy`, the single resolver consumed by middleware, the
 * better-auth hooks, and the admin APIs. Keeping the old exports means the
 * auth-hook call sites (and any tests) keep working unchanged, while the
 * semantics can no longer drift from what the admin UI shows.
 */
import {
  getEmailDomainPolicy,
  isEmailDomainAllowedEffective,
} from '@/app/api/utils/email-domain-policy';

interface SignupRestrictions {
  signup_restricted: boolean;
  allowed_email_domains: string[];
}

/**
 * Current effective signup restrictions (database setting when present,
 * environment allowlist fallback otherwise).
 */
export async function getSignupRestrictions(): Promise<SignupRestrictions> {
  const policy = await getEmailDomainPolicy();
  return {
    signup_restricted: policy.restricted,
    allowed_email_domains: policy.domains,
  };
}

/**
 * Check whether an email may sign up under the current policy.
 * Returns { allowed: true } when permitted, or { allowed: false, message }.
 */
export async function checkSignupAllowed(email: string): Promise<{
  allowed: boolean;
  message?: string;
}> {
  const policy = await getEmailDomainPolicy();

  if (!policy.restricted) {
    return { allowed: true };
  }

  if (await isEmailDomainAllowedEffective(email)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: 'Signups are currently restricted. Contact admin for access.',
  };
}

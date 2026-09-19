/**
 * Signup Restrictions - runtime check against app_settings.
 *
 * Used by better-auth hooks to enforce email domain restrictions at signup.
 * Settings are stored in app_settings with key 'signup_restrictions'.
 */
import sql from '@/app/api/utils/sql';

interface SignupRestrictions {
  signup_restricted: boolean;
  allowed_email_domains: string[];
}

const DEFAULT_SETTINGS: SignupRestrictions = {
  signup_restricted: false,
  allowed_email_domains: ['dealswiftautomation.com'],
};

/**
 * Get current signup restriction settings from the database.
 * Falls back to defaults if not configured.
 */
export async function getSignupRestrictions(): Promise<SignupRestrictions> {
  try {
    const [row] = await sql`
      SELECT value FROM app_settings WHERE key = 'signup_restrictions' LIMIT 1
    `;

    if (!row?.value) {
      return DEFAULT_SETTINGS;
    }

    const settings = row.value as SignupRestrictions;
    return {
      signup_restricted: settings.signup_restricted ?? false,
      allowed_email_domains: settings.allowed_email_domains ?? DEFAULT_SETTINGS.allowed_email_domains,
    };
  } catch (error) {
    console.error('[SignupRestrictions] Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Check if an email is allowed to sign up based on current restrictions.
 * Returns { allowed: true } if signup is permitted, or { allowed: false, message } if denied.
 */
export async function checkSignupAllowed(email: string): Promise<{
  allowed: boolean;
  message?: string;
}> {
  const settings = await getSignupRestrictions();

  // If signup is not restricted, allow everyone (but still check the static allowlist)
  if (!settings.signup_restricted) {
    return { allowed: true };
  }

  // Extract domain from email
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return { allowed: false, message: 'Invalid email format' };
  }

  const domain = email.slice(atIndex + 1).trim().toLowerCase();

  // Check if domain is in the allowed list
  const normalizedAllowed = settings.allowed_email_domains.map((d) =>
    d.trim().toLowerCase()
  );

  if (normalizedAllowed.includes(domain)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: 'Signups are currently restricted. Contact admin for access.',
  };
}

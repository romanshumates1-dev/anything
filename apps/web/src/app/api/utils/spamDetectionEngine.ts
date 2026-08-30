/**
 * Spam/Nuisance Detection Engine
 *
 * Detects and handles spam/irrelevant messages across all outreach channels.
 * After configurable threshold of offenses, adds contact to blacklist.
 *
 * Detection methods:
 * - Pattern matching (common spam phrases)
 * - Gibberish detection
 * - Repeated message detection
 * - Harassment/abuse detection
 * - Bot detection
 * - Off-topic detection for real estate context
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { callAI } from '@/app/api/utils/ai-provider';

export type SpamCategory =
  | 'promotional_spam'
  | 'phishing'
  | 'gibberish'
  | 'repeated_message'
  | 'harassment'
  | 'bot_detected'
  | 'off_topic'
  | 'scam_attempt'
  | 'opt_out_abuse';

export interface SpamCheckResult {
  isSpam: boolean;
  confidence: number;
  category?: SpamCategory;
  reason?: string;
  shouldBlacklist: boolean;
  offenseCount: number;
}

export interface SpamConfig {
  offenseThreshold: number;
  windowHours: number;
  autoBlacklist: boolean;
  enableAIDetection: boolean;
}

const DEFAULT_CONFIG: SpamConfig = {
  offenseThreshold: 3,
  windowHours: 24,
  autoBlacklist: true,
  enableAIDetection: true,
};

/**
 * Common spam patterns
 */
const SPAM_PATTERNS: Array<{ pattern: RegExp; category: SpamCategory; weight: number }> = [
  // Promotional spam
  { pattern: /follow\s+for\s+follow/i, category: 'promotional_spam', weight: 0.9 },
  { pattern: /check\s+(out\s+)?my\s+(profile|page|link)/i, category: 'promotional_spam', weight: 0.85 },
  { pattern: /free\s+(gift|money|cash|bitcoin)/i, category: 'promotional_spam', weight: 0.9 },
  { pattern: /click\s+(this|here|the)\s+link/i, category: 'promotional_spam', weight: 0.8 },
  { pattern: /dm\s+me\s+for\s+(more|info|details)/i, category: 'promotional_spam', weight: 0.7 },
  { pattern: /subscribe\s+to\s+my/i, category: 'promotional_spam', weight: 0.8 },
  { pattern: /limited\s+time\s+offer/i, category: 'promotional_spam', weight: 0.85 },

  // Phishing/scam
  { pattern: /verify\s+your\s+(account|identity)/i, category: 'phishing', weight: 0.9 },
  { pattern: /suspended\s+(account|profile)/i, category: 'phishing', weight: 0.85 },
  { pattern: /won\s+(a\s+)?(prize|lottery|giveaway)/i, category: 'scam_attempt', weight: 0.95 },
  { pattern: /nigerian\s+prince/i, category: 'scam_attempt', weight: 1.0 },
  { pattern: /inheritance\s+(from|of)/i, category: 'scam_attempt', weight: 0.9 },
  { pattern: /wire\s+(me\s+)?money/i, category: 'scam_attempt', weight: 0.95 },
  { pattern: /send\s+(btc|bitcoin|crypto)/i, category: 'scam_attempt', weight: 0.9 },

  // Bot patterns
  { pattern: /^(hi|hello|hey)\.?$/i, category: 'bot_detected', weight: 0.4 },
  { pattern: /^nice\s+(pic|photo|post)\.?$/i, category: 'bot_detected', weight: 0.6 },
  { pattern: /^\d+$/, category: 'gibberish', weight: 0.3 },

  // Off-topic (not real estate related)
  { pattern: /crypto(currency)?|nft|blockchain|defi/i, category: 'off_topic', weight: 0.8 },
  { pattern: /forex|trading\s+signals/i, category: 'off_topic', weight: 0.85 },
  { pattern: /weight\s+loss|diet\s+pills/i, category: 'off_topic', weight: 0.9 },
  { pattern: /dating|singles|lonely/i, category: 'off_topic', weight: 0.85 },

  // Harassment
  { pattern: /\b(f+u+c+k+|shit|ass+hole|bitch)\b/i, category: 'harassment', weight: 0.7 },
  { pattern: /\b(idiot|stupid|dumb|moron)\b/i, category: 'harassment', weight: 0.5 },
  { pattern: /kill\s+(yourself|you)/i, category: 'harassment', weight: 1.0 },
  { pattern: /threat(en)?\s+(you|your)/i, category: 'harassment', weight: 0.9 },
];

/**
 * URL shortener domains (often used for spam)
 */
const SUSPICIOUS_DOMAINS = [
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly',
  'is.gd', 'buff.ly', 'adf.ly', 'bc.vc', 'j.mp',
];

/**
 * Check for gibberish/random text
 */
function isGibberish(text: string): boolean {
  const words = text.split(/\s+/);

  // Check for random character sequences
  const randomCharPattern = /[^aeiou]{5,}|(.)\1{3,}/i;
  if (randomCharPattern.test(text)) return true;

  // Check for too many consonants in a row
  const consonantRatio = (text.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length / text.length;
  if (consonantRatio > 0.8 && text.length > 10) return true;

  // Check for keyboard mashing
  const keyboardPatterns = /asdf|qwer|zxcv|uiop|hjkl/i;
  if (keyboardPatterns.test(text)) return true;

  // Check average word length (gibberish often has abnormal lengths)
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  if (avgWordLength > 15 || avgWordLength < 1.5) return true;

  return false;
}

/**
 * Check for suspicious URLs
 */
function containsSuspiciousUrls(text: string): boolean {
  const urlPattern = /https?:\/\/[^\s]+/gi;
  const urls = text.match(urlPattern) || [];

  for (const url of urls) {
    for (const domain of SUSPICIOUS_DOMAINS) {
      if (url.includes(domain)) return true;
    }
  }

  return false;
}

/**
 * Main spam detection function
 */
export async function checkForSpam(
  organizationId: string,
  contactId: string,
  message: string,
  channel: 'email' | 'sms' | 'social',
  config: Partial<SpamConfig> = {}
): Promise<SpamCheckResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let isSpam = false;
  let confidence = 0;
  let category: SpamCategory | undefined;
  let reason: string | undefined;

  // 1. Pattern matching
  for (const { pattern, category: cat, weight } of SPAM_PATTERNS) {
    if (pattern.test(message)) {
      if (weight > confidence) {
        isSpam = weight > 0.7;
        confidence = weight;
        category = cat;
        reason = `Pattern match: ${pattern.toString()}`;
      }
    }
  }

  // 2. Gibberish detection
  if (!isSpam && isGibberish(message)) {
    isSpam = true;
    confidence = 0.8;
    category = 'gibberish';
    reason = 'Message appears to be gibberish or random text';
  }

  // 3. Suspicious URLs
  if (!isSpam && containsSuspiciousUrls(message)) {
    isSpam = true;
    confidence = 0.85;
    category = 'phishing';
    reason = 'Message contains suspicious shortened URLs';
  }

  // 4. Check for repeated messages
  const repeatCheck = await checkRepeatedMessage(organizationId, contactId, message);
  if (!isSpam && repeatCheck.isRepeated) {
    isSpam = true;
    confidence = 0.9;
    category = 'repeated_message';
    reason = `Same message sent ${repeatCheck.count} times`;
  }

  // 5. AI detection for edge cases (if enabled and not already flagged)
  if (cfg.enableAIDetection && !isSpam && message.length > 20) {
    const aiResult = await aiSpamDetection(message);
    if (aiResult.isSpam && aiResult.confidence > 0.8) {
      isSpam = true;
      confidence = aiResult.confidence;
      category = aiResult.category;
      reason = aiResult.reason;
    }
  }

  // 6. Record offense and check threshold
  let offenseCount = 0;
  let shouldBlacklist = false;

  if (isSpam) {
    offenseCount = await recordSpamOffense(organizationId, contactId, category!, message, channel);
    shouldBlacklist = cfg.autoBlacklist && offenseCount >= cfg.offenseThreshold;

    if (shouldBlacklist) {
      await blacklistContact(organizationId, contactId, category!, `Auto-blacklisted after ${offenseCount} offenses`);
    }

    await logEvent('spam_detected', 'contact', contactId, {
      category,
      confidence,
      reason,
      offenseCount,
      blacklisted: shouldBlacklist,
    }, organizationId);
  }

  return {
    isSpam,
    confidence,
    category,
    reason,
    shouldBlacklist,
    offenseCount,
  };
}

/**
 * Check for repeated identical messages
 */
async function checkRepeatedMessage(
  organizationId: string,
  contactId: string,
  message: string
): Promise<{ isRepeated: boolean; count: number }> {
  // Normalize message for comparison
  const normalized = message.toLowerCase().trim().replace(/\s+/g, ' ');
  const hash = Buffer.from(normalized).toString('base64').slice(0, 32);

  const [result] = await sql`
    SELECT COUNT(*)::int as count
    FROM spam_message_hashes
    WHERE organization_id = ${organizationId}
      AND contact_id = ${contactId}
      AND message_hash = ${hash}
      AND created_at > now() - interval '24 hours'
  `.catch(() => [{ count: 0 }]);

  // Record this message hash
  await sql`
    INSERT INTO spam_message_hashes (organization_id, contact_id, message_hash, created_at)
    VALUES (${organizationId}, ${contactId}, ${hash}, now())
  `.catch(() => {});

  return {
    isRepeated: (result?.count || 0) >= 2,
    count: (result?.count || 0) + 1,
  };
}

/**
 * AI-powered spam detection for edge cases
 */
async function aiSpamDetection(message: string): Promise<{
  isSpam: boolean;
  confidence: number;
  category?: SpamCategory;
  reason?: string;
}> {
  try {
    const response = await callAI({
      messages: [{ role: 'user', content: message }],
      system: `You are a spam detection system for a real estate wholesaling platform.
Analyze the message and determine if it's spam or off-topic.

Relevant topics: selling/buying property, home values, real estate questions, contract discussions, closing process, property conditions, etc.

Spam includes: promotional content, phishing, scams, harassment, completely off-topic messages, bot-like behavior.

Respond with JSON only:
{
  "isSpam": boolean,
  "confidence": 0.0-1.0,
  "category": "promotional_spam" | "phishing" | "scam_attempt" | "harassment" | "bot_detected" | "off_topic" | null,
  "reason": "brief explanation"
}`,
      maxTokens: 150,
    });

    const result = JSON.parse(response.text);
    return {
      isSpam: result.isSpam === true,
      confidence: result.confidence || 0,
      category: result.category || undefined,
      reason: result.reason || undefined,
    };
  } catch {
    return { isSpam: false, confidence: 0 };
  }
}

/**
 * Record spam offense
 */
async function recordSpamOffense(
  organizationId: string,
  contactId: string,
  category: SpamCategory,
  message: string,
  channel: string
): Promise<number> {
  await sql`
    INSERT INTO spam_offenses (
      id, organization_id, contact_id, category,
      message_preview, channel, created_at
    ) VALUES (
      ${crypto.randomUUID()},
      ${organizationId},
      ${contactId},
      ${category},
      ${message.slice(0, 200)},
      ${channel},
      now()
    )
  `;

  const [result] = await sql`
    SELECT COUNT(*)::int as count
    FROM spam_offenses
    WHERE organization_id = ${organizationId}
      AND contact_id = ${contactId}
      AND created_at > now() - interval '24 hours'
  `;

  return result?.count || 1;
}

/**
 * Blacklist a contact
 */
export async function blacklistContact(
  organizationId: string,
  contactId: string,
  reason: SpamCategory | string,
  notes?: string
): Promise<void> {
  // Update leads table
  await sql`
    UPDATE leads
    SET
      is_blacklisted = true,
      blacklisted_at = now(),
      blacklist_reason = ${reason}
    WHERE id = ${contactId}
      AND organization_id = ${organizationId}
  `.catch(() => {});

  // Update social contacts table
  await sql`
    UPDATE social_contacts
    SET
      is_blacklisted = true,
      blacklisted_at = now(),
      blacklist_reason = ${reason}
    WHERE id = ${contactId}
      AND organization_id = ${organizationId}
  `.catch(() => {});

  // Add to blacklist table
  await sql`
    INSERT INTO contact_blacklist (
      id, organization_id, contact_id, reason,
      notes, created_at
    ) VALUES (
      ${crypto.randomUUID()},
      ${organizationId},
      ${contactId},
      ${reason},
      ${notes || null},
      now()
    )
    ON CONFLICT (organization_id, contact_id) DO UPDATE SET
      reason = EXCLUDED.reason,
      notes = EXCLUDED.notes,
      updated_at = now()
  `;

  await logEvent('contact_blacklisted', 'contact', contactId, {
    reason,
    notes,
  }, organizationId);
}

/**
 * Remove from blacklist
 */
export async function removeFromBlacklist(
  organizationId: string,
  contactId: string
): Promise<void> {
  await sql`
    UPDATE leads
    SET is_blacklisted = false, blacklist_reason = null
    WHERE id = ${contactId}
      AND organization_id = ${organizationId}
  `.catch(() => {});

  await sql`
    UPDATE social_contacts
    SET is_blacklisted = false, blacklist_reason = null
    WHERE id = ${contactId}
      AND organization_id = ${organizationId}
  `.catch(() => {});

  await sql`
    DELETE FROM contact_blacklist
    WHERE organization_id = ${organizationId}
      AND contact_id = ${contactId}
  `;

  await logEvent('contact_unblacklisted', 'contact', contactId, {}, organizationId);
}

/**
 * Check if contact is blacklisted
 */
export async function isBlacklisted(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  const [result] = await sql`
    SELECT 1 FROM contact_blacklist
    WHERE organization_id = ${organizationId}
      AND contact_id = ${contactId}
  `;

  return !!result;
}

/**
 * Get blacklist for organization
 */
export async function getBlacklist(
  organizationId: string,
  limit: number = 100
): Promise<Array<{
  contactId: string;
  reason: string;
  notes?: string;
  createdAt: Date;
}>> {
  const rows = await sql`
    SELECT contact_id, reason, notes, created_at
    FROM contact_blacklist
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(r => ({
    contactId: r.contact_id,
    reason: r.reason,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

/**
 * Get spam analytics
 */
export async function getSpamAnalytics(
  organizationId: string,
  days: number = 30
): Promise<{
  totalSpamDetected: number;
  byCategory: Record<SpamCategory, number>;
  blacklistedCount: number;
  topOffenders: Array<{ contactId: string; count: number }>;
}> {
  const [totals] = await sql`
    SELECT COUNT(*)::int as total
    FROM spam_offenses
    WHERE organization_id = ${organizationId}
      AND created_at > now() - (${days} || ' days')::interval
  `;

  const byCategory = await sql`
    SELECT category, COUNT(*)::int as count
    FROM spam_offenses
    WHERE organization_id = ${organizationId}
      AND created_at > now() - (${days} || ' days')::interval
    GROUP BY category
  `;

  const [blacklisted] = await sql`
    SELECT COUNT(*)::int as count
    FROM contact_blacklist
    WHERE organization_id = ${organizationId}
  `;

  const topOffenders = await sql`
    SELECT contact_id, COUNT(*)::int as count
    FROM spam_offenses
    WHERE organization_id = ${organizationId}
      AND created_at > now() - (${days} || ' days')::interval
    GROUP BY contact_id
    ORDER BY count DESC
    LIMIT 10
  `;

  const categoryMap: Record<string, number> = {};
  for (const row of byCategory) {
    categoryMap[row.category] = row.count;
  }

  return {
    totalSpamDetected: totals?.total || 0,
    byCategory: categoryMap as Record<SpamCategory, number>,
    blacklistedCount: blacklisted?.count || 0,
    topOffenders: topOffenders.map(r => ({
      contactId: r.contact_id,
      count: r.count,
    })),
  };
}

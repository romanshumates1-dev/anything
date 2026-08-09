/**
 * Social Media Integration Engine
 *
 * Multi-platform social media integration for:
 * - Instagram (DMs, comments)
 * - Facebook (Messenger, comments)
 * - TikTok (DMs, comments)
 * - Twitter/X (DMs, mentions)
 *
 * Features:
 * - Receive messages from all platforms
 * - Add social contacts to pipeline
 * - Run full seller pipeline via social media
 * - Track analytics per platform
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { callAI } from '@/app/api/utils/ai-provider';

export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'twitter';
export type MessageType = 'dm' | 'comment' | 'mention' | 'story_reply';

export interface SocialMediaAccount {
  id: string;
  organizationId: string;
  platform: SocialPlatform;
  platformAccountId: string;
  accountName: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  webhookSecret?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface IncomingSocialMessage {
  platform: SocialPlatform;
  messageType: MessageType;
  platformMessageId: string;
  platformUserId: string;
  platformUsername?: string;
  userDisplayName?: string;
  userProfileUrl?: string;
  message: string;
  mediaUrls?: string[];
  parentPostId?: string;
  timestamp: Date;
  rawPayload?: Record<string, unknown>;
}

export interface SocialContact {
  id: string;
  organizationId: string;
  platform: SocialPlatform;
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  profileUrl?: string;
  leadId?: string;
  pipelineStatus: 'new' | 'contacted' | 'engaged' | 'qualified' | 'converted' | 'lost';
  lastMessageAt?: Date;
  messageCount: number;
  isBlacklisted: boolean;
  createdAt: Date;
}

export interface SocialAnalytics {
  platform: SocialPlatform;
  totalMessages: number;
  uniqueContacts: number;
  newContactsToday: number;
  responsesGenerated: number;
  leadsCreated: number;
  conversions: number;
  avgResponseTimeMinutes: number;
}

/**
 * Webhook handlers for each platform
 */
export const WEBHOOK_ENDPOINTS = {
  instagram: '/api/webhooks/social/instagram',
  facebook: '/api/webhooks/social/facebook',
  tiktok: '/api/webhooks/social/tiktok',
  twitter: '/api/webhooks/social/twitter',
} as const;

/**
 * Process incoming social media message
 */
export async function processIncomingSocialMessage(
  organizationId: string,
  message: IncomingSocialMessage
): Promise<{
  contactId: string;
  isNewContact: boolean;
  leadId?: string;
  response?: string;
}> {
  // 1. Find or create social contact
  const contact = await findOrCreateSocialContact(organizationId, message);

  // 2. Store the incoming message
  await storeSocialMessage(organizationId, contact.id, message, 'inbound');

  // 3. Check if contact is blacklisted
  if (contact.isBlacklisted) {
    await logEvent('social_message_blocked', 'social_contact', contact.id, {
      platform: message.platform,
      reason: 'blacklisted',
    }, organizationId);
    return { contactId: contact.id, isNewContact: false };
  }

  // 4. Detect intent and route appropriately
  const intent = await detectSocialIntent(message.message);

  // 5. If seller intent, add to pipeline
  let leadId: string | undefined;
  if (intent.isSeller && !contact.leadId) {
    leadId = await createLeadFromSocialContact(organizationId, contact, message);
    await linkContactToLead(contact.id, leadId);
  }

  // 6. Generate response if appropriate
  let response: string | undefined;
  if (intent.shouldRespond && !contact.isBlacklisted) {
    const generatedResponse = await generateSocialResponse(organizationId, contact, message, intent);
    if (generatedResponse) {
      response = generatedResponse;
      await queueSocialResponse(organizationId, contact, response, message.platform);
    }
  }

  return {
    contactId: contact.id,
    isNewContact: !contact.leadId && !!leadId,
    leadId: leadId || contact.leadId || undefined,
    response,
  };
}

/**
 * Detect intent from social message
 */
async function detectSocialIntent(message: string): Promise<{
  isSeller: boolean;
  isBuyer: boolean;
  isSpam: boolean;
  shouldRespond: boolean;
  topic?: string;
}> {
  // Quick pattern matching first
  const sellerPatterns = [
    /sell(ing)?\s+(my|our|a|the)?\s*(house|home|property)/i,
    /want(s)?\s+to\s+sell/i,
    /need\s+to\s+sell/i,
    /looking\s+to\s+sell/i,
    /cash\s+(offer|buyer)/i,
    /how\s+much\s+(for|is|would)/i,
    /property\s+value/i,
    /home\s+value/i,
    /inherited\s+(house|home|property)/i,
    /foreclosure/i,
    /behind\s+on\s+(payments|mortgage)/i,
  ];

  const buyerPatterns = [
    /looking\s+(to|for)\s+buy/i,
    /want(s)?\s+to\s+buy/i,
    /investor/i,
    /wholesale\s+deal/i,
    /assignment/i,
    /proof\s+of\s+funds/i,
  ];

  const spamPatterns = [
    /follow\s+for\s+follow/i,
    /check\s+out\s+my/i,
    /free\s+gift/i,
    /click\s+(this|here)/i,
    /dm\s+me\s+for/i,
    /crypto/i,
    /nft/i,
    /bit\.ly/i,
    /tinyurl/i,
  ];

  const isSeller = sellerPatterns.some(p => p.test(message));
  const isBuyer = buyerPatterns.some(p => p.test(message));
  const isSpam = spamPatterns.some(p => p.test(message));

  return {
    isSeller,
    isBuyer,
    isSpam,
    shouldRespond: !isSpam && (isSeller || isBuyer || message.length > 20),
    topic: isSeller ? 'seller_inquiry' : isBuyer ? 'buyer_inquiry' : 'general',
  };
}

/**
 * Find or create social contact
 */
async function findOrCreateSocialContact(
  organizationId: string,
  message: IncomingSocialMessage
): Promise<SocialContact> {
  const [existing] = await sql`
    SELECT *
    FROM social_contacts
    WHERE organization_id = ${organizationId}
      AND platform = ${message.platform}
      AND platform_user_id = ${message.platformUserId}
  `;

  if (existing) {
    // Update last message time and count
    await sql`
      UPDATE social_contacts
      SET
        last_message_at = now(),
        message_count = message_count + 1,
        platform_username = COALESCE(${message.platformUsername}, platform_username),
        display_name = COALESCE(${message.userDisplayName}, display_name)
      WHERE id = ${existing.id}
    `;

    return {
      id: existing.id,
      organizationId: existing.organization_id,
      platform: existing.platform,
      platformUserId: existing.platform_user_id,
      platformUsername: existing.platform_username,
      displayName: existing.display_name,
      profileUrl: existing.profile_url,
      leadId: existing.lead_id,
      pipelineStatus: existing.pipeline_status,
      lastMessageAt: existing.last_message_at,
      messageCount: existing.message_count + 1,
      isBlacklisted: existing.is_blacklisted,
      createdAt: existing.created_at,
    };
  }

  // Create new contact
  const contactId = crypto.randomUUID();
  await sql`
    INSERT INTO social_contacts (
      id, organization_id, platform, platform_user_id,
      platform_username, display_name, profile_url,
      pipeline_status, last_message_at, message_count,
      is_blacklisted, created_at
    ) VALUES (
      ${contactId},
      ${organizationId},
      ${message.platform},
      ${message.platformUserId},
      ${message.platformUsername || null},
      ${message.userDisplayName || null},
      ${message.userProfileUrl || null},
      'new',
      now(),
      1,
      false,
      now()
    )
  `;

  await logEvent('social_contact_created', 'social_contact', contactId, {
    platform: message.platform,
    username: message.platformUsername,
  }, organizationId);

  return {
    id: contactId,
    organizationId,
    platform: message.platform,
    platformUserId: message.platformUserId,
    platformUsername: message.platformUsername,
    displayName: message.userDisplayName,
    profileUrl: message.userProfileUrl,
    pipelineStatus: 'new',
    lastMessageAt: new Date(),
    messageCount: 1,
    isBlacklisted: false,
    createdAt: new Date(),
  };
}

/**
 * Store social message
 */
async function storeSocialMessage(
  organizationId: string,
  contactId: string,
  message: IncomingSocialMessage,
  direction: 'inbound' | 'outbound'
): Promise<string> {
  const messageId = crypto.randomUUID();

  await sql`
    INSERT INTO social_messages (
      id, organization_id, social_contact_id, platform,
      message_type, platform_message_id, direction,
      content, media_urls, parent_post_id,
      platform_timestamp, created_at
    ) VALUES (
      ${messageId},
      ${organizationId},
      ${contactId},
      ${message.platform},
      ${message.messageType},
      ${message.platformMessageId},
      ${direction},
      ${message.message},
      ${message.mediaUrls ? JSON.stringify(message.mediaUrls) : null},
      ${message.parentPostId || null},
      ${message.timestamp.toISOString()},
      now()
    )
  `;

  return messageId;
}

/**
 * Create lead from social contact
 */
async function createLeadFromSocialContact(
  organizationId: string,
  contact: SocialContact,
  message: IncomingSocialMessage
): Promise<string> {
  const leadId = crypto.randomUUID();

  await sql`
    INSERT INTO leads (
      id, organization_id, name, source, source_detail,
      status, raw_address, social_platform, social_username,
      social_profile_url, created_at
    ) VALUES (
      ${leadId},
      ${organizationId},
      ${contact.displayName || contact.platformUsername || 'Social Lead'},
      'social_media',
      ${`${contact.platform}:${contact.platformUsername || contact.platformUserId}`},
      'new',
      '',
      ${contact.platform},
      ${contact.platformUsername || null},
      ${contact.profileUrl || null},
      now()
    )
  `;

  await logEvent('lead_created_from_social', 'lead', leadId, {
    platform: contact.platform,
    contactId: contact.id,
    initialMessage: message.message.slice(0, 200),
  }, organizationId);

  return leadId;
}

/**
 * Link contact to lead
 */
async function linkContactToLead(contactId: string, leadId: string): Promise<void> {
  await sql`
    UPDATE social_contacts
    SET lead_id = ${leadId}, pipeline_status = 'contacted'
    WHERE id = ${contactId}
  `;
}

/**
 * Generate response for social message
 */
async function generateSocialResponse(
  organizationId: string,
  contact: SocialContact,
  message: IncomingSocialMessage,
  intent: { isSeller: boolean; isBuyer: boolean; topic?: string }
): Promise<string | null> {
  // Get conversation history
  const history = await sql`
    SELECT direction, content, created_at
    FROM social_messages
    WHERE social_contact_id = ${contact.id}
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const contextType = intent.isSeller ? 'seller' : intent.isBuyer ? 'buyer' : 'general';

  const systemPrompt = `You are a friendly real estate professional responding to a ${contact.platform} message.

Context: This person ${intent.isSeller ? 'may want to sell their property' : intent.isBuyer ? 'is interested in buying properties' : 'reached out via social media'}.

RULES:
1. Keep responses SHORT - max 2-3 sentences for DMs, 1-2 for comments
2. Be conversational and friendly - match social media tone
3. Don't be salesy or pushy
4. If they want to sell: ask about the property location and situation
5. If they want to buy: ask about their criteria and budget
6. Always end with a question to keep conversation going
7. Never mention specific prices or make promises
8. Respect platform norms (Instagram = casual, Twitter = brief, etc.)

Recent conversation:
${history.reverse().map(h => `${h.direction === 'inbound' ? 'Them' : 'Us'}: ${h.content}`).join('\n')}

Their latest message: "${message.message}"`;

  try {
    const response = await callAI({
      messages: [{ role: 'user', content: 'Generate an appropriate response.' }],
      system: systemPrompt,
      maxTokens: 200,
    });

    return response.text;
  } catch (err) {
    console.error('[Social] AI response generation failed:', err);
    return null;
  }
}

/**
 * Queue response for sending
 */
async function queueSocialResponse(
  organizationId: string,
  contact: SocialContact,
  response: string,
  platform: SocialPlatform
): Promise<string | null> {
  return enqueueJob('send_social_response', {
    organizationId,
    contactId: contact.id,
    platformUserId: contact.platformUserId,
    platform,
    message: response,
  }, {
    maxAttempts: 3,
  });
}

/**
 * Send response via platform API
 */
export async function sendSocialMessage(
  organizationId: string,
  platform: SocialPlatform,
  recipientId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Get account credentials
  const [account] = await sql`
    SELECT *
    FROM social_media_accounts
    WHERE organization_id = ${organizationId}
      AND platform = ${platform}
      AND is_active = true
  `;

  if (!account) {
    return { success: false, error: `No active ${platform} account configured` };
  }

  // Map DB row to typed account
  const typedAccount: SocialMediaAccount = {
    id: account.id,
    organizationId: account.organization_id,
    platform: account.platform,
    platformAccountId: account.platform_account_id,
    accountName: account.account_name,
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    tokenExpiresAt: account.token_expires_at,
    webhookSecret: account.webhook_secret,
    isActive: account.is_active,
    createdAt: account.created_at,
  };

  // Platform-specific sending logic
  switch (platform) {
    case 'instagram':
      return sendInstagramDM(typedAccount, recipientId, message);
    case 'facebook':
      return sendFacebookMessage(typedAccount, recipientId, message);
    case 'twitter':
      return sendTwitterDM(typedAccount, recipientId, message);
    case 'tiktok':
      return sendTikTokMessage(typedAccount, recipientId, message);
    default:
      return { success: false, error: 'Unsupported platform' };
  }
}

/**
 * Instagram DM sender
 */
async function sendInstagramDM(
  account: SocialMediaAccount,
  recipientId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Instagram Graph API
  const url = `https://graph.facebook.com/v18.0/${account.platformAccountId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json() as { message_id?: string };
    return { success: true, messageId: data.message_id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Facebook Messenger sender
 */
async function sendFacebookMessage(
  account: SocialMediaAccount,
  recipientId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const url = `https://graph.facebook.com/v18.0/me/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json() as { message_id?: string };
    return { success: true, messageId: data.message_id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Twitter DM sender
 */
async function sendTwitterDM(
  account: SocialMediaAccount,
  recipientId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Twitter API v2
  const url = 'https://api.twitter.com/2/dm_conversations/with/:participant_id/messages'
    .replace(':participant_id', recipientId);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify({
        text: message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    const data = await response.json() as { data?: { dm_event_id?: string } };
    return { success: true, messageId: data.data?.dm_event_id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * TikTok message sender (limited API)
 */
async function sendTikTokMessage(
  account: SocialMediaAccount,
  recipientId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // TikTok's messaging API is very limited
  // This would require TikTok for Business API access
  console.log(`[TikTok] Would send to ${recipientId}: ${message.slice(0, 50)}...`);
  return {
    success: false,
    error: 'TikTok direct messaging requires TikTok for Business API access',
  };
}

/**
 * Get social media analytics
 */
export async function getSocialAnalytics(
  organizationId: string,
  days: number = 30
): Promise<Record<SocialPlatform, SocialAnalytics>> {
  const stats = await sql`
    WITH platform_stats AS (
      SELECT
        platform,
        COUNT(DISTINCT sm.id) as total_messages,
        COUNT(DISTINCT sc.id) as unique_contacts,
        COUNT(DISTINCT CASE WHEN sc.created_at > now() - interval '1 day' THEN sc.id END) as new_today,
        COUNT(DISTINCT CASE WHEN sm.direction = 'outbound' THEN sm.id END) as responses,
        COUNT(DISTINCT sc.lead_id) as leads_created,
        COUNT(DISTINCT CASE WHEN sc.pipeline_status = 'converted' THEN sc.id END) as conversions
      FROM social_contacts sc
      LEFT JOIN social_messages sm ON sm.social_contact_id = sc.id
      WHERE sc.organization_id = ${organizationId}
        AND sc.created_at > now() - (${days} || ' days')::interval
      GROUP BY platform
    )
    SELECT * FROM platform_stats
  `;

  const result: Record<string, SocialAnalytics> = {};
  const platforms: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'twitter'];

  for (const platform of platforms) {
    const row = stats.find(s => s.platform === platform);
    result[platform] = {
      platform,
      totalMessages: row?.total_messages || 0,
      uniqueContacts: row?.unique_contacts || 0,
      newContactsToday: row?.new_today || 0,
      responsesGenerated: row?.responses || 0,
      leadsCreated: row?.leads_created || 0,
      conversions: row?.conversions || 0,
      avgResponseTimeMinutes: 0, // Would need response time tracking
    };
  }

  return result as Record<SocialPlatform, SocialAnalytics>;
}

/**
 * Connect social media account
 */
export async function connectSocialAccount(
  organizationId: string,
  platform: SocialPlatform,
  accountData: {
    platformAccountId: string;
    accountName: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
  }
): Promise<string> {
  const accountId = crypto.randomUUID();

  await sql`
    INSERT INTO social_media_accounts (
      id, organization_id, platform, platform_account_id,
      account_name, access_token, refresh_token, token_expires_at,
      is_active, created_at
    ) VALUES (
      ${accountId},
      ${organizationId},
      ${platform},
      ${accountData.platformAccountId},
      ${accountData.accountName},
      ${accountData.accessToken},
      ${accountData.refreshToken || null},
      ${accountData.tokenExpiresAt?.toISOString() || null},
      true,
      now()
    )
    ON CONFLICT (organization_id, platform, platform_account_id)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      is_active = true,
      updated_at = now()
  `;

  await logEvent('social_account_connected', 'social_media_account', accountId, {
    platform,
    accountName: accountData.accountName,
  }, organizationId);

  return accountId;
}

/**
 * Get connected accounts
 */
export async function getConnectedAccounts(
  organizationId: string
): Promise<SocialMediaAccount[]> {
  const rows = await sql`
    SELECT *
    FROM social_media_accounts
    WHERE organization_id = ${organizationId}
    ORDER BY platform, created_at DESC
  `;

  return rows.map(r => ({
    id: r.id,
    organizationId: r.organization_id,
    platform: r.platform,
    platformAccountId: r.platform_account_id,
    accountName: r.account_name,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    tokenExpiresAt: r.token_expires_at,
    webhookSecret: r.webhook_secret,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

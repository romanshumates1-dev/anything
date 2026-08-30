/**
 * Ghost Error Sweep System
 *
 * Comprehensive system-wide scan for silent failures, orphaned records,
 * stuck processes, and inconsistent state that could block campaigns.
 *
 * Run before launching campaigns to ensure clean system state.
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export interface GhostError {
  category: 'orphan' | 'stuck' | 'inconsistent' | 'missing' | 'config';
  severity: 'critical' | 'warning' | 'info';
  entity: string;
  description: string;
  count: number;
  autoFixable: boolean;
  fix?: () => Promise<number>;
}

export interface SweepResult {
  timestamp: string;
  duration_ms: number;
  errors: GhostError[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    autoFixed: number;
  };
}

/**
 * Run a full ghost error sweep across the system.
 * @param autoFix - If true, automatically fix issues that are auto-fixable
 */
export async function runGhostErrorSweep(autoFix: boolean = false): Promise<SweepResult> {
  const startTime = Date.now();
  const errors: GhostError[] = [];
  let autoFixed = 0;

  // 1. Orphaned campaign contacts (campaign deleted but contacts remain)
  const orphanedContacts = await sql`
    SELECT COUNT(*)::int as count FROM campaign_contacts cc
    WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cc.campaign_id)
  `.catch(() => [{ count: 0 }]);

  if (orphanedContacts[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        DELETE FROM campaign_contacts
        WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_contacts.campaign_id)
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'orphan',
      severity: 'warning',
      entity: 'campaign_contacts',
      description: 'Campaign contacts with no parent campaign',
      count: orphanedContacts[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 2. Stuck jobs (processing for > 1 hour)
  const stuckJobs = await sql`
    SELECT COUNT(*)::int as count FROM jobs
    WHERE status = 'processing'
      AND locked_until < NOW() - INTERVAL '1 hour'
  `.catch(() => [{ count: 0 }]);

  if (stuckJobs[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        UPDATE jobs SET status = 'pending', locked_until = NULL, updated_at = NOW()
        WHERE status = 'processing' AND locked_until < NOW() - INTERVAL '1 hour'
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'stuck',
      severity: 'critical',
      entity: 'jobs',
      description: 'Jobs stuck in processing state for over 1 hour',
      count: stuckJobs[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 3. Dead jobs not alerted
  const unalertedDeadJobs = await sql`
    SELECT COUNT(*)::int as count FROM jobs
    WHERE status = 'dead'
      AND (payload->>'dead_alerted')::boolean IS NOT TRUE
  `.catch(() => [{ count: 0 }]);

  if (unalertedDeadJobs[0]?.count > 0) {
    errors.push({
      category: 'stuck',
      severity: 'warning',
      entity: 'jobs',
      description: 'Dead jobs that haven\'t been alerted to owner',
      count: unalertedDeadJobs[0].count,
      autoFixable: false,
    });
  }

  // 4. Campaigns in ACTIVE state with no pending contacts
  const activeNoContacts = await sql`
    SELECT COUNT(*)::int as count FROM campaigns c
    WHERE c.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM campaign_contacts cc
        WHERE cc.campaign_id = c.id
          AND cc.status IN ('pending', 'queued', 'sending')
      )
      AND c.created_at < NOW() - INTERVAL '1 hour'
  `.catch(() => [{ count: 0 }]);

  if (activeNoContacts[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        UPDATE campaigns SET status = 'COMPLETED', updated_at = NOW()
        WHERE status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM campaign_contacts cc
            WHERE cc.campaign_id = campaigns.id
              AND cc.status IN ('pending', 'queued', 'sending')
          )
          AND created_at < NOW() - INTERVAL '1 hour'
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'inconsistent',
      severity: 'warning',
      entity: 'campaigns',
      description: 'Active campaigns with no remaining contacts to process',
      count: activeNoContacts[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 5. Leads with invalid status
  const invalidStatusLeads = await sql`
    SELECT COUNT(*)::int as count FROM leads
    WHERE status NOT IN ('NEW', 'CONTACTED', 'ENGAGED', 'QUALIFIED', 'DEAL', 'DEAL_NO_AGREEMENT', 'COLD', 'LOST', 'DNC')
  `.catch(() => [{ count: 0 }]);

  if (invalidStatusLeads[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        UPDATE leads SET status = 'NEW', updated_at = NOW()
        WHERE status NOT IN ('NEW', 'CONTACTED', 'ENGAGED', 'QUALIFIED', 'DEAL', 'DEAL_NO_AGREEMENT', 'COLD', 'LOST', 'DNC')
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'inconsistent',
      severity: 'warning',
      entity: 'leads',
      description: 'Leads with invalid pipeline status',
      count: invalidStatusLeads[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 6. Buyers with invalid status
  const invalidStatusBuyers = await sql`
    SELECT COUNT(*)::int as count FROM buyers
    WHERE status NOT IN ('NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'MATCHED', 'OFFERED', 'ACCEPTED', 'CLOSED', 'LOST')
  `.catch(() => [{ count: 0 }]);

  if (invalidStatusBuyers[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        UPDATE buyers SET status = 'NEW', updated_at = NOW()
        WHERE status NOT IN ('NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'MATCHED', 'OFFERED', 'ACCEPTED', 'CLOSED', 'LOST')
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'inconsistent',
      severity: 'warning',
      entity: 'buyers',
      description: 'Buyers with invalid pipeline status',
      count: invalidStatusBuyers[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 7. Contracts signed but not assigned (stale > 7 days)
  const staleSignedContracts = await sql`
    SELECT COUNT(*)::int as count FROM contracts
    WHERE status = 'SIGNED'
      AND signed_at < NOW() - INTERVAL '7 days'
  `.catch(() => [{ count: 0 }]);

  if (staleSignedContracts[0]?.count > 0) {
    errors.push({
      category: 'stuck',
      severity: 'critical',
      entity: 'contracts',
      description: 'Signed contracts not assigned to buyers in 7+ days (inspection deadline risk)',
      count: staleSignedContracts[0].count,
      autoFixable: false,
    });
  }

  // 8. Orphaned buyer assignments (buyer or contract deleted)
  const orphanedAssignments = await sql`
    SELECT COUNT(*)::int as count FROM buyer_assignments ba
    WHERE NOT EXISTS (SELECT 1 FROM buyers b WHERE b.id = ba.buyer_id)
       OR NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = ba.contract_id)
  `.catch(() => [{ count: 0 }]);

  if (orphanedAssignments[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        DELETE FROM buyer_assignments
        WHERE NOT EXISTS (SELECT 1 FROM buyers b WHERE b.id = buyer_assignments.buyer_id)
           OR NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id = buyer_assignments.contract_id)
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'orphan',
      severity: 'warning',
      entity: 'buyer_assignments',
      description: 'Buyer assignments with missing buyer or contract',
      count: orphanedAssignments[0].count,
      autoFixable: true,
      fix,
    });
  }

  // 9. Messages with no lead/buyer reference
  const orphanedMessages = await sql`
    SELECT COUNT(*)::int as count FROM messages m
    WHERE m.lead_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = m.lead_id)
      AND NOT EXISTS (SELECT 1 FROM buyers b WHERE b.id = m.lead_id)
  `.catch(() => [{ count: 0 }]);

  if (orphanedMessages[0]?.count > 0) {
    errors.push({
      category: 'orphan',
      severity: 'info',
      entity: 'messages',
      description: 'Messages referencing deleted leads/buyers',
      count: orphanedMessages[0].count,
      autoFixable: false,
    });
  }

  // 10. Duplicate leads (same phone in same org)
  const duplicateLeads = await sql`
    SELECT COUNT(*)::int as count FROM (
      SELECT phone, organization_id, COUNT(*) as cnt
      FROM leads
      WHERE phone IS NOT NULL
      GROUP BY phone, organization_id
      HAVING COUNT(*) > 1
    ) dups
  `.catch(() => [{ count: 0 }]);

  if (duplicateLeads[0]?.count > 0) {
    errors.push({
      category: 'inconsistent',
      severity: 'warning',
      entity: 'leads',
      description: 'Duplicate leads with same phone number in organization',
      count: duplicateLeads[0].count,
      autoFixable: false,
    });
  }

  // 11. Missing AI provider configuration
  const aiConfig = await sql`
    SELECT value FROM app_settings WHERE key = 'ai_provider' LIMIT 1
  `.catch(() => []);

  const hasOllama = process.env.OLLAMA_BASE_URL || process.env.AI_PROVIDER === 'ollama';
  const hasBedrock = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  const hasAnthropic = process.env.ANTHROPIC_API_KEY;

  if (!hasOllama && !hasBedrock && !hasAnthropic) {
    errors.push({
      category: 'config',
      severity: 'critical',
      entity: 'ai_provider',
      description: 'No AI provider configured (need Ollama, Bedrock, or Anthropic)',
      count: 1,
      autoFixable: false,
    });
  }

  // 12. Missing SMS configuration
  const hasSms = process.env.AWS_SNS_SMS_ENABLED === 'true' ||
                 process.env.TWILIO_ACCOUNT_SID ||
                 process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!hasSms) {
    errors.push({
      category: 'config',
      severity: 'critical',
      entity: 'sms_provider',
      description: 'No SMS provider configured (need AWS SNS or Twilio)',
      count: 1,
      autoFixable: false,
    });
  }

  // 13. Missing email configuration
  const hasEmail = (process.env.AWS_SES_REGION || process.env.AWS_REGION) &&
                   process.env.AWS_ACCESS_KEY_ID;

  if (!hasEmail) {
    errors.push({
      category: 'config',
      severity: 'warning',
      entity: 'email_provider',
      description: 'No email provider configured (need AWS SES)',
      count: 1,
      autoFixable: false,
    });
  }

  // 14. Pending human approvals older than 48 hours
  const staleApprovals = await sql`
    SELECT COUNT(*)::int as count FROM human_approvals
    WHERE status = 'PENDING'
      AND created_at < NOW() - INTERVAL '48 hours'
  `.catch(() => [{ count: 0 }]);

  if (staleApprovals[0]?.count > 0) {
    errors.push({
      category: 'stuck',
      severity: 'warning',
      entity: 'human_approvals',
      description: 'Human approvals pending for over 48 hours',
      count: staleApprovals[0].count,
      autoFixable: false,
    });
  }

  // 15. Campaign contacts stuck in 'sending' state
  const stuckSending = await sql`
    SELECT COUNT(*)::int as count FROM campaign_contacts
    WHERE status = 'sending'
      AND updated_at < NOW() - INTERVAL '30 minutes'
  `.catch(() => [{ count: 0 }]);

  if (stuckSending[0]?.count > 0) {
    const fix = async () => {
      const result = await sql`
        UPDATE campaign_contacts SET status = 'pending', updated_at = NOW()
        WHERE status = 'sending' AND updated_at < NOW() - INTERVAL '30 minutes'
        RETURNING id
      `;
      return result.length;
    };
    errors.push({
      category: 'stuck',
      severity: 'critical',
      entity: 'campaign_contacts',
      description: 'Campaign contacts stuck in sending state for 30+ minutes',
      count: stuckSending[0].count,
      autoFixable: true,
      fix,
    });
  }

  // Auto-fix if requested
  if (autoFix) {
    for (const error of errors) {
      if (error.autoFixable && error.fix) {
        try {
          const fixed = await error.fix();
          autoFixed += fixed;
          console.log(`[GHOST-SWEEP] Auto-fixed ${fixed} ${error.entity} issues`);
        } catch (e) {
          console.error(`[GHOST-SWEEP] Failed to auto-fix ${error.entity}:`, e);
        }
      }
    }
  }

  const result: SweepResult = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    errors,
    summary: {
      critical: errors.filter(e => e.severity === 'critical').length,
      warning: errors.filter(e => e.severity === 'warning').length,
      info: errors.filter(e => e.severity === 'info').length,
      autoFixed,
    },
  };

  await logEvent('ghost_error_sweep', 'system', 'system', {
    ...result.summary,
    totalErrors: errors.length,
    duration_ms: result.duration_ms,
  }).catch(console.error);

  return result;
}

/**
 * Quick pre-campaign health check - returns true if system is ready for campaigns.
 */
export async function isSystemHealthyForCampaigns(): Promise<{
  healthy: boolean;
  blockers: string[];
}> {
  const sweep = await runGhostErrorSweep(false);
  const criticalErrors = sweep.errors.filter(e => e.severity === 'critical');

  return {
    healthy: criticalErrors.length === 0,
    blockers: criticalErrors.map(e => `${e.entity}: ${e.description} (${e.count})`),
  };
}

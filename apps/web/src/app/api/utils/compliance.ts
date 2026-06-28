import sql from '@/app/api/utils/sql';
import { logEvent } from './logger';

export async function checkConsent(target: string, channel: 'sms' | 'email') {
  const rows = await sql`
    SELECT * FROM compliance_records 
    WHERE target = ${target} 
    AND channel = ${channel}
    AND type = 'opt-out'
    LIMIT 1
  `;

  return rows.length === 0; // Returns true if NOT opted out
}

export async function registerOptOut(target: string, channel: 'sms' | 'email', metadata: any = {}) {
  await sql`
    INSERT INTO compliance_records (target, type, channel, metadata)
    VALUES (${target}, 'opt-out', ${channel}, ${JSON.stringify(metadata)})
    ON CONFLICT (target, channel, type) DO UPDATE
      SET metadata = EXCLUDED.metadata, created_at = CURRENT_TIMESTAMP
  `;

  await logEvent('compliance_opt_out', 'compliance', target, { channel, ...metadata });
}

export async function registerConsent(
  target: string,
  channel: 'sms' | 'email',
  metadata: any = {}
) {
  // Re-consent must clear any prior opt-out so the lead is reachable again.
  await sql.transaction([
    sql`
      DELETE FROM compliance_records
      WHERE target = ${target} AND channel = ${channel} AND type = 'opt-out'
    `,
    sql`
      INSERT INTO compliance_records (target, type, channel, metadata)
      VALUES (${target}, 'consent', ${channel}, ${JSON.stringify(metadata)})
      ON CONFLICT (target, channel, type) DO UPDATE
        SET metadata = EXCLUDED.metadata, created_at = CURRENT_TIMESTAMP
    `,
  ]);

  await logEvent('compliance_consent', 'compliance', target, { channel, ...metadata });
}

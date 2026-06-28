import sql from '@/app/api/utils/sql';

export type LogLevel = 'info' | 'warn' | 'error';

export async function logEvent(
  action: string,
  targetType: string,
  targetId: string,
  payload: any = {},
  userId?: string
) {
  // Console logging for dev visibility
  console.log(`[DealFlow LOG] ${action} on ${targetType}:${targetId}`, payload);

  try {
    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (${userId || null}, ${action}, ${targetType}, ${targetId}, ${JSON.stringify(payload)})
    `;
  } catch (error) {
    console.error('Failed to write to audit_logs', error);
  }
}

export const logger = {
  info: (msg: string, ctx: any = {}) => console.log(`INFO: ${msg}`, ctx),
  warn: (msg: string, ctx: any = {}) => console.warn(`WARN: ${msg}`, ctx),
  error: (msg: string, ctx: any = {}) => console.error(`ERROR: ${msg}`, ctx),
};

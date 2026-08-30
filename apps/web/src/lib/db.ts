/**
 * Database client re-export for cleaner imports.
 * Uses the same Neon serverless client as the rest of the app.
 */
import sqlClient from '@/app/api/utils/sql';

export const sql = sqlClient;
export default sqlClient;

/**
 * 10DLC A2P Throughput Configuration
 * Reads real assigned throughput values from environment variables (set after Twilio A2P approval)
 */

import { type ThroughputConfig, type TrustLevel } from './numberPool';

/**
 * Get the real assigned A2P throughput config from env vars
 * Falls back to defaults if not yet configured
 */
export function get10DLCThroughputConfig(): ThroughputConfig {
  const assignedMps = parseInt(process.env.TWILIO_10DLC_ASSIGNED_MPS || '1', 10);
  const tMobileDailyCap = parseInt(process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP || '2000', 10);

  // Infer trust level from assigned throughput
  let trustLevel: TrustLevel = 'low';
  if (tMobileDailyCap >= 50000 || assignedMps >= 50) {
    trustLevel = 'high';
  } else if (tMobileDailyCap >= 10000 || assignedMps >= 10) {
    trustLevel = 'medium';
  }

  return {
    mps: assignedMps,
    tMobileDailyCap,
    trustLevel,
  };
}

/**
 * Validate that throughput config is properly set (post A2P approval)
 * Used before Phase 2 loopback to ensure credentials are complete
 */
export function validate10DLCThroughputConfig(): { valid: boolean; message: string } {
  const mps = process.env.TWILIO_10DLC_ASSIGNED_MPS;
  const cap = process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP;

  if (!mps || !cap) {
    return {
      valid: false,
      message:
        'BLOCKED-ON-OWNER: Missing 10DLC throughput config. Set TWILIO_10DLC_ASSIGNED_MPS and TWILIO_10DLC_TMOBILE_DAILY_CAP after Twilio A2P approval.',
    };
  }

  const mpsNum = parseInt(mps, 10);
  const capNum = parseInt(cap, 10);

  if (isNaN(mpsNum) || isNaN(capNum) || mpsNum <= 0 || capNum <= 0) {
    return {
      valid: false,
      message: 'BLOCKED-ON-OWNER: 10DLC throughput vars must be positive integers.',
    };
  }

  return {
    valid: true,
    message: `10DLC throughput configured: MPS=${mpsNum}, T-Mobile cap=${capNum}/day`,
  };
}

export function printThroughputConfig(): void {
  const config = get10DLCThroughputConfig();
  console.log(`\n10DLC A2P Throughput Configuration`);
  console.log(`===================================`);
  console.log(`  MPS: ${config.mps}`);
  console.log(`  T-Mobile daily cap: ${config.tMobileDailyCap}`);
  console.log(`  Inferred trust level: ${config.trustLevel}`);
  console.log(`\nThis is either the real assigned value from Twilio or DEFAULT (unvetted).`);
  console.log(`After A2P campaign approval, update .env with the real values.`);
  console.log('');
}

/**
 * Sensitive Data Encryption
 *
 * AES-256-GCM encryption for PII and sensitive data at rest.
 * Uses ENCRYPTION_KEY from environment (32 bytes / 64 hex chars).
 *
 * WHAT TO ENCRYPT:
 * - Social Security Numbers (if ever stored)
 * - Bank account numbers
 * - API keys stored for users
 * - OAuth refresh tokens
 *
 * WHAT NOT TO ENCRYPT (use hashing instead):
 * - Passwords (use bcrypt/argon2)
 * - Phone numbers (need for lookup - use masking in display)
 * - Email addresses (need for lookup - use masking in display)
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required for encryption');
  }
  if (key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt sensitive data using AES-256-GCM.
 * Returns base64 encoded string: salt:iv:authTag:ciphertext
 */
export function encryptSensitive(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);

  // Derive a unique key for this encryption using scrypt
  const derivedKey = scryptSync(key, salt, 32);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  // Combine: salt:iv:authTag:ciphertext
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt sensitive data encrypted with encryptSensitive.
 */
export function decryptSensitive(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [saltB64, ivB64, authTagB64, ciphertext] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  // Derive the same key
  const derivedKey = scryptSync(key, salt, 32);

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a string appears to be encrypted by our system.
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 4 && parts.every(p => p.length > 0);
}

/**
 * Safely decrypt - returns null if decryption fails or data isn't encrypted.
 */
export function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isEncrypted(value)) return value; // Return as-is if not encrypted
  try {
    return decryptSensitive(value);
  } catch {
    console.error('[ENCRYPTION] Failed to decrypt value');
    return null;
  }
}

/**
 * Mask sensitive data for display (e.g., "****1234" for last 4 digits).
 */
export function maskSensitive(value: string, showLast: number = 4): string {
  if (!value || value.length <= showLast) return '****';
  return '****' + value.slice(-showLast);
}

/**
 * Mask email for display (e.g., "j***@example.com").
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '****';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Mask phone for display (e.g., "(***) ***-1234").
 */
export function maskPhone(phone: string): string {
  if (!phone) return '****';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `(***) ***-${digits.slice(-4)}`;
}

/**
 * Generate a new encryption key (for initial setup).
 * Run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

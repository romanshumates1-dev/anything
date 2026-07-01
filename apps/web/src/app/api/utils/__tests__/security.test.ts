import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeInput } from '@/app/api/utils/security';

describe('security', () => {
  it('sanitizes common SQL injection payloads', () => {
    expect(sanitizeInput("admin' OR '1'='1")).not.toMatch(/OR/i);
    expect(sanitizeInput('SELECT * FROM users')).not.toMatch(/SELECT/i);
  });
});
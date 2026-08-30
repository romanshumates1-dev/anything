#!/usr/bin/env node
/**
 * test-email-pipeline.mjs
 *
 * Tests the complete email pipeline from lead to deal close.
 * Uses Gmail SMTP (free 500/day) by default.
 *
 * Run: node scripts/test-email-pipeline.mjs
 *
 * Required env:
 *   SMTP_USER - Gmail address
 *   SMTP_PASS - Gmail app password
 *   DATABASE_URL - Supabase connection string
 */

import nodemailer from 'nodemailer';
import pg from 'pg';

const { Pool } = pg;

const config = {
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  databaseUrl: process.env.DATABASE_URL,
  testEmail: process.env.TEST_EMAIL || process.env.SMTP_USER,
};

let pool;

async function initDb() {
  pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
}

async function createTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

async function sendTestEmail(transport, subject, body) {
  try {
    const result = await transport.sendMail({
      from: config.smtpUser,
      to: config.testEmail,
      subject,
      text: body,
    });
    console.log(`✅ Email sent: ${subject} (${result.messageId})`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send: ${subject}`, error.message);
    return false;
  }
}

async function testPurchaseAgreementEmail(transport) {
  console.log('\n=== TEST: Purchase Agreement Email ===');

  const subject = '[TEST] Purchase Agreement - 123 Main St';
  const body = `
REAL ESTATE PURCHASE AGREEMENT

This Purchase Agreement ("Agreement") is entered into as of ${new Date().toLocaleDateString()}.

SELLER: John Doe
Property Address: 123 Main St, Dallas, TX 75001
Purchase Price: $150,000

TERMS:
1. Seller agrees to sell the above property to Buyer or Buyer's assigns.
2. Earnest money deposit of $1,500 due within 3 business days.
3. Closing to occur within 30 days of execution.
4. This agreement is assignable without seller approval.

INSPECTION PERIOD: 14 days from execution date.

SELLER SIGNATURE: _________________________ Date: _________

---
To unsubscribe: http://localhost:4000/api/email/unsubscribe
123 Main St, Suite 100, Dallas, TX 75001
`;

  return sendTestEmail(transport, subject, body);
}

async function testAssignmentContractEmail(transport) {
  console.log('\n=== TEST: Assignment Contract Email ===');

  const subject = '[TEST] Assignment Contract - 123 Main St';
  const body = `
ASSIGNMENT OF REAL ESTATE CONTRACT

This Assignment Agreement is entered into as of ${new Date().toLocaleDateString()}.

ASSIGNOR: DealFlow AI (on behalf of original buyer)
ASSIGNEE: Jane Smith
Original Contract Date: ${new Date().toLocaleDateString()}
Property: 123 Main St, Dallas, TX 75001

ASSIGNMENT FEE: $10,000

TERMS:
1. Assignor hereby assigns all rights under the original purchase agreement to Assignee.
2. Assignee agrees to pay the Assignment Fee at closing.
3. Assignee assumes all obligations under the original agreement.

ASSIGNEE SIGNATURE: _________________________ Date: _________

---
To unsubscribe: http://localhost:4000/api/email/unsubscribe
123 Main St, Suite 100, Dallas, TX 75001
`;

  return sendTestEmail(transport, subject, body);
}

async function testFeeAgreementEmail(transport) {
  console.log('\n=== TEST: Fee Agreement Email ===');

  const subject = '[TEST] Assignment Fee Agreement - 123 Main St';
  const body = `
ASSIGNMENT FEE AGREEMENT

This Fee Agreement is entered into as of ${new Date().toLocaleDateString()}.

BUYER: Jane Smith
Property: 123 Main St, Dallas, TX 75001
Assignment Fee: $10,000

PAYMENT TERMS:
1. Fee is due and payable at closing.
2. Fee is non-refundable once closing occurs.
3. If deal fails to close due to buyer default, fee is still owed.

BUYER SIGNATURE: _________________________ Date: _________

---
To unsubscribe: http://localhost:4000/api/email/unsubscribe
123 Main St, Suite 100, Dallas, TX 75001
`;

  return sendTestEmail(transport, subject, body);
}

async function testPasswordResetEmail(transport) {
  console.log('\n=== TEST: Password Reset Email ===');

  const subject = '[TEST] Reset your password';
  const body = `
Hi there,

You requested a password reset. Click the link below to set a new password:

http://localhost:4000/account/reset-password?token=test123

This link expires in 1 hour.

If you didn't request this, you can safely ignore this email.

---
DealFlow AI
`;

  return sendTestEmail(transport, subject, body);
}

async function checkDailyQuota() {
  console.log('\n=== CHECK EMAIL QUOTA ===');

  try {
    const result = await pool.query(`
      SELECT COUNT(*) as cnt
      FROM message_events
      WHERE provider = 'gmail'
        AND created_at > now() - interval '24 hours'
        AND direction = 'outbound'
        AND channel = 'email'
    `);
    const sentToday = Number(result.rows[0]?.cnt || 0);
    const remaining = 500 - sentToday;

    console.log(`Gmail quota: ${sentToday}/500 used, ${remaining} remaining`);
    return remaining;
  } catch {
    console.log('Could not check quota (table may not exist)');
    return 500;
  }
}

async function main() {
  console.log('========================================');
  console.log('EMAIL PIPELINE TEST');
  console.log('========================================');
  console.log(`\nSMTP User: ${config.smtpUser}`);
  console.log(`Test Email: ${config.testEmail}`);

  if (!config.smtpUser || !config.smtpPass) {
    console.error('\n❌ Missing SMTP credentials');
    console.log('Set SMTP_USER and SMTP_PASS environment variables');
    process.exit(1);
  }

  await initDb();
  const transport = await createTransport();

  const remaining = await checkDailyQuota();
  if (remaining < 5) {
    console.error('\n❌ Gmail daily quota nearly exhausted');
    process.exit(1);
  }

  const results = {
    purchaseAgreement: await testPurchaseAgreementEmail(transport),
    assignmentContract: await testAssignmentContractEmail(transport),
    feeAgreement: await testFeeAgreementEmail(transport),
    passwordReset: await testPasswordResetEmail(transport),
  };

  console.log('\n========================================');
  console.log('RESULTS');
  console.log('========================================');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.values(results).length;

  console.log(`\nEmails sent: ${passed}/${total}`);

  for (const [name, success] of Object.entries(results)) {
    console.log(`  ${success ? '✅' : '❌'} ${name}`);
  }

  if (passed === total) {
    console.log('\n✅ ALL EMAIL TESTS PASSED');
    console.log('\nCheck your inbox for test emails:');
    console.log(`  - Purchase Agreement`);
    console.log(`  - Assignment Contract`);
    console.log(`  - Fee Agreement`);
    console.log(`  - Password Reset`);
  } else {
    console.log('\n⚠️ SOME TESTS FAILED');
  }

  await pool.end();
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

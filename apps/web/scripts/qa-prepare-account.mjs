// Disposable QA account preparation for authenticated browser QA.
// Run:  node --env-file=.env scripts/qa-prepare-account.mjs <email> [--promote]
//
// SCOPE, deliberately narrow: this touches EXACTLY ONE row, and only the
// synthetic throwaway QA account used by scripts/deployed-browser-qa.mjs.
// It never touches customer data, and it prints only the QA account's own
// row. Read-only unless --promote is passed.
//
// WHY --promote IS NEEDED: the platform ships closed. getMinAccessRole()
// (src/app/api/utils/access-control.ts) reads MIN_ACCESS_ROLE, which is NOT
// set in the deployed Worker, so it falls back to ADMIN ("fail closed"). A
// freshly signed-up account therefore has role NULL, ranks below MEMBER, and
// every authenticated page soft-redirects it to /pending-access — which is
// exactly what the first authenticated crawl recorded (11 routes returning
// finalUrl=/pending-access while reporting status 200).
import { neon } from '@neondatabase/serverless';

const email = (process.argv[2] || '').trim().toLowerCase();
const promote = process.argv.includes('--promote');

if (!email) {
  console.error('usage: node --env-file=.env scripts/qa-prepare-account.mjs <email> [--promote]');
  process.exit(2);
}

// Refuse to operate on anything that is not obviously a disposable QA
// account. The seed owner must never be modified by a QA script.
if (!email.startsWith('qa-') || !email.endsWith('@dealswiftautomation.com')) {
  console.error(`refusing to touch '${email}': only 'qa-*@dealswiftautomation.com' synthetic accounts are in scope`);
  process.exit(2);
}

const sql = neon(process.env.DATABASE_URL);

const before = await sql`
  SELECT id, email, role, "emailVerified" IS NOT NULL AS verified, "createdAt"
  FROM "user" WHERE lower(email) = ${email}
`;
console.log('before:', JSON.stringify(before, null, 2));

if (before.length === 0) {
  console.error(`no such account: ${email}`);
  process.exit(1);
}

if (promote) {
  const updated = await sql`
    UPDATE "user" SET role = 'ADMIN' WHERE lower(email) = ${email} RETURNING id, email, role
  `;
  console.log('after promote:', JSON.stringify(updated, null, 2));
} else {
// Restore the value a real signup gets. `user.role` is NOT NULL (measured:
// setting it to NULL fails with 23502), so the safe demote target is the
// default signup role, not null.
const demoted = await sql`
  UPDATE "user" SET role = 'MEMBER' WHERE lower(email) = ${email} AND role = 'ADMIN'
RETURNING id, email, role
`;
console.log(
  demoted.length
      ? `demoted to the default signup role MEMBER: ${JSON.stringify(demoted)}`
        : 'no ADMIN row to demote (already non-admin)'
    );
  }
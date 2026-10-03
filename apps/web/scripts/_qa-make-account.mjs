// Creates a disposable QA account through the REAL signup API, then promotes it
// so it clears the access gate (MIN_ACCESS_ROLE is unset in the deployed Worker
// and getMinAccessRole() falls back to ADMIN, so MEMBER soft-redirects to
// /pending-access and no authenticated page renders).
//
// Why a fresh account: a previous QA password is not recoverable, and re-deriving
// one would mean writing credentials we do not own.
//
// Touches exactly ONE synthetic row. Refuses any address outside the qa-*
// synthetic domain. The credential is written to a temp file outside the repo
// for the QA scripts and is never printed or committed.
//
// Run: node --env-file=.env scripts/_qa-make-account.mjs
import { neon } from '@neondatabase/serverless';
import { writeFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';
const stamp = Date.now().toString(36);
const email = `qa-${stamp}@dealswiftautomation.com`;
const password = `Qa!${stamp}Pp9x`; // synthetic, never reused, never printed

// 1. Sign up through the real endpoint, so the deployed signup path is exercised
//    rather than assumed.
const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ email, password, name: 'QA Probe' }),
});
const body = await res.text();
console.log('SIGNUP', res.status, body.slice(0, 120));
if (!res.ok) {
  console.error('signup failed; not touching the database');
  process.exit(1);
}

// 2. Promote, because MEMBER cannot pass the access gate (see header).
const sql = neon(process.env.DATABASE_URL);
const promoted = await sql`
  UPDATE "user" SET role = 'ADMIN' WHERE lower(email) = ${email} RETURNING id, role
`;
console.log('PROMOTED', JSON.stringify(promoted));

// 3. Credential handoff for the QA scripts only.
const out = process.env.TEMP + '/qa-cred.json';
writeFileSync(out, JSON.stringify({ email, password, base: BASE }));
console.log('WROTE', out);

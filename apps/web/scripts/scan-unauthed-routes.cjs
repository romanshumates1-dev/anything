// Adversarial scan: find API routes with no auth/session/org/tenant scoping reference.
// Output is a candidate list for manual review, NOT a verdict.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src', 'app', 'api');

const AUTH_PATTERNS = [
  'getSession',
  'auth.api',
  'requireAdmin',
  'getOrganization',
  'authz',
  'csrf',
  'verifySignature',
  'validateTwilioSignature',
  'apiKey',
  'authorization',
  'verifyWebhook',
  'requireAuth',
  'requireSession',
  'getUserOrganizations',
  'x-api-key',
  'Bearer',
  'checkAuth',
  'authenticateApiKey',
  'CRON_SECRET',
  'webhookSecret',
  'stripe',
  'twilio',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name === 'route.ts') out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const flagged = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const hasAuth = AUTH_PATTERNS.some((p) => src.includes(p));
  if (!hasAuth) {
    // Show the exported handlers so we can eyeball what is exposed.
    const handlers = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    flagged.push({ rel, handlers: handlers.join(',') || '(none)' });
  }
}

console.log(`TOTAL ROUTES SCANNED: ${files.length}`);
console.log(`ROUTES WITH NO AUTH/ORG REFERENCE: ${flagged.length}\n`);
for (const x of flagged) {
  console.log(`  ${x.rel}   [${x.handlers}]`);
}

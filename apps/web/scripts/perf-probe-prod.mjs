const BASE = process.argv[2] || 'https://dealswiftautomation.com';
const ROUTES = [
  '/', '/pricing', '/features', '/how-it-works', '/trust', '/faq',
  '/about', '/contact', '/legal/terms', '/privacy', '/security',
  '/cash-offer', '/login', '/signin', '/signup',
];
const RUNS = 3;

console.log(`route                          p50     p95     min     max   status  KB`);
console.log('-'.repeat(72));
const rows = [];
for (const route of ROUTES) {
  const times = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}${route}`, { redirect: 'follow' });
      const buf = await res.arrayBuffer();
      times.push(Date.now() - t0);
      if (i === 0) {
        bytes = buf.byteLength;
        status = res.status;
      }
    } catch (e) {
      times.push(-1);
    }
  }
  const ok = times.filter((t) => t >= 0).sort((a, b) => a - b);
  if (!ok.length) {
    console.log(`${route.padEnd(30)} ERROR`);
    continue;
  }
  const p50 = ok[Math.floor(ok.length / 2)];
  const p95 = ok[ok.length - 1];
  rows.push({ route, p50, p95 });
  console.log(
    `${route.padEnd(30)} ${String(p50).padEnd(6)} ${String(p95).padEnd(6)} ${String(ok[0]).padEnd(6)} ${String(ok[ok.length - 1]).padEnd(6)} ${String(status).padEnd(7)} ${(bytes / 1024).toFixed(0)}`
  );
}

console.log('');
const slow = rows.filter((r) => r.p95 > 2000).sort((a, b) => b.p95 - a.p95);
if (slow.length) {
  console.log(`SLOW (>2s p95): ${slow.length}`);
  for (const s of slow) console.log(`  ${s.route} p95=${s.p95}ms`);
} else {
  console.log('No route exceeded 2s p95.');
}
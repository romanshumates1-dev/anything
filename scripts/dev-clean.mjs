// dev-clean.mjs — kill a stale jobs-dev process and anything bound to :4000,
// then the root `dev:clean` script chains into `yarn workspace web dev`.
// Written as a real script file so the root package.json stays valid JSON
// (the previous inline `node -e "..."` used backtick/`$` escapes that are
// illegal in JSON and broke Turbopack's package.json resolver).
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PID_FILE = 'apps/web/.jobs-dev.pid';
const PORT = '4000';

function killPid(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    console.log(`[dev:clean] killed PID ${pid}`);
  } catch {
    /* process already gone — fine */
  }
}

// 1) Stale jobs-dev single-instance pidfile.
if (existsSync(PID_FILE)) {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) killPid(pid);
  } catch {
    /* unreadable pidfile — ignore */
  }
  try {
    unlinkSync(PID_FILE);
    console.log(`[dev:clean] removed ${PID_FILE}`);
  } catch {
    /* already removed — ignore */
  }
}

// 2) Anything still listening on :4000.
try {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (line.includes(`:${PORT}`)) {
      const cols = line.trim().split(/\s+/);
      const pid = cols[cols.length - 1];
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
  }
  for (const pid of pids) killPid(pid);
} catch {
  /* netstat unavailable — ignore */
}

console.log('[dev:clean] done');

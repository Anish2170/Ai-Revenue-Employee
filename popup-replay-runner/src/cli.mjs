import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { executeReplay } from './replay.mjs';

const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
const backend = new URL(args.includes('--backend') ? arg('--backend') : 'https://ai-revenue-employee.onrender.com');
if (backend.protocol !== 'https:' || backend.username || backend.password) throw Error('Runner backend must be an HTTPS origin.');
backend.pathname = '/'; backend.search = ''; backend.hash = '';
let silent = false;
const output = new Writable({ write(chunk, _encoding, done) { if (!silent) process.stdout.write(chunk); done(); } });
const reader = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
process.stdout.write('Paste the one-time pairing code from Popup Test Lab (hidden): ');
silent = true; const pairingCode = (await reader.question('')).trim(); silent = false; reader.close(); process.stdout.write('\n');
let bearer;
async function request(path, body) {
  const res = await fetch(new URL(path, backend), { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!res.ok) { const error = new Error(`Replay service returned HTTP ${res.status}`); error.status = res.status; throw error; }
  return res.json();
}
const paired = await request('/api/popup-replay/runner/pair', { pairingCode }); bearer = paired.token;
console.log('Runner connected. Credentials stay in memory. Ctrl+C stops the runner.');
let stopped = false, active;
process.on('SIGINT', () => { stopped = true; active?.abort(); });
process.on('SIGTERM', () => { stopped = true; active?.abort(); });
let completed = 0, failures = 0; const identities = new Set();
while (!stopped && completed < 50) {
  try {
    const { job } = await request('/api/popup-replay/runner/claim', {});
    if (!job) { await new Promise(resolve => setTimeout(resolve, 2500)); continue; }
    active = new AbortController(); console.log(`Run ${job.ordinal}: ${job.scenario} (${job.surface})`);
    const report = await executeReplay(job, { backendUrl: backend.origin, headed: args.includes('--headed'), signal: active.signal, heartbeat: () => request(`/api/popup-replay/runner/runs/${job.id}/heartbeat`, { runToken: job.runToken }) });
    if (report.identity) {
      if (identities.has(report.identity.visitorId) || identities.has(report.identity.sessionId)) { report.result.outcome = 'failed'; report.result.reason = 'A previous run identity was reused'; }
      identities.add(report.identity.visitorId); identities.add(report.identity.sessionId);
    }
    if (!stopped) {
      try { const result = await request(`/api/popup-replay/runner/runs/${job.id}/complete`, { runToken: job.runToken, result: report.result, ...(report.screenshot ? { screenshot: report.screenshot } : {}) }); console.log(`Result: ${result.status}`); }
      catch (error) { if (![403, 409].includes(error.status)) throw error; console.log('Run was stopped, expired, or reached its budget limit.'); }
    }
    completed++; failures = 0;
    await new Promise(resolve => setTimeout(resolve, 4000));
  } catch (error) {
    if ([401, 403].includes(error.status)) { console.error('Runner authorization expired or was revoked. Pair again from the dashboard.'); break; }
    if (++failures >= 5) { console.error('Replay service unavailable after five bounded attempts. Stopping.'); break; }
    console.error('Connection interrupted; retrying after 10 seconds.'); await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
console.log('Runner stopped.');

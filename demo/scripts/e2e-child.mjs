import { spawn } from 'node:child_process';

const [, , command, ...args] = process.argv;
if (!command) throw new Error('e2e-child requires a command');

const ownerPid = process.ppid;
const child = spawn(command, args, { env: process.env, stdio: 'inherit' });
let closing = false;

function ownerIsAlive() {
  try { process.kill(ownerPid, 0); return process.ppid === ownerPid; } catch { return false; }
}

function stop(code = 0) {
  if (closing) return;
  closing = true;
  if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => stop(signal === 'SIGINT' ? 130 : 0));
}
child.once('error', error => { console.error(error); stop(1); });
child.once('exit', (code, signal) => {
  if (!closing) process.exit(signal ? 1 : code ?? 1);
});
setInterval(() => { if (!ownerIsAlive()) stop(0); }, 500).unref();

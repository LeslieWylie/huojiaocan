import { spawn } from 'node:child_process';

const appPort = Number(process.env.E2E_PORT || 18790);
const dataPort = Number(process.env.E2E_DATA_PORT || 15431);
const llmPort = Number(process.env.E2E_LLM_PORT || 15432);
const children = [];
let closing = false;

function start(label, command, args, env = {}) {
  const child = spawn(process.execPath, ['scripts/e2e-child.mjs', command, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  const forward = stream => stream.on('data', chunk => process.stdout.write(`[e2e:${label}] ${chunk}`));
  forward(child.stdout);
  forward(child.stderr);
  child.once('exit', (code, signal) => {
    if (!closing && code !== 0) {
      console.error(`[e2e:${label}] exited before the suite completed (${signal || code})`);
      shutdown(code || 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250).unref();
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

start('data', process.execPath, ['scripts/mock-supabase.mjs'], { MOCK_PORT: String(dataPort) });
start('llm', process.execPath, ['scripts/mock-supabase.mjs'], { MOCK_PORT: String(llmPort) });
start('app', process.execPath, ['server/index.js'], {
  PORT: String(appPort),
  DOCUMENT_INDEX_PROVIDER: 'local',
  SUPABASE_URL: `http://127.0.0.1:${dataPort}`,
  SUPABASE_ANON_KEY: 'mock-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service',
  USER_DEEPSEEK_KEY_ENCRYPTION_SECRET: 'mock-secret-for-local-e2e-only',
  LLM_GATEWAY_BASE_URL: `http://127.0.0.1:${llmPort}`,
  LLM_GATEWAY_API_KEY: 'mock-key',
  LLM_TEXT_MODEL: 'mock-model',
  ALLOW_INDEX_PROVIDER_FALLBACK: 'true'
});

setInterval(() => {}, 2 ** 30);

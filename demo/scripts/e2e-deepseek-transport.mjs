// Test-process-only transport: exercise personal-key resolution without paid calls.
if (process.env.HJC_E2E_TRANSPORT !== '1') throw new Error('E2E transport requires explicit opt-in');
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://api.deepseek.com') {
    url.protocol = 'http:';
    url.host = '127.0.0.1:' + (process.env.E2E_LLM_PORT || '15432');
    return realFetch(url, init);
  }
  return realFetch(input, init);
};

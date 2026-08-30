const site = String(process.env.SITE_URL || 'https://app.huojiaocan.workers.dev').replace(/\/$/, '');
const expectedCommit = 'd5c4e62c20172ce400aef84545dfba3a0580b9ae';

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return body;
}

const health = await json(`${site}/api/index/health`);
if (health.activeProvider !== 'pageindex' || health.requestedProvider !== 'pageindex' || health.fallback !== false) {
  throw new Error(`provider selection is not fail-closed: ${JSON.stringify({ activeProvider: health.activeProvider, requestedProvider: health.requestedProvider, fallback: health.fallback })}`);
}
if (health.adapter !== 'vendor' || health.vendorCommit !== expectedCommit) {
  throw new Error(`unexpected PageIndex runtime: ${JSON.stringify({ adapter: health.adapter, vendorCommit: health.vendorCommit })}`);
}

const retrieval = await json(`${site}/api/index/retrieve`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: '沁园春·雪', scope: ['teacher-guide', 'textbook'], topK: 8, includeReview: false, mode: 'search' })
});
const results = retrieval.results || retrieval.hits || [];
if (retrieval.provider !== 'pageindex' || results.length === 0) {
  throw new Error(`public PageIndex retrieval did not complete: ${JSON.stringify({ provider: retrieval.provider, results: results.length })}`);
}
if (results.some(result => !Number.isInteger(result.pdfPage) || result.pdfPage < 1 || result.viewer?.page !== result.pdfPage)) {
  throw new Error('citation physical-page mapping is invalid');
}

// Asking is account-protected in production. If a caller deliberately supplies
// a short-lived Supabase access token, verify the complete grounded path too;
// otherwise keep this check public and never require a teacher credential in CI.
const accessToken = String(process.env.PRODUCTION_AUTH_TOKEN || '').trim();
let answer = null;
if (accessToken) {
  answer = await json(`${site}/api/index/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ question: '讲一下沁园春·雪应该怎么备课', scope: ['teacher-guide', 'textbook'], limit: 8 })
  });
  const citations = answer.citations || answer.sections?.flatMap(section => section.citations || []) || [];
  if (answer.provider !== 'pageindex' || !answer.generation || citations.length === 0) {
    throw new Error(`grounded PageIndex ask did not complete: ${JSON.stringify({ provider: answer.provider, generation: answer.generation, citations: citations.length })}`);
  }
  if (citations.some(citation => !Number.isInteger(citation.pdfPage) || citation.pdfPage < 1 || citation.viewer?.page !== citation.pdfPage)) {
    throw new Error('answer citation physical-page mapping is invalid');
  }
}

console.log(JSON.stringify({
  ok: true,
  site,
  provider: health.activeProvider,
  pageIndexCommit: health.vendorCommit,
  retrievalCount: results.length,
  answerGeneration: answer?.generation || null,
  samplePages: results.slice(0, 4).map(result => ({ documentId: result.documentId, pdfPage: result.pdfPage, printedPage: result.printedPage }))
}));

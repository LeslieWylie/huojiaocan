// URL-owned workspace context. A material is identified by its real document id,
// never by the import classification when both are present.
export const LESSON_PAGES = new Set(['cards', 'slides', 'study', 'homework', 'rehearsal', 'pulse', 'worksheet', 'learning', 'deliberation', 'reflection']);
const CONTEXT_PAGES = new Set(['library', 'document', 'unit', 'ask', 'alignment', 'guide', 'inspect', 'validation', 'jobs', 'ingest']);
export function navigationHref(id, href, search = globalThis.location?.search || '') {
  const source = new URLSearchParams(search), target = new URL(href, 'https://workspace.invalid');
  const returnPath = source.get('return') || '';
  if (returnPath.startsWith('/') && !returnPath.startsWith('//')) {
    const parent = new URL(returnPath, 'https://workspace.invalid').searchParams;
    if ((LESSON_PAGES.has(id) || ['ask', 'alignment', 'unit', 'guide'].includes(id)) && parent.has('lesson')) {
      // A citation's section title/page identifies the evidence, not the lesson
      // being prepared. Course actions return to the explicit parent context.
      for (const key of ['doc', 'documentId', 'page', 'node', 'lesson', 'unit', 'scope', 'job', 'jobId']) {
        source.delete(key);
        if (parent.has(key)) source.set(key, parent.get(key));
      }
    }
    for (const key of ['draftId', 'returnDraftId', 'lesson', 'unit', 'scope']) {
      if (!source.has(key) && parent.has(key)) source.set(key, parent.get(key));
    }
    if ((source.get('documentId') || source.get('doc')) === (parent.get('documentId') || parent.get('doc'))) {
      const job = parent.get('jobId') || parent.get('job');
      if (job && !source.has('jobId')) source.set('jobId', job);
    }
  }
  const draft = source.get('draftId') || source.get('returnDraftId');
  if ((LESSON_PAGES.has(id) || id === 'ask' || id === 'alignment') && draft) {
    return `${target.pathname}?${new URLSearchParams({ draftId: draft })}`;
  }
  if (!CONTEXT_PAGES.has(id)) return target.pathname + target.search;
  const documentId = source.get('documentId') || source.get('doc');
  const targetDocument = target.searchParams.get('documentId') || target.searchParams.get('doc') || documentId;
  const switched = Boolean(documentId && targetDocument && documentId !== targetDocument);
  if (targetDocument) target.searchParams.set('doc', targetDocument);
  target.searchParams.delete('documentId');
  for (const key of ['lesson', 'scope', 'unit']) {
    if (!target.searchParams.has(key) && source.get(key)) target.searchParams.set(key, source.get(key));
  }
  if (!switched) {
    for (const key of ['page', 'node']) if (!target.searchParams.has(key) && source.get(key)) target.searchParams.set(key, source.get(key));
    const job = source.get('jobId') || source.get('job');
    if (job && documentId && targetDocument === documentId && !target.searchParams.has('jobId')) target.searchParams.set('jobId', job);
  }
  if (draft) target.searchParams.set('returnDraftId', draft);
  return target.pathname + target.search;
}

export function replaceWorkspaceUrl(href) {
  globalThis.history?.replaceState?.(null, '', href);
  // Sibling navigation must reflect page changes, not only full navigations.
  globalThis.dispatchEvent?.(new Event('workspace-context-change'));
}

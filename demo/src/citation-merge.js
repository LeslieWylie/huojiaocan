function citationPage(citation) {
  return Number(citation?.pdfPage ?? citation?.pageNumber ?? citation?.page);
}

function citationKey(citation) {
  const documentId = String(citation?.documentId || citation?.document_id || '').trim();
  const page = citationPage(citation);
  return documentId && Number.isInteger(page) && page > 0 ? `${documentId}:${page}` : '';
}

function nextEvidenceId(usedIds, counter) {
  while (usedIds.has(`E${counter.value}`)) counter.value += 1;
  const id = `E${counter.value}`;
  usedIds.add(id);
  counter.value += 1;
  return id;
}

function remapEvidenceRefs(value, idMap, key = '') {
  if (Array.isArray(value)) {
    if (['evidenceRefs', 'evidence_refs', 'citationIds', 'citation_ids', 'refs'].includes(key)) {
      return [...new Set(value.map(item => idMap.get(String(item)) || String(item)).filter(Boolean))];
    }
    return value.map(item => remapEvidenceRefs(item, idMap));
  }
  if (!value || typeof value !== 'object') {
    if (['citationId', 'citation_id'].includes(key)) return idMap.get(String(value)) || value;
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    remapEvidenceRefs(childValue, idMap, childKey)
  ]));
}

/**
 * A model response numbers its citations from E1 on every turn. Drafts keep a
 * stable citation namespace because existing cards may still point at an older
 * page. Merge by trusted document + physical page, then remap this turn's refs
 * before the draft is saved.
 */
export function mergeFollowUpCitations(previousCitations, response) {
  const previous = Array.isArray(previousCitations) ? previousCitations : [];
  const current = Array.isArray(response?.citations) ? response.citations : [];
  const usedIds = new Set();
  const byPage = new Map();
  const merged = [];
  const counter = { value: 1 };

  for (const citation of previous) {
    const key = citationKey(citation);
    if (!key || byPage.has(key)) continue;
    const requestedId = String(citation?.id || citation?.citationId || '').trim();
    const id = requestedId && !usedIds.has(requestedId)
      ? (usedIds.add(requestedId), requestedId)
      : nextEvidenceId(usedIds, counter);
    const normalized = { ...citation, id };
    byPage.set(key, merged.length);
    merged.push(normalized);
  }

  const idMap = new Map();
  const currentCitations = [];
  for (const citation of current) {
    const key = citationKey(citation);
    if (!key) continue;
    const localId = String(citation?.id || citation?.citationId || '').trim();
    const existingIndex = byPage.get(key);
    let id;
    if (existingIndex !== undefined) {
      id = merged[existingIndex].id;
      // Prefer the newest server-returned canonical excerpt for this page while
      // preserving the stable id used by older cards.
      merged[existingIndex] = { ...merged[existingIndex], ...citation, id };
    } else {
      const requestedId = localId;
      id = requestedId && !usedIds.has(requestedId)
        ? (usedIds.add(requestedId), requestedId)
        : nextEvidenceId(usedIds, counter);
      byPage.set(key, merged.length);
      merged.push({ ...citation, id });
    }
    if (localId) idMap.set(localId, id);
    if (!currentCitations.some(item => citationKey(item) === key)) {
      currentCitations.push({ ...citation, id });
    }
  }

  const normalizedResponse = remapEvidenceRefs({ ...response, citations: currentCitations }, idMap);
  return { citations: merged, response: normalizedResponse };
}


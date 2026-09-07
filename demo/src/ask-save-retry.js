// Page-memory only. Never reconstruct a write from display/recovery turns.
export function pendingDraftSave({ ownerUserId, draftId = '', version, payload }) {
  if (!ownerUserId || !payload?.answer || (draftId && !(Number(version) > 0))) return null;
  return JSON.parse(JSON.stringify({ ownerUserId: String(ownerUserId), draftId: String(draftId),
    body: { ...payload, ...(draftId ? { version } : {}) } }));
}

export function canRetryDraftSave(pending, { ownerUserId, draftId = '', version, transitioning = false }) {
  return Boolean(pending && !(pending.createAttempted && !pending.draftId) && !transitioning && ownerUserId
    && pending.ownerUserId === String(ownerUserId) && pending.draftId === String(draftId)
    && (!pending.draftId || Number(pending.body.version) === Number(version)));
}

export function unsafeSaveRetry(error) {
  return [400, 401, 403, 404, 409, 422].includes(error?.status)
    || ['auth_invalid', 'auth_required', 'auth_owner_changed', 'edit_conflict', 'card_locked', 'save_result_unknown'].includes(error?.code);
}

export async function writePendingDraft(pending, request) {
  // A create may commit before its response is lost; without an idempotency
  // key, a second POST could create a duplicate draft.
  if (!pending.draftId && pending.createAttempted) throw Object.assign(new Error('save_result_unknown'), { code: 'save_result_unknown' });
  if (!pending.draftId) pending.createAttempted = true;
  const data = await request(pending.draftId ? `/api/drafts/${encodeURIComponent(pending.draftId)}` : '/api/drafts', {
    method: pending.draftId ? 'PATCH' : 'POST', body: pending.body
  });
  const draft = data?.draft;
  // A successful-but-unusable response is not permission to blindly POST again.
  if (!draft?.id || (pending.draftId && String(draft.id) !== pending.draftId)) {
    throw Object.assign(new Error('save_result_unknown'), { code: 'save_result_unknown' });
  }
  return draft;
}

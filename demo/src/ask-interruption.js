// Per-tab handoff only; this is not a server checkpoint.
const prefix = 'huojiaocan.ask.inflight.';
const key = (owner, draft) => prefix + JSON.stringify([owner, draft || '']);
export function readInterruptedAsk(owner, draft = '') {
  if (!owner) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key(owner, draft)) || 'null');
    return value?.owner === owner && value.draft === draft && typeof value.question === 'string'
      && Date.now() - value.startedAt < 86400000 ? value : null;
  } catch { return null; }
}
export function markAskInFlight(owner, draft, question) {
  const value = { owner, draft: draft || '', question, startedAt: Date.now(), id: crypto.randomUUID() };
  try { sessionStorage.setItem(key(owner, draft), JSON.stringify(value)); return value; } catch { return null; }
}
export function clearAskInFlight(value) {
  if (!value) return;
  try {
    if (readInterruptedAsk(value.owner, value.draft)?.id === value.id) sessionStorage.removeItem(key(value.owner, value.draft));
  } catch { /* Recovery is best effort and must not break rendering. */ }
}

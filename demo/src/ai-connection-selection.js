// Only an opaque key ID is persisted; raw provider credentials never enter here.
const selectionKey = owner => `huojiaocan.ai.selection.${encodeURIComponent(owner)}`;
export function readAiConnectionSelection(owner) {
  if (!owner) return null;
  try {
    const value = JSON.parse(localStorage.getItem(selectionKey(String(owner))) || 'null');
    return value?.owner === String(owner) && typeof value.keyId === 'string' ? value.keyId : null;
  } catch { return null; }
}
export function writeAiConnectionSelection(owner, keyId) {
  if (!owner || typeof keyId !== 'string') return;
  try { localStorage.setItem(selectionKey(String(owner)), JSON.stringify({ owner: String(owner), keyId })); } catch {}
}

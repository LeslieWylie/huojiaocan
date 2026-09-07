// Separate unsaved edits from the ordinary last-loaded draft cache.
function key(userId, draftId) {
  return userId && draftId ? `huojiaocan.cards.edits.v1.${encodeURIComponent(userId)}.${encodeURIComponent(draftId)}` : '';
}
export function readCardEdits(storage, userId, draftId) {
  try {
    const value = JSON.parse(storage?.getItem(key(userId, draftId)) || 'null');
    return key(userId, draftId) && value?.userId === userId && value?.draftId === draftId && Array.isArray(value.cards) ? value : null;
  } catch { return null; }
}
export function writeCardEdits(storage, userId, draftId, version, cards) {
  try {
    if (!key(userId, draftId)) return false;
    storage.setItem(key(userId, draftId), JSON.stringify({ userId, draftId, version, cards }));
    return true;
  } catch { return false; }
}
export function clearCardEdits(storage, userId, draftId) {
  try { if (key(userId, draftId)) storage.removeItem(key(userId, draftId)); } catch {}
}
// Server-owned lock state and card identity always win, including explicit recovery.
export function recoverEditableCards(serverCards, localCards) {
  return serverCards.map(card => {
    const local = localCards.find(item => item.id === card.id && item.type === card.type);
    return card.status === 'locked' || !local ? card : { ...card, items: local.items };
  });
}

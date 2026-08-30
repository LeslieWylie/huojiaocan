const PREFIX = 'huojiaocan.ask.session.';
const RECENT_PREFIX = 'huojiaocan.ask.recent.';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECENT = 8;

function storageKey(userId = '') {
  const owner = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `${PREFIX}${owner}`;
}

function recentStorageKey(userId = '') {
  const owner = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `${RECENT_PREFIX}${owner}`;
}

function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function snapshotResumeId(value) {
  if (value?.resumeId) return String(value.resumeId);
  if (value?.draftId) return `draft-${String(value.draftId)}`;
  const lesson = value?.lessonRef || {};
  const identity = [lesson.documentId, lesson.nodeId, lesson.title, value?.planQuestion, value?.question]
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join('|');
  return `local-${shortHash(identity || value?.savedAt || 'conversation')}`;
}

function safePath(value) {
  const path = String(value || '').trim();
  return path.startsWith('/') && !path.startsWith('//') ? path : '/ask/';
}

function validSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const savedAt = Date.parse(value.savedAt || '');
  if (!savedAt || Date.now() - savedAt > TTL_MS) return null;
  return {
    version: 1,
    resumeId: snapshotResumeId(value),
    draftId: String(value.draftId || ''),
    question: String(value.question || ''),
    planQuestion: String(value.planQuestion || ''),
    scope: String(value.scope || 'both'),
    lessonContext: value.lessonContext && typeof value.lessonContext === 'object' ? value.lessonContext : {},
    lessonRef: value.lessonRef && typeof value.lessonRef === 'object' ? value.lessonRef : null,
    messages: Array.isArray(value.messages) ? value.messages.filter(item => item?.question && item?.response).slice(-12) : [],
    conversationHistory: Array.isArray(value.conversationHistory) ? value.conversationHistory.filter(item => item?.role && item?.content).slice(-12) : [],
    savedAt: value.savedAt,
    next: safePath(value.next)
  };
}

function readRecentValues(userId = '') {
  try {
    const stored = JSON.parse(localStorage.getItem(recentStorageKey(userId)) || '[]');
    const values = Array.isArray(stored) ? stored.map(validSnapshot).filter(Boolean) : [];
    if (values.length) localStorage.setItem(recentStorageKey(userId), JSON.stringify(values.slice(0, MAX_RECENT)));
    else localStorage.removeItem(recentStorageKey(userId));
    return values.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecentValue(value, userId = '') {
  const current = readRecentValues(userId);
  const next = [value, ...current.filter(item => item.resumeId !== value.resumeId)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(recentStorageKey(userId), JSON.stringify(next));
  } catch {
    // Prefer preserving the latest recoverable thread over an older list.
    try { localStorage.setItem(recentStorageKey(userId), JSON.stringify([value])); } catch {}
  }
}

/**
 * Browser-only crash/navigation recovery for the active lesson conversation.
 * It contains grounded answers and page references, never API keys or tokens.
 * The server draft remains the source of truth when a draftId is available.
 */
export function saveConversationSnapshot(snapshot, userId = '') {
  const value = validSnapshot({ ...snapshot, savedAt: snapshot?.savedAt || new Date().toISOString() });
  if (!value) return false;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(value));
    saveRecentValue(value, userId);
    return true;
  } catch {
    // A large answer can exceed the browser quota. Keep a smaller transcript
    // rather than dropping the recovery path entirely.
    try {
      const compact = { ...value, messages: value.messages.slice(-4), conversationHistory: value.conversationHistory.slice(-8) };
      localStorage.setItem(storageKey(userId), JSON.stringify(compact));
      saveRecentValue(compact, userId);
      return true;
    } catch {
      return false;
    }
  }
}

export function readConversationSnapshot(userId = '', resumeId = '') {
  try {
    if (resumeId) {
      return readRecentValues(userId).find(item => item.resumeId === String(resumeId)) || null;
    }
    let value = validSnapshot(JSON.parse(localStorage.getItem(storageKey(userId)) || 'null'));
    // A login redirect can change the owner key between saves. Recover the
    // short-lived anonymous hand-off once, then the next save moves it to the
    // authenticated owner's slot.
    if (!value && userId) {
      value = validSnapshot(JSON.parse(localStorage.getItem(storageKey()) || 'null'));
      // Consume the anonymous hand-off immediately. Otherwise a second
      // account using this browser could inherit the previous teacher's lesson.
      if (value) localStorage.removeItem(storageKey());
    }
    if (!value) {
      localStorage.removeItem(storageKey(userId));
      if (userId) localStorage.removeItem(storageKey());
    }
    return value;
  } catch {
    return null;
  }
}

export function readRecentConversationSnapshots(userId = '') {
  return readRecentValues(userId);
}

export function removeRecentConversationSnapshot(resumeId, userId = '') {
  const next = readRecentValues(userId).filter(item => item.resumeId !== String(resumeId));
  try {
    if (next.length) localStorage.setItem(recentStorageKey(userId), JSON.stringify(next));
    else localStorage.removeItem(recentStorageKey(userId));
    return true;
  } catch {
    return false;
  }
}

export function clearConversationSnapshot(userId = '') {
  try { localStorage.removeItem(storageKey(userId)); } catch {}
  if (userId) { try { localStorage.removeItem(storageKey()); } catch {} }
}

export function conversationStorageKey(userId = '') {
  return storageKey(userId);
}

export { MAX_RECENT, TTL_MS };

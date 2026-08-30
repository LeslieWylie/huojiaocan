function compact(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function stableNodeId(value) {
  return String(value || '').replace(/^seed-/u, '');
}

function pageRange(node = {}) {
  const start = Number(node.startPage ?? node.pageRange?.start ?? node.pageRange?.[0] ?? 0);
  const end = Number(node.endPage ?? node.pageRange?.end ?? node.pageRange?.[1] ?? start);
  return {
    start: Number.isInteger(start) && start > 0 ? start : null,
    end: Number.isInteger(end) && end > 0 ? end : Number.isInteger(start) && start > 0 ? start : null
  };
}

export function unitNodes(tree = []) {
  const roots = Array.isArray(tree) ? tree : tree?.tree ? tree.tree : [];
  return roots.filter(node => {
    const range = pageRange(node);
    return node && range.start && Array.isArray(node.children) && node.children.length;
  }).map(node => ({ ...node, pageRange: pageRange(node) }));
}

export function unitLessonNodes(unit = {}) {
  return (Array.isArray(unit.children) ? unit.children : []).filter(node => /^\s*\d+\s+\S/u.test(compact(node?.title))).map(node => ({
    nodeId: String(node.id || ''),
    title: compact(node.title).replace(/^\d+\s*/u, ''),
    rawTitle: compact(node.title),
    startPage: pageRange(node).start,
    endPage: pageRange(node).end,
    lessonNumber: Number(compact(node.title).match(/^\s*(\d+)/u)?.[1] || 0) || null,
    kind: 'lesson'
  })).filter(node => node.nodeId && node.title && node.startPage);
}

export function lessonKey(value) {
  return compact(value)
    .replace(/[《》〈〉“”‘’·，。！？：:；;、\s]/gu, '')
    .replace(/^\d+/u, '')
    .replace(/(?:(?:两课时|一课时)?(?:备课方案|课堂方案)?(?:复备|副本)?)$/u, '')
    .toLowerCase();
}

export function matchLessonAsset(lesson, assets = []) {
  const key = lessonKey(lesson?.title);
  if (!key) return null;
  return (Array.isArray(assets) ? assets : []).find(asset => {
    const candidates = [asset?.lessonKey, asset?.title];
    return candidates.some(value => {
      const candidate = lessonKey(value);
      return candidate === key;
    });
  }) || null;
}

export function matchLessonDraft(lesson, drafts = []) {
  const list = Array.isArray(drafts) ? drafts : [];
  const exact = list.find(draft => stableNodeId(draft?.lesson_context?.lessonRef?.nodeId || draft?.lessonContext?.lessonRef?.nodeId) === stableNodeId(lesson?.nodeId));
  if (exact) return exact;
  const key = lessonKey(lesson?.title);
  return list.find(draft => {
    const ref = draft?.lesson_context?.lessonRef || draft?.lessonContext?.lessonRef;
    return !ref?.nodeId && lessonKey(ref?.title || draft?.title) === key;
  }) || null;
}

export function buildUnitTrack(unit, drafts = [], assets = []) {
  return unitLessonNodes(unit).map((lesson, index, lessons) => {
    const draft = matchLessonDraft(lesson, drafts);
    const asset = draft ? (assets || []).find(item => String(item.draftId) === String(draft.id)) || matchLessonAsset(lesson, assets) : matchLessonAsset(lesson, assets);
    const status = asset?.learningEvidenceStatus === 'confirmed' || asset?.hasReflection
      ? 'reflected'
      : asset?.classroomStatus === 'in_progress'
        ? 'in_class'
        : asset?.hasClassroomRecord
          ? 'recorded'
          : asset?.cardsGenerated
            ? 'ready'
            : draft ? 'draft' : 'not_started';
    return { ...lesson, index, total: lessons.length, draft, asset, status };
  });
}

export function unitTrackInsights(track = []) {
  const lessons = Array.isArray(track) ? track : [];
  const ready = lessons.filter(lesson => ['ready', 'in_class', 'recorded', 'reflected'].includes(lesson.status));
  const reflected = lessons.filter(lesson => lesson.status === 'reflected');
  const pendingIndex = lessons.findIndex(lesson => lesson.status !== 'reflected');
  const currentIndex = pendingIndex < 0 ? lessons.length : pendingIndex;
  return {
    total: lessons.length,
    ready: ready.length,
    reflected: reflected.length,
    missing: Math.max(0, lessons.length - ready.length),
    currentIndex,
    current: lessons[currentIndex] || null,
    next: lessons[currentIndex + 1] || null
  };
}

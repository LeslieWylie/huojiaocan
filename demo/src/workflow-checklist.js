function list(value) {
  return Array.isArray(value) ? value : [];
}

function hasGuide(citations) {
  return list(citations).some(item => {
    const type = String(item?.documentType || '').toLowerCase().replaceAll('_', '-');
    return type === 'teacher-guide' || type === 'teacher-guidebook' || type === 'guide';
  });
}

function hasTextbook(citations) {
  return list(citations).some(item => String(item?.documentType || '').toLowerCase().replaceAll('_', '-') === 'textbook');
}

function hasCurriculumStandard(citations) {
  return list(citations).some(item => {
    const type = String(item?.documentType || item?.documentId || '').toLowerCase().replaceAll('_', '-');
    return ['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(type);
  });
}

function citationsFromMessages(messages) {
  return list(messages).flatMap(item => list(item?.response?.citations));
}

function hasPlan(messages, draft) {
  if (list(messages).some(item => {
    const answer = item?.response?.answer;
    return Boolean(answer?.summary || list(answer?.lessonPlan).length || list(answer?.questionChain).length);
  })) return true;
  return Boolean(draft?.answer?.summary || list(draft?.answer?.lessonPlan).length);
}

function hasCards(draft, cards) {
  const candidates = list(cards).length ? cards : list(draft?.cards);
  // Suggestions returned beside an answer are not classroom cards. Marking
  // this step complete before the teacher confirms and generates the cards
  // sends the ask page and the cards page into contradictory states.
  return candidates.some(card => list(card?.items).length || list(card?.content).length);
}

/**
 * Derive the teacher-facing progress of one lesson without creating another
 * server-side state machine. It intentionally uses only trusted answer and
 * citation data already present in the current conversation/draft.
 */
export function deriveWorkflowChecklist({ messages = [], draft = null, cards = [] } = {}) {
  const citations = [
    ...citationsFromMessages(messages),
    ...list(draft?.citations)
  ];
  const hasAnyCitation = citations.some(item => Number(item?.pdfPage) > 0);
  const hasLesson = Boolean(
    list(messages).length
      || draft?.title
      || draft?.question
      || draft?.lesson_context?.lessonRef?.title
      || draft?.lessonContext?.lessonRef?.title
  );
  return [
    { id: 'lesson', label: '篇目已定位', detail: hasLesson ? '当前对话已固定篇目身份' : '先从篇名或目录开始', done: hasLesson },
    { id: 'standard', label: '课程标准已核对', detail: hasCurriculumStandard(citations) ? '已找到学段要求或学业质量原页' : '下一步核对第四学段原文', done: hasCurriculumStandard(citations) },
    { id: 'guide', label: '教师用书已读取', detail: hasGuide(citations) ? '已找到教学处理与课时依据' : '下一步读取教学重点与活动设计', done: hasGuide(citations) },
    { id: 'textbook', label: '学生教材已核对', detail: hasTextbook(citations) ? '已回到课文原文或任务页' : '下一步核对课文、段落和关键语句', done: hasTextbook(citations) },
    { id: 'plan', label: '课堂方案已生成', detail: hasPlan(messages, draft) ? '已形成可继续追问的课堂流程' : '先提出“怎么备课”或具体教学问题', done: hasPlan(messages, draft) },
    { id: 'cards', label: '三卡已生成', detail: hasCards(draft, cards) ? '板书、提问和评价可继续编辑' : '方案确认后再进入课堂设计', done: hasCards(draft, cards) }
  ].map(item => ({ ...item, hasEvidence: hasAnyCitation }));
}

export function checklistProgress(items = []) {
  const listItems = list(items);
  return {
    done: listItems.filter(item => item?.done).length,
    total: listItems.length,
    complete: listItems.length > 0 && listItems.every(item => item?.done)
  };
}

const CARD_TYPES = ['board', 'question', 'assessment'];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function refsOf(value) {
  if (!value || typeof value !== 'object') return [];
  return [value.citationIds, value.evidenceRefs, value.refs]
    .find(refs => Array.isArray(refs)) || [];
}

function sourceType(citation) {
  const value = text(citation?.documentType || citation?.sourceType || citation?.type)
    .toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (['textbook', 'student-textbook', 'student-book'].includes(value)) return 'textbook';
  if (['teacher-guide', 'teacher-guidebook', 'guide'].includes(value)) return 'teacherGuide';
  if (['curriculum-standard', 'curriculum', 'standard', '课程标准', '课标'].includes(value)) return 'curriculumStandard';
  return '';
}

function issue(code, severity, message) {
  return { code, severity, message };
}

/**
 * Assess whether a generated lesson plan is sufficiently grounded to use.
 * The function does not mutate answer, cards, or citations.
 */
export function analyzeTeachingPlanQuality(answer = {}, cards = []) {
  const safeAnswer = answer && typeof answer === 'object' ? answer : {};
  const safeCards = list(cards);
  const citations = list(safeAnswer.citations || safeAnswer.answer?.citations);
  const issues = [];
  const byType = new Map(safeCards.map(card => [text(card?.type), card]));

  for (const type of CARD_TYPES) {
    const card = byType.get(type);
    const items = list(card?.items || card?.content);
    if (!card || !items.length || items.every(item => !text(typeof item === 'string' ? item : item?.text))) {
      issues.push(issue('CARD_EMPTY', 'error', `${type} 卡没有可用内容`));
      continue;
    }
    if (card.status === 'locked') {
      issues.push(issue('CARD_LOCKED', 'info', `${type} 卡已锁定，后续生成不会覆盖它`));
    }
    items.forEach((item, index) => {
      const value = typeof item === 'string' ? { text: item } : item;
      if (!refsOf(value).length) {
        issues.push(issue('CARD_ITEM_UNREFERENCED', 'warning', `${type} 卡第 ${index + 1} 项没有引用`));
      }
    });
  }

  const answerSections = [
    ['lessonPlan', '课堂流程'],
    ['questionChain', '问题链'],
    ['assessment', '课堂评价']
  ];
  for (const [key, label] of answerSections) {
    if (!list(safeAnswer[key]).length) {
      issues.push(issue(`ANSWER_${key.toUpperCase()}_MISSING`, 'error', `回答缺少${label}`));
    }
  }

  const coverage = {
    textbook: citations.some(citation => sourceType(citation) === 'textbook'),
    teacherGuide: citations.some(citation => sourceType(citation) === 'teacherGuide'),
    curriculumStandard: citations.some(citation => sourceType(citation) === 'curriculumStandard')
  };
  for (const [key, label] of [
    ['textbook', '学生教材'],
    ['teacherGuide', '教师用书'],
    ['curriculumStandard', '课程标准']
  ]) {
    if (!coverage[key]) {
      issues.push(issue('CITATION_SOURCE_MISSING', 'warning', `引用未覆盖${label}`));
    }
  }

  const deductions = issues.reduce((total, current) => total + (current.severity === 'error' ? 20 : current.severity === 'warning' ? 10 : 0), 0);
  return {
    status: issues.some(current => current.severity !== 'info') ? 'review' : 'ready',
    score: Math.max(0, 100 - deductions),
    issues,
    coverage
  };
}

export default analyzeTeachingPlanQuality;

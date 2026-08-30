export const CLASSROOM_PACE_SIGNALS = ['on_track', 'time_short', 'students_stuck', 'ahead'];

function cardItems(cards, type) {
  const card = (Array.isArray(cards) ? cards : []).find(item => item?.type === type);
  return (Array.isArray(card?.items) ? card.items : []).map(item => ({
    text: String(item?.text || item || '').trim(),
    citationIds: (Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(Boolean)
  })).filter(item => item.text);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Build an immediate classroom adjustment from teacher-confirmed cards.
 * It never invents a page or a new teaching claim: all displayed actions and
 * references are projected from the current cards or confirmed rehearsal.
 */
export function classroomAdaptationAdvice({ signal = 'on_track', cards = [], rehearsalStep = null } = {}) {
  if (!CLASSROOM_PACE_SIGNALS.includes(signal) || signal === 'on_track') return null;
  const board = cardItems(cards, 'board');
  const questions = cardItems(cards, 'question');
  const assessments = cardItems(cards, 'assessment');
  const fallback = board[0] || questions[0] || assessments[0] || { text: '回到当前核心问题', citationIds: [] };
  if (signal === 'time_short') {
    const keep = questions[0] || fallback;
    const close = assessments[0] || board.at(-1) || fallback;
    return {
      signal,
      title: '时间不足：保住核心问题和可观察结论',
      primaryAction: keep.text,
      secondaryAction: `收束时使用：${close.text}`,
      note: '其余活动延后，不临时增加新内容。',
      citationIds: unique([...keep.citationIds, ...close.citationIds])
    };
  }
  if (signal === 'students_stuck') {
    const branch = rehearsalStep?.branches?.needs_followup || rehearsalStep?.branches?.silent || '';
    const question = rehearsalStep?.question || questions[0]?.text || fallback.text;
    return {
      signal,
      title: '学生卡住：先降低一步，再回到原文',
      primaryAction: branch || `把主问拆小：${question}`,
      secondaryAction: '让学生先指出一个词句，再说明它与问题的关系。',
      note: '这里只切换追问路径，不替学生补写答案。',
      citationIds: unique([...(rehearsalStep?.citationIds || []), ...(questions[0]?.citationIds || fallback.citationIds)])
    };
  }
  const extend = questions[1] || assessments[0] || board.at(-1) || fallback;
  return {
    signal,
    title: '提前完成：把结论交给新的文本任务检验',
    primaryAction: extend.text,
    secondaryAction: '要求学生换一处原文或换一种表达方式再次证明。',
    note: '不提前讲下一课，只加深当前课的迁移。',
    citationIds: unique(extend.citationIds)
  };
}

function clean(value) {
  return String(value || '').trim();
}

function fallbackTitle(question = '') {
  const quoted = clean(question).match(/《([^》]{2,32})》/u);
  return quoted?.[1] ? `《${quoted[1]}》` : clean(question) || '当前篇目';
}

const DEICTIC_PREPARATION = /^(?:请)?(?:说说|讲讲|分析一下|帮我)?(?:这|本)(?:篇|课|篇课文|篇文章|课文|文章).{0,8}(?:怎么|如何|怎样)?(?:备课|教|讲|设计)(?:[？?。！!]*)$/u;

function includesTitle(question, title) {
  const plain = clean(title).replace(/[《》]/gu, '');
  return Boolean(plain && clean(question).includes(plain));
}

/**
 * Resolve pronouns such as “这篇文章” against the selected catalogue lesson.
 * The teacher's sentence remains visible as the current prompt, while the
 * model and retriever receive an explicit lesson anchor and a stable teaching
 * question. This prevents a generic instruction from becoming the lesson
 * title or the blackboard's core question.
 */
export function resolveTeachingFocus(question = '', identityTitle = '') {
  const current = clean(question);
  const title = clean(identityTitle) || '当前篇目';
  const deictic = DEICTIC_PREPARATION.test(current);
  return {
    deictic,
    teachingFocus: deictic ? `确定${title}的教学重点、课堂主线与学生学习任务` : current,
    coreQuestion: deictic ? `${title}的关键内容如何通过学生阅读活动逐步理解？` : current,
    retrievalQuery: includesTitle(current, title) ? current : `${title} ${current}`.trim()
  };
}

function responseHistoryText(response) {
  const answer = response?.answer || {};
  const parts = [
    response?.understanding && `问题理解：${response.understanding}`,
    answer.summary && `回答：${answer.summary}`,
    answer.lessonPosition && `课时定位：${answer.lessonPosition}`,
    Array.isArray(answer.keyPoints) && answer.keyPoints.length ? `重点：${answer.keyPoints.join('；')}` : '',
    Array.isArray(answer.lessonPlan) && answer.lessonPlan.length
      ? `课堂流程：${answer.lessonPlan.slice(0, 5).map(item => [item.title, item.content, item.studentTask].filter(Boolean).join('：')).join('；')}` : '',
    Array.isArray(answer.questionChain) && answer.questionChain.length
      ? `问题链：${answer.questionChain.slice(0, 5).map(item => typeof item === 'string' ? item : item.question).filter(Boolean).join('；')}` : '',
    answer.reply && `本轮回答：${answer.reply}`
  ];
  return parts.filter(Boolean).join('\n').slice(0, 3600);
}

/**
 * Convert the visible React transcript into the small, bounded message list
 * sent to the model. This is the conversation boundary: PageIndex receives
 * only the retrieval query, while the model receives the teacher's prior
 * questions and grounded answers for continuity.
 */
export function buildConversationHistory(messages = [], extra = []) {
  const turns = Array.isArray(messages) ? messages : [];
  const history = turns.flatMap(item => {
    if (!item || !item.response) return [];
    const question = String(item.question || '').trim();
    const answer = responseHistoryText(item.response);
    return [
      question ? { role: 'user', content: question } : null,
      answer ? { role: 'assistant', content: answer } : null
    ].filter(Boolean);
  });
  const appended = Array.isArray(extra) ? extra.filter(item => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim()) : [];
  return [...history, ...appended].slice(-10).map(item => ({ role: item.role, content: String(item.content).slice(0, 1800) }));
}

/**
 * Keep the lesson identity separate from the sentence currently being asked.
 * A teacher may ask several follow-up questions in one plan; an operation
 * such as “换成两课时” is not a new lesson and must never become the title.
 */
export function buildAskContext({
  text,
  identityQuestion = '',
  lessonRef = null,
  requestOptions = {},
  planTitle = ''
} = {}) {
  const currentText = clean(text);
  const stableQuestion = clean(identityQuestion) || currentText;
  const actionOnly = Boolean(requestOptions.prompt && requestOptions.isAction);
  const currentQuestion = actionOnly ? stableQuestion || currentText : currentText;
  const identityTitle = clean(lessonRef?.title) || clean(planTitle) || fallbackTitle(stableQuestion);
  const isFollowUp = Boolean(stableQuestion && currentQuestion && currentQuestion !== stableQuestion && !actionOnly);
  const focus = resolveTeachingFocus(currentQuestion || stableQuestion, identityTitle);
  const stableFocus = resolveTeachingFocus(stableQuestion || currentQuestion, identityTitle);
  const retrievalQuery = actionOnly ? stableFocus.retrievalQuery : focus.retrievalQuery;
  return {
    actionOnly,
    currentQuestion,
    canonicalQuestion: stableQuestion,
    nextIdentityQuestion: stableQuestion,
    identityTitle,
    retrievalQuery,
    teachingFocus: focus.teachingFocus,
    stableCoreQuestion: stableFocus.coreQuestion,
    followUpInstruction: clean(requestOptions.prompt) || (isFollowUp ? currentQuestion : '')
  };
}

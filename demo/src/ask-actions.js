// Keep the browser action contract separate from the lesson identity. This
// small pure helper is deliberately framework-free so the follow-up path can
// be regression-tested without rendering the whole app.
function inferredPeriodChange(text) {
  const match = String(text || '').match(/(?:改(?:成|为)?|换成|调整(?:为|成)?|安排(?:为|成)?|设计(?:为|成)?).{0,8}?([一二两三四五六七八1-8])\s*课时/u);
  if (!match) return null;
  const periods = ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 })[match[1]] || Number(match[1]);
  return Number.isInteger(periods) ? periods : null;
}

export function normalizeAskAction(directQuestion, options = {}, fallbackQuestion = '') {
  let action = {
    ...(directQuestion && typeof directQuestion === 'object' && !Array.isArray(directQuestion) ? directQuestion : {}),
    ...(options && typeof options === 'object' ? options : {})
  };
  const directText = typeof directQuestion === 'string' ? directQuestion : '';
  const text = String(action.prompt || directText || fallbackQuestion || '').trim();
  const mayInferFromComposer = !directQuestion || typeof directQuestion === 'string';
  const inferredPeriods = !action.operation && mayInferFromComposer ? inferredPeriodChange(text) : null;
  if (inferredPeriods) {
    action = {
      ...action,
      operation: { type: 'change_periods', periods: inferredPeriods },
      lessonContextPatch: { ...(action.lessonContextPatch || {}), periods: inferredPeriods }
    };
  }
  return {
    options: action,
    text
  };
}

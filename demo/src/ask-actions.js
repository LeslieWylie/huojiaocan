// Keep the browser action contract separate from the lesson identity. This
// small pure helper is deliberately framework-free so the follow-up path can
// be regression-tested without rendering the whole app.
export function normalizeAskAction(directQuestion, options = {}, fallbackQuestion = '') {
  const action = {
    ...(directQuestion && typeof directQuestion === 'object' && !Array.isArray(directQuestion) ? directQuestion : {}),
    ...(options && typeof options === 'object' ? options : {})
  };
  const directText = typeof directQuestion === 'string' ? directQuestion : '';
  return {
    options: action,
    text: String(action.prompt || directText || fallbackQuestion || '').trim()
  };
}

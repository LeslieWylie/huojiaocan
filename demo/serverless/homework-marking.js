import { createDeepSeekClient } from './deepseek.js';
import { callGatewayChatCompletion } from './llm-gateway.js';
import { gatewayConfig } from './shared.js';
import { buildHomeworkReview } from '../shared/homework-review.js';
import { layeredHomeworkIsStale, normalizeLayeredHomework } from '../shared/layered-homework.js';

function failure(code, status = 422) { return Object.assign(new Error(code), { code, status }); }
function compact(value, max = 600) { return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max); }
function list(value, maxItems = 5, maxLength = 220) { return (Array.isArray(value) ? value : []).map(item => compact(item, maxLength)).filter(Boolean).slice(0, maxItems); }
function hasIdentifier(value) {
  const input = String(value || '');
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(input)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u.test(input)
    || /(?:姓名|学号|考号|手机号|电话|微信|QQ)\s*[:：]?\s*[\w\u4e00-\u9fff-]{2,}/iu.test(input);
}
function parseJson(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const candidates = [raw]; const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) { try { const parsed = JSON.parse(candidate); if (parsed && typeof parsed === 'object') return parsed; } catch {} }
  throw failure('homework_marking_invalid_response', 502);
}

export function normalizeAnonymousResponses(value) {
  const source = Array.isArray(value) ? value : [];
  if (!source.length || source.length > 40) throw failure('homework_marking_responses_invalid', 400);
  return source.map((item, index) => {
    const response = compact(typeof item === 'string' ? item : item?.text, 1200);
    if (!response || response.length < 4) throw failure('homework_marking_responses_invalid', 400);
    if (hasIdentifier(response)) throw failure('homework_marking_contains_identifier', 400);
    return { index: index + 1, response };
  });
}

function prompt({ draft, pack, task, responses }) {
  const citations = new Map((Array.isArray(draft.citations) ? draft.citations : []).map(item => [String(item?.id), item]));
  const evidence = [...task.studentCitationIds, ...task.teacherCitationIds].map(id => citations.get(String(id))).filter(Boolean).slice(0, 6).map(item => ({
    source: String(item.documentId || item.documentType || '').includes('teacher') ? '教师用书' : '学生教材',
    pdfPage: Number(item.pdfPage ?? item.page) || null,
    excerpt: compact(item.quote || item.text, 500)
  }));
  return [
    { role: 'system', content: '你是中学语文作业批改助手。只依据当前题目、评分量规、参考要点和教材片段判断匿名答案。不得猜测学生身份，不得引用或复述学生原句，不得把参考答案措辞当作唯一答案。每份反馈必须短、具体、可执行。只返回严格 JSON，不要 Markdown。' },
    { role: 'user', content: JSON.stringify({
      task: '逐份判断匿名答案达成情况，并归纳班级共性问题。不要输出答案原文、姓名、页码、URL、文档编号或新引用。',
      lesson: pack.lessonTitle, coreQuestion: pack.coreQuestion,
      assignment: { id: task.id, level: task.level, prompt: task.prompt, directions: task.directions, maxScore: task.score, answerGuide: task.answerGuide, rubric: task.rubric.map(item => ({ id: item.id, label: item.label, points: item.points, description: item.description })) },
      evidence,
      anonymousResponses: responses,
      outputSchema: { results: [{ index: 1, score: 0, strengths: ['已经做到的具体能力，不复述答案'], nextStep: '下一步怎样改，不超过70字', issueTags: ['评分项 id'] }], commonPatterns: ['班级共性问题，不引用答案原句'], nextActions: ['教师下一课可执行动作'] }
    }) }
  ];
}

async function completion(messages, { deepseek, env = process.env, complete } = {}) {
  if (typeof complete === 'function') return complete(messages);
  if (deepseek?.apiKey && deepseek?.model) return (await createDeepSeekClient(deepseek).chat({ messages, responseFormat: true, maxTokens: 3200 })).content;
  const config = gatewayConfig(env);
  if (!config.baseUrl || !config.apiKey || !(config.gatewayModel || config.textModel)) throw failure('gateway_not_configured', 503);
  return (await callGatewayChatCompletion({ messages, model: config.gatewayModel || config.textModel, maxTokens: 3200, response_format: { type: 'json_object' } }, { env })).content;
}

export async function analyzeHomeworkResponses({ draft, taskId, responses, deepseek, env = process.env, complete, now = new Date().toISOString() } = {}) {
  if (!draft) throw failure('draft_not_found', 404);
  const pack = normalizeLayeredHomework(draft.answer?.layeredHomework || {});
  if (pack.status !== 'confirmed') throw failure('homework_marking_requires_confirmed_pack', 409);
  if (layeredHomeworkIsStale(draft)) throw failure('homework_marking_pack_stale', 409);
  const task = pack.tasks.find(item => item.id === String(taskId || ''));
  if (!task) throw failure('homework_marking_task_not_found', 404);
  const anonymous = normalizeAnonymousResponses(responses);
  const parsed = parseJson(await completion(prompt({ draft, pack, task, responses: anonymous }), { deepseek, env, complete }));
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
  if (rawResults.length !== anonymous.length) throw failure('homework_marking_invalid_response', 502);
  const rubricIds = new Set(task.rubric.map(item => item.id));
  const byIndex = new Map();
  for (const item of rawResults) {
    const sequence = Number(item?.index), score = Number(item?.score);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > anonymous.length || byIndex.has(sequence) || !Number.isFinite(score)) throw failure('homework_marking_invalid_response', 502);
    const boundedScore = Math.max(0, Math.min(task.score, Math.round(score * 10) / 10));
    const ratio = task.score ? boundedScore / task.score : 0;
    byIndex.set(sequence, {
      id: `response-${sequence}`, sequence, score: boundedScore, maxScore: task.score,
      status: ratio >= .75 ? 'secure' : ratio >= .4 ? 'partial' : 'not_yet',
      strengths: list(item?.strengths, 2, 120), nextStep: compact(item?.nextStep, 180),
      issueTags: [...new Set((Array.isArray(item?.issueTags) ? item.issueTags : []).map(String))].filter(id => rubricIds.has(id)).slice(0, 3)
    });
  }
  const results = anonymous.map(item => byIndex.get(item.index));
  if (results.some(item => !item?.nextStep)) throw failure('homework_marking_invalid_response', 502);
  const patterns = list(parsed.commonPatterns, 5, 260), nextActions = list(parsed.nextActions, 5, 260);
  if (!patterns.length || !nextActions.length) throw failure('homework_marking_invalid_response', 502);
  return { results, review: buildHomeworkReview({ pack, task, results, patterns, nextActions, now }) };
}

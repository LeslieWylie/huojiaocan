import { createDeepSeekClient } from './deepseek.js';
import { callGatewayChatCompletion } from './llm-gateway.js';
import { gatewayConfig } from './shared.js';
import { normalizeTeachingDeliberation, teachingDeliberationSourceKey } from '../shared/teaching-deliberation.js';

function error(code, status = 422) {
  return Object.assign(new Error(code), { code, status });
}

function parseJson(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const sources = [raw];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) sources.push(raw.slice(first, last + 1));
  for (const source of sources) {
    try { const parsed = JSON.parse(source); if (parsed && typeof parsed === 'object') return parsed; } catch {}
  }
  throw error('deliberation_invalid_response', 502);
}

function compact(value, max = 800) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function promptForDraft(draft = {}) {
  const citations = (Array.isArray(draft.citations) ? draft.citations : []).slice(0, 8);
  if (citations.length < 1) throw error('evidence_insufficient', 422);
  const references = citations.map((item, index) => ({
    ref: `E${index + 1}`,
    documentType: String(item.documentType || item.sourceType || '').replaceAll('_', '-'),
    pdfPage: Number(item.pdfPage ?? item.pageNumber ?? item.page) || null,
    section: Array.isArray(item.sectionPath) ? item.sectionPath.join(' › ') : compact(item.title, 100),
    excerpt: compact(item.quote || item.text, 700)
  }));
  const answer = draft.answer || {};
  return {
    citations,
    messages: [
      {
        role: 'system',
        content: '你是中学语文教研组长。你的任务不是再写一份完整教案，而是从已有教材依据和备课方案中找出教师必须亲自决定的关键取舍。每个取舍给两个都可成立但代价不同的选项：说明课堂怎么做、会得到什么、必须接受什么代价。不得制造教材没有支持的结论，不得输出页码、URL、文档编号或新引用。教师用书优先说明“怎么教”，学生教材优先说明“教什么”。只返回严格 JSON，不要 Markdown。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '提出 2—3 个会实质改变课堂组织的备课取舍。不要提出“是否认真备课”之类伪选择，也不要把同一句话换个说法当两个选项。',
          lesson: { title: answer.lesson?.title || draft.title, coreQuestion: answer.lesson?.coreQuestion || draft.question },
          conditions: draft.lesson_context || draft.lessonContext || {},
          currentPlan: {
            summary: compact(answer.summary, 600),
            objectives: Array.isArray(answer.objectives) ? answer.objectives.slice(0, 6) : [],
            keyPoints: Array.isArray(answer.keyPoints) ? answer.keyPoints.slice(0, 6) : [],
            lessonPlan: Array.isArray(answer.lessonPlan) ? answer.lessonPlan.slice(0, 8).map(item => ({ title: compact(item?.title, 100), content: compact(item?.content, 500) })) : [],
            questionChain: Array.isArray(answer.questionChain) ? answer.questionChain.slice(0, 8).map(item => compact(item?.question || item, 300)) : []
          },
          evidence: references,
          outputSchema: {
            decisions: [{
              question: '教师必须作出的具体选择，使用问句',
              whyItMatters: '这个选择会怎样改变课堂，不超过80字',
              recommendedOption: 'A 或 B',
              options: [
                { id: 'A', label: '8字以内的路径名', approach: '具体课堂路径，不超过100字', tradeoff: '选择它必须接受的代价，不超过70字', evidenceRefs: ['E1'] },
                { id: 'B', label: '8字以内的路径名', approach: '与A真正不同的课堂路径', tradeoff: '选择它必须接受的代价', evidenceRefs: ['E1'] }
              ]
            }]
          }
        })
      }
    ]
  };
}

async function modelCompletion(messages, { deepseek, env = process.env, complete } = {}) {
  if (typeof complete === 'function') return complete(messages);
  if (deepseek?.apiKey && deepseek?.model) {
    const result = await createDeepSeekClient(deepseek).chat({ messages, responseFormat: true, maxTokens: 2200 });
    return result.content;
  }
  const config = gatewayConfig(env);
  if (!config.baseUrl || !config.apiKey || !(config.gatewayModel || config.textModel)) throw error('gateway_not_configured', 503);
  const result = await callGatewayChatCompletion({ messages, model: config.gatewayModel || config.textModel, maxTokens: 2200, response_format: { type: 'json_object' } }, { env });
  return result.content;
}

export async function generateTeachingDeliberation({ draft, deepseek, env = process.env, complete, now = new Date().toISOString() } = {}) {
  if (!draft) throw error('draft_not_found', 404);
  const { citations, messages } = promptForDraft(draft);
  const parsed = parseJson(await modelCompletion(messages, { deepseek, env, complete }));
  const availableRefs = new Map(citations.map((item, index) => [`E${index + 1}`, String(item.id || item.citationId || '')]).filter(([, id]) => id));
  const rawDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const normalizedQuestions = new Set();
  if (rawDecisions.length < 2 || rawDecisions.length > 3) throw error('deliberation_invalid_response', 502);
  for (const decision of rawDecisions) {
    const question = compact(decision?.question, 240).toLowerCase();
    const recommended = String(decision?.recommendedOption || '').toUpperCase();
    const options = Array.isArray(decision?.options) ? decision.options : [];
    if (!question || normalizedQuestions.has(question) || !['A', 'B'].includes(recommended) || options.length !== 2) throw error('deliberation_invalid_response', 502);
    normalizedQuestions.add(question);
    const normalizedOptions = options.map(option => ({
      label: compact(option?.label, 80).toLowerCase(),
      approach: compact(option?.approach, 500).toLowerCase(),
      tradeoff: compact(option?.tradeoff, 360),
      refs: (Array.isArray(option?.evidenceRefs) ? option.evidenceRefs : []).filter(ref => availableRefs.has(String(ref)))
    }));
    if (normalizedOptions.some(option => !option.label || !option.approach || !option.tradeoff || !option.refs.length)) throw error('deliberation_invalid_response', 502);
    if (normalizedOptions[0].label === normalizedOptions[1].label || normalizedOptions[0].approach === normalizedOptions[1].approach) throw error('deliberation_invalid_response', 502);
  }
  const value = normalizeTeachingDeliberation({
    promptVersion: 1,
    sourceDraftVersion: Number(draft.version || 1),
    status: 'draft',
    sourceKey: teachingDeliberationSourceKey(draft),
    generatedAt: now,
    updatedAt: now,
    decisions: rawDecisions.slice(0, 3).map((decision, decisionIndex) => ({
      id: `decision-${decisionIndex + 1}`,
      question: decision?.question,
      whyItMatters: decision?.whyItMatters,
      recommendedOptionId: String(decision?.recommendedOption || '').toUpperCase() === 'B' ? 'option-B' : 'option-A',
      options: (Array.isArray(decision?.options) ? decision.options : []).slice(0, 2).map((option, optionIndex) => ({
        id: `option-${optionIndex === 1 ? 'B' : 'A'}`,
        label: option?.label,
        approach: option?.approach,
        tradeoff: option?.tradeoff,
        evidenceRefs: (Array.isArray(option?.evidenceRefs) ? option.evidenceRefs : []).map(ref => availableRefs.get(String(ref))).filter(Boolean)
      }))
    }))
  });
  if (value.decisions.length < 2 || value.decisions.some(decision => decision.options.length !== 2)) throw error('deliberation_invalid_response', 502);
  return value;
}

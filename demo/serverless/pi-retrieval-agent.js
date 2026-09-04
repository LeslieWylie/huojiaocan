import { Agent } from '@earendil-works/pi-agent-core';
import { Type, createModels, createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { normalizeGatewayBaseUrl } from './llm-gateway.js';
import { gatewayConfig } from './shared.js';
import {
  createTeachingTurnContract,
  groundingQueryFor,
  inspectEvidenceCoverage
} from './teaching-agent-contract.js';

const MAX_SEARCHES = 2;
const DEFAULT_TIMEOUT_MS = 18_000;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

function compact(value, max = 900) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000) return fallback;
  return Math.min(30_000, Math.floor(parsed));
}

function modelDescriptor({ provider, model, baseUrl }) {
  return {
    id: model,
    name: model,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64_000,
    maxTokens: 2_000,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false
    }
  };
}

/**
 * Build a request-local Pi runtime. Credentials remain explicit request data:
 * Pi owns the agent loop, but it never persists or enumerates user keys.
 */
export function createPiRetrievalRuntime({ env = process.env, deepseek, deadlineAt } = {}) {
  const gateway = gatewayConfig(env);
  const personal = Boolean(deepseek?.apiKey && deepseek?.model);
  const providerId = personal ? 'huojiaocan-deepseek' : 'huojiaocan-gateway';
  const apiKey = String(personal ? deepseek.apiKey : gateway.apiKey).trim();
  const modelId = compact(personal ? deepseek.model : (gateway.gatewayModel || gateway.textModel), 160);
  const configuredBase = personal ? DEEPSEEK_BASE_URL : gateway.baseUrl;
  if (!apiKey || !modelId || !configuredBase) return { configured: false };

  const baseUrl = personal ? DEEPSEEK_BASE_URL : normalizeGatewayBaseUrl(configuredBase);
  const model = modelDescriptor({ provider: providerId, model: modelId, baseUrl });
  const provider = createProvider({
    id: providerId,
    name: personal ? 'DeepSeek' : 'System gateway',
    baseUrl,
    // The key below is supplied explicitly to each request. This resolver only
    // declares that the provider is request-authenticated; it stores nothing.
    auth: { apiKey: { name: 'Request credential', resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: openAICompletionsApi()
  });
  const models = createModels();
  models.setProvider(provider);
  const remaining = Math.max(1_000, Number(deadlineAt) > Date.now()
    ? Number(deadlineAt) - Date.now()
    : safeTimeout(personal ? deepseek?.timeoutMs : gateway.timeoutMs));

  return {
    configured: true,
    model,
    apiKey,
    timeoutMs: safeTimeout(remaining),
    streamFn: (activeModel, context, options = {}) => models.streamSimple(activeModel, context, {
      ...options,
      apiKey,
      timeoutMs: safeTimeout(Math.min(remaining, options.timeoutMs || remaining)),
      maxRetries: 1,
      maxRetryDelayMs: 1_500,
      onPayload: payload => ({
        ...(payload && typeof payload === 'object' ? payload : {}),
        thinking: { type: 'disabled' }
      })
    })
  };
}

function evidenceForAgent(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map(item => ({
    document: compact(item.documentTitle, 100),
    documentType: compact(item.documentType, 40),
    page: Number(item.pdfPage) || undefined,
    sectionPath: Array.isArray(item.sectionPath) ? item.sectionPath.slice(-3) : [],
    excerpt: compact(item.text || item.quote, 420)
  }));
}

function distinctEvidence(current, next) {
  const seen = new Set(current.map(item => `${item?.documentId || ''}:${Number(item?.pdfPage) || 0}`));
  return (Array.isArray(next) ? next : []).filter(item => {
    const key = `${item?.documentId || ''}:${Number(item?.pdfPage) || 0}`;
    if (!item?.documentId || !Number(item?.pdfPage) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pi owns the model/tool loop. The only exposed tool is a narrow PageIndex
 * retrieval seam; the model can propose a query but cannot provide document
 * ids, page numbers, citation text or viewer URLs.
 */
export async function runPiRetrievalAgent({
  question,
  scope,
  evidence,
  history = [],
  teacherReflectionContext = '',
  lessonIdentity,
  followUpInstruction = '',
  operation,
  expectedCardTypes = [],
  retrieveMore,
  env = process.env,
  deepseek,
  deadlineAt,
  runtime
} = {}) {
  let current = Array.isArray(evidence) ? [...evidence] : [];
  const trace = [];
  if (typeof retrieveMore !== 'function') return { evidence: current, trace };

  const activeRuntime = runtime || createPiRetrievalRuntime({ env, deepseek, deadlineAt });
  if (!activeRuntime?.configured || !activeRuntime.model || typeof activeRuntime.streamFn !== 'function') {
    return { evidence: current, trace };
  }

  const contract = createTeachingTurnContract({
    question,
    scope,
    history,
    lessonIdentity,
    followUpInstruction,
    operation,
    expectedCardTypes
  });
  let searchCount = 0;
  const seenQueries = new Set();
  const searchTool = {
    name: 'search_teaching_material',
    label: '继续查找教材',
    description: '仅在当前页面不足以回答教师问题时，提出一个更短、更具体的教材搜索语句。',
    parameters: Type.Object({
      query: Type.String({ minLength: 2, maxLength: 120, description: '包含当前篇目或明确文本概念的短查询' })
    }),
    executionMode: 'sequential',
    execute: async (_toolCallId, params) => {
      if (searchCount >= MAX_SEARCHES) {
        return {
          content: [{ type: 'text', text: '已达到本轮教材搜索上限，请使用已有页面完成判断。' }],
          details: { status: 'limit_reached' },
          terminate: true
        };
      }
      const query = compact(params?.query, 120);
      const queryKey = query.toLowerCase();
      if (!query || seenQueries.has(queryKey)) {
        return {
          content: [{ type: 'text', text: '该教材搜索已经执行，请依据已有页面继续。' }],
          details: { status: 'duplicate_search' },
          terminate: true
        };
      }
      seenQueries.add(queryKey);
      searchCount += 1;
      const next = await retrieveMore(query);
      const additions = distinctEvidence(current, next);
      current = [...current, ...additions].slice(0, 10);
      trace.push({ step: searchCount, action: 'search', query, reason: '补充当前篇目的教材依据' });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ added: additions.length, evidence: evidenceForAgent(additions) })
        }],
        details: { added: additions.length },
        ...(additions.length ? {} : { terminate: true })
      };
    }
  };

  // The model may decide whether another page would be useful, but it cannot
  // waive the product's source requirements. Planning and card turns fetch the
  // first missing source deterministically before free tool use.
  let nextMissing = inspectEvidenceCoverage(contract, current).missing[0];
  while (nextMissing && searchCount < contract.maxRetrievalIterations) {
    const missingSource = nextMissing;
    const query = groundingQueryFor(contract, question, missingSource);
    try {
      seenQueries.add(query.toLowerCase());
      searchCount += 1;
      const next = await retrieveMore(query);
      const additions = distinctEvidence(current, next);
      current = [...current, ...additions].slice(0, 10);
      trace.push({
        step: searchCount,
        action: 'search',
        query,
        reason: `补齐${missingSource === 'teacher_guide' ? '教师用书' : missingSource === 'textbook' ? '学生教材' : '课程标准'}依据`,
        initiatedBy: 'grounding_policy'
      });
    } catch {
      trace.push({
        step: searchCount,
        action: 'search_failed',
        query: '',
        reason: '所需教材依据暂未补齐',
        initiatedBy: 'grounding_policy'
      });
    }
    const missing = inspectEvidenceCoverage(contract, current).missing;
    nextMissing = missing.find(type => type !== missingSource) || null;
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: [
        '你只负责教材搜索编排，不回答教师问题，不编写教案。',
        '先判断已有页面是否覆盖当前篇目、教师用书处理或学生教材原文。',
        '证据足够时直接回复 READY；只有明确缺页时才调用 search_teaching_material。',
        `最多搜索 ${MAX_SEARCHES} 次，禁止重复查找。`,
        '不得生成或修改文档 ID、页码、引用文字和 PDF 地址。'
      ].join('\n'),
      model: activeRuntime.model,
      tools: [searchTool],
      messages: []
    },
    streamFn: activeRuntime.streamFn,
    getApiKey: activeRuntime.apiKey ? () => activeRuntime.apiKey : undefined,
    toolExecution: 'sequential',
    shouldStopAfterTurn: () => searchCount >= MAX_SEARCHES,
    onPayload: payload => payload,
    maxRetryDelayMs: 1_500
  });

  const abortAfter = Math.max(1_000, Math.min(
    activeRuntime.timeoutMs || DEFAULT_TIMEOUT_MS,
    Number(deadlineAt) > Date.now() ? Number(deadlineAt) - Date.now() : DEFAULT_TIMEOUT_MS
  ));
  const timer = setTimeout(() => agent.abort(), abortAfter);
  try {
    await agent.prompt(JSON.stringify({
      currentQuestion: compact(question, 900),
      fixedLessonIdentity: lessonIdentity || {},
      turnContract: contract,
      scope: Array.isArray(scope) ? scope : [scope].filter(Boolean),
      recentConversation: Array.isArray(history) ? history.slice(-6) : [],
      teacherReflectionContext: compact(teacherReflectionContext, 900),
      currentEvidence: evidenceForAgent(current)
    }));
  } catch {
    // Retrieval expansion is optional. The already verified evidence remains
    // usable even if the planning model or one tool turn fails.
  } finally {
    clearTimeout(timer);
  }

  if (!trace.length || trace.at(-1)?.action === 'search') {
    trace.push({ step: searchCount + 1, action: 'answer', query: '', reason: '已有页面交由最终回答流程核对' });
  }
  return { evidence: current, trace, contract, coverage: inspectEvidenceCoverage(contract, current) };
}

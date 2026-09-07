import { requiresSourceRead, hasSourceRead, retrievalExecution } from './agent-execution.js';
import { createTeachingSkillSession, selectTeachingSkills } from './teaching-skills.js';
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
    excerpt: compact(item.text || item.quote, item.readMode === 'full_page' ? 3000 : 600),
    readMode: item.readMode || 'snippet'
  }));
}

// Reserve space for each material type before filling the remaining context.
// New full-page reads replace snippets of the same physical page, not vice versa.
export function selectTeachingEvidence(current = [], additions = [], limit = 10) {
  const pages = new Map();
  for (const item of [...additions, ...current]) {
    if (!item?.documentId || !Number.isSafeInteger(Number(item.pdfPage)) || Number(item.pdfPage) < 1) continue;
    const key = `${item.documentId}:${Number(item.pdfPage)}`;
    const previous = pages.get(key);
    if (!previous || (item.readMode === 'full_page' && previous.readMode !== 'full_page')) pages.set(key, item);
  }
  const list = [...pages.values()];
  const type = item => String(item.documentType || 'other').replaceAll('-', '_');
  const groups = [...new Set(list.map(type))].map(key => list.filter(item => type(item) === key));
  const chosen = groups.flatMap(group => group.slice(0, 2)).slice(0, limit);
  for (const item of list) if (chosen.length < limit && !chosen.includes(item)) chosen.push(item);
  return chosen;
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
  readingContext,
  env = process.env,
  deepseek,
  deadlineAt,
  runtime
} = {}) {
  let current = Array.isArray(evidence) ? [...evidence] : [];
  const trace = [];
  const required = requiresSourceRead(question, followUpInstruction);
  const early = () => ({ evidence: current, trace, execution: retrievalExecution({ evidence: current, required, stopReason: 'not_run' }) });
  if (typeof retrieveMore !== 'function' && !readingContext) return early();

  const activeRuntime = runtime || createPiRetrievalRuntime({ env, deepseek, deadlineAt });
  if (!activeRuntime?.configured || !activeRuntime.model || typeof activeRuntime.streamFn !== 'function') {
    return early();
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
  const expiresAt = Math.min(Date.now() + (activeRuntime.timeoutMs || DEFAULT_TIMEOUT_MS), Number(deadlineAt) || Infinity);
  let stopped = false;
  let stopReason;
  const failureReason = error => expired() ? 'timeout'
    : [401, 403].includes(Number(error?.status || error?.statusCode)) || /auth|forbidden|key_invalid|unauthorized/u.test(String(error?.code || ''))
      ? 'access_denied' : 'tool_error';
  let modelTurns = 0;
  const expired = () => stopped || Date.now() >= expiresAt;
  async function withinBudget(operation) {
    if (expired()) throw new Error('retrieval_deadline');
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('retrieval_deadline')), Math.max(0, expiresAt - Date.now())); })
      ]);
    } finally { clearTimeout(timer); }
  }
  let sections = [];
  if (readingContext?.listSections) {
    try { sections = (await withinBudget(() => readingContext.listSections())).slice(0, 24); } catch { /* Keep verified initial hits. */ }
  }
  const sectionRefs = new Set(sections.map(section => section.sectionRef));
  let readCount = 0;
  let toolCount = 0;
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
      toolCount += 1;
      if (expired() || toolCount > 4 || searchCount >= MAX_SEARCHES || typeof retrieveMore !== 'function') {
        return {
          content: [{ type: 'text', text: '已达到本轮教材搜索上限，请使用已有页面完成判断。' }],
          details: { status: 'limit_reached' },
          ...(sections.length ? {} : { terminate: true })
        };
      }
      const query = compact(params?.query, 120);
      const queryKey = query.toLowerCase();
      if (!query || seenQueries.has(queryKey)) {
        return {
          content: [{ type: 'text', text: '该教材搜索已经执行，请依据已有页面继续。' }],
          details: { status: 'duplicate_search' },
          ...(sections.length ? {} : { terminate: true })
        };
      }
      seenQueries.add(queryKey);
      searchCount += 1;
      let additions;
      try { additions = await withinBudget(() => retrieveMore(query)); }
      catch (error) { stopReason = failureReason(error); throw error; }
      if (!expired()) current = selectTeachingEvidence(current, additions);
      trace.push({ step: searchCount, action: 'search', query, reason: '补充当前篇目的教材依据' });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ added: additions.length, evidence: evidenceForAgent(additions) })
        }],
        details: { added: additions.length },
        ...(additions.length || sections.length ? {} : { terminate: true })
      };
    }
  };

  const readTool = {
    name: 'read_teaching_section',
    label: '阅读篇目原页',
    description: '从本轮提供的目录节点中选择 sectionRef，读取命中原页及同节相邻页，核对人物、词句和上下文；不得自行提交文档或页码。',
    parameters: Type.Object({ sectionRef: Type.String({ minLength: 1, maxLength: 100 }) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      toolCount += 1;
      if (expired() || toolCount > 4 || readCount >= 2 || !sectionRefs.has(params?.sectionRef)) {
        return { content: [{ type: 'text', text: '节点不可用或阅读额度已用完，请依据已读材料判断，不要猜测。' }], details: { status: 'unavailable' } };
      }
      readCount += 1;
      let pages;
      try { pages = await withinBudget(() => readingContext.readSection(params.sectionRef)); }
      catch (error) { stopReason = failureReason(error); throw error; }
      if (!expired()) current = selectTeachingEvidence(current, pages);
      trace.push({ step: trace.length + 1, action: 'read', reason: '核对篇目原页与同节上下文', pagesRead: pages.length });
      return { content: [{ type: 'text', text: JSON.stringify({ evidence: evidenceForAgent(pages), remainingReads: 2 - readCount }) }], details: { pagesRead: pages.length } };
    }
  };

  // Explicit original-text tasks must read a server-selected section even
  // when the model attempts to finish immediately.
  if (required && !hasSourceRead(current) && sections.length && !expired()) {
    const first = sections.find(section => section.documentType === 'textbook') || sections[0];
    try { await readTool.execute('required-source-read', { sectionRef: first.sectionRef }); }
    catch (error) { stopReason = failureReason(error); }
  }

  // The model may decide whether another page would be useful, but it cannot
  // waive the product's source requirements. Planning and card turns fetch the
  // first missing source deterministically before free tool use.
  let nextMissing = inspectEvidenceCoverage(contract, current).missing[0];
  while (!expired() && stopReason !== 'access_denied' && typeof retrieveMore === 'function' && nextMissing && searchCount < Math.min(MAX_SEARCHES, contract.maxRetrievalIterations)) {
    const missingSource = nextMissing;
    const query = groundingQueryFor(contract, question, missingSource);
    try {
      seenQueries.add(query.toLowerCase());
      searchCount += 1;
      const additions = await withinBudget(() => retrieveMore(query, { sourceType: missingSource }));
      if (!expired()) current = selectTeachingEvidence(current, additions);
      trace.push({
        step: searchCount,
        action: 'search',
        query,
        reason: `补齐${missingSource === 'teacher_guide' ? '教师用书' : missingSource === 'textbook' ? '学生教材' : '课程标准'}依据`,
        initiatedBy: 'grounding_policy'
      });
    } catch (error) {
      stopReason = failureReason(error);
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

  const skills = createTeachingSkillSession({ env, deadlineAt: expiresAt });
  skills.require(selectTeachingSkills({ question, followUpInstruction, stage: 'retrieval' }));
  let skillToolCalls = 0;
  const skillTool = {
    name: 'read_teaching_skill', label: '读取教材核对方法',
    description: '仅可读取内置技能目录中的方法，不是教材证据，不可读取任意文件。',
    parameters: Type.Object({ skillId: Type.String() }),
    execute: async (_id, params) => {
      skillToolCalls++;
      const value = skillToolCalls > 2 || expired() ? { ok: false, reason: 'skill_budget' } : skills.load(params.skillId);
      return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
    }
  };
  const agent = new Agent({
    initialState: {
      systemPrompt: [
        skills.prompt(),
        skills.enabled ? `可按需读取的教学方法：${JSON.stringify(skills.catalog())}` : '',
        '你负责沿教材目录定位、阅读、核对，不回答教师问题，不编写教案。',
        '先判断已有页面是否覆盖当前篇目、教师用书处理或学生教材原文。',
        '先看 availableSections 的标题、摘要、范围，再按需调用 read_teaching_section 读原页；摘要不是原文。涉及引文主语、段落比较或纠错时应读正文上下文，材料不足才搜索补充。证据足够回复 READY；没有支持则回复 INSUFFICIENT，不能靠常识填补。',
        `最多搜索 ${MAX_SEARCHES} 次，禁止重复查找。`,
        '不得生成或修改文档 ID、页码、引用文字和 PDF 地址。'
      ].join('\n'),
      model: activeRuntime.model,
      tools: [...skills.enabled ? [skillTool] : [], ...typeof retrieveMore === 'function' ? [searchTool] : [], ...sections.length ? [readTool] : []],
      messages: []
    },
    streamFn: activeRuntime.streamFn,
    getApiKey: activeRuntime.apiKey ? () => activeRuntime.apiKey : undefined,
    toolExecution: 'sequential',
    shouldStopAfterTurn: () => {
      const exhausted = modelTurns >= 4 || skillToolCalls > 2 || toolCount >= 4 || (searchCount >= MAX_SEARCHES && (!sections.length || readCount >= 2));
      if (expired()) stopReason = 'timeout';
      else if (exhausted && !stopReason) stopReason = 'budget_exhausted';
      return expired() || exhausted || ['tool_error', 'access_denied'].includes(stopReason);
    },
    onPayload: payload => payload,
    maxRetryDelayMs: 1_500
  });

  agent.subscribe(event => { if (event.type === 'turn_start') modelTurns++; });
  const timer = setTimeout(() => agent.abort(), Math.max(0, expiresAt - Date.now()));
  try {
    if (!expired() && stopReason !== 'access_denied') await withinBudget(() => agent.prompt(JSON.stringify({
      currentQuestion: compact(question, 900),
      followUpInstruction: compact(followUpInstruction, 1400),
      availableSections: sections,
      fixedLessonIdentity: lessonIdentity || {},
      turnContract: contract,
      scope: Array.isArray(scope) ? scope : [scope].filter(Boolean),
      recentConversation: Array.isArray(history) ? history.slice(-6) : [],
      teacherReflectionContext: compact(teacherReflectionContext, 900),
      currentEvidence: evidenceForAgent(current)
    })));
  } catch {
    stopReason = expired() ? 'timeout' : 'model_error';
    // Retrieval expansion is optional. The already verified evidence remains
    // usable even if the planning model or one tool turn fails.
  } finally {
    if (Date.now() >= expiresAt) stopReason = 'timeout';
    if (agent.state.errorMessage && !stopReason) stopReason = 'model_error';
    stopped = true;
    agent.abort();
    clearTimeout(timer);
  }

  if (!trace.length || ['search', 'read'].includes(trace.at(-1)?.action)) {
    trace.push({ step: searchCount + 1, action: 'answer', query: '', reason: '已有页面交由最终回答流程核对' });
  }
  return { evidence: current, trace, contract, coverage: inspectEvidenceCoverage(contract, current), skillExecution: skills.audit(), execution: retrievalExecution({ evidence: current, required, coverage: inspectEvidenceCoverage(contract, current), stopReason, counts: { searches: searchCount, reads: readCount, modelTurns } }) };
}

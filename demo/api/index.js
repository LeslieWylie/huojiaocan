import { allowMethod, json, readJson } from '../serverless/shared.js';
import { getIndexProvider, getManifest } from '../serverless/index-provider.js';
import uploadHandler from './upload.js';
import { resolveActiveDeepSeekKey } from './ai.js';
import { AuthError, DataStoreError, requireUser, safeAuthResponse, supabaseRest } from '../serverless/auth.js';
import { learningEvidenceContext, learningEvidenceIsStale } from '../shared/learning-evidence.js';
import { teachingDeliberationContext, teachingDeliberationContextForDraft } from '../shared/teaching-deliberation.js';
import { homeworkReviewContext, homeworkReviewIsStale } from '../shared/homework-review.js';
import { normalizePreviousLessonCarryover } from '../shared/classroom-carryover.js';
import { serializeClassLearningProfile } from '../shared/class-learning-profile.js';
import { resolveLessonIdentity } from '../shared/lesson-identity.js';

function indexMaintainerEmails(env = process.env) {
  return new Set(String(env.INDEX_MAINTAINER_EMAILS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean));
}

async function requireIndexMaintainer(req, env = process.env) {
  const user = await requireUser(req, { env });
  const allowed = indexMaintainerEmails(env);
  if (!user.email || !allowed.has(user.email.toLowerCase())) {
    throw new AuthError('index_write_forbidden', 403);
  }
  return user;
}

async function protectIndexWrite(req, res) {
  try {
    await requireIndexMaintainer(req);
    return true;
  } catch (error) {
    safeAuthResponse(res, error);
    return false;
  }
}

function routePath(req) {
  if (req.indexPath) return String(req.indexPath).startsWith('/') ? String(req.indexPath) : `/${req.indexPath}`;
  const explicit = req.query?.path;
  if (explicit) return `/${String(explicit).replace(/^\/+/, '')}`;
  try { return new URL(req.url, 'http://local').pathname.replace(/^\/api\/index/, '') || '/'; } catch { return '/'; }
}

const publicErrorCodes = new Set([
  'document_not_found', 'page_not_found', 'job_not_found', 'question_required', 'query_required', 'pages_required',
  'pageindex_unavailable', 'pageindex_unauthorized', 'pageindex_forbidden', 'pageindex_rate_limited',
  'pageindex_timeout', 'pageindex_invalid_request', 'pageindex_invalid_response', 'pageindex_request_failed',
  'pageindex_not_found', 'pageindex_method_not_allowed',
  'gateway_not_configured', 'gateway_invalid_url', 'gateway_invalid_request', 'gateway_unauthorized',
  'gateway_forbidden', 'gateway_rate_limited', 'gateway_timeout', 'gateway_unavailable',
  'gateway_invalid_response', 'gateway_request_failed',
  'auth_required', 'auth_invalid', 'auth_not_configured', 'auth_unavailable', 'key_not_found', 'key_decrypt_failed',
  'deepseek_unauthorized', 'deepseek_forbidden', 'deepseek_rate_limited', 'deepseek_timeout', 'deepseek_unavailable',
  'deepseek_invalid_response', 'deepseek_invalid_request', 'deepseek_request_failed',
  'draft_not_found', 'index_write_forbidden', 'operation_not_supported_for_fixture_document', 'route_not_found'
]);
const publicDocumentIds = new Set(getManifest().documents.map(document => String(document.id)));

function normalizedConversationHistory(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: item.content.trim().slice(0, 1800) }))
    .filter(item => item.content);
}

/**
 * The saved draft is the durable baseline, while the browser may contain one
 * or two newer locally recovered turns after a save interruption. Both are
 * ordinary conversation text; only server-owned reflection context carries a
 * teacher-confirmed status. Merge the two without silently discarding either.
 */
export function mergeAskHistory(stored = [], recent = []) {
  const baseline = normalizedConversationHistory(stored);
  const local = normalizedConversationHistory(recent);
  let overlap = Math.min(baseline.length, local.length);
  while (overlap > 0) {
    const suffix = baseline.slice(-overlap);
    const prefix = local.slice(0, overlap);
    if (suffix.every((item, index) => item.role === prefix[index].role && item.content === prefix[index].content)) break;
    overlap -= 1;
  }
  return [...baseline, ...local.slice(overlap)].slice(-10);
}

/**
 * The current turn is carried by `question` and `followUpInstruction`, not by
 * history. Old browser snapshots may still end with that pending user text;
 * trim only an unpaired trailing user item and keep completed repeated turns.
 */
export function completedAskHistory(history = [], currentQuestion = '', followUpInstruction = '') {
  const completed = normalizedConversationHistory(history);
  const pending = new Set([currentQuestion, followUpInstruction].map(value => String(value || '').trim()).filter(Boolean));
  while (completed.at(-1)?.role === 'user' && (!pending.size || pending.has(completed.at(-1).content))) completed.pop();
  return completed.slice(-10);
}

function askDeadlineAt(env = process.env) {
  const requested = Number(env.AI_WORKFLOW_TIMEOUT_MS);
  const budget = Number.isFinite(requested) && requested > 0
    ? Math.min(110_000, Math.max(20_000, requested))
    : 55_000;
  return Date.now() + budget;
}

function publicManifestDocument(document = {}) {
  const id = String(document.id || '');
  const type = id === 'teacher-guide' ? 'teacher_guide' : id === 'curriculum-standard' ? 'curriculum_standard' : id === 'textbook' ? 'textbook' : document.documentType || 'other';
  return {
    id,
    title: document.title || id,
    shortTitle: document.shortTitle || document.title || id,
    short: document.shortTitle || document.title || id,
    documentType: type,
    pageCount: Number(document.pageCount || 0),
    indexedPages: Number(document.indexedPages || document.pageCount || 0),
    pdfUrl: document.pdfUrl || '',
    indexStatus: document.status || 'ready',
    status: document.status || 'ready',
    visibility: 'public'
  };
}

/** Remote PageIndex owns retrieval, while the bundled course-standard snapshot
 * is an intentional third public source. Keep the catalogue complete even
 * when the remote service only knows the textbook and teacher guide. */
export function mergeBundledPublicDocuments(documents = []) {
  const merged = new Map((Array.isArray(documents) ? documents : []).filter(item => item?.id).map(item => [String(item.id), item]));
  for (const document of getManifest().documents) {
    if (!merged.has(String(document.id))) merged.set(String(document.id), publicManifestDocument(document));
  }
  return [...merged.values()].map(document => {
    const id = String(document.id || '');
    return {
      ...document,
      documentType: id === 'teacher-guide' ? 'teacher_guide' : id === 'textbook' ? 'textbook' : id === 'curriculum-standard' ? 'curriculum_standard' : document.documentType || 'other'
    };
  });
}

export function reflectionContext(value = {}) {
  const feedback = value?.feedback || value || {};
  const cardUsage = Array.isArray(feedback.cardUsage) ? feedback.cardUsage : Array.isArray(feedback.usedCards) ? feedback.usedCards : [];
  const lines = [
    feedback.observedLearning && `学生实际表现：${String(feedback.observedLearning).slice(0, 500)}`,
    feedback.unresolvedLearning && `仍未说清：${String(feedback.unresolvedLearning).slice(0, 500)}`,
    feedback.pacingNotes && `课堂节奏：${String(feedback.pacingNotes).slice(0, 400)}`,
    feedback.nextLessonAdjustment && `教师确认的下次调整：${String(feedback.nextLessonAdjustment).slice(0, 500)}`,
    cardUsage.length && `实际使用：${cardUsage.map(item => String(item).slice(0, 40)).slice(0, 6).join('、')}`
  ].filter(Boolean);
  return lines.length ? `上一课教师确认的课堂记录：\n${lines.join('\n')}` : '';
}

export function aggregateLearningContext(value = {}) {
  const summary = value?.summary || learningEvidenceContext(value);
  if (!summary?.itemCount) return '';
  const counts = summary.counts || {};
  const lines = [
    `已汇总 ${summary.itemCount} 道任务，单题最多收到 ${summary.submittedCount || 0} 份提交；按题累计：完整达成 ${counts.secure || 0}，部分达成 ${counts.partial || 0}，尚未达成 ${counts.not_yet || 0}。`,
    ...(Array.isArray(summary.focus) ? summary.focus.slice(0, 5).map((item, index) => `L${index + 1} ${item.question}；教师归纳：${item.observedPattern || '未填写'}；下次处理：${item.teacherAction || '待教师决定'}`) : [])
  ];
  return `上一课教师确认的班级聚合学情（不是教材依据）：\n${lines.join('\n')}`.slice(0, 2200);
}

export function confirmedDeliberationContext(value = {}) {
  const context = teachingDeliberationContext(value);
  if (!context?.decisions?.length) return '';
  const lines = context.decisions.map(item => `${item.id} ${item.question}；教师选择：${item.choice}；课堂落实：${item.approach}；已接受的代价：${item.acceptedTradeoff || '未填写'}`);
  return `本课教师已经确认的备课取舍（不是教材依据）：\n${lines.join('\n')}`.slice(0, 2400);
}

export function confirmedHomeworkReviewContext(value = {}) {
  const summary = value?.summary || homeworkReviewContext(value);
  if (!summary?.responseCount) return '';
  const counts = summary.counts || {};
  const lines = [
    `${summary.task?.level || ''}层任务共分析 ${summary.responseCount} 份匿名答案：已达成 ${counts.secure || 0}，部分达成 ${counts.partial || 0}，需要支持 ${counts.notYet || 0}，平均 ${summary.averageScore || 0}/${summary.task?.maxScore || 0} 分。`,
    ...(Array.isArray(summary.patterns) ? summary.patterns.slice(0, 5).map(item => `共性问题：${item}`) : []),
    ...(Array.isArray(summary.nextActions) ? summary.nextActions.slice(0, 5).map(item => `教师确认的后续动作：${item}`) : []),
    summary.teacherNote ? `教师判断：${summary.teacherNote}` : ''
  ].filter(Boolean);
  return `上一课教师确认的匿名作业汇总（不是教材依据，不含学生原文）：\n${lines.join('\n')}`.slice(0, 2200);
}

export function previousLessonCarryoverContext(value = {}) {
  const carryover = normalizePreviousLessonCarryover(value);
  const pending = carryover.items.filter(item => item.status !== 'done');
  if (!pending.length) return '';
  return `上一课教师明确要求在本课处理的事项（不是教材依据）：\n${pending.map((item, index) => `C${index + 1} ${item.text}`).join('\n')}\n请在本课课堂组织中回应这些事项，但教材判断和页码仍须来自本课重新检索的学生教材与教师用书。`.slice(0, 1800);
}

function storedConversationHistory(value) {
  return (Array.isArray(value) ? value : []).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(-10)
    .map(item => ({ role: item.role, content: item.content.slice(0, 1200) }));
}

function storedLessonIdentity(draft = {}) {
  const answerLesson = draft.answer?.lesson || {};
  const lessonRef = draft.lesson_context?.lessonRef || {};
  const resolved = resolveLessonIdentity({
    lessonRef,
    title: draft.title,
    answerTitle: answerLesson.title,
    question: draft.question,
    citations: draft.citations
  });
  return {
    title: String(resolved.title || answerLesson.title || lessonRef.title || draft.title || '').slice(0, 120),
    coreQuestion: String(answerLesson.coreQuestion || draft.question || '').slice(0, 500)
  };
}

function planLine(value, max = 360) {
  if (Array.isArray(value)) return value.map(item => planLine(item, 160)).filter(Boolean).join('；').slice(0, max);
  if (value && typeof value === 'object') {
    return String(value.title || value.question || value.teacherAction || value.studentTask || value.text || value.content || value.description || '')
      .replace(/\s+/gu, ' ').trim().slice(0, max);
  }
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

export function classAdaptationPlanContext(draft = {}) {
  const answer = draft?.answer && typeof draft.answer === 'object' ? draft.answer : {};
  if (!answer.classAdaptation?.sourceDraftId) return '';
  const lessonPlan = (Array.isArray(answer.lessonPlan) ? answer.lessonPlan : []).slice(0, 8).map((item, index) => {
    const title = planLine(item?.title || item?.name || `环节${index + 1}`, 80);
    const action = planLine(item?.teacherAction || item?.content || item?.description || item?.activity, 180);
    return `${index + 1}.${title}${action ? `：${action}` : ''}`;
  }).join('；');
  const lines = [
    '一课多班的源方案骨架（教师方案，不是教材依据）：',
    `源班：${planLine(answer.classAdaptation.sourceClassName || '未注明', 60)}；目标班：${planLine(answer.classAdaptation.targetClassName || draft.lesson_context?.className || '未注明', 60)}`,
    answer.summary && `方案主线：${planLine(answer.summary, 420)}`,
    answer.objectives && `教学目标：${planLine(answer.objectives, 420)}`,
    answer.keyPoints && `重点难点：${planLine(answer.keyPoints, 360)}`,
    lessonPlan && `课堂流程：${lessonPlan}`,
    answer.questionChain && `问题链：${planLine(answer.questionChain, 420)}`,
    answer.assessment && `评价观察：${planLine(answer.assessment, 320)}`,
    '调整时保留篇目、教材依据与教学目标，只改变课堂起点、支架、节奏、问题梯度和评价观察点。'
  ].filter(Boolean);
  return lines.join('\n').slice(0, 2600);
}

export async function ownedDraftAskContext(user, draftId) {
  const id = String(draftId || '').trim();
  if (!id) return null;
  const rows = await supabaseRest('lesson_drafts', {
    authToken: user.token,
    query: { select: 'id,title,question,lesson_context,answer,citations,cards,version', user_id: `eq.${user.id}`, id: `eq.${id}`, limit: 1 }
  });
  const draft = Array.isArray(rows) ? rows[0] : null;
  if (!draft) throw Object.assign(new Error('draft_not_found'), { code: 'draft_not_found', status: 404 });
  const answer = draft.answer || {};
  const teacherReflectionContext = [
    classAdaptationPlanContext(draft),
    reflectionContext(answer.previousLessonReflection || answer.lessonReflection || answer.teachingFeedback),
    previousLessonCarryoverContext(answer.previousLessonCarryover),
    aggregateLearningContext(answer.previousLessonLearningEvidence || (learningEvidenceIsStale(draft) ? null : answer.learningEvidence)),
    confirmedHomeworkReviewContext(answer.previousLessonHomeworkReview || (homeworkReviewIsStale(draft) ? null : answer.homeworkReview)),
    confirmedDeliberationContext(teachingDeliberationContextForDraft(draft) ? answer.teachingDeliberation : null)
  ].filter(Boolean).join('\n\n').slice(0, 5200);
  return {
    teacherReflectionContext,
    history: storedConversationHistory(answer.conversationHistory),
    lessonContext: draft.lesson_context && typeof draft.lesson_context === 'object' ? draft.lesson_context : {},
    lessonIdentity: storedLessonIdentity(draft)
  };
}

export async function ownedDraftTeachingContext(user, draftId) {
  return (await ownedDraftAskContext(user, draftId))?.teacherReflectionContext || '';
}

export async function ownedClassLearningContext(user, requestedClassName, excludeDraftId = '') {
  const className = String(requestedClassName || '').trim().slice(0, 80);
  if (!className) return '';
  const rows = await supabaseRest('lesson_drafts', {
    authToken: user.token,
    query: {
      select: 'id,title,question,lesson_context,answer,updated_at,created_at',
      user_id: `eq.${user.id}`,
      order: 'updated_at.desc',
      limit: 80
    }
  });
  const excluded = String(excludeDraftId || '').trim();
  return serializeClassLearningProfile(
    (Array.isArray(rows) ? rows : []).filter(draft => !excluded || String(draft?.id || '') !== excluded),
    className
  );
}

function hasBearerToken(req) {
  const headers = req?.headers || {};
  return /^Bearer\s+\S+/i.test(String(headers.authorization || headers.Authorization || '').trim());
}

async function ownedDocumentIds(req, authenticatedUser) {
  if (!authenticatedUser && !hasBearerToken(req)) return new Set();
  const user = authenticatedUser || await requireUser(req);
  const rows = await supabaseRest('document_access', {
    authToken: user.token,
    query: {
      select: 'document_id',
      owner_id: `eq.${user.id}`
    }
  });
  return new Set((Array.isArray(rows) ? rows : []).map(row => String(row.document_id)).filter(Boolean));
}

function publicDocument(document = {}) {
  // PageIndex is a retrieval service, not an authorization authority. Only the
  // bundled manifest decides which documents are public.
  return publicDocumentIds.has(String(document.id || document.documentId || ''));
}

async function filterAccessibleDocuments(req, documents = []) {
  const list = Array.isArray(documents) ? documents : [];
  let owned = new Set();
  if (hasBearerToken(req)) {
    try {
      owned = await ownedDocumentIds(req);
    } catch (error) {
      // Public books remain anonymously readable when a previously signed-in
      // browser carries an expired token. Treat that request as anonymous for
      // catalogue listing only; private document reads still fail closed in
      // requireDocumentRead.
      if (!(error instanceof AuthError)) throw error;
    }
  }
  return list.filter(document => publicDocument(document) || owned.has(String(document.id || document.documentId || '')));
}

async function requireDocumentRead(req, provider, documentId, authenticatedUser) {
  const id = String(documentId || '').trim();
  if (!id) throw new Error('document_not_found');
  if (!publicDocument({ id })) {
    let owned;
    try {
      owned = await ownedDocumentIds(req, authenticatedUser);
    } catch (error) {
      if (error instanceof AuthError && ['auth_required', 'auth_invalid'].includes(error.code)) {
        throw new Error('document_not_found');
      }
      throw error;
    }
    if (!owned.has(id)) throw new Error('document_not_found');
  }
  try {
    return await provider.getDocument(id);
  } catch (error) {
    if (['document_not_found', 'pageindex_not_found'].includes(String(error?.code || error?.message || ''))) {
      throw new Error('document_not_found');
    }
    throw error;
  }
}

function requestedDocumentIds(scope) {
  if (scope == null || scope === '' || scope === 'both') return [...publicDocumentIds];
  const incoming = Array.isArray(scope) ? scope : [scope];
  const ids = [];
  for (const value of incoming) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    if (raw === 'both') {
      ids.push(...publicDocumentIds);
      continue;
    }
    ids.push(raw === 'guide' || raw === 'teacher_guide' ? 'teacher-guide' : raw);
  }
  return ids.length ? [...new Set(ids)] : [...publicDocumentIds];
}

async function resolveDocumentScope(req, provider, scope, authenticatedUser) {
  const requested = requestedDocumentIds(scope);
  for (const documentId of requested) {
    if (!publicDocument({ id: documentId })) {
      // Every explicit non-public id crosses the same read-authorization
      // boundary. Client-supplied userId fields never participate.
      await requireDocumentRead(req, provider, documentId, authenticatedUser);
    }
  }
  return requested;
}

function filterScopedProviderResponse(response, allowedDocumentIds) {
  if (!response || typeof response !== 'object') return response;
  const allowed = new Set(allowedDocumentIds);
  const next = { ...response };
  for (const key of ['results', 'hits', 'contexts', 'citations', 'evidence']) {
    if (Array.isArray(next[key])) {
      next[key] = next[key].filter(item => allowed.has(String(item?.documentId || item?.document_id || '')));
    }
  }
  if (typeof next.total === 'number' && Array.isArray(next.results)) next.total = next.results.length;
  return next;
}
function safeErrorCode(error) {
  const message = String(error?.message || 'index_error');
  if (publicErrorCodes.has(message)) return message;
  return 'index_provider_error';
}
function errorResponse(res, error) {
  const code = safeErrorCode(error);
  const status = code.includes('not_found') ? 404
    : code.includes('required') ? 400
    : code === 'pageindex_invalid_request' || code === 'pageindex_method_not_allowed' ? 400
    : code.includes('unavailable') || code.includes('timeout') || code.includes('rate_limited') ? 503
        : code === 'operation_not_supported_for_fixture_document' ? 409 : 500;
  return json(res, status, { ok: false, error: code });
}
export default async function handler(req, res) {
  const path = routePath(req);
  if (path === '/documents/upload') return uploadHandler(req, res);
  const { provider, requested, fallback, reason } = getIndexProvider();
  try {
    if (path === '/' || path === '/health') {
      if (!allowMethod(req, res, 'GET')) return;
      const status = await provider.healthCheck();
      return json(res, 200, { ok: true, activeProvider: provider.id, providerLabel: provider.label, requestedProvider: requested, fallback, reason, ...status });
    }
    if (path === '/documents' && req.method === 'GET') {
      const status = await provider.getStatus();
      const documents = await filterAccessibleDocuments(req, status.documents || []);
      const normalized = mergeBundledPublicDocuments(documents).map(({ tree, ...document }) => document);
      return json(res, 200, { provider: provider.id, documents: normalized, ...(provider.id === 'local-fulltext' ? {} : { status: { ...status, documents: normalized } }) });
    }
    if (path === '/documents' && req.method === 'POST') {
      if (!await protectIndexWrite(req, res)) return;
      return json(res, 202, await provider.createDocument(await readJson(req)));
    }
    if (path === '/search') {
      if (!allowMethod(req, res, 'POST')) return;
      const body = await readJson(req);
      const scope = await resolveDocumentScope(req, provider, body.scope ?? body.documentIds ?? body.documentId);
      const response = await provider.search({
        query: body.query,
        scope,
        limit: body.limit,
        nodeId: body.nodeId,
        includeReview: body.includeReview
      });
      return json(res, 200, filterScopedProviderResponse(response, scope));
    }
    if (path === '/retrieve') {
      if (!allowMethod(req, res, 'POST')) return;
      const body = await readJson(req);
      const scope = await resolveDocumentScope(req, provider, body.scope ?? body.documentIds ?? body.documentId);
      const response = await provider.retrieve({
        query: body.query,
        question: body.question,
        scope,
        limit: body.limit,
        includeReview: body.includeReview
      });
      return json(res, 200, filterScopedProviderResponse(response, scope));
    }
    if (path === '/ask') {
      if (!allowMethod(req, res, 'POST')) return;
      const body = await readJson(req);
      let user;
      try { user = await requireUser(req); } catch (error) { return safeAuthResponse(res, error); }
      try {
        const scope = await resolveDocumentScope(req, provider, body.scope ?? body.documentIds ?? body.documentId, user);
        // An empty keyId is an explicit choice of the configured system
        // service. Do not resolve the account's old active key in that case;
        // a personal key is used only when its id is selected explicitly.
        let active = null;
        if (typeof body.keyId === 'string' && body.keyId.trim()) {
          active = await resolveActiveDeepSeekKey(user, body.keyId.trim());
        }
        // Learning observations are trusted only when read from this user's
        // stored draft. Browser-supplied prose can never impersonate a
        // teacher-confirmed classroom or homework record.
        const ownedContext = await ownedDraftAskContext(user, body.draftId);
        const lessonContext = ownedContext?.lessonContext || (body.lessonContext && typeof body.lessonContext === 'object' ? body.lessonContext : {});
        const classLearningContext = await ownedClassLearningContext(user, lessonContext.className, body.draftId);
        const teacherReflectionContext = [ownedContext?.teacherReflectionContext, classLearningContext].filter(Boolean).join('\n\n').slice(0, 7200);
        // Keep user/account metadata at the business boundary.  The provider
        // receives only the explicit ask contract, so it can never forward
        // private draft/key fields to the self-hosted retrieval service.
        const askInput = {
          question: body.question,
          retrievalQuery: typeof body.retrievalQuery === 'string' ? body.retrievalQuery : '',
          teachingFocus: typeof body.teachingFocus === 'string' ? body.teachingFocus.slice(0, 500) : '',
          scope,
          limit: body.limit,
          // Keep the account draft as the durable baseline, but merge any
          // newer locally recovered turns so a temporary save failure does
          // not make the next follow-up forget the conversation.
          history: completedAskHistory(
            mergeAskHistory(ownedContext?.history, body.history),
            body.question,
            body.followUpInstruction
          ),
          teacherReflectionContext,
          lessonContext,
          lessonIdentity: ownedContext?.lessonIdentity || (body.lessonIdentity && typeof body.lessonIdentity === 'object' ? body.lessonIdentity : undefined),
          followUpInstruction: typeof body.followUpInstruction === 'string' ? body.followUpInstruction : '',
          operation: body.operation && typeof body.operation === 'object' ? {
            type: typeof body.operation.type === 'string' ? body.operation.type.slice(0, 64) : '',
            periods: Number(body.operation.periods) === 2 ? 2 : Number(body.operation.periods) === 1 ? 1 : undefined
          } : undefined,
          retrievalMode: body.retrievalMode,
          deepseek: active,
          deadlineAt: askDeadlineAt()
        };
        const response = await provider.ask(askInput);
        return json(res, 200, filterScopedProviderResponse(response, scope));
      } catch (error) {
        if (String(error?.code || '').startsWith('auth_') || String(error?.code || '').startsWith('key_') || String(error?.code || '').startsWith('deepseek_') || String(error?.code || '').startsWith('gateway_')) return safeAuthResponse(res, error);
        throw error;
      }
    }

    const jobStatusMatch = path.match(/^\/status\/([^/]+)$/);
    if (jobStatusMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      return json(res, 200, await provider.getJob(decodeURIComponent(jobStatusMatch[1])));
    }
    const publicTreeMatch = path.match(/^\/tree\/([^/]+)$/);
    if (publicTreeMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      const documentId = decodeURIComponent(publicTreeMatch[1]);
      await requireDocumentRead(req, provider, documentId);
      return json(res, 200, await provider.getTree(documentId));
    }
    const publicPageMatch = path.match(/^\/page\/([^/]+)\/(\d+)$/);
    if (publicPageMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      const documentId = decodeURIComponent(publicPageMatch[1]);
      await requireDocumentRead(req, provider, documentId);
      return json(res, 200, await provider.getPage(documentId, Number(publicPageMatch[2])));
    }

    const statusMatch = path.match(/^\/documents\/([^/]+)\/status$/);
    if (statusMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      return json(res, 200, await requireDocumentRead(req, provider, decodeURIComponent(statusMatch[1])));
    }
    const treeMatch = path.match(/^\/documents\/([^/]+)\/tree$/);
    if (treeMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      const documentId = decodeURIComponent(treeMatch[1]);
      await requireDocumentRead(req, provider, documentId);
      return json(res, 200, await provider.getTree(documentId));
    }
    const pageMatch = path.match(/^\/documents\/([^/]+)\/pages\/(\d+)$/);
    if (pageMatch) {
      const documentId = decodeURIComponent(pageMatch[1]);
      const page = Number(pageMatch[2]);
      if (req.method === 'GET') {
        await requireDocumentRead(req, provider, documentId);
        return json(res, 200, await provider.getPage(documentId, page));
      }
      if (req.method === 'PATCH') {
        if (!await protectIndexWrite(req, res)) return;
        return json(res, 200, await provider.updatePage(documentId, page, await readJson(req)));
      }
      res.setHeader('Allow', 'GET, PATCH');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    const buildMatch = path.match(/^\/documents\/([^/]+)\/build$/);
    if (buildMatch) {
      if (!allowMethod(req, res, 'POST')) return;
      if (!await protectIndexWrite(req, res)) return;
      return json(res, 202, await provider.startIndex(decodeURIComponent(buildMatch[1]), await readJson(req)));
    }
    const rerunMatch = path.match(/^\/documents\/([^/]+)\/pages\/rerun$/);
    if (rerunMatch) {
      if (!allowMethod(req, res, 'POST')) return;
      if (!await protectIndexWrite(req, res)) return;
      return json(res, 202, await provider.rerunPages(decodeURIComponent(rerunMatch[1]), await readJson(req)));
    }
    const validateMatch = path.match(/^\/documents\/([^/]+)\/validate$/);
    if (validateMatch) {
      if (!allowMethod(req, res, 'POST')) return;
      if (!await protectIndexWrite(req, res)) return;
      return json(res, 202, await provider.validate(decodeURIComponent(validateMatch[1]), await readJson(req)));
    }
    const validationMatch = path.match(/^\/documents\/([^/]+)\/validation$/);
    if (validationMatch) {
      if (!allowMethod(req, res, 'GET')) return;
      const documentId = decodeURIComponent(validationMatch[1]);
      await requireDocumentRead(req, provider, documentId);
      return json(res, 200, await provider.getValidation(documentId));
    }
    const deleteMatch = path.match(/^\/documents\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      if (!await protectIndexWrite(req, res)) return;
      return json(res, 200, await provider.deleteDocument(decodeURIComponent(deleteMatch[1])));
    }

    return json(res, 404, { ok: false, error: 'route_not_found' });
  } catch (error) {
    if (error instanceof AuthError || error instanceof DataStoreError) return safeAuthResponse(res, error);
    return errorResponse(res, error);
  }
}

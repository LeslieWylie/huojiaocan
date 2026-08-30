import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Copy,
  CircleAlert, ClipboardCheck, Download, ExternalLink, Eye, FileCheck2, FileSearch,
  FileText, Gauge, GitCompareArrows, History, Layers3, Library, Maximize2, Menu, MessageCircle, Network,
  Link2, Microscope, PanelTop, Play, Plus, Quote, RefreshCw, Route, Search, Send, Share2, ShieldCheck,
  Sparkles, Target, Upload, X, ZoomIn, ZoomOut
} from 'lucide-react';
import { accessToken, authOwnersConflict, canPersistAuthOwner, clearAuthRecovery, consumeAuthCallback, ensureSession, getSession, readAuthRecovery, refreshSession, resendVerification, safeAuthReturnPath, saveAuthRecovery, sessionExpired, signIn, signOut, signUp, subscribeAuth } from './auth.js';
import { errorCopy, UI_COPY } from './copy.js';
import { API, fetchJson, request, rootRequest, askErrorMessage, canonicalDocumentId, citationPage, citationLink, citationText, currentPageReturn, DOC_LABELS, docName, isIndexRecoveryCode, pageText, pageTitle, pdfPageUrl, queryParams, requestCode, routeId, safeDownloadStem, statusLabel, terminalJob } from './app-core.js';
import { Badge, Logo, SectionHead, Stat } from './ui-kit.jsx';
import { Decision } from './views/decision-page.jsx';
import { Pitch } from './views/pitch-page.jsx';
import { LoginPage, SettingsPage } from './views/auth-pages.jsx';
import { normalizeAskAction } from './ask-actions.js';
import { buildAskContext, buildConversationHistory } from './conversation-context.js';
import { clearConversationSnapshot, readConversationSnapshot, readRecentConversationSnapshots, saveConversationSnapshot } from './conversation-recovery.js';
import { withAskRetry } from './ask-retry.js';
import { buildPdfPageUrl, buildReaderHref, findTreeNodeByNormalizedTitle, normalizeLessonIdentity as normalizeReaderLessonIdentity, pairedDocumentId, pairedFocusQuery, pairedLessonQuery, resolveCrossDocTarget, resolveReaderReturn } from './reader-target.js';
import { evidenceShelfKey, mergeEvidenceShelf, removeEvidenceShelfItem } from './evidence-shelf.js';
import { checklistProgress, deriveWorkflowChecklist } from './workflow-checklist.js';
import { analyzeTeachingPlanQuality } from './lesson-quality.js';
import { pairLessonEvidence } from './lesson-evidence.js';
import { applyPlanForm, cardsForAskDraft, deriveTeacherDraftState, isTeacherConfirmed, planFormFromDraft, readDraftRecovery as readOwnedDraftRecovery, writeDraftRecovery } from './teacher-finalization.js';
import { buildUnitTrack, stableNodeId, unitLessonNodes, unitNodes, unitTrackInsights } from './unit-planning.js';
import { CLASSROOM_STAGE_LABELS, addClassroomMoment, classroomRunHasContent, classroomRunToReflectionSeed, emptyClassroomRun, normalizeClassroomRun, removeClassroomMoment, resolveClassroomRecovery, setClassroomStageOutcome } from '../shared/classroom-run.js';
import { defaultClassroomMomentTriage, normalizeClassroomMomentTriage, normalizePreviousLessonCarryover } from '../shared/classroom-carryover.js';
import { CLASSROOM_PACE_SIGNALS, classroomAdaptationAdvice } from '../shared/classroom-adaptation.js';
import { buildBoardWritingPlan } from '../shared/board-writing-plan.js';
import { buildDualSourceTeachingCard } from '../shared/dual-source-teaching-card.js';
import { buildOfflineClassroomPack } from '../shared/offline-classroom-pack.js';
import { buildTeachingBrief } from '../shared/teaching-brief.js';
import { buildTeachingEvidenceChain } from '../shared/teaching-evidence-chain.js';
import { buildPeriodPlan, reorderPeriodActivity, repairPeriodSequence, serializePeriodPlan, updatePeriodActivity } from '../shared/period-planner.js';
import { buildClassroomWorksheet, buildClassroomWorksheetHtml } from '../shared/classroom-worksheet.js';
import { buildCurriculumAlignment, curriculumSearchQueries } from '../shared/curriculum-alignment.js';
import { emptyQuestionRehearsal, normalizeQuestionRehearsal, questionRehearsalIsStale, rehearsalProgress } from '../shared/question-rehearsal.js';
import { emptyPreClassPulse, normalizePreClassPulse, preClassPulseClassroomCue, preClassPulseIsStale, preClassPulseProgress } from '../shared/preclass-pulse.js';
import { emptyLearningEvidence, learningEvidenceIsStale, learningEvidenceProgress, learningEvidenceSummary, normalizeLearningEvidence } from '../shared/learning-evidence.js';
import { emptyTeachingDeliberation, normalizeTeachingDeliberation, teachingDeliberationIsStale } from '../shared/teaching-deliberation.js';
import { emptyLessonStudy, lessonStudyIsStale, lessonStudyReadiness, normalizeLessonStudy } from '../shared/lesson-study.js';
import { emptySameLessonComparison, normalizeLessonIdentity, normalizeSameLessonComparison } from '../shared/same-lesson-comparison.js';
import { observationProtocolMarkdown } from '../shared/observation-protocol.js';
import { teachingSlideDeckHtml } from '../shared/teaching-slides.js';
import { layeredHomeworkStudentHtml, layeredHomeworkTeacherMarkdown } from '../shared/layered-homework.js';
import { homeworkReviewCsv } from '../shared/homework-review.js';
import { buildSubstituteTeachingPack } from '../shared/substitute-teaching-pack.js';
import { lessonTitleForDraft } from '../shared/lesson-identity.js';

const ROUTES = [
  ['dashboard', '/', Route, '教学任务'],
  ['guide', '/guide/', Play, '备课引导'],
  ['unit', '/unit/', Network, '单元接力'],
  ['cards', '/cards/', Layers3, '一课三卡'],
  ['slides', '/slides/', PanelTop, '课堂课件'],
  ['homework', '/homework/', ClipboardCheck, '分层作业'],
  ['marking', '/marking/', FileCheck2, '匿名批改'],
  ['rehearsal', '/rehearsal/', Route, '问题链预演'],
  ['pulse', '/pulse/', Gauge, '课前学情摸底'],
  ['worksheet', '/worksheet/', FileText, '双页课堂任务单'],
  ['alignment', '/alignment/', Target, '课标对齐'],
  ['learning', '/learning/', ClipboardCheck, '作业回流'],
  ['deliberation', '/deliberation/', Route, '备课取舍'],
  ['study', '/study/', Microscope, '一课一研'],
  ['compare', '/compare/', GitCompareArrows, '同课异构'],
  ['research', '/research/', FileText, '教研问题簿'],
  ['observation', '/observation/', ClipboardCheck, '听评课观察单'],
  ['assets', '/assets/', Archive, '教研资产'],
  ['share', '/share/', Share2, '教研共备'],
  ['reflection', '/reflection/', History, '课后复盘'],
  ['library', '/library/', Library, '教材库'],
  ['ask', '/ask/', MessageCircle, '备课问答'],
  ['ingest', '/ingest/', Upload, '导入教材'],
  ['jobs', '/jobs/', Activity, '处理进度'],
  ['inspect', '/inspect/', FileSearch, '页面校正'],
  ['validation', '/validation/', ClipboardCheck, '质量检查'],
  ['document', '/document/', BookOpen, '教材原页核验'],
  ['login', '/login/', ShieldCheck, '账号登录'],
  ['settings', '/settings/', ShieldCheck, 'AI 设置'],
  ['decision', '/decision/', Sparkles, '教学决策'],
  ['pitch', '/pitch/', Play, '使用示例']
];
const PRIMARY_NAV = [
  ['dashboard', '/', Route, '教学任务'],
  ['library', '/library/', Library, '教材库'],
  ['unit', '/unit/', Network, '单元接力'],
  ['ask', '/ask/', MessageCircle, '备课问答'],
  ['cards', '/cards/', Layers3, '一课三卡'],
  ['assets', '/assets/', Archive, '教研资产']
];
const WORKFLOW_TOOL_NAV = [
  ['alignment', '/alignment/', Target, '课标对齐'],
  ['slides', '/slides/', PanelTop, '课堂课件'],
  ['study', '/study/', Microscope, '一课一研'],
  ['compare', '/compare/', GitCompareArrows, '同课异构'],
  ['research', '/research/', FileText, '教研问题簿']
];
const MATERIAL_NAV = [
  ['ingest', '/ingest/', Upload, '导入教材'],
  ['jobs', '/jobs/', Activity, '处理进度'],
  ['inspect', '/inspect/', FileSearch, '页面校正'],
  ['validation', '/validation/', ClipboardCheck, '质量检查']
];
const EXAMPLES = [
  '《我爱这土地》第二节为什么不能删？怎样设计课堂活动？',
  '第一单元三项任务之间是什么关系？',
  '怎样指导学生读出《我爱这土地》的重音和节奏？',
  '某项练习在教师用书中应当如何处理？'
];
const JOB_STAGES = ['文件检查', '读取教材页面信息', '读取页面文字与页面识别', '整理教材目录与章节', '建立教材目录', '核对搜索与页码', '可用于问答和三卡生成'];

async function uploadPdf(file, { documentType, title, extractionPolicy = 'auto' }) {
  if (!(file instanceof File)) throw new Error('pdf_file_required');
  return fetchJson(`${API}/documents/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Filename': encodeURIComponent(file.name),
      'X-Document-Type': documentType,
      'X-Document-Title': encodeURIComponent(title),
      'X-Extraction-Policy': extractionPolicy
    },
    body: file
  });
}
function ingestErrorMessage(code) {
  return ({
    pdf_file_required: '请先选择一个真实的 PDF 文件。',
    pdf_content_type_required: '上传内容必须是 PDF 文件。',
    invalid_pdf_signature: '文件内容不是有效的 PDF，请重新选择。',
    pdf_too_large: 'PDF 文件超过当前上传大小限制。',
    storage_not_configured: '生产存储尚未配置，原始教材无法安全保存。',
    storage_configuration_incomplete: '生产存储配置不完整，请联系部署人员。',
    storage_remote_unavailable: '原始教材存储暂时不可用，请稍后重试。',
    storage_remote_write_failed: '原始教材保存失败，请稍后重试。',
    stored_but_registration_failed: '原始教材已保存，但文档登记失败，请稍后重试。',
    document_id_missing: '文档登记成功，但未返回文档编号。',
    job_id_missing: '文档已登记，但未返回解析任务编号。',
    pdf_too_large_for_inline_index: '文件已保存，但超过当前在线处理大小；请使用较小文件，或先配置对象存储读取任务。',
    ocr_provider_not_configured: '已选择页面识别，但识别服务尚未部署。请先部署页面识别服务，再处理扫描 PDF。',
    ocr_unavailable: '页面识别服务暂时不可用，原始教材已保留；请稍后重试。',
    ocr_failed: '页面识别未完成，原始教材已保留；请检查页面后重试。',
    ocr_requires_pdf_ingest: '页面识别需要重新导入原始教材，不能复用旧的页面文字快照。',
    indexing_failed: '文件已保存，但索引没有完成；请查看任务状态后重试。'
  })[code] || code || '未知错误';
}
function cacheDraftForRecovery(userId, id, draft, cards = draft?.cards) {
  try { writeDraftRecovery(localStorage, userId, id, draft, cards); } catch {}
}
function readDraftRecovery(userId, id) {
  try { return readOwnedDraftRecovery(localStorage, userId, id); } catch { return null; }
}
function rememberAuthReturn(extra = {}) {
  saveAuthRecovery({ next: `${location.pathname}${location.search}`, ...extra, savedAt: new Date().toISOString() });
  return `/login/?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

function useAuthSession() {
  const [session, setSession] = useState(() => getSession());
  useEffect(() => subscribeAuth(setSession), []);
  return session;
}

function draftRecoverySnapshot(draft, cards = draft?.cards) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    draft: { ...draft, cards: undefined },
    cards: Array.isArray(cards) ? cards : Array.isArray(draft.cards) ? draft.cards : []
  };
}

function Sidebar({ active, open, close }) {
  const [docs, setDocs] = useState([]);
  useEffect(() => { request('/documents').then(data => setDocs((data.documents || []).map(normalizeCatalogItem).filter(Boolean))).catch(() => {}); }, []);
  const textbook = docs.find(item => item.documentType === 'textbook') || docs[0];
  const title = textbook?.title || '九年级语文上册';
  const shortTitle = title.replace(/^义务教育教科书\s*/, '').replace(/\s+上册.*$/, '上册');
  const totalPages = docs.reduce((sum, item) => sum + item.pageCount, 0);
  return <>{open && <button className="sidebar-scrim" aria-label="关闭导航" onClick={close}/>}<aside className={`sidebar ${open ? 'open' : ''}`}>
    <div className="sidebar-mobile-head"><Logo/><button onClick={close} aria-label="关闭导航"><X size={18}/></button></div><div className="desktop-logo"><Logo/></div>
    <div className="workspace-label">当前项目</div><a className="book-card" href="/library/"><div className="book-cover">九上<br/><span>语文</span></div><div><strong>{shortTitle}</strong><small>{docs.length ? `${docs.length} 份材料 · ${totalPages} 页` : '正在读取教材目录'}</small></div><ChevronRight size={16}/></a>
    <nav>{PRIMARY_NAV.map(([id, href, Icon, label]) => <a key={id} href={href} className={active === id ? 'active' : ''}><Icon size={18}/>{label}</a>)}</nav>
    <a className="sidebar-guide-link" href="/guide/"><Play size={16}/><span><b>第一次使用？</b><small>看一遍完整备课路径</small></span><ChevronRight size={14}/></a>
    <div className="sidebar-tool-groups">
      <details className="sidebar-tool-group" open={WORKFLOW_TOOL_NAV.some(([id]) => id === active)}><summary><span>课堂与教研工具</span><ChevronDown/></summary><div>{WORKFLOW_TOOL_NAV.map(([id, href, Icon, label]) => <a className={active === id ? 'active' : ''} href={href} key={id}><Icon/><span>{label}</span></a>)}</div></details>
      <details className="sidebar-tool-group" open={MATERIAL_NAV.some(([id]) => id === active)}><summary><span>教材导入与处理</span><ChevronDown/></summary><div>{MATERIAL_NAV.map(([id, href, Icon, label]) => <a className={active === id ? 'active' : ''} href={href} key={id}><Icon/><span>{label}</span></a>)}</div></details>
    </div>
    <div className="sidebar-foot"><ShieldCheck size={15}/><span>原始教材是唯一可核验的依据</span></div>
  </aside></>;
}
function Layout({ active, children }) {
  const [open, setOpen] = useState(false);
  const title = ROUTES.find(item => item[0] === active)?.[3] || '备课首页';
  const session = useAuthSession();
  const [aiState, setAiState] = useState('checking');
  useEffect(() => {
    let cancelled = false;
    rootRequest('/api/config').then(config => {
      if (cancelled) return;
      // Anonymous users can browse the public catalogue, but AI generation is
      // account-bound even when the system gateway is configured.
      const gatewayReady = Boolean(config.gatewayConfigured && config.textModelConfigured);
      setAiState(gatewayReady ? (session ? 'ready' : 'login') : session ? 'needs-key' : 'unavailable');
    }).catch(() => { if (!cancelled) setAiState('unavailable'); });
    return () => { cancelled = true; };
  }, [session?.user?.id, session?.access_token]);
  const aiLabel = aiState === 'ready' ? '系统 AI 可用' : aiState === 'needs-key' ? '需配置 AI 连接' : aiState === 'login' ? '需要登录后开始备课' : aiState === 'unavailable' ? 'AI 服务暂时不可用' : '正在检查 AI 服务';
  const currentDraftId = new URLSearchParams(location.search).get('draftId') || '';
  const askHref = currentDraftId ? `/ask/?draftId=${encodeURIComponent(currentDraftId)}` : '/ask/';
  return <div className="app-shell"><Sidebar active={active} open={open} close={() => setOpen(false)}/><main className="main-area"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu" onClick={() => setOpen(true)}><Menu/></button><span>活教参</span><ChevronRight/><b>{title}</b></div><div className="top-actions"><span className={`mode mode-${aiState}`} title="系统 AI 仅在后台调用"><i/>{aiLabel}</span>{session ? <><a href="/settings/">AI 设置</a><button className="text-action" onClick={async()=>{await signOut();location.reload();}}>退出</button></> : <a href="/login/">登录</a>}<a href={askHref}><MessageCircle/>{currentDraftId ? '本课问答' : '提问'}</a><a href="/ingest/"><Upload/>导入</a></div></header><div className="content">{children}</div></main></div>;
}

function normalizeCatalogItem(item) {
  if (!item || !item.id) return null;
  const rawType = String(item.documentType || item.type || '').trim().toLowerCase().replaceAll('_', '-').replace(/\s+/g, '-');
  const documentType = ['teacher-guide', 'teacher-guidebook', 'guide'].includes(rawType) || item.id === 'teacher-guide' ? 'teacher_guide' : ['textbook', 'student-textbook', 'student-book'].includes(rawType) || item.id === 'textbook' ? 'textbook' : ['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(rawType) || item.id === 'curriculum-standard' ? 'curriculum_standard' : rawType || 'other';
  return { ...item, id: String(item.id), documentType, title: item.title || item.originalFilename || String(item.id), short: item.short || item.shortTitle || (documentType === 'teacher_guide' ? '教师教学用书' : documentType === 'textbook' ? '学生教材' : documentType === 'curriculum_standard' ? '课程标准' : item.title || String(item.id)), pageCount: Number(item.pageCount || item.pages || 0), indexedPages: Number(item.indexedPages || item.indexed_pages || 0), pdfUrl: item.pdfUrl || '', issueCount: Number(item.issueCount || 0), visibility: item.visibility || 'public', tone: documentType === 'teacher_guide' ? 'blue' : documentType === 'textbook' ? 'orange' : documentType === 'curriculum_standard' ? 'standard' : 'green' };
}
function useCatalogDocument(documentId) {
  const [documents, setDocuments] = useState([]);
  useEffect(() => { request('/documents').then(data => setDocuments((data.documents || []).map(normalizeCatalogItem).filter(Boolean))).catch(() => {}); }, []);
  return documents.find(item => item.id === documentId) || null;
}
const GUIDANCE_STEPS = [
  ['选定篇目', '从教材目录或搜索结果打开课文起始页，先确认教材页码、书页和章节范围。'],
  ['核对课程标准', '找到学段要求、相关学习任务群和学业质量原页；篇目的具体对齐由教师确认。'],
  ['读教师用书', '优先查看教师用书中的教学目标、重点难点、活动顺序和参考处理。'],
  ['回到学生教材', '回到课文原页核对词句、任务和段落结构；原始教材始终是课堂核验的真源。'],
  ['连续追问', '围绕同一篇目继续追问，系统会保留本场对话、教材范围和已经核对过的页面。'],
  ['生成课堂材料', '把已经核对的内容整理成方案、三卡和渐进式板书，教师可以编辑、保存、锁定。']
];
function GuidancePage() {
  return <div className="view-stack guidance-page">
    <section className="hero compact-hero guidance-hero"><div><Badge tone="green"><Play/> 使用引导</Badge><h1>从选篇目开始，<br/><em>一步步把课备到课堂上</em></h1><p>这不是一次性生成教案。活教参会先定位篇目，再查看教师用书、核对学生教材，最后把已经确认的依据整理成可直接使用的课堂材料。</p><div className="hero-actions"><a className="primary" href="/library/"><Library/>先选一篇课文</a><a href="/ask/"><MessageCircle/>直接开始提问</a></div></div><div className="guidance-hero-mark"><span>01</span><b>选篇目</b><i/><span>02</span><b>看教师用书</b><i/><span>03</span><b>回原文</b></div></section>
    <section className="panel guidance-video-panel"><div className="guidance-video-intro"><Badge tone="gold">三分钟看懂</Badge><h2>一条备课路径，五个动作完成</h2><p>建议第一次使用时完整看一遍。以后从教材库进入某篇课文，就可以沿着同样的顺序继续。</p><div className="guidance-video-note"><CheckCircle2/><span><b>视频中的每一步都能在页面中直接完成</b><small>目录定位、教材原页核验、连续追问和课堂材料会沿用同一篇目。</small></span></div></div><div className="guidance-video-frame"><video controls playsInline preload="metadata" poster="/guidance/活教参备课引导封面.svg"><source src="/guidance/活教参备课引导.mp4" type="video/mp4"/><track kind="captions" src="/guidance/活教参备课引导.vtt" srcLang="zh-CN" label="中文字幕" default/>当前浏览器无法播放视频。</video><p>如果视频无法播放，可以直接查看下方的文字步骤。</p></div></section>
    <section className="guidance-steps panel"><header><div><Badge tone="blue">文字版路径</Badge><h2>每一步应该看什么、做什么</h2></div><span>从材料定位到课堂使用</span></header><div className="guidance-step-grid">{GUIDANCE_STEPS.map(([title, body], index) => <article key={title}><div className="guidance-step-number">0{index + 1}</div><div><h3>{title}</h3><p>{body}</p>{index === 0 && <a href="/library/">打开教材库 <ArrowRight/></a>}{index === 3 && <a href="/ask/">进入备课问答 <ArrowRight/></a>}{index === 4 && <a href="/ask/">继续追问并保存方案 <ArrowRight/></a>}{index === 5 && <a href="/ask/">生成本课课堂材料 <ArrowRight/></a>}</div></article>)}</div></section>
    <details className="panel guidance-checklist"><summary><span><ClipboardCheck/>第一次使用，可以按这张清单走</span><ChevronDown/></summary><div><p>选好篇目后，不必重复上传或重复构建；问答、引用、三卡和板书都读取已经准备好的教材。</p><ul>{['确认课文起始页和教师用书相关页', '先看教师用书的教学处理，再回到学生教材核对原文', '追问时沿用同一场对话，不要另开一个问题丢失上下文', '生成后先编辑，再保存和锁定需要带进课堂的内容'].map(item => <li key={item}><Check/>{item}</li>)}</ul></div></details>
    </div>;
}
const TASK_PHASE_META = {
  continue_preparation: { label: '备课', icon: MessageCircle, tone: 'prepare' },
  confirm_plan: { label: '定稿', icon: CheckCircle2, tone: 'finalize' },
  generate_cards: { label: '成课', icon: Layers3, tone: 'finalize' },
  enter_classroom: { label: '课堂', icon: Play, tone: 'classroom' },
  confirm_reflection: { label: '课后', icon: History, tone: 'reflect' },
  process_homework_return: { label: '回流', icon: ClipboardCheck, tone: 'reflect' },
  continue_next_lesson: { label: '接力', icon: Network, tone: 'relay' },
  completed: { label: '完成', icon: Check, tone: 'complete' }
};

function Dashboard() {
  const session = useAuthSession();
  const [docs, setDocs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [classProfiles, setClassProfiles] = useState([]);
  const [taskBusy, setTaskBusy] = useState(Boolean(session));
  const [taskError, setTaskError] = useState('');
  useEffect(() => { request('/documents').then(data => setDocs((data.documents || []).map(normalizeCatalogItem).filter(Boolean))).catch(() => {}); }, []);
  const loadTasks = () => {
    if (!session?.user?.id) { setTasks([]); setClassProfiles([]); setTaskBusy(false); setTaskError(''); return; }
    // Account-owned state disappears before the new account request starts;
    // never flash the previous teacher's class summary during a session change.
    setTasks([]); setClassProfiles([]);
    setTaskBusy(true); setTaskError('');
    Promise.all([
      rootRequest('/api/drafts/tasks'),
      rootRequest('/api/drafts/class-profiles').catch(() => ({ profiles: [] }))
    ]).then(([data, classData]) => {
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setClassProfiles(Array.isArray(classData.profiles) ? classData.profiles : []);
    })
      .catch(() => { setTasks([]); setClassProfiles([]); setTaskError('个人教学任务暂时没有读取完整。教材仍可正常浏览，请稍后重试。'); })
      .finally(() => setTaskBusy(false));
  };
  useEffect(loadTasks, [session?.user?.id]);
  const totalPages = docs.reduce((sum, item) => sum + item.pageCount, 0);
  const ready = docs.filter(item => item.indexStatus === 'ready' || item.indexStatus === 'partial').length;
  const pending = tasks.filter(item => item.phase !== 'completed');
  const completed = tasks.filter(item => item.phase === 'completed').slice(0, 3);
  const lead = pending[0] || null;
  const afterClassCount = pending.filter(item => ['confirm_reflection', 'process_homework_return', 'continue_next_lesson'].includes(item.phase)).length;
  const LeadIcon = lead ? (TASK_PHASE_META[lead.phase]?.icon || Route) : CheckCircle2;
  return <div className="view-stack teaching-flow-page"><section className="hero teaching-flow-hero"><div><Badge tone="green"><Route/> 班级接续</Badge><h1>{lead ? <>不用重新找入口，<br/><em>也不用重新回忆班情</em></> : <>从教材开始，<br/><em>把一节课完整带到课后</em></>}</h1><p>{lead ? '系统只读取账号中教师已经确认的课堂事实与班级聚合结果，帮助下一次备课接住真实学情；不会建立学生个人画像。' : '选择篇目和任教班级后，备课、上课、复盘与下一课会沿着同一条教学记录继续。'}</p><div className="hero-actions">{lead ? <a className="primary" href={lead.href || `/ask/?draftId=${encodeURIComponent(lead.draftId || '')}`}><LeadIcon/>{lead.actionLabel || '继续当前教学任务'}</a> : <a className="primary" href="/library/"><Library/>先选一篇教材</a>}<a href="/ask/"><MessageCircle/>开始新的备课</a><a href="/unit/"><Network/>查看单元接力</a></div></div><div className="teaching-flow-summary" aria-label="当前教学任务概况"><div><strong>{pending.length}</strong><span>待继续</span></div><i/><div><strong>{classProfiles.length}</strong><span>已接续班级</span></div><i/><div><strong>{afterClassCount}</strong><span>课后处理</span></div></div></section>
    {!session ? <section className="panel teaching-flow-login"><ShieldCheck/><div><span>登录后显示个人任务</span><h2>教材可以直接阅读，个人教学进度只在自己的账号中出现</h2><p>登录后，这里会根据真实方案状态告诉你下一步应该继续备课、进入课堂，还是完成课后复盘。</p></div><a className="primary" href={`/login/?next=${encodeURIComponent('/')}`}>登录并继续</a></section> : taskError ? <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>个人教学任务暂时没有读取完整</b><p>{taskError}</p></div><div className="cards-alert-actions"><button type="button" onClick={loadTasks}><RefreshCw/>重新读取</button><a href="/library/">先看教材</a></div></section> : null}
    <div className="teaching-flow-layout"><section className="panel teaching-task-panel"><header><div><span>现在应该做什么</span><h2>{taskBusy ? '正在整理最近的教学进度' : pending.length ? `${pending.length} 项工作等待继续` : '当前没有未完成的教学任务'}</h2><p>每份方案只显示一个最关键的下一步，避免同一节课出现一排互相竞争的按钮。</p></div>{session && !taskBusy && <button type="button" onClick={loadTasks}><RefreshCw/>刷新状态</button>}</header>{taskBusy ? <div className="teaching-task-loading"><Activity/><b>正在读取你的方案状态…</b><small>不会修改任何方案或课堂记录。</small></div> : pending.length ? <ol className="teaching-task-list">{pending.slice(0, 8).map((task, index) => { const meta = TASK_PHASE_META[task.phase] || TASK_PHASE_META.continue_preparation; const TaskIcon = meta.icon; return <li className={index === 0 ? 'lead' : ''} data-phase={meta.tone} key={`${task.draftId}-${task.phase}`}><div className="teaching-task-number">{String(index + 1).padStart(2, '0')}</div><div className="teaching-task-copy"><span><TaskIcon/>{meta.label}</span><h3>{task.title || task.lessonTitle || '未命名方案'}</h3><p>{task.description || '继续完善当前教学方案。'}</p><small>{task.lessonTitle || '当前方案'}{task.updatedAt ? ` · 最近更新 ${new Date(task.updatedAt).toLocaleDateString('zh-CN')}` : ''}</small></div><a className={index === 0 ? 'primary' : ''} href={task.href || `/ask/?draftId=${encodeURIComponent(task.draftId || '')}`}>{task.actionLabel || '继续处理'}<ArrowRight/></a></li>; })}</ol> : <div className="teaching-task-empty"><CheckCircle2/><h3>{session ? '最近的教学任务已经处理完' : '登录后，这里会接住你的上次进度'}</h3><p>{session ? '可以开始新的篇目，或者从单元接力中查看下一篇课文。' : '公共教材仍可直接浏览；登录不会改变教材内容。'}</p><div>{session ? <><a className="primary" href="/library/">选择新篇目</a><a href="/unit/">查看单元轨道</a></> : <a className="primary" href="/login/?next=%2F">登录查看任务</a>}</div></div>}</section>
      <aside className="teaching-material-rail"><section className="panel"><header><span>教材起点</span><h2>需要重新找材料时，从原页开始</h2><p>教学任务来自个人方案；教材目录与教材页码仍由后台材料库提供。</p></header><div className="teaching-material-list">{docs.length ? docs.slice(0, 3).map(doc => <a href={`/library/?doc=${encodeURIComponent(doc.id)}`} key={doc.id}><span className={`doc-icon ${doc.tone}`}><FileText/></span><div><b>{doc.short || doc.title}</b><small>{doc.pageCount} 页 · {statusLabel(doc.indexStatus)}</small></div><ChevronRight/></a>) : <div className="teaching-material-loading"><Activity/>正在读取教材目录…</div>}</div><footer><span>{totalPages ? `${docs.length} 份材料 · ${totalPages} 个教材页码` : '教材目录正在准备'}</span><a href="/library/">打开教材库 <ArrowRight/></a></footer></section>{classProfiles.length > 0 && <section className="panel class-continuity-panel"><header><span>班级接续</span><h2>下一次备课，不从空白班情开始</h2><p>只汇总教师确认的班级事实，不保存学生姓名与逐人表现。</p></header><div>{classProfiles.slice(0, 3).map(profile => <a href={`/ask/?new=1&className=${encodeURIComponent(profile.className)}`} key={profile.className}><span><b>{profile.className}</b><small>{profile.lessonCount} 节记录 · 最近 {profile.latestLessonTitle || '课堂复盘'}</small><p>{profile.nextFocus || profile.confirmedObservation || '选择这个班级继续备课。'}</p></span><ArrowRight/></a>)}</div></section>}{completed.length > 0 && <section className="panel teaching-completed"><header><span>最近完成</span><h2>这些课程已经留下完整记录</h2></header>{completed.map(item => <a href={item.href} key={item.draftId}><CheckCircle2/><span><b>{item.lessonTitle || item.title}</b><small>{item.description}</small></span><ArrowRight/></a>)}</section>}</aside></div>
  </div>;
}
function Unit() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const [tree, setTree] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const unitLoadRef = useRef(0);
  const requestedUnit = params.get('unit') || '';
  const [selectedUnitId, setSelectedUnitId] = useState(requestedUnit);
  const units = useMemo(() => unitNodes(tree), [tree]);
  const selectedUnit = units.find(item => String(item.id) === String(selectedUnitId))
    || units.find(item => stableNodeId(item.id) === stableNodeId(selectedUnitId))
    || units[0] || null;
  const track = useMemo(() => buildUnitTrack(selectedUnit || {}, drafts, assets), [selectedUnit, drafts, assets]);
  const insight = useMemo(() => unitTrackInsights(track), [track]);

  const load = async () => {
    const loadId = ++unitLoadRef.current;
    setBusy(true); setError('');
    // Personal progress must disappear immediately when the account changes;
    // never leave the previous account's lesson status visible during retry.
    setDrafts([]); setAssets([]);
    try {
      const treeData = await request('/documents/textbook/tree');
      if (loadId !== unitLoadRef.current) return;
      setTree(normalizeTree(treeData));
      if (session?.user?.id) {
        const [draftData, assetData] = await Promise.all([rootRequest('/api/drafts'), rootRequest('/api/assets')]);
        if (loadId !== unitLoadRef.current) return;
        setDrafts(draftData.drafts || []);
        setAssets(assetData.assets || []);
      } else {
        setDrafts([]); setAssets([]);
      }
    } catch {
      if (loadId !== unitLoadRef.current) return;
      setError('单元目录暂时没有读取完整，请稍后重试。');
    } finally { if (loadId === unitLoadRef.current) setBusy(false); }
  };
  useEffect(() => {
    load();
    return () => { unitLoadRef.current += 1; };
  }, [session?.user?.id]);
  useEffect(() => {
    if (!selectedUnit?.id || String(selectedUnit.id) === String(selectedUnitId)) return;
    setSelectedUnitId(String(selectedUnit.id));
    const url = new URL(location.href);
    url.searchParams.set('unit', String(selectedUnit.id));
    history.replaceState(null, '', url);
  }, [selectedUnit?.id, selectedUnitId]);

  const selectUnit = id => {
    const url = new URL(location.href);
    url.searchParams.set('unit', id);
    history.replaceState(null, '', url);
    setSelectedUnitId(id);
  };
  const unitRefQuery = (unit, lesson) => new URLSearchParams({
    q: `怎样备课《${lesson.title}》？请说明它在${unit.title}中的承接作用。`,
    scope: 'both',
    doc: unit.documentId || 'textbook',
    page: String(lesson.startPage),
    node: lesson.nodeId,
    lesson: lesson.title,
    unit: unit.id,
    unitTitle: unit.title,
    unitStart: String(unit.pageRange?.start || ''),
    unitEnd: String(unit.pageRange?.end || ''),
    lessonIndex: String(lesson.index),
    lessonTotal: String(lesson.total)
  }).toString();
  const statusMeta = status => ({
    not_started: ['尚未开始', 'neutral'],
    draft: ['备课中', 'orange'],
    ready: ['待上课', 'blue'],
    in_class: ['课堂进行中', 'gold'],
    recorded: ['待确认复盘', 'purple'],
    reflected: ['已复盘', 'green']
  })[status] || ['尚未开始', 'neutral'];
  const lessonAction = lesson => {
    if (!lesson?.draft) return { href: `/ask/?${unitRefQuery(selectedUnit, lesson)}`, label: '开始当前课' };
    const id = encodeURIComponent(lesson.draft.id);
    if (lesson.status === 'in_class') return { href: `/cards/?draftId=${id}&classroom=1`, label: '继续本节课堂' };
    if (lesson.status === 'recorded') return { href: `/reflection/?draftId=${id}`, label: '确认课后复盘' };
    if (lesson.status === 'ready') return { href: `/cards/?draftId=${id}`, label: '开始上课' };
    return { href: `/ask/?draftId=${id}`, label: lesson.status === 'reflected' ? '查看本课记录' : '继续当前课' };
  };

  return <div className="view-stack unit-relay-page">
    <section className="hero compact-hero unit-relay-hero"><div><Badge tone="gold"><Network/> 从教材问题到真实学情</Badge><h1>不只记录课堂感受，<br/><em>还要让作业结果改变下一次备课</em></h1><p>课前预演问题，课堂保留事实，课后按同一问题汇总班级作业达成。下一次备课先承接教师确认的学情，再重新核验当前教材与教师用书。</p><div className="hero-actions"><a className="primary" href="/library/"><Library/>回教材库核对目录</a>{insight.current && <a href={lessonAction(insight.current).href}><ArrowRight/>{session ? lessonAction(insight.current).label : '浏览本单元第一课'}</a>}</div></div><div className="unit-relay-summary"><strong>{insight.reflected}<small>已复盘</small></strong><i/><strong>{insight.ready}<small>已形成方案</small></strong><i/><strong>{insight.total}<small>篇课文</small></strong></div></section>

    {error && <section className="ask-error"><CircleAlert/><span>{error}</span><button type="button" onClick={load}>重新读取</button></section>}
    <section className="panel unit-picker"><div><span>选择单元</span><b>{selectedUnit?.title || '正在读取教材目录'}</b></div><label><span className="sr-only">选择单元</span><select value={selectedUnit?.id || ''} onChange={event => selectUnit(event.target.value)} disabled={!units.length}>{units.map(unit => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</select></label>{selectedUnit && <a href={buildReaderHref({ documentId: selectedUnit.documentId || 'textbook', page: selectedUnit.pageRange?.start || 1, lessonTitle: selectedUnit.title, returnTo: currentPageReturn() })}>核验单元起始页 <ExternalLink/></a>}</section>

    {busy ? <section className="panel unit-relay-loading"><Activity/><h2>正在整理单元轨道</h2><p>篇目顺序来自学生教材目录，个人进度来自账号中的备课方案。</p></section> : selectedUnit && <div className="unit-relay-layout">
      <section className="panel unit-track-panel"><SectionHead icon={Route} eyebrow="本单元课程轨道" title="每一课都保留自己的依据和成果" note="活动任务、写作和综合实践仍可在教材目录查看；轨道先呈现正式篇目。"/><div className="unit-track-list">{track.map((lesson, index) => { const [statusLabelText, tone] = statusMeta(lesson.status); const isCurrent = insight.current?.nodeId === lesson.nodeId; const reflection = lesson.asset?.reflection; const action = lessonAction(lesson); return <article className={`${isCurrent ? 'current' : ''} ${lesson.status}`} key={lesson.nodeId}><div className="unit-track-marker"><span>{String(index + 1).padStart(2, '0')}</span><i/></div><div className="unit-track-copy"><header><div><Badge tone={tone}>{statusLabelText}</Badge><h2>{lesson.title}</h2><p>学生教材 第 {lesson.startPage}{lesson.endPage !== lesson.startPage ? `—${lesson.endPage}` : ''} 页</p></div><span className="unit-track-role">{index === 0 ? '建立方法' : index === track.length - 1 ? '整合迁移' : '继续深化'}</span></header>{reflection && <div className="unit-track-reflection"><History/><span><b>上一课已经留下课堂记录</b><small>{reflection.unresolvedLearning || reflection.observedLearning || reflection.nextLessonAdjustment}</small></span></div>}<footer><a href={buildReaderHref({ documentId: selectedUnit?.documentId || 'textbook', page: lesson.startPage, nodeId: lesson.nodeId, lessonTitle: lesson.title, returnTo: currentPageReturn() })}>核验原页</a>{lesson.draft ? <><a href={`/ask/?draftId=${encodeURIComponent(lesson.draft.id)}`}>继续备课</a><a className={['in_class','recorded','ready'].includes(lesson.status) ? 'primary' : ''} href={action.href}>{action.label}</a>{lesson.asset?.hasReflection && <a href={`/reflection/?draftId=${encodeURIComponent(lesson.draft.id)}`}>查看复盘</a>}</> : <a className="primary" href={action.href}>从这一课开始 <ArrowRight/></a>}</footer></div></article>; })}</div></section>

      <aside className="panel unit-continuity-ledger"><SectionHead icon={Network} eyebrow="连续性账本" title="现在要接住什么" note="课堂事实和教材依据严格分开。"/>{insight.current ? <><div className="continuity-step previous"><span>承接上一课</span><b>{track[insight.currentIndex - 1]?.title || '这是本单元的起点'}</b><p>{track[insight.currentIndex - 1]?.asset?.reflection?.unresolvedLearning || '还没有上一课复盘。第一课先建立本单元共同的阅读方法。'}</p></div><div className="continuity-arrow"><ArrowRight/></div><div className="continuity-step current"><span>当前要完成</span><b>{insight.current.title}</b><p>{insight.current.status === 'in_class' ? '课堂已经开始，继续记录学生真正说出的关键词和仍需追问的环节。' : insight.current.status === 'recorded' ? '现场记录已经整理好，请教师核对并保存为正式课后复盘。' : insight.current.draft ? '已有备课记录，继续核对依据、完善方案或进入课堂设计。' : '先从教师用书确定教学处理，再回到学生教材核对本课原文。'}</p></div><div className="continuity-arrow"><ArrowRight/></div><div className="continuity-step next"><span>带往下一课</span><b>{insight.next?.title || '完成本单元整合'}</b><p>课后只记录学生已经做到什么、还没做到什么，以及下一课需要优先调整什么。</p></div><a className="primary continuity-primary" href={lessonAction(insight.current).href}>{lessonAction(insight.current).label} <ArrowRight/></a></> : <div className="index-empty"><CheckCircle2/><b>本单元轨道已经完成</b><p>可以回看各课复盘，整理单元学习成果。</p></div>}{!session && <div className="unit-login-note"><ShieldCheck/><p>教材轨道可以直接浏览；登录后才会显示个人备课进度和课后学情。</p><a href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>登录并继续</a></div>}</aside>
    </div>}
  </div>;
}

const CARD_EDIT_GUIDANCE = {
  board: '建议写成“关键词 → 关系或结论”，并标明教师先写什么、学生回答后再补什么，让板书可以边问边展开。',
  question: '建议写清“回到哪一处原文 + 观察什么 + 为什么追问”，问题要能直接带学生找到词句、意象或结构。',
  assessment: '建议写清“学生完成什么任务 + 使用哪处教材依据 + 达到什么可观察表现”，不要只停留在“能否……”的判断。'
};
function SvgLabel({ x, y, text, className = 'board-svg-label', max = 13, anchor = 'middle' }) {
  return <text x={x} y={y} textAnchor={anchor} className={className}>{wrapSvgText(text, max).map((line, index) => <tspan x={x} dy={index ? 21 : 0} key={`${line}-${index}`}>{line}</tspan>)}</text>;
}
function MindMapBoard({ title, items = [], stage = 1, filterId = 'chalkGlow', coreQuestion = '', classroomRun = null, showWriteOrder = false }) {
  const cleanItems = items.filter(item => String(item?.text || '').trim()).slice(0, 9).map((item, index) => ({ ...item, writeOrder: index + 1, label: item.label || boardLabelFromText(item.text, '待补写') }));
  const branches = [
    { title: '文本结构', x: 260, y: 330, color: 'gold', anchor: 'middle', side: 'left' },
    { title: '语言证据', x: 700, y: 330, color: 'mint', anchor: 'middle', side: 'middle' },
    { title: '情感主旨', x: 1140, y: 330, color: 'lavender', anchor: 'middle', side: 'right' }
  ];
  const grouped = branches.map((branch, index) => ({ ...branch, items: cleanItems.filter((_, itemIndex) => itemIndex % branches.length === index) }));
  const visibleBranches = grouped.filter(branch => branch.items.length > 0);
  const leafPosition = (branch, index) => {
    const offsets = [-82, 82, 0];
    const x = branch.x + offsets[index % offsets.length];
    return { x, y: 465 + Math.floor(index / offsets.length) * 78, anchor: 'middle' };
  };
  const safeTitle = boardLabelFromText(title, '课堂板书');
  const safeQuestion = boardQuestion(coreQuestion, safeTitle);
  const conclusion = cleanItems.length ? boardLabelFromText(cleanItems[cleanItems.length - 1].text, '课堂归纳') : '课堂归纳：________';
  const liveRun = classroomRun ? normalizeClassroomRun(classroomRun) : null;
  const liveKeywords = liveRun?.keywords?.map(item => item.text).filter(Boolean) || [];
  const followupStages = liveRun?.stages?.filter(item => item.outcome === 'needs_followup').map(item => CLASSROOM_STAGE_LABELS[item.stage - 1]) || [];
  return <svg className="board-map" viewBox="0 0 1400 820" role="img" aria-label="可逐步书写的课堂板书">
    <defs><filter id={filterId}><feGaussianBlur stdDeviation="1.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <rect width="1400" height="820" rx="4" className="board-map-surface"/>
    <path d="M56 78 C360 38 520 92 700 60 S1060 40 1344 78" className="board-map-wipe"/>
    {stage >= 2 && visibleBranches.map(branch => <path key={`center-${branch.title}`} d={`M700 220 Q${branch.x} 260 ${branch.x} ${branch.y - 30}`} className={`board-map-connector ${branch.color}`} filter={`url(#${filterId})`}/>) }
    {stage >= 3 && visibleBranches.map(branch => branch.items.map((item, index) => { const pos = leafPosition(branch, index); return <path key={`line-${item.id}`} d={`M${branch.x} ${branch.y + 25} Q${pos.x} ${pos.y - 60} ${pos.x} ${pos.y - 20}`} className={`board-map-connector leaf ${branch.color}`} filter={`url(#${filterId})`}/>; }))}
    {stage >= 1 && <g className="board-map-core" filter={`url(#${filterId})`}><rect x="470" y="105" width="460" height="120" rx="18"/><SvgLabel x={700} y={152} text={safeTitle} className="board-map-core-title" max={18}/><SvgLabel x={700} y={194} text={safeQuestion} className="board-map-core-prompt" max={28}/></g>}
    {stage >= 2 && visibleBranches.map(branch => <g className={`board-map-branch ${branch.color}`} key={branch.title}><rect x={branch.x - 100} y={branch.y - 28} width="200" height="56" rx="16"/><SvgLabel x={branch.x} y={branch.y + 7} text={branch.title} className="board-map-branch-label" max={8}/></g>)}
    {stage >= 2 && !visibleBranches.length && <text x="700" y="360" textAnchor="middle" className="board-map-empty-hint">板书卡暂无要点，请先在课堂设计中整理关键词。</text>}
    {stage >= 3 && visibleBranches.map(branch => branch.items.map((item, index) => { const pos = leafPosition(branch, index); return <g className={`board-map-leaf ${branch.color}`} key={`leaf-${item.id}`}><rect x={pos.x - 92} y={pos.y - 25} width="184" height="58" rx="12"/><SvgLabel x={pos.x} y={pos.y + 4} text={item.label} className="board-map-leaf-label" max={12}/>{showWriteOrder && <g className="board-write-order"><circle cx={pos.x - 78} cy={pos.y - 15} r="15"/><text x={pos.x - 78} y={pos.y - 10} textAnchor="middle">{item.writeOrder}</text></g>}</g>; }))}
    {stage >= 4 && <g className="board-map-conclusion"><rect x="480" y="635" width="440" height="64" rx="14"/><SvgLabel x={700} y="674" text={`课堂归纳：${conclusion}`} className="board-map-conclusion-label" max={24}/></g>}
    {stage >= 5 && <g className="board-map-blanks"><rect x="80" y="700" width="330" height="82" rx="12"/><SvgLabel x={245} y="733" text="学生关键词" className="board-map-blank-label" max={12}/><SvgLabel x={245} y="765" text={liveKeywords.length ? liveKeywords.join(' · ') : '________________'} className="board-map-blank-line" max={18}/><rect x="990" y="700" width="330" height="82" rx="12"/><SvgLabel x={1155} y="733" text="仍需追问" className="board-map-blank-label" max={12}/><SvgLabel x={1155} y="765" text={followupStages.length ? followupStages.join(' · ') : '________________'} className="board-map-blank-line" max={18}/></g>}
  </svg>;
}
function CardSourceList({ citations = [], refs = [], returnTo = 'cards' }) {
  const items = uniqueCitations(citations, refs);
  if (!items.length) return <span className="card-source-empty">尚未绑定教材依据</span>;
  const first = items[0];
  const rest = items.slice(1);
  const chip = item => { const href = citationLink(item, returnTo); return href ? <a href={href} key={String(item.documentId) + '-' + citationPage(item)}><Quote size={12}/>{docName(item.documentId)} · 第 {citationPage(item)}页</a> : null; };
  return <div className="card-source-list"><span className="card-source-label">教材依据</span>{chip(first)}{rest.length > 0 && <details><summary>另有 {rest.length} 个依据</summary><div>{rest.map(chip)}</div></details>}</div>;
}
function sourceTypeLabel(type) {
  return ({ textbook: '学生教材支持', 'teacher-guide': '教师用书支持', teacher_guide: '教师用书支持', 'curriculum-standard': '课程标准支持', curriculum_standard: '课程标准支持', combined: '三类材料综合', suggestion: '系统教学建议', insufficient: '依据不足' }[type] || '教材依据');
}
function classroomRecoveryKey(userId, draftId) { return `huojiaocan:classroom:${userId}:${draftId}`; }
function readClassroomRecovery(userId, draftId) {
  if (!userId || !draftId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(classroomRecoveryKey(userId, draftId)) || 'null');
    return value?.userId === userId && value?.draftId === draftId ? {
      baseVersion: Number(value.baseVersion || value.version || 0),
      baseRun: normalizeClassroomRun(value.baseRun || {}),
      classroomRun: normalizeClassroomRun(value.classroomRun || {})
    } : null;
  } catch { return null; }
}
function writeClassroomRecovery(userId, draftId, version, classroomRun, baseRun = {}) {
  if (!userId || !draftId || !version) return;
  try { localStorage.setItem(classroomRecoveryKey(userId, draftId), JSON.stringify({ userId, draftId, baseVersion: version, baseRun: normalizeClassroomRun(baseRun), classroomRun: normalizeClassroomRun(classroomRun) })); } catch {}
}
function clearClassroomRecovery(userId, draftId) {
  try { localStorage.removeItem(classroomRecoveryKey(userId, draftId)); } catch {}
}

function TeachingBrief({ brief }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState('');
  if (!brief) return null;
  const current = brief.sections[active] || brief.sections[0];
  const coverageCopy = brief.sourceCoverage === 'three-source'
    ? '课程标准、学生教材与教师用书均有页级依据'
    : brief.sourceCoverage === 'balanced' ? '学生教材与教师用书均有页级依据，仍需核对课标'
    : brief.sourceCoverage === 'textbook-only' ? '已核对学生教材，仍需补充教师用书'
      : brief.sourceCoverage === 'guide-only' ? '已核对教师用书，仍需补充学生教材' : brief.sourceCoverage === 'standard-only' ? '已核对课程标准，仍需回到学生教材与教师用书' : '尚未绑定可核验的原始页面';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.markdown);
      setNotice('完整说课简报已复制。');
    } catch { setNotice('浏览器没有允许复制，可以改用下载。'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([brief.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = brief.filename; link.click();
    URL.revokeObjectURL(url);
    setNotice('说课简报已下载。');
  };
  return <section className={`teaching-brief panel${open ? ' open' : ''}`}>
    <header className="teaching-brief-head">
      <div><Badge tone="green"><Quote/> 教研说课简报</Badge><h2>把“这节课怎么上”，说清成一条有依据的教学逻辑</h2><p>不再重复朗读整份方案。简报只提取课情、核心问题、课堂路径、学习表现和原始页码，用于集体备课或课前说课。</p></div>
      <div className="teaching-brief-metrics"><span><b>{brief.sections.length}</b><small>段说课逻辑</small></span><span><b>{brief.characterCount}</b><small>字口头内容</small></span><span><b>约 {brief.estimatedMinutes}</b><small>分钟说完</small></span></div>
    </header>
    <div className="teaching-brief-source"><ShieldCheck/><span><b>{coverageCopy}</b><small>学生教材 {brief.textbookCount} 页 · 教师用书 {brief.guideCount} 页。页码只来自当前草稿的教材依据。</small></span></div>
    <div className="teaching-brief-actions"><button type="button" className="primary" onClick={() => setOpen(value => !value)}><Play/>{open ? '收起说课演练' : '开始说课演练'}</button><button type="button" onClick={copy}><ClipboardCheck/>复制完整简报</button><button type="button" onClick={download}><Download/>下载 Markdown</button>{notice && <span role="status">{notice}</span>}</div>
    {open && <div className="teaching-brief-stage">
      <nav aria-label="说课简报阶段">{brief.sections.map((section, index) => <button type="button" className={active === index ? 'active' : ''} onClick={() => setActive(index)} key={section.id}><span>0{section.order}</span><b>{section.title}</b><small>{section.cue}</small></button>)}</nav>
      <article><span>当前讲述 · 0{current.order}</span><h3>{current.title}</h3><p className="teaching-brief-cue">{current.cue}</p><ol>{current.lines.map((line, index) => <li key={`${current.id}-${index}`}><i>{index + 1}</i><p>{line}</p></li>)}</ol><footer><button type="button" onClick={() => setActive(value => Math.max(0, value - 1))} disabled={active === 0}><ArrowLeft/>上一段</button><small>只讲已确认的内容；班情判断和课堂取舍由教师口头补充。</small><button type="button" className="primary" onClick={() => setActive(value => Math.min(brief.sections.length - 1, value + 1))} disabled={active === brief.sections.length - 1}>下一段<ArrowRight/></button></footer></article>
    </div>}
  </section>;
}

function TeachingEvidenceChain({ chain, returnTo = 'cards' }) {
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  if (!chain) return null;
  const visible = filter === 'complete' ? chain.paths.filter(path => path.complete)
    : filter === 'gap' ? chain.paths.filter(path => !path.complete) : chain.paths;
  const copy = async () => {
    try { await navigator.clipboard.writeText(chain.markdown); setNotice('教学证据链已复制。'); }
    catch { setNotice('浏览器没有允许复制，可以改用下载。'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([chain.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = chain.filename; link.click(); URL.revokeObjectURL(url);
    setNotice('教学证据链已下载。');
  };
  return <section className="teaching-evidence-chain panel">
    <header className="evidence-chain-head"><div><Badge tone="blue"><Network/> 教学证据链</Badge><h2>每一页教材依据，最后带出了什么课堂行动？</h2><p>按原始教材页码聚合板书、问题和评价。可以一眼看出哪些课堂内容已有依据，哪些还没有连到可观察的学习表现。</p></div><div className={`evidence-chain-score ${chain.status}`}><b>{chain.linkedPercent}<small>%</small></b><span>三卡内容已绑定原页</span><em>{chain.completePaths} 条完整链路</em></div></header>
    <div className="evidence-chain-toolbar"><div role="group" aria-label="筛选教学证据链"><button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部原页 <span>{chain.paths.length}</span></button><button type="button" className={filter === 'complete' ? 'active' : ''} onClick={() => setFilter('complete')}>问题与评价已连接 <span>{chain.completePaths}</span></button><button type="button" className={filter === 'gap' ? 'active' : ''} onClick={() => setFilter('gap')}>待补链路 <span>{chain.paths.length - chain.completePaths}</span></button></div><div><button type="button" onClick={copy}><ClipboardCheck/>复制证据链</button><button type="button" onClick={download}><Download/>下载</button></div></div>
    {notice && <p className="evidence-chain-notice" role="status">{notice}</p>}
    {visible.length ? <div className="evidence-chain-paths">{visible.slice(0, 8).map((path, index) => <article className={path.complete ? 'complete' : 'incomplete'} key={path.id}>
      <div className="evidence-chain-source"><span>0{index + 1}</span><div><small>{path.source.documentId === 'textbook' ? '学生教材' : path.source.documentId === 'teacher-guide' ? '教师用书' : path.source.documentId === 'curriculum-standard' ? '课程标准' : '教学资料'}</small><b>第 {path.source.pdfPage} 页</b><p>{path.source.title || path.source.sectionPath?.join(' › ') || '已定位原始页面'}</p></div><a href={citationLink(path.source, returnTo)}>打开原页 <ExternalLink/></a></div>
      <div className="evidence-chain-flow"><div><span>板书落点</span>{path.board.length ? path.board.slice(0, 2).map(item => <p key={item}>{item}</p>) : <p className="empty">本页暂未连到板书</p>}</div><ArrowRight/><div><span>课堂问题</span>{path.questions.length ? path.questions.slice(0, 2).map(item => <p key={item}>{item}</p>) : <p className="empty">本页还没有直接问题</p>}</div><ArrowRight/><div><span>学习表现</span>{path.assessments.length ? path.assessments.slice(0, 2).map(item => <p key={item}>{item}</p>) : <p className="empty">还没有可观察的评价表现</p>}</div></div>
      <footer><Badge tone={path.complete ? 'green' : 'orange'}>{path.complete ? '问题与评价已连接' : '仍需教师补齐'}</Badge><small>共同页码只表示显式引用关系，不自动代表因果。</small></footer>
    </article>)}</div> : <div className="evidence-chain-empty"><FileSearch/><b>当前筛选下没有可展示的链路</b><p>可以切换到“全部原页”，或先在三卡中补充教材依据。</p></div>}
    {chain.missingItems.length > 0 && <details className="evidence-chain-missing"><summary>还有 {chain.missingItems.length} 项内容没有页级依据</summary><ul>{chain.missingItems.map(item => <li key={item.id}><b>{item.cardTitle || '课堂卡片'}</b><span>{item.text}</span></li>)}</ul></details>}
  </section>;
}

function PeriodPlanner({ draft, onSaved }) {
  const periods = Math.max(1, Math.min(4, Number(draft?.lesson_context?.periods || draft?.lessonContext?.periods || 1) || 1));
  const periodMinutes = Math.max(35, Math.min(60, Number(draft?.lesson_context?.periodMinutes || draft?.lessonContext?.periodMinutes || 45) || 45));
  const lessonPlan = Array.isArray(draft?.answer?.lessonPlan) ? draft.answer.lessonPlan : [];
  const [plan, setPlan] = useState(() => buildPeriodPlan({ periods, periodMinutes, lessonPlan, existing: draft?.answer?.periodPlan }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setPlan(buildPeriodPlan({ periods, periodMinutes, lessonPlan, existing: draft?.answer?.periodPlan }));
    setDirty(false); setNotice(''); setError('');
  }, [draft?.id, draft?.version, periods, periodMinutes, draft?.answer?.periodPlan]);
  const update = (activityId, patch) => {
    setPlan(current => updatePeriodActivity(current, activityId, patch));
    setDirty(true); setNotice(''); setError('');
  };
  const reorder = (activityId, direction) => {
    setPlan(current => reorderPeriodActivity(current, activityId, direction));
    setDirty(true); setNotice(''); setError('');
  };
  const repairSequence = () => {
    setPlan(current => repairPeriodSequence(current));
    setDirty(true); setNotice('已按阅读教学的前置关系重新排列，请再核对教师用书中的具体建议。'); setError('');
  };
  const statusLabel = period => {
    if (period.status === 'over') return `超出 ${Math.abs(period.remainingMinutes)} 分钟`;
    if (period.status === 'sparse') return `主线偏少 · 余 ${period.remainingMinutes} 分钟`;
    if (period.status === 'tight') return period.remainingMinutes > 0 ? `安排较满 · 余 ${period.remainingMinutes} 分钟` : '安排较满 · 无机动时间';
    return `预留 ${period.remainingMinutes} 分钟回应与机动`;
  };
  const sparsePeriods = plan.periodSummaries.filter(period => period.status === 'sparse');
  const overPeriods = plan.periodSummaries.filter(period => period.status === 'over');
  const save = async () => {
    if (!draft?.id || !dirty || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: { version: draft.version, answer: { ...(draft.answer || {}), periodPlan: serializePeriodPlan(plan) } }
      });
      const saved = data.draft || data;
      onSaved?.(saved);
      setDirty(false);
      setNotice('课时编排已保存。课堂流程已调整，请重新确认方案后再更新三卡。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setSaving(false); }
  };
  return <section className="period-planner panel">
    <header className="period-planner-head"><div><Badge tone="orange"><Route/> 课时编排</Badge><h2>先核对教学顺序，再安排每一课时的课堂主线</h2><p>篇目、核心问题和板书课题保持不变。系统只统计主要学习活动，不要求把 {periodMinutes} 分钟机械排满；请为学生回应、板书生成、临时追问和课堂变化保留机动时间。</p></div><div className={`period-planner-total ${plan.status}`}><b>{plan.periods}</b><span>课时</span><strong>{plan.usedMinutes} / {plan.targetMinutes}</strong><small>主要活动参考用时</small></div></header>
    {plan.activities.length > 0 && ['sequence', 'over', 'sparse'].includes(plan.status) && <div className={`period-plan-warning ${plan.status}`} role="status"><CircleAlert/><div><b>{plan.sequenceIssues.length ? '当前教学顺序需要调整' : overPeriods.length ? '主要活动已经挤满课时' : '课堂主线可能偏少'}</b><p>{plan.sequenceIssues[0]?.message || overPeriods.length ? (plan.sequenceIssues[0]?.message || `${overPeriods.map(item => item.label).join('、')}需要删减、合并或移到其他课时，并给学生回应留出时间。`) : `${sparsePeriods.map(item => item.label).join('、')}的主要活动少于建议范围。请检查是否缺少必要的朗读、讨论、练习或评价，不要用延长教师讲授来填满课时。`}</p>{plan.sequenceIssues.length > 1 && <small>另外还有 {plan.sequenceIssues.length - 1} 处顺序需要核对。</small>}</div>{plan.sequenceIssues.length > 0 && <button type="button" onClick={repairSequence}>按学习前置关系整理</button>}</div>}
    {!plan.activities.length ? <div className="period-planner-empty"><Route/><b>当前方案还没有可编排的课堂环节</b><p>先回到教师定稿台补全课堂流程，再按课时分配。</p></div> : <div className="period-planner-columns">{plan.periodSummaries.map(period => <article className={period.status} key={period.number}>
      <header><div><span>0{period.number}</span><div><b>{period.label}</b><small>主要活动 {period.usedMinutes} 分钟 · 课时 {period.targetMinutes} 分钟</small></div></div><Badge tone={period.status === 'over' || period.status === 'sparse' ? 'orange' : period.status === 'balanced' ? 'green' : 'blue'}>{statusLabel(period)}</Badge></header>
      <i className="period-load"><em style={{ width: `${Math.min(100, Math.round(period.usedMinutes / period.targetMinutes * 100))}%` }}/></i>
      <div className="period-activities">{period.activities.length ? period.activities.map((activity, activityIndex) => <section key={activity.id}><div className="period-activity-order">{String(activity.order).padStart(2, '0')}</div><div className="period-activity-copy"><b>{activity.title}</b>{activity.detail && <p>{activity.detail}</p>}<div className="period-activity-fields"><label>计划用时 <input type="number" min="3" max="45" value={activity.minutes} onChange={event => update(activity.id, { minutes: event.target.value })}/> 分钟</label>{plan.periods > 1 && <label>安排到 <select value={activity.period} onChange={event => update(activity.id, { period: Number(event.target.value) })}>{plan.periodSummaries.map(item => <option value={item.number} key={item.number}>{item.label}</option>)}</select></label>}</div></div><div className="period-activity-move" aria-label={`${activity.title}的顺序调整`}><button type="button" disabled={activityIndex === 0} onClick={() => reorder(activity.id, 'up')}>上移</button><button type="button" disabled={activityIndex === period.activities.length - 1} onClick={() => reorder(activity.id, 'down')}>下移</button></div></section>) : <div className="period-empty-slot"><Plus/><span>这一课时还没有安排环节</span></div>}</div>
    </article>)}</div>}
    <footer className="period-planner-footer"><div><b>{dirty ? '编排有未保存修改' : '当前编排已与草稿同步'}</b><small>保存后会保留旧版本；已锁定的卡片不会被自动覆盖。</small>{notice && <span>{notice}</span>}{error && <span className="error">{error}</span>}</div><button type="button" className="primary" disabled={!dirty || saving || !plan.activities.length} onClick={save}>{saving ? '正在保存编排…' : '保存课时编排'}</button></footer>
  </section>;
}
function Cards() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const [draft, setDraft] = useState(null);
  const [cards, setCards] = useState([]);
  const [planForm, setPlanForm] = useState(() => planFormFromDraft());
  const [planDirty, setPlanDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState('');
  const [generationStage, setGenerationStage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [classroom, setClassroom] = useState(false);
  const [classroomRun, setClassroomRun] = useState(() => emptyClassroomRun());
  const [classroomDirty, setClassroomDirty] = useState(false);
  const [classroomSaving, setClassroomSaving] = useState(false);
  const [classroomKeyword, setClassroomKeyword] = useState('');
  const [classroomMoment, setClassroomMoment] = useState('');
  const [classroomClock, setClassroomClock] = useState(() => Date.now());
  const [classroomNotice, setClassroomNotice] = useState('');
  const [classroomConflictRun, setClassroomConflictRun] = useState(null);
  const [revealed, setRevealed] = useState(1);
  const [writingRehearsal, setWritingRehearsal] = useState(false);
  const [activeCard, setActiveCard] = useState(0);
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyWorking, setHistoryWorking] = useState('');
  const [assetMessage, setAssetMessage] = useState('');
  const [repairMessage, setRepairMessage] = useState('');
  const [classProfiles, setClassProfiles] = useState([]);
  const [classAdaptationOpen, setClassAdaptationOpen] = useState(false);
  const [targetClassName, setTargetClassName] = useState('');
  const [targetClassLevel, setTargetClassLevel] = useState('');
  const [classAdaptationBusy, setClassAdaptationBusy] = useState(false);
  const [classAdaptationMessage, setClassAdaptationMessage] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [feedbackForm, setFeedbackForm] = useState(normalizeFeedbackForm());
  const [feedbackAdvice, setFeedbackAdvice] = useState([]);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const classroomRef = useRef(null);
  const classroomSaveRef = useRef(false);
  const cardsLoadRef = useRef(0);
  const draftId = params.get('draftId') || params.get('id') || '';
  const userId = String(session?.user?.id || '');
  const cardsReaderReturn = draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : 'cards';

  useEffect(() => {
    const loadId = ++cardsLoadRef.current;
    setDraft(null); setCards([]); setPlanForm(planFormFromDraft()); setPlanDirty(false); setDirty(false); setHistory(null); setBusy(true); setError(''); setErrorCode(''); setRepairMessage(''); setFeedbackForm(normalizeFeedbackForm()); setFeedbackAdvice([]); setFeedbackDirty(false); setFeedbackMessage(''); setClassroom(false); setClassroomRun(emptyClassroomRun()); setClassroomDirty(false); setClassroomKeyword(''); setClassroomMoment(''); setClassroomClock(Date.now()); setClassroomNotice(''); setClassroomConflictRun(null); setWritingRehearsal(false); setExportNotice(''); classroomSaveRef.current = false;
    if (!userId) {
      setError('请先登录，再打开课堂设计。为保护账号资料，身份未知时不会读取任何课堂草稿缓存。');
      setErrorCode('auth_required');
      setBusy(false);
      return;
    }
    if (!draftId) {
      setError('还没有选定备课方案。');
      setErrorCode('draft_missing');
      setBusy(false);
      return;
    }
    rootRequest('/api/drafts/' + draftId)
      .then(data => {
        if (loadId !== cardsLoadRef.current) return;
        const next = data.draft || data;
        if (data.repairNeeded) setRepairMessage('已修正篇目名称和自动编排；教师修改、锁定卡片与教材依据均已保留。');
        const loadedCards = withBoardPlan(Array.isArray(next.cards) ? next.cards : [], next.answer?.lesson?.coreQuestion || next.question || next.title || '');
        const nextFeedback = normalizeFeedbackForm(next.answer?.lessonReflection || next.answer?.teachingFeedback || {});
        const serverRun = normalizeClassroomRun(next.answer?.classroomRun || {});
        const recovery = readClassroomRecovery(userId, draftId);
        const resolvedRecovery = resolveClassroomRecovery(serverRun, next.version, recovery);
        const nextRun = resolvedRecovery.classroomRun;
        setDraft(next);
        setCards(loadedCards);
        setPlanForm(planFormFromDraft(next));
        setFeedbackForm(nextFeedback);
        setFeedbackAdvice(feedbackAdviceFromForm(nextFeedback));
        setFeedbackDirty(false);
        setFeedbackMessage('');
        const launchClassroom = params.get('classroom') === '1' && nextRun.status !== 'pending_review';
        const classroomStartRun = launchClassroom && nextRun.status !== 'confirmed'
          ? normalizeClassroomRun({ ...nextRun, status: 'in_progress', currentStage: nextRun.currentStage || 1, usedCards: [...new Set([...(nextRun.usedCards || []), '板书卡'])] }, nextRun)
          : nextRun;
        setClassroomRun(classroomStartRun);
        setClassroomDirty(resolvedRecovery.dirty || (launchClassroom && nextRun.status === 'idle'));
        if (resolvedRecovery.recoveredAcrossVersion) setClassroomNotice('已恢复本机未保存的课堂记录，请核对后再次保存。');
        if (resolvedRecovery.conflictRun) { setClassroomConflictRun(resolvedRecovery.conflictRun); setClassroomNotice('账号和本机各有一份课堂记录，请选择保留哪一份。'); }
        setRevealed(classroomStartRun.currentStage || 1);
        if (launchClassroom) setClassroom(true);
        setActiveCard(Math.max(0, loadedCards.findIndex(card => card.type === 'board')));
        cacheDraftForRecovery(userId, draftId, next, loadedCards);
      })
      .catch(err => {
        if (loadId !== cardsLoadRef.current) return;
        const cached = readDraftRecovery(userId, draftId);
        if (cached) {
          const cachedFeedback = normalizeFeedbackForm(cached.draft?.answer?.lessonReflection || cached.draft?.answer?.teachingFeedback || {});
          const cachedRecovery = readClassroomRecovery(userId, draftId);
          const cachedRun = cachedRecovery?.classroomRun || normalizeClassroomRun(cached.draft?.answer?.classroomRun || {});
          setDraft(cached.draft);
          setCards(withBoardPlan(cached.cards, cached.draft?.answer?.lesson?.coreQuestion || cached.draft?.question || cached.draft?.title || ''));
          setPlanForm(planFormFromDraft(cached.draft));
          setFeedbackForm(cachedFeedback);
          setFeedbackAdvice(feedbackAdviceFromForm(cachedFeedback));
          setFeedbackDirty(false);
          setFeedbackMessage('已从本地恢复草稿，建议先保存到服务器。');
          setClassroomRun(cachedRun); setClassroomDirty(Boolean(cachedRecovery)); setRevealed(cachedRun.currentStage || 1);
          setActiveCard(Math.max(0, cached.cards.findIndex(card => card.type === 'board')));
          setError(requestCode(err) === 'auth_invalid' ? '登录状态已失效，已保留最近一次编辑内容；登录后可以继续保存。' : '服务暂时没有响应，已保留最近一次编辑内容。');
        } else setError(askErrorMessage(err));
        setErrorCode(requestCode(err));
      })
      .finally(() => { if (loadId === cardsLoadRef.current) setBusy(false); });
    return () => { cardsLoadRef.current += 1; };
  }, [draftId, userId, session?.access_token]);

  useEffect(() => { if (userId && draftId && draft) cacheDraftForRecovery(userId, draftId, draft, cards); }, [userId, draftId, draft, cards]);

  useEffect(() => {
    let active = true;
    setClassProfiles([]); setTargetClassName(''); setTargetClassLevel(''); setClassAdaptationMessage('');
    if (!userId) return undefined;
    rootRequest('/api/drafts/class-profiles').then(data => {
      if (active) setClassProfiles(Array.isArray(data?.profiles) ? data.profiles : []);
    }).catch(() => { if (active) setClassProfiles([]); });
    return () => { active = false; };
  }, [userId, session?.access_token]);

  useEffect(() => {
    if (classroomDirty && draft?.version) writeClassroomRecovery(userId, draftId, draft.version, classroomRun, draft.answer?.classroomRun || {});
  }, [classroomDirty, classroomRun, draft?.version, draftId, userId]);

  useEffect(() => {
    if (activeCard >= cards.length) setActiveCard(Math.max(0, cards.length - 1));
  }, [activeCard, cards.length]);

  useEffect(() => {
    if (!generating) { setGenerationStage(0); return undefined; }
    setGenerationStage(0);
    const timer = setInterval(() => setGenerationStage(index => Math.min(CARD_GENERATION_STEPS.length - 1, index + 1)), 6500);
    return () => clearInterval(timer);
  }, [generating]);

  const updatePlanField = (field, value) => {
    setPlanForm(current => ({ ...current, [field]: value }));
    setPlanDirty(true);
    setAssetMessage('');
  };

  const savePlan = async () => {
    if (!draftId || !draft) return null;
    setSaving(true); setError(''); setErrorCode(''); setAssetMessage('');
    try {
      const update = applyPlanForm(draft, planForm);
      const data = await rootRequest('/api/drafts/' + encodeURIComponent(draftId), {
        method: 'PATCH',
        body: { ...update, version: draft.version }
      });
      const saved = data.draft || data;
      setDraft(saved);
      setCards(withBoardPlan(Array.isArray(saved.cards) ? saved.cards : cards, saved.answer?.lesson?.coreQuestion || saved.question || saved.title || ''));
      setPlanForm(planFormFromDraft(saved));
      setPlanDirty(false);
      setAssetMessage('当前方案修改已保存，可以确认本版。');
      return saved;
    } catch (err) {
      setError(askErrorMessage(err)); setErrorCode(requestCode(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateFeedbackField = (field, value) => {
    setFeedbackForm(current => {
      const next = normalizeFeedbackForm({ ...current, [field]: value });
      setFeedbackAdvice(feedbackAdviceFromForm(next));
      return next;
    });
    setFeedbackDirty(true);
    setFeedbackMessage('');
  };

  const saveFeedback = async () => {
    if (!draftId || !draft) return null;
    if (!feedbackDirty) return draft;
    setFeedbackSaving(true);
    setFeedbackMessage('');
    setError('');
    try {
      const data = await rootRequest('/api/drafts/' + encodeURIComponent(draftId) + '/feedback', {
        method: 'PATCH',
        body: { reflection: feedbackStorageValue(feedbackForm), version: draft.version }
      });
      const saved = data.draft || data;
      setDraft(saved);
      const nextFeedback = normalizeFeedbackForm(saved.answer?.lessonReflection || saved.answer?.teachingFeedback || feedbackForm);
      setCards(withBoardPlan(Array.isArray(saved.cards) ? saved.cards : cards, saved.answer?.lesson?.coreQuestion || saved.question || saved.title || ''));
      setFeedbackForm(nextFeedback);
      setFeedbackAdvice(feedbackAdviceFromForm(nextFeedback));
      setFeedbackDirty(false);
      setFeedbackMessage('课后复盘已保存。下次打开本篇方案时，可继续查看课堂表现和调整建议。');
      return saved;
    } catch (err) {
      setError(askErrorMessage(err));
      setErrorCode(requestCode(err));
      return null;
    } finally {
      setFeedbackSaving(false);
    }
  };

  const confirmAndGenerate = async () => {
    if (!draftId || generating) return;
    const current = planDirty ? await savePlan() : draft;
    if (!current) return;
    setGenerating('all'); setError(''); setErrorCode(''); setAssetMessage('');
    let keyId = '';
    try { keyId = sessionStorage.getItem('activeDeepSeekKeyId') || ''; } catch {}
    try {
      let confirmed = current;
      if (!isTeacherConfirmed(current)) {
        const confirmation = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/confirm`, {
          method: 'POST',
          body: { version: current.version }
        });
        confirmed = confirmation.draft || confirmation;
        setDraft(confirmed);
      }
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/cards/generate`, {
        method: 'POST',
        body: { version: confirmed.version, keyId: keyId || undefined }
      });
      const saved = data.draft || data;
      const generatedCards = withBoardPlan(Array.isArray(saved.cards) ? saved.cards : [], saved.answer?.lesson?.coreQuestion || saved.question || saved.title || '');
      setDraft(saved); setCards(generatedCards); setPlanForm(planFormFromDraft(saved)); setPlanDirty(false); setDirty(false);
      setActiveCard(Math.max(0, generatedCards.findIndex(card => card.type === 'board')));
      const rounds = Math.max(1, ...(Array.isArray(data.generations) ? data.generations.map(item => Number(item?.generationRounds) || 1) : [1]));
      setAssetMessage(rounds >= 3
        ? '三卡已保存：系统先形成初稿，再核对教材依据与课堂节奏，并完成了必要修订。'
        : '三卡已保存：系统已完成初稿与教材依据、课堂可用性审校。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'plan_incomplete' ? '这份方案还缺少完整的课堂流程、问题链或评价标准，请回到问答补齐后再确认。' : code === 'evidence_insufficient' ? '当前方案还没有足够的教材页级依据，请先补充并核验原始页面。' : askErrorMessage(err));
      setErrorCode(code);
    } finally {
      setGenerating('');
    }
  };

  const save = async next => {
    const prepared = withBoardPlan(next, draft?.question || '');
    setCards(prepared);
    if (!draftId) {
      setDirty(false);
      return draft;
    }
    setSaving(true);
    setError('');
    setErrorCode('');
    try {
      const lockedById = new Map((Array.isArray(draft?.cards) ? draft.cards : []).filter(card => card?.status === 'locked').map(card => [String(card.id), card]));
      const outboundCards = prepared.map(card => lockedById.get(String(card?.id)) || card);
      const data = await rootRequest('/api/drafts/' + draftId + '/cards', {
        method: 'POST',
        body: { cards: outboundCards, version: draft && draft.version }
      });
      const saved = data.draft || draft;
      setDraft(saved);
      setCards(Array.isArray(saved.cards) ? saved.cards : prepared);
      setDirty(false);
      return saved;
    } catch (err) {
      setError(askErrorMessage(err)); setErrorCode(requestCode(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (cardIndex, itemIndex, value) => {
    const next = cards.map((card, cardPosition) => {
      if (cardPosition !== cardIndex || card.status === 'locked') return card;
      return { ...card, items: (card.items || []).map((item, itemPosition) => itemPosition === itemIndex ? { ...item, text: value } : item) };
    });
    setCards(next);
    setActiveCard(cardIndex);
    setDirty(true);
  };

  const lock = async card => {
    const current = dirty ? await save(cards) : draft;
    if (!current) return;
    try {
      const data = await rootRequest('/api/drafts/' + draftId + '/cards/' + card.id + '/lock', { method: 'POST', body: { version: current.version } });
      const next = data.draft || draft;
      setDraft(next);
      setCards(next.cards || cards);
      setDirty(false);
    } catch (err) {
      setError(askErrorMessage(err)); setErrorCode(requestCode(err));
    }
  };

  const regenerate = async card => {
    if (card.status === 'locked' || generating) return;
    const current = dirty ? await save(cards) : draft;
    if (!current) return;
    setGenerating(card.id);
    setError('');
    setErrorCode('');
    let keyId = '';
    try { keyId = sessionStorage.getItem('activeDeepSeekKeyId') || ''; } catch {}
    try {
      const data = await rootRequest('/api/drafts/' + draftId + '/cards/' + card.id + '/regenerate', {
        method: 'POST',
        body: { keyId: keyId || undefined, version: current.version }
      });
      const next = data.draft || draft;
      setDraft(next);
      setCards(withBoardPlan(next.cards || cards, next.answer?.lesson?.coreQuestion || next.question || next.title || ''));
      setDirty(false);
      setAssetMessage(Number(data.generationRounds) >= 3
        ? `${card.title}已重做，并完成教材依据、课堂节奏与格式修订。`
        : `${card.title}已重做，并完成教材依据与课堂可用性审校。`);
    } catch (err) {
      setError(askErrorMessage(err)); setErrorCode(requestCode(err));
    } finally {
      setGenerating('');
    }
  };

  const updateClassroomUrl = active => {
    const url = new URL(location.href);
    if (active) url.searchParams.set('classroom', '1');
    else url.searchParams.delete('classroom');
    history.replaceState(null, '', url);
  };

  const saveClassroomRun = async (requested = classroomRun, { complete = false } = {}) => {
    if (!draftId || !draft || classroomSaveRef.current) return null;
    const nextRun = normalizeClassroomRun({ ...requested, status: complete ? 'pending_review' : 'in_progress' }, classroomRun);
    classroomSaveRef.current = true;
    setClassroomSaving(true); setClassroomNotice(''); setError('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/classroom-run`, {
        method: 'PATCH', body: { ...nextRun, version: draft.version }
      });
      const saved = data.draft || data;
      const savedRun = normalizeClassroomRun(saved.answer?.classroomRun || nextRun);
      setDraft(saved); setClassroomRun(savedRun); setRevealed(savedRun.currentStage); setClassroomDirty(false);
      clearClassroomRecovery(userId, draftId);
      setClassroomNotice(complete ? '课堂现场记录已整理，下一步请核对课后复盘。' : '课堂记录已保存。');
      return saved;
    } catch (err) {
      if (requestCode(err) === 'edit_conflict') {
        setClassroomNotice('这份方案已在另一处更新。当前课堂记录仍保留在本机，请刷新核对后再保存。');
        writeClassroomRecovery(userId, draftId, draft.version, nextRun, draft.answer?.classroomRun || {});
      } else setClassroomNotice(askErrorMessage(err));
      return null;
    } finally { classroomSaveRef.current = false; setClassroomSaving(false); }
  };

  const chooseClassroomRecord = useLocal => {
    if (useLocal && classroomConflictRun) {
      setClassroomRun(classroomConflictRun); setRevealed(classroomConflictRun.currentStage || 1); setClassroomDirty(true);
      setClassroomNotice('已选择本机记录，请点击“保存现场记录”写入当前账号。');
    } else {
      clearClassroomRecovery(userId, draftId); setClassroomDirty(false); setClassroomNotice('已保留账号中的课堂记录。');
    }
    setClassroomConflictRun(null);
  };

  const startClassroom = async () => {
    if (!draft || !board?.items?.length) return;
    if (classroomRun.status === 'pending_review') { location.href = `/reflection/?draftId=${encodeURIComponent(draftId)}`; return; }
    const readOnly = classroomRun.status === 'confirmed';
    const nextRun = readOnly ? classroomRun : normalizeClassroomRun({ ...classroomRun, status: 'in_progress', currentStage: classroomRun.currentStage || 1, usedCards: [...new Set([...(classroomRun.usedCards || []), '板书卡'])] }, classroomRun);
    setClassroomRun(nextRun); setRevealed(nextRun.currentStage); setClassroom(true); setClassroomDirty(!readOnly); updateClassroomUrl(true);
    if (!readOnly) await saveClassroomRun(nextRun);
  };

  const closeClassroom = async () => {
    if (classroomDirty && classroomRun.status !== 'confirmed') {
      const saved = await saveClassroomRun(classroomRun);
      if (!saved) return;
    }
    if (document.fullscreenElement) await document.exitFullscreen?.();
    setClassroom(false); updateClassroomUrl(false);
  };

  const changeClassroomStage = nextStage => {
    if (classroomRun.status === 'confirmed') return;
    const stage = Math.min(5, Math.max(1, nextStage));
    setRevealed(stage); setClassroomRun(current => normalizeClassroomRun({ ...current, currentStage: stage }, current)); setClassroomDirty(true); setClassroomNotice('');
  };

  const markClassroomStage = outcome => {
    if (classroomRun.status === 'confirmed') return;
    setClassroomRun(current => setClassroomStageOutcome({ ...current, currentStage: revealed }, revealed, outcome)); setClassroomDirty(true); setClassroomNotice('');
  };

  const markClassroomPace = paceSignal => {
    if (classroomRun.status === 'confirmed' || !CLASSROOM_PACE_SIGNALS.includes(paceSignal)) return;
    setClassroomRun(current => normalizeClassroomRun({ ...current, paceSignal }, current));
    setClassroomDirty(true);
    setClassroomNotice('');
  };

  const addClassroomKeyword = () => {
    const text = classroomKeyword.trim().slice(0, 16);
    if (!text || classroomRun.keywords.length >= 3 || classroomRun.status === 'confirmed') return;
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setClassroomRun(current => normalizeClassroomRun({ ...current, keywords: [...current.keywords, { id, stage: revealed, text }] }, current));
    setClassroomKeyword(''); setClassroomDirty(true); setClassroomNotice('');
  };

  const removeClassroomKeyword = id => {
    if (classroomRun.status === 'confirmed') return;
    setClassroomRun(current => normalizeClassroomRun({ ...current, keywords: current.keywords.filter(item => item.id !== id) }, current)); setClassroomDirty(true); setClassroomNotice('');
  };

  const classroomElapsedMinutes = () => {
    const startedAt = Date.parse(classroomRun.startedAt || '');
    return Number.isFinite(startedAt) ? Math.max(0, Math.min(180, Math.floor((classroomClock - startedAt) / 60000))) : 0;
  };

  const recordClassroomMoment = type => {
    if (classroomRun.status === 'confirmed' || classroomRun.moments.length >= 24) return;
    const fallback = {
      breakthrough: `${stages[revealed - 1]}：学生已经说通关键关系`,
      confusion: `${stages[revealed - 1]}：出现共同卡点`,
      question: `${stages[revealed - 1]}：出现值得保留的学生问题`,
      timing: `${stages[revealed - 1]}：实际用时与预设不同`
    }[type];
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setClassroomRun(current => addClassroomMoment(current, {
      id,
      type,
      stage: revealed,
      text: classroomMoment.trim() || fallback,
      elapsedMinutes: classroomElapsedMinutes(),
      createdAt: new Date().toISOString()
    }));
    setClassroomMoment(''); setClassroomDirty(true); setClassroomNotice('已记入课堂时间线，10 秒内自动保存。');
  };

  const deleteClassroomMoment = id => {
    if (classroomRun.status === 'confirmed') return;
    setClassroomRun(current => removeClassroomMoment(current, id));
    setClassroomDirty(true); setClassroomNotice('已移除这条现场观察，10 秒内自动保存。');
  };

  const finishClassroom = async () => {
    const saved = await saveClassroomRun(classroomRun, { complete: true });
    if (saved) location.href = `/reflection/?draftId=${encodeURIComponent(draftId)}`;
  };

  useEffect(() => {
    if (!classroom || classroomRun.status !== 'in_progress') return undefined;
    setClassroomClock(Date.now());
    const timer = setInterval(() => setClassroomClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [classroom, classroomRun.status, classroomRun.startedAt]);

  useEffect(() => {
    if (!classroom || !classroomDirty || classroomSaving || classroomRun.status !== 'in_progress') return undefined;
    const timer = setTimeout(() => saveClassroomRun(classroomRun), 10000);
    return () => clearTimeout(timer);
  }, [classroom, classroomDirty, classroomSaving, classroomRun, draft?.version]);

  useEffect(() => {
    if (!classroom) return undefined;
    const previousFocus = document.activeElement;
    classroomRef.current?.querySelector('.classroom-close')?.focus();
    return () => { previousFocus?.focus?.(); };
  }, [classroom]);

  useEffect(() => {
    if (!classroom) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape' && !document.fullscreenElement) closeClassroom(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [classroom, classroomDirty, classroomRun, draft?.version]);

  const toggleFullscreen = async () => {
    if (!classroomRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else await classroomRef.current.requestFullscreen?.();
    } catch { setClassroomNotice('浏览器未能进入全屏，课堂记录仍可继续使用。'); }
  };

  const exportMd = () => {
    const coverage = draft?.answer?.sourceCoverage;
    const answer = draft?.answer || {};
    const feedback = normalizeFeedbackForm(feedbackDirty ? feedbackForm : answer?.lessonReflection || answer?.teachingFeedback || feedbackForm);
    const listText = value => Array.isArray(value) ? value.map(item => `- ${typeof item === 'string' ? item : item?.text || item?.title || item?.question || item?.content || '待教师补充'}`).join('\n') : '';
    const refsText = refs => uniqueCitations(draft?.citations || [], refs).map(item => `${docName(item.documentId)} 第${citationPage(item)}页`).join('；');
    const workflow = Array.isArray(answer.lessonPlan) ? answer.lessonPlan.map((item, index) => {
      const lines = [
        `### ${index + 1}. ${item.title || item.name || '课堂环节'}${item.duration ? `（${item.duration}）` : ''}`,
        `教师怎样组织：${item.teacherAction || item.content || item.description || item.activity || item.text || '待教师补充'}`,
        item.studentTask && `学生完成什么：${item.studentTask}`,
        item.expectedEvidence && `预期出现的表现：${item.expectedEvidence}`,
        item.teacherGuideBasis && `教师用书参考：${item.teacherGuideBasis}`,
        refsText(item.evidenceRefs) && `教材页码：${refsText(item.evidenceRefs)}`
      ].filter(Boolean);
      return lines.join('\n');
    }).join('\n\n') : '';
    const citations = uniqueCitations(draft?.citations || []).map(item => `- ${docName(item.documentId)} · 第 ${citationPage(item)} 页${item.printedPage ? `（书页 ${item.printedPage}）` : ''}`).join('\n');
    const sourceNote = coverage ? `\n\n## 材料覆盖\n${sourceCoverageLabel(coverage)}。缺少的材料不会被当作已引用；正式使用前请教师回看原始教材。\n` : '';
    const feedbackText = feedback.unfinishedQuestions || feedback.timeManagement || feedback.nextStep || feedback.classResponse.length || feedback.usedCards.length
      ? `## 课后复盘\n- 学生的实际表现：${feedback.classResponse || '未填写'}\n- 学生还没有说清的内容：${feedback.unfinishedQuestions || '未填写'}\n- 实际用时与课堂节奏：${feedback.timeManagement || '未填写'}\n- 本节实际使用：${(feedback.usedCards || []).join('；') || '未填写'}\n- 下次教学调整：${feedback.nextStep || '未填写'}\n\n### 依据本节表现形成的调整建议\n${feedbackAdviceFromForm(feedback).map(item => `- ${item}`).join('\n')}\n` : '';
    const text = `# ${draft?.title || '备课方案'}

> 这是基于教材与教师用书生成的备课初稿，需经教师审核后使用。

## 备课条件
- 课时：${draft?.lesson_context?.periods || 1} 课时
- 班级：${draft?.lesson_context?.classLevel || '普通'}
- 目标：${draft?.lesson_context?.teachingGoal || '理解文本'}
- 方式：${draft?.lesson_context?.teachingMode || '探究'}

## 方案概述
${answer.summary || ''}

## 教学目标
${listText(answer.objectives)}

## 重点与难点
${listText(answer.keyPoints)}

## 课堂流程
${workflow || listText(answer.lessonPlan)}

## 问题链
${listText(answer.questionChain)}

## 作业与评价
${listText(answer.homework)}
${listText(answer.assessment)}

${feedbackText}
    ${cards.map(card => `## ${card.title}\n- 状态：${card.status === 'locked' ? '教师已锁定' : '可继续编辑'}\n${(card.items || []).map(item => `- ${item.text}\n  - 内容性质：${sourceTypeLabel(item.sourceType)}${refsText(item.citationIds) ? `\n  - 教材依据：${refsText(item.citationIds)}` : '\n  - 教材依据：尚未绑定页级依据'}`).join('\n')}`).join('\n\n')}

## 教材依据
${citations || '- 当前没有可复制的页级依据'}
${sourceNote}`;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `活教参-${safeDownloadStem(lessonTitle)}-一课三卡.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadHistory = async () => {
    if (!draftId) return;
    setHistoryBusy(true); setError('');
    try { const data = await rootRequest(`/api/assets/${encodeURIComponent(draftId)}/versions`); setHistory(data); }
    catch (err) { setError(askErrorMessage(err)); }
    finally { setHistoryBusy(false); }
  };
  const compareHistory = async revisionId => {
    if (!draftId || !revisionId) return;
    setHistoryWorking(`compare:${revisionId}`); setError('');
    try {
      const data = await rootRequest(`/api/assets/${encodeURIComponent(draftId)}/versions?compare=${encodeURIComponent(revisionId)}`);
      setHistory(current => current ? { ...current, comparison: data.comparison || null } : current);
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setHistoryWorking(''); }
  };
  const restoreHistory = async revisionId => {
    if (!draftId || !revisionId || !draft) return;
    setHistoryWorking(`restore:${revisionId}`); setError('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/restore`, { method: 'POST', body: { revisionId, version: draft.version } });
      const restored = data.draft || data;
      const restoredCards = withBoardPlan(Array.isArray(restored.cards) ? restored.cards : [], restored.answer?.lesson?.coreQuestion || restored.question || restored.title || '');
      setDraft(restored); setCards(restoredCards); setPlanForm(planFormFromDraft(restored)); setPlanDirty(false); setDirty(false);
      setHistory(null); setAssetMessage('已恢复所选版本。请重新检查方案；已锁定卡片保持不变。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setHistoryWorking(''); }
  };
  const publishAsset = async () => {
    if (!draftId) return;
    setAssetMessage(''); setError('');
    try { await rootRequest('/api/assets', { method: 'POST', body: { draftId, version: draft?.version } }); setAssetMessage('已收进教研资产库；以后可以按篇目搜索并继续编辑。'); }
    catch (err) { setError(askErrorMessage(err)); }
  };

  const adaptToClass = async () => {
    const target = targetClassName.trim().slice(0, 40);
    const sourceClass = String(draft?.lesson_context?.className || '').trim();
    if (!draftId || !draft || classAdaptationBusy) return;
    if (!target) { setClassAdaptationMessage('请先填写目标班级。'); return; }
    if (target === sourceClass) { setClassAdaptationMessage('目标班级与当前方案相同，不需要另建版本。'); return; }
    if (planDirty || dirty) { setClassAdaptationMessage('当前还有未保存修改，请先保存后再建立目标班版本。'); return; }
    setClassAdaptationBusy(true); setClassAdaptationMessage(''); setError('');
    const operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/adapt-class`, {
        method: 'POST',
        body: { sourceVersion: draft.version, targetClassName: target, targetClassLevel: targetClassLevel.trim().slice(0, 80), operationId }
      });
      const next = data.draft || data;
      const nextId = next?.id;
      if (!nextId) throw Object.assign(new Error('draft_not_found'), { code: 'draft_not_found' });
      // The adapted draft already contains the lesson identity, evidence and
      // source plan. Do not put an internal model instruction in the URL or
      // auto-run it before the owned draft has loaded: that race previously
      // cleared cards and made the teacher lose track of where the button led.
      location.href = `/ask/?draftId=${encodeURIComponent(nextId)}&adapt=1`;
    } catch (err) {
      setClassAdaptationMessage(requestCode(err) === 'edit_conflict' ? '源方案已在其他页面更新，请刷新后再建立目标班版本。' : '目标班版本暂时没有建立成功，请稍后重试。');
    } finally { setClassAdaptationBusy(false); }
  };

  const exportBoard = format => {
    const svg = document.querySelector('.board-preview-canvas .board-map');
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    if (format === 'svg') {
      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `活教参-${safeDownloadStem(lessonTitle)}-板书.svg`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = Math.round(1600 * image.height / Math.max(1, image.width));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) return;
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `活教参-${safeDownloadStem(lessonTitle)}-板书.png`;
        link.click();
        URL.revokeObjectURL(downloadUrl);
      }, 'image/png');
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  const board = cards.find(card => card.type === 'board') || cards[0];
  const currentCard = cards[activeCard] || board;
  const lessonTitle = draft ? lessonTitleForDraft(draft) : '课堂板书';
  const boardCoreQuestion = board?.boardPlan?.coreQuestion
    || draft?.answer?.lesson?.coreQuestion
    || `围绕${lessonTitle}，学生读完后能理解什么、说明什么？`;
  const boardWritingPlan = useMemo(() => buildBoardWritingPlan({
    title: lessonTitle,
    coreQuestion: boardCoreQuestion,
    items: board?.items || [],
    blankZones: board?.boardPlan?.blankZones || []
  }), [lessonTitle, boardCoreQuestion, board?.items, board?.boardPlan?.blankZones]);
  const CARD_META = {
    board: { role: '课堂主线', action: '先搭出课堂主线', rail: '把课题、核心问题和关键发现排成一条可以边问边补的主线。' },
    question: { role: '问题驱动', action: '再把问题带回原文', rail: '让每一个问题都把学生带回具体词句、意象或结构，而不是停留在泛泛讨论。' },
    assessment: { role: '观察评价', action: '最后确认学生表现', rail: '把学生最终能说、能写、能引用的表现写成可以观察、记录和反馈的标准。' }
  };
  const stages = CLASSROOM_STAGE_LABELS;
  const showEmpty = !busy && !draft;
  const workflowState = deriveTeacherDraftState({ draft, cards, dirty: planDirty || dirty });
  const allCardsLocked = cards.length > 0 && cards.every(card => card?.status === 'locked');
  const classroomReady = workflowState.cardsGenerated && allCardsLocked && Boolean(board?.items?.length);
  const planFormReady = Boolean(planForm.title.trim() && planForm.summary.trim() && planForm.objectives.trim() && planForm.keyPoints.trim());
  const workflowGuideStep = !workflowState.teacherConfirmed || workflowState.unsavedChanges ? 0 : !workflowState.cardsGenerated ? 1 : dirty || !allCardsLocked ? 2 : 3;
  const workflowGuide = [
    ['核对方案', '检查课堂主线、目标与教材依据'],
    ['生成三卡', '依据已确认方案形成板书、提问和评价'],
    ['编辑保存锁定', '逐张修改，保存后锁定课堂版本'],
    ['课堂使用', '按步骤展开板书并记录课堂情况']
  ];
  const workflowNextCopy = [
    planDirty ? '先保存上方修改，再确认本版。' : '核对篇目、目标和教材依据，然后确认本版。',
    generating ? '正在生成三卡，请保留当前页面。' : '点击“生成板书与三卡”，已有方案不会丢失。',
    dirty ? '先保存当前卡片，再继续锁定。' : '逐张检查三卡，锁定已经可以进课堂的版本。',
    classroomReady ? '板书与三卡已经就绪，可以进入课堂模式。' : '请先补全板书卡，再进入课堂模式。'
  ][workflowGuideStep];
  const citationNeedsReview = errorCode === 'citation_text_mismatch';
  const noticeTitle = ['auth_required','auth_invalid'].includes(errorCode) ? '登录后继续编辑课堂设计' : errorCode === 'draft_missing' ? '还没有选定备课方案' : errorCode === 'draft_not_found' ? '这份备课方案暂时无法读取' : citationNeedsReview ? '教材依据已更新，请重新核对' : /^(gateway|deepseek|card_generation|evidence_)/u.test(errorCode) ? '三卡暂时没有生成' : '课堂设计暂时没有打开';
  const noticeBody = ['auth_required','auth_invalid'].includes(errorCode) ? '为保护不同账号的课堂资料，只有确认当前账号后才会读取该账号自己的本机恢复副本。' : errorCode === 'draft_missing' ? '先在备课问答中提出问题，保存方案后再进入这里。' : errorCode === 'draft_not_found' ? '可能是链接已过期，或这份方案不属于当前账号。请回到备课问答重新建立方案。' : citationNeedsReview ? '教材页码或摘录发生变化。你的方案和教师修改仍在，请重新核对教材依据后再确认。' : error || '请稍后重试，或回到备课问答重新建立方案。';
  const workflowCopy = CARD_META[currentCard?.type]?.action || '把教材依据转成课堂行动';
  const classroomCta = classroomRun.status === 'in_progress' ? '继续本节课堂' : classroomRun.status === 'pending_review' ? '完成课后复盘' : classroomRun.status === 'confirmed' ? '查看课堂记录' : '开始上课并记录';
  const classroomButtonCopy = classroomReady ? classroomCta : !workflowState.cardsGenerated ? '请先生成三卡' : !allCardsLocked ? '请先锁定三卡' : '请先补全板书卡';
  const currentStageOutcome = classroomRun.stages.find(item => item.stage === revealed)?.outcome || '';
  const classroomReadOnly = classroomRun.status === 'confirmed';
  const planQuality = useMemo(() => analyzeTeachingPlanQuality({ ...(draft?.answer || {}), citations: draft?.citations || [] }, cards), [draft?.answer, draft?.citations, cards]);
  const teachingBrief = useMemo(() => buildTeachingBrief({
    title: lessonTitle,
    coreQuestion: boardCoreQuestion,
    answer: draft?.answer || {},
    cards,
    citations: draft?.citations || [],
    lessonContext: draft?.lesson_context || draft?.lessonContext || {}
  }), [lessonTitle, boardCoreQuestion, draft?.answer, draft?.citations, draft?.lesson_context, draft?.lessonContext, cards]);
  const teachingEvidenceChain = useMemo(() => buildTeachingEvidenceChain({
    title: lessonTitle,
    cards,
    citations: draft?.citations || []
  }), [lessonTitle, cards, draft?.citations]);
  const rehearsalForClassroom = useMemo(() => {
    const value = normalizeQuestionRehearsal(draft?.answer?.questionRehearsal || {});
    return value.status === 'confirmed' && draft && !questionRehearsalIsStale(draft) ? value : null;
  }, [draft]);
  const preClassCue = useMemo(() => draft ? preClassPulseClassroomCue(draft) : null, [draft]);
  const rehearsalClassroomStep = rehearsalForClassroom?.steps?.[Math.min(Math.max(0, revealed - 1), Math.max(0, rehearsalForClassroom.steps.length - 1))] || null;
  const classroomAdaptation = useMemo(() => classroomAdaptationAdvice({
    signal: classroomRun.paceSignal,
    cards,
    rehearsalStep: rehearsalClassroomStep
  }), [classroomRun.paceSignal, cards, rehearsalClassroomStep]);
  const stageGuide = [
    { reveal: '先写课题与核心问题', prompt: '教师追问：读完这篇课文，学生最需要说清什么？', student: '学生回答后，留下一个关键词。', next: '下一步：从原文找出能够支撑回答的词句。' },
    { reveal: '沿着学生回答展开课堂主线', prompt: '教师追问：这个回答可以分成哪几条理解路径？', student: '学生补写：文本发现、关键依据或表达方法。', next: '下一步：把每条主线都落到具体页面。' },
    { reveal: '补上最有代表性的教材依据', prompt: '教师追问：哪一个词句或段落最能证明你的判断？', student: '学生补写：关键词、关键句或段落关系。', next: '下一步：比较依据，形成课堂结论。' },
    { reveal: '把分支收束成一句课堂结论', prompt: '教师追问：这些发现合在一起说明了什么？', student: '学生补写：用自己的话概括本课收获。', next: '下一步：留下空间，接住学生最后的表达。' },
    { reveal: '保留现场生成的教师空间', prompt: '教师补写：把学生的有效回答写回留白区。', student: '学生回答后再补入关键词、依据或结论。', next: '板书完成：不要替学生提前写满。' }
  ];

  const exportOfflineClassroomPack = () => {
    if (!workflowState.cardsGenerated || !cards.length) return;
    const pack = buildOfflineClassroomPack({
      title: lessonTitle,
      coreQuestion: boardCoreQuestion,
      cards,
      citations: draft?.citations || [],
      rehearsalStep: rehearsalForClassroom?.steps?.[0] || null
    });
    const url = URL.createObjectURL(new Blob([pack.html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = pack.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice(`离线课堂包已下载，包含渐进式板书、三卡和 ${pack.citationCount} 条可核验页码。`);
  };

  const exportSubstituteTeachingPack = () => {
    if (!draft) return;
    const pack = buildSubstituteTeachingPack({ draft, cards });
    const url = URL.createObjectURL(new Blob([pack.html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = pack.filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice(`代课交接单已下载：${pack.sectionCount} 个课堂部分，附 ${pack.citationCount} 个可核验教材页码。`);
  };

  return <div className="view-stack cards-page">
    <section className="hero compact-hero cards-hero">
      <div><Badge tone="green"><Layers3/> 一课三卡</Badge><h1>{draft ? lessonTitle : '先选篇目，再生成一课三卡'}</h1><p>{draft ? '先看清这节课的主线，再逐张整理板书、提问和评价；每个关键判断都能回到原始教材核验。' : '请先在备课问答中选定篇目、形成方案并保存。完成后，这里会出现可编辑的板书卡、提问卡和评价卡。'}</p></div>
      <div className="hero-actions"><button type="button" className="primary" onClick={startClassroom} disabled={!classroomReady}><PanelTop/>{classroomReady ? classroomCta : '请先生成板书卡'}</button><button type="button" onClick={exportMd} disabled={!cards.length}><Download/>导出方案</button><button type="button" onClick={publishAsset} disabled={!draftId || !workflowState.teacherConfirmed || !workflowState.cardsGenerated}><Archive/>收进教研资产库</button><details className="hero-more-tools"><summary><Menu/>更多课堂工具</summary><div className="hero-more-tools-grid">{draftId && <a href={`/alignment/?draftId=${encodeURIComponent(draftId)}`}><Target/>核对课标</a>}{draftId && workflowState.teacherConfirmed && workflowState.cardsGenerated && <a href={`/share/?draftId=${encodeURIComponent(draftId)}`}><Share2/>发布共备快照</a>}{draftId && workflowState.cardsGenerated && <a href={`/slides/?draftId=${encodeURIComponent(draftId)}`}><PanelTop/>生成课堂课件</a>}{draftId && workflowState.cardsGenerated && <a href={`/homework/?draftId=${encodeURIComponent(draftId)}`}><ClipboardCheck/>生成分层作业</a>}{draftId && workflowState.cardsGenerated && <a href={`/pulse/?draftId=${encodeURIComponent(draftId)}`}><Gauge/>课前学情摸底</a>}{draftId && workflowState.cardsGenerated && <a href={`/rehearsal/?draftId=${encodeURIComponent(draftId)}`}><Route/>预演问题链</a>}{draftId && workflowState.cardsGenerated && <a href={`/reflection/?draftId=${encodeURIComponent(draftId)}`}><History/>查看课后复盘</a>}</div></details></div>
    </section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>{noticeTitle}</b><p>{noticeBody}</p></div><div className="cards-alert-actions">{['auth_required','auth_invalid'].includes(errorCode) && <a className="primary" href={'/login/?next=' + encodeURIComponent(location.pathname + location.search)} onClick={() => rememberAuthReturn({ draftId })}>重新登录</a>}{isTeacherConfirmed(draft) && !workflowState.cardsGenerated && /^(gateway|deepseek|card_generation|evidence_)/u.test(errorCode) && <button type="button" className="primary" onClick={confirmAndGenerate} disabled={Boolean(generating)}><RefreshCw/>重试生成三卡</button>}<a href={draftId ? `/ask/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>{draftId ? '返回本课问答' : '返回备课问答'}</a>{errorCode === 'draft_not_found' && <button type="button" onClick={() => location.reload()}><RefreshCw/>重新读取</button>}</div></section>}
    {busy ? <div className="panel answer-loading"><p>正在读取账号草稿…</p></div> : showEmpty ? null : <>
      {assetMessage && <section className="quality-box"><CheckCircle2/><span>{assetMessage}</span><a href="/assets/">查看教研资产库</a></section>}
      {repairMessage && <section className="cards-repair-notice" role="status"><CheckCircle2/><span>{repairMessage}</span></section>}
      {exportNotice && <section className="quality-box offline-pack-notice"><CheckCircle2/><span>{exportNotice}</span><small>下载的 HTML 可以离线打开和打印；导出不会改动账号中的课堂记录。</small></section>}
      <section className="teacher-status-strip" aria-label="课堂方案状态">
        {[
          ['方案草稿', workflowState.planDraft],
          ['有未确认修改', workflowState.unsavedChanges],
          ['教师已定稿', workflowState.teacherConfirmed],
          ['三卡已生成', workflowState.cardsGenerated],
          ['卡片已锁定', workflowState.cardLocked]
        ].map(([label, active], index) => <div className={active ? 'active' : ''} key={label}><span>{active ? <Check size={14}/> : String(index + 1).padStart(2, '0')}</span><b>{label}</b></div>)}
      </section>
      <section className="cards-overview panel">
        <div className="cards-overview-title"><div><span>方案总览</span><h2>先确认这节课要带学生走到哪里</h2><p>{draft?.answer?.summary || '先从教材依据确定课堂主线。此处仍是方案草稿，不代表板书与三卡已经生成。'}</p></div><Badge tone={workflowState.unsavedChanges ? 'orange' : workflowState.teacherConfirmed ? 'green' : 'gold'}>{saving ? '正在保存' : workflowState.unsavedChanges ? '有未确认修改' : workflowState.teacherConfirmed ? '教师已定稿' : '方案草稿'}</Badge></div>
        <div className="cards-overview-meta"><span><b>课时</b>{draft?.lesson_context?.periods || draft?.lessonContext?.periods || 1} 课时</span><span><b>班级</b>{draft?.lesson_context?.className || draft?.lessonContext?.className || '未指定'} · {draft?.lesson_context?.classLevel || draft?.lessonContext?.classLevel || '普通'}</span><span><b>目标</b>{draft?.lesson_context?.teachingGoal || draft?.lessonContext?.teachingGoal || '理解文本'}</span><span><b>方式</b>{draft?.lesson_context?.teachingMode || draft?.lessonContext?.teachingMode || '探究'}</span><span><b>依据</b>{Array.isArray(draft?.citations) ? uniqueCitations(draft.citations).length : 0} 个页面</span><button type="button" onClick={loadHistory} disabled={historyBusy}><History/>{historyBusy ? '正在读取版本' : '查看版本历史'}</button></div>
        <AssetCoverage coverage={draft?.answer?.sourceCoverage}/>
        <div className={`curriculum-alignment-entry ${draft?.answer?.curriculumAlignment?.status || 'missing'}`}><Target/><div><b>{draft?.answer?.curriculumAlignment ? '已保存课标对齐' : '还没有确认课标对齐'}</b><p>{draft?.answer?.curriculumAlignment ? '学段要求、任务群候选和学业质量已分开记录，可以随时回到原始教材核验。' : '先找到课标原页，再由教师决定本课如何对齐学习任务群。'}</p></div>{draftId && <a href={`/alignment/?draftId=${encodeURIComponent(draftId)}`}>{draft?.answer?.curriculumAlignment ? '重新核对' : '开始核对'} <ArrowRight/></a>}</div>
        <PlanQualitySummary quality={planQuality}/>
      </section>
      <section className={`panel class-adaptation-panel ${classAdaptationOpen ? 'open' : ''}`}>
        <header><div><span>教学接棒</span><h2>同一份方案，可以换班，也可以交给同事接着上</h2><p>换班时建立独立教学版本；临时代课时生成可打印交接单。两种方式都保留教材页码，并隔离课堂记录与学生信息。</p></div><div className="class-adaptation-actions"><button type="button" onClick={() => setClassAdaptationOpen(value => !value)}>{classAdaptationOpen ? '收起换班设置' : '适配另一个班'}<ChevronDown/></button><button type="button" className="handoff" onClick={exportSubstituteTeachingPack} disabled={!draft}><FileCheck2/>下载代课交接单</button></div></header>
        {classAdaptationOpen && <div className="class-adaptation-body"><div className="class-adaptation-route"><span><small>当前方案</small><b>{draft?.lesson_context?.className || '尚未填写班级'}</b></span><ArrowRight/><span><small>目标班级</small><b>{targetClassName || '等待选择'}</b></span></div><div className="class-adaptation-form"><label><span>目标班级</span><input list="class-adaptation-options" value={targetClassName} maxLength="40" onChange={event => { const value = event.target.value; setTargetClassName(value); const profile = classProfiles.find(item => item.className === value); if (profile?.classLevel) setTargetClassLevel(profile.classLevel); setClassAdaptationMessage(''); }} placeholder="例如：九年级 4 班"/><datalist id="class-adaptation-options">{classProfiles.filter(item => item.className !== draft?.lesson_context?.className).map(item => <option value={item.className} key={item.className}>{item.lessonCount} 节记录</option>)}</datalist></label><label><span>班级情况</span><input value={targetClassLevel} maxLength="80" onChange={event => setTargetClassLevel(event.target.value)} placeholder="可选，例如：需要更多阅读支架"/></label><button type="button" className="primary" disabled={classAdaptationBusy || !targetClassName.trim() || planDirty || dirty} onClick={adaptToClass}>{classAdaptationBusy ? '正在建立目标班版本…' : '建立新版本并继续调整'}<ArrowRight/></button></div><div className="class-adaptation-boundary"><ShieldCheck/><p><b>保留：</b>篇目、教材页码、教学主线和三卡内容。<br/><b>重新开始：</b>教师定稿、卡片锁定、课堂记录、作业结果和课后复盘。</p></div>{classAdaptationMessage && <p className="class-adaptation-message" role="status">{classAdaptationMessage}</p>}</div>}
      </section>
      <section className="panel teacher-plan-editor">
        <header><div><span>教师定稿台</span><h2>把模型整理的方案改成你要带进课堂的版本</h2><p>先修改，再保存当前修改；确认本版后才会生成板书与三卡。</p></div><Badge tone={planDirty ? 'orange' : 'green'}>{planDirty ? '有未确认修改' : '当前修改已保存'}</Badge></header>
        <div className="teacher-plan-grid">
          <label className="wide"><span>方案标题</span><input value={planForm.title} onChange={event => updatePlanField('title', event.target.value)}/></label>
          <label><span>课时</span><input type="number" min="1" max="8" value={planForm.periods} onChange={event => updatePlanField('periods', event.target.value)}/></label>
          <label><span>任教班级</span><input value={planForm.className} maxLength="40" onChange={event => updatePlanField('className', event.target.value)} placeholder="例如：九年级 3 班"/></label>
          <label><span>班级情况</span><input value={planForm.classLevel} onChange={event => updatePlanField('classLevel', event.target.value)} placeholder="例如：基础较扎实"/></label>
          <label><span>教学方式</span><input value={planForm.teachingMode} onChange={event => updatePlanField('teachingMode', event.target.value)} placeholder="例如：朗读探究"/></label>
          <label className={`wide ${planForm.summary ? '' : 'empty'}`}><span>课堂主线</span><textarea rows="3" value={planForm.summary} onChange={event => updatePlanField('summary', event.target.value)} placeholder="用一两句话说明：学生围绕什么问题，经过哪些活动，最终形成什么理解。"/>{!planForm.summary && <small>本轮回答还没有形成课堂主线，请先补充后再定稿。</small>}</label>
          <label className={`wide ${planForm.objectives ? '' : 'empty'}`}><span>教学目标（每行一项）</span><textarea rows="3" value={planForm.objectives} onChange={event => updatePlanField('objectives', event.target.value)} placeholder="写可观察的学习结果，例如：学生能够结合反语词句说明雨果的立场。"/>{!planForm.objectives && <small>未从当前方案中读取到明确目标，不会用空白内容生成三卡。</small>}</label>
          <label className={`wide ${planForm.keyPoints ? '' : 'empty'}`}><span>教学重点与学习难点（每行一项）</span><textarea rows="3" value={planForm.keyPoints} onChange={event => updatePlanField('keyPoints', event.target.value)} placeholder="重点写本课必须学会的内容；难点写学生最可能卡住的理解。"/>{!planForm.keyPoints && <small>请至少补充一项重点或难点，再确认本版。</small>}</label>
          <label className="wide"><span>本课目标补充</span><input value={planForm.teachingGoal} onChange={event => updatePlanField('teachingGoal', event.target.value)} placeholder="教师希望学生最终能够……"/></label>
        </div>
        <footer><div><b>{!planFormReady && !workflowState.cardsGenerated ? '先补齐课堂主线、目标与重难点' : workflowState.teacherConfirmed ? '本版已经确认' : '确认前请检查'}</b><small>{!planFormReady && !workflowState.cardsGenerated ? '缺失内容会在上方明确标出；系统不会拿空表单生成三卡。' : workflowState.teacherConfirmed ? '可以直接生成三卡；失败重试不会重复确认，也不会丢失这份定稿。' : '篇目、课时、目标、重难点和材料依据是否符合你的班级。'}</small></div><button type="button" onClick={savePlan} disabled={saving || !planDirty}>{saving ? '正在保存…' : '保存当前修改'}</button><button type="button" className="primary" onClick={confirmAndGenerate} disabled={saving || Boolean(generating) || planDirty || (!planFormReady && !workflowState.cardsGenerated)}>{generating === 'all' ? CARD_GENERATION_STEPS[generationStage] : workflowState.cardsGenerated ? '重新生成未锁定三卡' : workflowState.teacherConfirmed ? '生成板书与三卡' : '确认本版并生成三卡'}</button></footer>
      </section>
      {generating && <section className="panel card-generation-progress" role="status" aria-live="polite"><div className="card-generation-spinner"><Activity/></div><div><span>{generating === 'all' ? '正在生成一课三卡' : '正在重新生成当前卡片'}</span><h2>{CARD_GENERATION_STEPS[generationStage]}</h2><p>系统会先形成课堂初稿，再核对教师用书、学生教材、问题递进和评价标准。页面可以停留在这里，原有内容会保留到新结果完整保存。</p><ol>{CARD_GENERATION_STEPS.map((step, index) => <li className={index < generationStage ? 'done' : index === generationStage ? 'active' : ''} key={step}><i>{index < generationStage ? <Check size={13}/> : index + 1}</i><b>{step}</b></li>)}</ol></div></section>}
      <PeriodPlanner draft={draft} onSaved={saved => { setDraft(saved); setCards(withBoardPlan(Array.isArray(saved.cards) ? saved.cards : cards, saved.answer?.lesson?.coreQuestion || saved.question || saved.title || '')); setPlanForm(planFormFromDraft(saved)); }}/>
      {history && <section className="panel cards-history"><header><div><span>方案历史</span><h2>先对比，再决定是否恢复</h2><p>恢复会把方案带回所选版本；当前已锁定的课堂卡片不会被覆盖。</p></div><button type="button" onClick={() => setHistory(null)}><X/>关闭</button></header><div>{(history.versions || []).length ? history.versions.map(item => <article key={item.id}><b>{item.id === 'current' ? '当前' : `V${item.version || '—'}`}</b><span>{item.id === 'current' ? '当前方案' : item.reason || '已保存版本'}</span><small>{item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : '—'}</small>{item.id === 'current' ? <Badge tone="green">正在使用</Badge> : <div className="cards-history-actions"><button type="button" onClick={() => compareHistory(item.id)} disabled={Boolean(historyWorking)}>{historyWorking === `compare:${item.id}` ? '对比中…' : '对比当前'}</button><button type="button" onClick={() => restoreHistory(item.id)} disabled={Boolean(historyWorking)}>{historyWorking === `restore:${item.id}` ? '恢复中…' : '恢复此版'}</button></div>}</article>) : <p>当前还没有可回看的历史版本。</p>}</div>{history.comparison && <div className="asset-comparison"><header><b>与当前方案的差异</b><small>{history.comparison.changed ? `${history.comparison.changes.length} 处变化` : '主要内容一致'}</small></header>{history.comparison.changes?.length ? <ul>{history.comparison.changes.map(change => <li key={change.field}><b>{change.label}</b><span>旧版：{change.before}</span><span>当前：{change.after}</span></li>)}</ul> : <p>所选版本与当前方案的主要内容一致。</p>}</div>}</section>}
      {!workflowState.cardsGenerated && <section className="panel cards-generation-gate"><div><FileCheck2/></div><span>下一步</span><h2>教师确认后再生成板书与三卡</h2><p>当前只有可编辑的方案草稿。保存修改并点击“确认本版”后，系统才会调用生成服务；不会把问答阶段的模型建议冒充为最终卡片。</p></section>}
      {workflowState.cardsGenerated && <>
      <TeachingBrief brief={teachingBrief}/>
      <TeachingEvidenceChain chain={teachingEvidenceChain} returnTo={cardsReaderReturn}/>
      <section className="worksheet-entry panel"><div className="worksheet-entry-mark"><FileText/><span>03</span></div><div><span>正式课堂材料</span><h2>把定稿三卡整理成学生页与教师页</h2><p>学生页只给任务和学生教材页码；教师页保留观察要点与教师用书依据。下载后可以分别打印，不会把参考提示提前交给学生。</p></div><a className="primary" href={`/worksheet/?draftId=${encodeURIComponent(draftId)}`}>生成双页课堂任务单 <ArrowRight/></a></section>
      <section className="board-preview panel">
        <header className="board-preview-head"><div><Badge tone="gold"><PanelTop/> 板书预览</Badge><h2>先留出问题，再跟着学生的回答补写</h2><p>课堂开始只显示课题和核心问题；学生说出关键词后，再展开教材依据、归纳结论，并保留教师现场补写的空间。</p></div><div className="board-preview-head-actions"><div className="board-preview-step"><b>0{revealed}</b><span>/ 05</span><small>{stages[revealed - 1]}</small></div><div className="board-export-actions"><button type="button" className={writingRehearsal ? 'active' : ''} onClick={() => setWritingRehearsal(value => !value)}>{writingRehearsal ? '收起落笔排练' : '查看落笔排练'}</button><button type="button" onClick={() => exportBoard('svg')}>导出 SVG</button><button type="button" onClick={() => exportBoard('png')}>导出 PNG</button><button type="button" className="offline-pack-button" onClick={exportOfflineClassroomPack}><Download/>下载离线课堂包</button></div></div></header>
      <div className="board-preview-canvas"><MindMapBoard title={lessonTitle} coreQuestion={boardCoreQuestion} items={(board && board.items) || []} stage={revealed} filterId="boardPreviewGlow" showWriteOrder={writingRehearsal}/><div className="board-stage-guide"><div><span>本步出现什么</span><b>{stageGuide[revealed - 1].reveal}</b></div><div><span>教师怎么追问</span><p>{stageGuide[revealed - 1].prompt}</p></div><div><span>学生留下什么</span><p>{stageGuide[revealed - 1].student}</p></div><div><span>下一步</span><p>{stageGuide[revealed - 1].next}</p></div></div></div>
      <section className={`board-writing-rehearsal ${boardWritingPlan.status}${writingRehearsal ? ' open' : ''}`}>
        <header><div><span>板书落笔排练</span><h3>这不是一张展示图，而是一块真正要写完的黑板</h3><p>系统只计算粉笔字量和书写顺序，不替教师改写已确认的板书内容。</p></div><div className="board-writing-metrics"><span><b>{boardWritingPlan.itemCount}</b> 条要点</span><span><b>{boardWritingPlan.totalChars}</b> 个可写字</span><span><b>约 {boardWritingPlan.estimatedMinutes}</b> 分钟</span><Badge tone={boardWritingPlan.status === 'ready' ? 'green' : 'orange'}>{boardWritingPlan.status === 'ready' ? '适合落笔' : '建议收缩'}</Badge></div></header>
        {writingRehearsal && <><div className="board-writing-steps">{boardWritingPlan.steps.map(step => <article className={revealed === step.stage ? 'active' : ''} key={step.stage} onClick={() => setRevealed(step.stage)}><span>0{step.stage}</span><small>{step.when}</small><b>{step.write.length ? step.write.join(' · ') : '本步不预写答案'}</b><p>{step.leave}</p><em>预计 {step.seconds} 秒</em></article>)}</div>{boardWritingPlan.issues.length > 0 && <div className="board-writing-issues"><CircleAlert/><div><b>上黑板前建议调整</b>{boardWritingPlan.issues.map(item => <p key={item}>{item}</p>)}</div></div>}</>}
      </section>
        <footer className="board-preview-footer"><div className="board-step-tabs">{stages.map((stage, index) => <button type="button" className={revealed === index + 1 ? 'active' : ''} key={stage} onClick={() => setRevealed(index + 1)}><span>0{index + 1}</span>{stage}</button>)}</div><button type="button" className="primary" onClick={startClassroom} disabled={!classroomReady}><Maximize2/>{classroomReady ? classroomCta : '请先生成板书卡'}</button></footer>
      </section>
      <section className="card-workspace panel">
        <header className="card-workspace-head"><div><span>课堂产物</span><h2>三张卡，分别对应课堂中的三个动作</h2><p>先选一张卡作为主编辑区；每条内容都可以修改、保存、锁定，并从依据芯片回到真实教材页面。</p></div><Badge tone="gold">{currentCard?.status === 'locked' ? '当前卡已锁定' : workflowCopy}</Badge></header>
        <nav className="card-nav" aria-label="选择课堂卡片">{cards.map((card, index) => <button type="button" className={`card-nav-item card-nav-${card.type}${activeCard === index ? ' active' : ''}`} aria-current={activeCard === index ? 'step' : undefined} onClick={() => setActiveCard(index)} key={card.id || (card.type + '-' + index)}><span className="card-nav-number">0{index + 1}</span><span><small className="card-nav-role">{CARD_META[card.type]?.role || '课堂行动'}</small><b>{card.title}</b><small>{card.subtitle || '把教材依据整理成课堂动作'}</small></span><em>{card.status === 'locked' ? '已锁定' : (card.items || []).length + ' 项内容'}</em><ChevronRight/></button>)}</nav>
        <div className="card-editor-layout">
          {currentCard && <article className={`card-editor card-editor-${currentCard.type}`}>
            <header className="card-editor-head"><div><span className="card-editor-kicker">{workflowCopy}</span><h3>{currentCard.title}</h3><p>{currentCard.subtitle || '把教材依据整理成课堂动作'}</p></div><Badge tone={currentCard.status === 'locked' ? 'gold' : dirty ? 'orange' : 'green'}>{currentCard.status === 'locked' ? '已锁定' : dirty ? '待保存' : '已保存'}</Badge></header>
            <div className="card-ribbon"><span>{workflowCopy}</span><i/></div>
            <div className="card-editor-guidance"><Sparkles/><div><b>这一张卡怎么写</b><p>{cardEditGuidance(currentCard.type)}</p></div></div>
            <ul className="card-items">{(currentCard.items || []).length ? (currentCard.items || []).map((item, itemIndex) => <li key={item.id || (currentCard.id + '-' + itemIndex)}><div className="card-item-mark"><Check/></div><div className="card-item-body"><textarea rows={3} value={item.text || ''} disabled={currentCard.status === 'locked'} onChange={event => updateItem(activeCard, itemIndex, event.target.value)} aria-label={currentCard.title + '第' + (itemIndex + 1) + '项'}/><div className="card-item-meta"><span>0{itemIndex + 1}</span><span className="source-type-chip">{sourceTypeLabel(item.sourceType)}</span>{cardItemNeedsDetail(currentCard.type, item.text) && currentCard.status !== 'locked' && <span className="detail-needed-chip">建议补全</span>}<CardSourceList citations={(draft && draft.citations) || []} refs={item.citationIds} returnTo={cardsReaderReturn}/></div></div></li>) : <li className="card-empty"><Sparkles/><span>这张卡暂时还没有内容。可以回到备课问答重新生成，也可以先保留这张卡，稍后补写。</span></li>}</ul>
            <footer className="card-actions"><span className={'save-state ' + (dirty ? 'pending' : '')}>{saving ? '正在保存…' : dirty ? '有未保存修改' : '内容已保存'}</span>{currentCard.status !== 'locked' && <><button type="button" onClick={() => save(cards)} disabled={saving || !dirty}>{saving ? '保存中' : '保存修改'}</button><button type="button" onClick={() => regenerate(currentCard)} disabled={Boolean(generating)}>{generating === currentCard.id ? '正在依据中生成' : currentCard.items?.some(item => cardItemNeedsDetail(currentCard.type, item.text)) ? '补全本卡' : '重新生成本卡'}</button><button type="button" onClick={() => lock(currentCard)} disabled={saving}>锁定本卡</button></>}<a href={draftId ? `/ask/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>回到本课问答</a></footer>
          </article>}
          <aside className="card-editor-rail"><div className="rail-note"><span>当前动作</span><b>{workflowCopy}</b><p>{CARD_META[currentCard?.type]?.rail || '把教材依据转成可以直接使用的课堂行动。'}</p></div><div className="rail-note rail-paper"><span>依据提示</span><b>优先看教师用书</b><p>教师用书中的教学建议优先作为课堂组织参考；学生教材用于锁定原文、任务和学习证据。</p></div></aside>
        </div>
      </section>
      </>}
    </>}
    {!busy && showEmpty && <section className="cards-empty-state panel"><div className="empty-orbit"><Layers3/></div><h2>从一个备课问题开始</h2><p>选定篇目并生成方案后，这里会出现板书、提问和评价三张课堂卡。</p><div><a className="primary" href="/ask/">去备课问答</a><a href="/library/">先选一篇教材</a></div></section>}
    {classroom && <div className="classroom-overlay"><div className="classroom-session" ref={classroomRef} role="dialog" aria-modal="true" aria-label="课堂共创记录" tabIndex={-1}><button type="button" className="classroom-close" onClick={closeClassroom} aria-label="关闭课堂模式"><X/></button><div className="blackboard-shell"><div className="blackboard-topline"><span>课堂共创板书 · 只记录学生真正说出的内容</span><b>第 {revealed} / {stages.length} 步</b></div>{preClassCue && <section className={`classroom-pulse-cue ${preClassCue.level}`}><div><span>课前学情摸底 · {preClassCue.counts.responded} 人完成判断</span><b>{preClassCue.teacherDecision === 'adopt' ? preClassCue.title : '教师决定保持原课堂主线'}</b><p>{preClassCue.teacherDecision === 'adopt' ? preClassCue.openingMove : '摸底结果已保留；课堂仍按教师原定主线开始，必要时再使用下方教材追问。'}</p></div><CardSourceList citations={draft?.citations || []} refs={preClassCue.citationIds} returnTo={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}/></section>}<section className="classroom-adaptation" aria-label="课堂应变"><header><div><span>课堂应变</span><b>现在课堂进行得怎样？</b></div><small>{classroomReadOnly ? '本节课的应变记录已确认' : '选择现场情况，系统只用已确认的三卡和教材依据调整下一步。'}</small></header><div className="classroom-pace-options">{[['on_track','节奏正常','继续当前步骤'],['time_short','时间不足','保住主问和收束'],['students_stuck','学生卡住','降低一步再回原文'],['ahead','提前完成','在本篇内加深']].map(([value,label,help]) => <button type="button" key={value} className={classroomRun.paceSignal === value ? 'active' : ''} aria-pressed={classroomRun.paceSignal === value} disabled={classroomReadOnly} onClick={() => markClassroomPace(value)}><span>{label}</span><small>{help}</small></button>)}</div>{classroomAdaptation && <div className="classroom-adaptation-advice" data-signal={classroomAdaptation.signal}><div className="classroom-adaptation-copy"><span>下一步建议</span><h3>{classroomAdaptation.title}</h3><p><b>现在这样做：</b>{classroomAdaptation.primaryAction}</p><p><b>随后这样收：</b>{classroomAdaptation.secondaryAction}</p><small>{classroomAdaptation.note}</small></div><CardSourceList citations={draft?.citations || []} refs={classroomAdaptation.citationIds} returnTo={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}/></div>}</section>{rehearsalClassroomStep && <section className="classroom-rehearsal-cue"><div><span>课前预演问题</span><b>{rehearsalClassroomStep.question}</b></div><div><span>备用追问</span><p>{rehearsalClassroomStep.branches?.[rehearsalClassroomStep.selectedOutcome] || '根据学生回答决定是否继续追问。'}</p></div><CardSourceList citations={draft?.citations || []} refs={rehearsalClassroomStep.citationIds} returnTo={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}/></section>}<MindMapBoard title={lessonTitle} coreQuestion={boardCoreQuestion} items={(board && board.items) || []} stage={revealed} classroomRun={classroomRun}/><div className="blackboard-caption"><strong>{stages[revealed - 1]}</strong><span>{stageGuide[revealed - 1].prompt}</span><small>{stageGuide[revealed - 1].student} {stageGuide[revealed - 1].next}</small><small className="classroom-writing-cue"><b>落笔提示：</b>{boardWritingPlan.steps[revealed - 1]?.write.join(' · ') || '本步不预写答案'} · 约 {boardWritingPlan.steps[revealed - 1]?.seconds || 0} 秒</small></div></div><section className="classroom-record-strip" aria-label="课堂现场记录"><div className="classroom-record-copy"><span>本步课堂情况</span><b>{classroomReadOnly ? '这份课堂记录已经由教师确认' : '点一下即可，不需要在课堂上写长文'}</b><small>{classroomSaving ? '正在保存课堂记录…' : classroomNotice || (classroomDirty ? '本次标记暂存在本机，关闭或结束课堂时会保存。' : '课堂记录已保存到当前账号。')}</small>{classroomConflictRun && <div className="classroom-conflict-actions"><button type="button" onClick={() => chooseClassroomRecord(true)}>使用本机记录</button><button type="button" onClick={() => chooseClassroomRecord(false)}>保留账号记录</button></div>}</div><div className="classroom-outcome-grid">{[['reached','学生已经说出'],['needs_followup','还需要追问'],['not_used','本步未展开']].map(([value, label]) => <button type="button" className={currentStageOutcome === value ? 'active' : ''} aria-pressed={currentStageOutcome === value} disabled={classroomReadOnly} onClick={() => markClassroomStage(value)} key={value}><CheckCircle2/>{label}</button>)}</div><div className="classroom-keyword-box"><label><span>学生关键词（最多 3 个）</span><div><input value={classroomKeyword} maxLength={16} disabled={classroomReadOnly || classroomRun.keywords.length >= 3} onChange={event => setClassroomKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addClassroomKeyword(); } }} placeholder={classroomRun.keywords.length >= 3 ? '已记录 3 个关键词' : '不写姓名，只记关键词'}/><button type="button" onClick={addClassroomKeyword} disabled={classroomReadOnly || !classroomKeyword.trim() || classroomRun.keywords.length >= 3}>记下</button></div></label><div className="classroom-keywords">{classroomRun.keywords.map(item => <span key={item.id}>{item.text}{!classroomReadOnly && <button type="button" onClick={() => removeClassroomKeyword(item.id)} aria-label={`删除关键词${item.text}`}><X/></button>}</span>)}</div></div><section className="classroom-moment-panel" aria-label="课堂随手记"><header><div><span>课堂随手记</span><b>第 {classroomElapsedMinutes()} 分钟 · 一次只记一个可观察事实</b></div><small>{classroomReadOnly ? '本节课堂时间线已确认' : `已记录 ${classroomRun.moments.length} / 24 条；不写学生姓名，不需要课后重新回忆。`}</small></header><div className="classroom-moment-entry"><input value={classroomMoment} maxLength={80} disabled={classroomReadOnly || classroomRun.moments.length >= 24} onChange={event => setClassroomMoment(event.target.value)} placeholder="可选：补一句学生表现、原话摘要或时间变化"/><div>{[['breakthrough','说通了'],['confusion','共同卡点'],['question','意外好问题'],['timing','时间变化']].map(([type,label]) => <button type="button" key={type} disabled={classroomReadOnly || classroomRun.moments.length >= 24} onClick={() => recordClassroomMoment(type)} data-type={type}><Plus/>{label}</button>)}</div></div>{classroomRun.moments.length > 0 && <ol className="classroom-moment-timeline">{classroomRun.moments.slice().reverse().slice(0, 8).map(item => <li key={item.id} data-type={item.type}><time>{item.elapsedMinutes}′</time><span><b>{{ breakthrough:'说通了', confusion:'共同卡点', question:'意外好问题', timing:'时间变化' }[item.type]}</b><small>{item.text}</small></span>{!classroomReadOnly && <button type="button" onClick={() => deleteClassroomMoment(item.id)} aria-label={`删除课堂记录：${item.text}`}><X/></button>}</li>)}</ol>}</section></section><footer className="classroom-controls"><button type="button" onClick={() => changeClassroomStage(1)} disabled={revealed === 1 || classroomReadOnly}>恢复初始</button><button type="button" onClick={() => changeClassroomStage(revealed - 1)} disabled={revealed === 1 || classroomReadOnly}><ArrowLeft/>上一步</button><span>课堂展开：{stages[revealed - 1]}</span><button type="button" onClick={() => changeClassroomStage(revealed + 1)} disabled={revealed === stages.length || classroomReadOnly}>{revealed === stages.length ? '已到最后一步' : '下一步'}<ArrowRight/></button><button type="button" onClick={() => saveClassroomRun()} disabled={classroomSaving || classroomReadOnly || !classroomDirty}>{classroomSaving ? '保存中…' : '保存现场记录'}</button><button type="button" onClick={toggleFullscreen}><Maximize2/>全屏投影</button>{!classroomReadOnly && <button type="button" className="primary" onClick={finishClassroom} disabled={classroomSaving}>结束并整理复盘</button>}</footer></div></div>}
  </div>;
}

function rehearsalRecoveryKey(userId, draftId) { return `huojiaocan:rehearsal:${userId}:${draftId}`; }
function readRehearsalRecovery(userId, draftId) {
  try { const value = JSON.parse(localStorage.getItem(rehearsalRecoveryKey(userId, draftId)) || 'null'); return value?.userId === userId && value?.draftId === draftId ? value : null; } catch { return null; }
}
function clearRehearsalRecovery(userId, draftId) { try { localStorage.removeItem(rehearsalRecoveryKey(userId, draftId)); } catch {} }

function RehearsalPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [rehearsal, setRehearsal] = useState(() => emptyQuestionRehearsal());
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const userId = String(session?.user?.id || '');
  useEffect(() => {
    if (!userId) { if (session !== undefined) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定课堂方案。请先从一课三卡打开本次预演。'); setBusy(false); return; }
    let active = true;
    setBusy(true); setError('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (!active) return;
      const next = data.draft || data;
      const serverRehearsal = normalizeQuestionRehearsal(next.answer?.questionRehearsal || {});
      const recovery = readRehearsalRecovery(userId, draftId);
      const recoverable = recovery && Number(recovery.baseVersion) === Number(next.version)
        && recovery.sourceKey === serverRehearsal.sourceKey && serverRehearsal.status !== 'confirmed';
      setDraft(next);
      setRehearsal(recoverable ? normalizeQuestionRehearsal(recovery.rehearsal) : serverRehearsal);
      setDirty(Boolean(recoverable));
      if (recoverable) setMessage('已恢复本机尚未保存的预演选择，请核对后保存。');
    }).catch(err => { if (active) setError(askErrorMessage(err)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [draftId, userId, session]);
  useEffect(() => {
    if (!dirty || !draft?.version || !userId || !draftId) return;
    try { localStorage.setItem(rehearsalRecoveryKey(userId, draftId), JSON.stringify({ userId, draftId, baseVersion: draft.version, sourceKey: rehearsal.sourceKey, rehearsal })); } catch {}
  }, [dirty, draft?.version, draftId, rehearsal, userId]);
  useEffect(() => {
    const warn = event => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const generate = async () => {
    if (!draft || working) return;
    setWorking('generate'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/rehearsal/generate`, { method: 'POST', body: { version: draft.version } });
      const saved = data.draft || draft;
      setDraft(saved); setRehearsal(normalizeQuestionRehearsal(data.rehearsal || saved.answer?.questionRehearsal)); setDirty(false);
      clearRehearsalRecovery(userId, draftId);
      setMessage('问题链已经整理成可逐题预演的课堂路径。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'plan_confirmation_required' ? '请先在一课三卡中确认教学方案，再开始课前预演。' : code === 'rehearsal_evidence_required' ? '提问卡还缺少可核验的教材依据，请先补全并保存提问卡。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const updateStep = (stepId, patch) => {
    if (rehearsal.status === 'confirmed') return;
    setRehearsal(current => normalizeQuestionRehearsal({ ...current, steps: current.steps.map(item => item.id === stepId ? { ...item, ...patch } : item) }));
    setDirty(true); setMessage('');
  };
  const selectStep = index => { setRehearsal(current => normalizeQuestionRehearsal({ ...current, currentStep: index })); setDirty(rehearsal.status !== 'confirmed'); };
  const persist = async confirm => {
    if (!draft || working || rehearsal.status === 'confirmed') return;
    const progress = rehearsalProgress(rehearsal);
    if (confirm && !progress.complete) { setError('请先为每个问题选择一种课堂情况，再确认本次上课路径。'); return; }
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/rehearsal`, { method: 'PATCH', body: { version: draft.version, rehearsal, confirm } });
      const saved = data.draft || draft;
      setDraft(saved); setRehearsal(normalizeQuestionRehearsal(data.rehearsal || saved.answer?.questionRehearsal)); setDirty(false);
      clearRehearsalRecovery(userId, draftId);
      setMessage(confirm ? '本次问题路径已确认。课堂中仍由你根据学生回答决定下一步。' : '预演记录已保存到当前账号。');
    } catch (err) { const code = requestCode(err); setError(code === 'edit_conflict' ? '这份方案已在其他页面更新。请刷新后继续，当前选择仍保留在页面中。' : code === 'rehearsal_stale' ? '提问卡或教材依据已经更新，请先按最新内容重新整理预演。' : code === 'rehearsal_incomplete' ? '请先为每个问题选择一种课堂情况。' : askErrorMessage(err)); }
    finally { setWorking(''); }
  };
  const progress = rehearsalProgress(rehearsal);
  const step = rehearsal.steps[rehearsal.currentStep] || null;
  const readOnly = rehearsal.status === 'confirmed';
  const stale = draft ? questionRehearsalIsStale({ ...draft, answer: { ...(draft.answer || {}), questionRehearsal: rehearsal } }) : false;
  return <div className="view-stack rehearsal-page">
    <section className="rehearsal-cover panel"><div><Badge tone="gold"><Route/> 课前问题链预演</Badge><h1>{draft?.title || '先把问题走一遍，再带进课堂'}</h1><p>这不是模拟学生聊天，而是逐题检查课堂能否继续：学生答到了怎样收束，答偏了怎样追问，沉默时怎样降低门槛。所有原文位置仍来自已核验教材依据。</p></div><div className="rehearsal-cover-actions"><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}><ArrowLeft/>返回课堂设计</a>{progress.total > 0 && !stale && <a className="primary" href={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}><PanelTop/>{readOnly ? '打开带预演提示的课堂' : '返回板书课堂'}</a>}</div></section>
    {error && <section className="ask-error" role="alert"><CircleAlert/><span>{error}</span></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {stale && <section className="cards-alert" role="status"><div className="cards-alert-icon"><RefreshCw/></div><div className="cards-alert-copy"><b>提问卡已经更新，这份预演需要重新整理</b><p>旧记录仍保留在当前页面，但不能作为本次上课路径。重新整理只读取最新提问卡和教材依据。</p></div><div className="cards-alert-actions"><button type="button" className="primary" onClick={generate} disabled={Boolean(working)}>按最新提问卡重新整理</button></div></section>}
    {busy ? <section className="panel rehearsal-empty"><Activity/><h2>正在读取本课问题链</h2><p>只读取当前账号中的方案、提问卡和教材依据。</p></section> : !progress.total ? <section className="panel rehearsal-empty"><Route/><span>开始前</span><h2>把提问卡整理成一条可走通的课堂路径</h2><p>系统从教师已经确认的提问卡中抽取主问、预期学生行动和真实教材页，不接收浏览器提交的页码或引用身份。</p><button type="button" className="primary" onClick={generate} disabled={working === 'generate'}>{working === 'generate' ? '正在整理问题链…' : '生成本次课前预演'}</button></section> : <>
      <section className="panel rehearsal-progress"><div><span>本次上课路径</span><b>{progress.decided} / {progress.total} 个问题已经预演</b><small>{readOnly ? '教师已确认，当前为只读记录。' : '每题只选最担心的一种课堂情况，形成备用路径。'}</small></div><div className="rehearsal-line">{rehearsal.steps.map((item, index) => <button type="button" key={item.id} className={`${index === rehearsal.currentStep ? 'active' : ''} ${item.selectedOutcome ? 'done' : ''}`} onClick={() => selectStep(index)}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.selectedOutcome ? '已预演' : '待判断'}</b></button>)}</div></section>
      {step && <section className="rehearsal-workbench"><aside className="rehearsal-spine"><span>问题 {String(rehearsal.currentStep + 1).padStart(2, '0')}</span><b>{step.estimatedMinutes} 分钟</b><small>预计课堂用时</small><i/><small>问题不是越多越好；每一问都要能回到原文，并接得住学生的真实回答。</small></aside><article className="panel rehearsal-sheet"><header><div><span>当前主问</span><h2>{step.question}</h2></div><Badge tone={step.selectedOutcome ? 'green' : 'orange'}>{step.selectedOutcome ? '已选择备用路径' : '等待教师判断'}</Badge></header><div className="rehearsal-expect"><Target/><div><b>希望学生完成什么</b><p>{step.expectedAction}</p></div></div><div className="rehearsal-scenarios">{[
        ['reached', '学生答到了', '顺势收束', step.branches.reached],
        ['partial', '学生答偏了', '回到依据纠偏', step.branches.partial],
        ['silent', '课堂沉默', '拆小问题降阶', step.branches.silent]
      ].map(([value, title, label, content]) => <button type="button" key={value} disabled={readOnly} className={step.selectedOutcome === value ? 'active' : ''} aria-pressed={step.selectedOutcome === value} onClick={() => updateStep(step.id, { selectedOutcome: value })}><span>{label}</span><h3>{title}</h3><p>{content}</p><em>{step.selectedOutcome === value ? '本次采用' : '选择这条路径'}</em></button>)}</div><label className="rehearsal-note"><span>给自己的课堂提醒（可选）</span><textarea rows="3" maxLength="300" disabled={readOnly} value={step.teacherNote} onChange={event => updateStep(step.id, { teacherNote: event.target.value })} placeholder="例如：先给 40 秒静读时间，不急着点名。"/></label><footer><div><span>教材依据</span><CardSourceList citations={draft?.citations || []} refs={step.citationIds} returnTo={`/rehearsal/?draftId=${encodeURIComponent(draftId)}`}/></div><div><button type="button" onClick={() => selectStep(Math.max(0, rehearsal.currentStep - 1))} disabled={rehearsal.currentStep === 0}><ArrowLeft/>上一问</button><button type="button" onClick={() => selectStep(Math.min(progress.total - 1, rehearsal.currentStep + 1))} disabled={rehearsal.currentStep >= progress.total - 1}>下一问<ArrowRight/></button></div></footer></article></section>}
      <section className="panel rehearsal-summary"><div><span>预演结果</span><h2>{stale ? '先按最新提问卡重新整理' : progress.complete ? '这条问题链已经具备课堂备用路径' : `还剩 ${progress.total - progress.decided} 个问题需要判断`}</h2><p>{stale ? '方案内容已经变化，旧预演不会继续冒充当前课堂路径。' : progress.complete ? '确认后不会自动修改提问卡或母稿；它只保存为本次授课的课前准备。' : '逐题选择最可能出现的课堂情况，系统会保留对应追问和教材入口。'}</p></div><div><button type="button" onClick={() => persist(false)} disabled={stale || readOnly || !dirty || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存预演进度'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={stale || readOnly || !progress.complete || Boolean(working)}>{readOnly ? '本次路径已确认' : working === 'confirm' ? '正在确认…' : '确认本次上课路径'}</button></div></section>
    </>}
  </div>;
}

function pulseRecoveryKey(userId, draftId) { return `huojiaocan:pulse:${userId}:${draftId}`; }
function readPulseRecovery(userId, draftId) {
  try { const value = JSON.parse(localStorage.getItem(pulseRecoveryKey(userId, draftId)) || 'null'); return value?.userId === userId && value?.draftId === draftId ? value : null; } catch { return null; }
}
function clearPulseRecovery(userId, draftId) { try { localStorage.removeItem(pulseRecoveryKey(userId, draftId)); } catch {} }

function PreClassPulsePage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [pulse, setPulse] = useState(() => emptyPreClassPulse());
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const userId = String(session?.user?.id || '');
  useEffect(() => {
    if (!userId) { if (session !== undefined) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定课堂方案。请从一课三卡进入课前学情摸底。'); setBusy(false); return; }
    let active = true;
    setBusy(true); setError('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (!active) return;
      const next = data.draft || data;
      const serverPulse = normalizePreClassPulse(next.answer?.preClassPulse || {});
      const recovery = readPulseRecovery(userId, draftId);
      const recoverable = recovery && Number(recovery.baseVersion) === Number(next.version)
        && recovery.sourceKey === serverPulse.sourceKey && serverPulse.status !== 'confirmed';
      setDraft(next);
      setPulse(recoverable ? normalizePreClassPulse(recovery.preClassPulse) : serverPulse);
      setDirty(Boolean(recoverable));
      if (recoverable) setMessage('已恢复本机尚未保存的班级汇总，请核对后保存。');
    }).catch(err => { if (active) setError(askErrorMessage(err)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [draftId, userId, session]);
  useEffect(() => {
    if (!dirty || !draft?.version || !userId || !draftId) return;
    try { localStorage.setItem(pulseRecoveryKey(userId, draftId), JSON.stringify({ userId, draftId, baseVersion: draft.version, sourceKey: pulse.sourceKey, preClassPulse: pulse })); } catch {}
  }, [dirty, draft?.version, draftId, pulse, userId]);
  useEffect(() => {
    const warn = event => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const generate = async () => {
    if (!draft || working) return;
    setWorking('generate'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/preclass-pulse/generate`, { method: 'POST', body: { version: draft.version } });
      const saved = data.draft || draft;
      setDraft(saved); setPulse(normalizePreClassPulse(data.preClassPulse || saved.answer?.preClassPulse)); setDirty(false);
      clearPulseRecovery(userId, draftId);
      setMessage('课前判断题已从当前提问卡和教材依据中整理完成。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'plan_confirmation_required' ? '请先在一课三卡中确认教学方案，再建立课前摸底。' : code === 'preclass_pulse_evidence_required' ? '提问卡还缺少可核验的教材依据，请先补全并保存。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const update = patch => {
    if (pulse.status === 'confirmed') return;
    setPulse(current => normalizePreClassPulse({ ...current, ...patch }));
    setDirty(true); setMessage(''); setError('');
  };
  const persist = async confirm => {
    if (!draft || working || pulse.status === 'confirmed') return;
    const progress = preClassPulseProgress(pulse);
    if (confirm && !progress.complete) { setError('请先核对人数，并选择“采用建议”或“保持原方案”。'); return; }
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/preclass-pulse`, { method: 'PATCH', body: { version: draft.version, preClassPulse: pulse, confirm } });
      const saved = data.draft || draft;
      setDraft(saved); setPulse(normalizePreClassPulse(data.preClassPulse || saved.answer?.preClassPulse)); setDirty(false);
      clearPulseRecovery(userId, draftId);
      setMessage(confirm ? '本课真实起点已经确认，打开课堂时会显示这条起步提醒。' : '班级摸底已经保存到当前账号。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'edit_conflict' ? '这份方案已在其他页面更新。请刷新后继续，当前填写仍保留在本机。' : code === 'preclass_pulse_stale' ? '提问卡或教材依据已经变化，请按最新内容重新建立摸底。' : code === 'preclass_pulse_counts_invalid' ? '人数没有对齐：三种情况之和应等于已判断人数，已判断人数不能超过到课人数。' : code === 'preclass_pulse_contains_identifier' ? '这里只记录班级共同表现，请删除姓名、学号或联系方式。' : code === 'preclass_pulse_incomplete' ? '请核对人数并选择本课起步方式。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const progress = preClassPulseProgress(pulse);
  const stale = draft ? preClassPulseIsStale({ ...draft, answer: { ...(draft.answer || {}), preClassPulse: pulse } }) : false;
  const readOnly = pulse.status === 'confirmed';
  const recommendation = pulse.recommendation;
  const numberInput = (label, field, hint) => <label><span>{label}</span><input type="number" min="0" max="200" disabled={readOnly} value={pulse[field]} onChange={event => update({ [field]: event.target.value })}/><small>{hint}</small></label>;
  return <div className="view-stack pulse-page">
    <section className="pulse-hero"><div><Badge tone="gold"><Gauge/> 三分钟课前诊断</Badge><h1>{draft?.title || '先确认学生从哪里出发'}</h1><p>课前用一至两个教材问题快速观察班级起点，再决定本课是先搭台阶、按原主线推进，还是直接进入比较与解释。这里只记录班级人数和共同表现，不建立学生画像。</p></div><div className="pulse-flow"><span><b>01</b>回到教材</span><i/><span><b>02</b>汇总人数</span><i/><span><b>03</b>确定起步</span></div></section>
    <section className="pulse-privacy"><ShieldCheck/><div><b>只保存班级聚合结果</b><p>不要填写姓名、学号、逐人分数或粘贴学生原始作答。摸底结果只用于调整课堂起步，不会替代教材依据。</p></div><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}><ArrowLeft/>返回课堂设计</a></section>
    {error && <section className="ask-error" role="alert"><CircleAlert/><span>{error}</span></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {stale && <section className="cards-alert"><div className="cards-alert-icon"><RefreshCw/></div><div className="cards-alert-copy"><b>提问卡已经更新，这份摸底需要重新建立</b><p>旧记录不会冒充当前课堂起点。重新建立只读取最新提问卡和教材依据，已确认的旧记录仍会归档。</p></div><div className="cards-alert-actions"><button type="button" className="primary" onClick={generate} disabled={Boolean(working)}>按最新内容重新建立</button></div></section>}
    {busy ? <section className="panel pulse-empty"><Activity/><h2>正在读取本课准备</h2><p>只读取当前账号中的方案、提问卡和教材依据。</p></section> : !pulse.prompts.length ? <section className="panel pulse-empty"><Gauge/><span>课前 3 分钟</span><h2>从本课提问卡抽出一组快速判断题</h2><p>系统不会另编知识题，而是从教师已经确认的课堂问题中选择一至两个有真实教材页支撑的问题。</p><button type="button" className="primary" onClick={generate} disabled={!draft || working === 'generate'}>{working === 'generate' ? '正在建立…' : '建立本课学情摸底'}</button></section> : <>
      <section className="pulse-workbench">
        <article className="panel pulse-questions"><header><span>第一步 · 学生先回到教材</span><h2>用真实课堂问题判断起点</h2><p>不要求完整作答，只观察学生能否找到词句，并把词句与判断连起来。</p></header><div>{pulse.prompts.map((item, index) => <section key={item.id}><span>判断 {String(index + 1).padStart(2, '0')}</span><h3>{item.prompt}</h3><div><b>学生怎么做</b><p>{item.studentAction}</p></div><div><b>教师看什么</b><p>{item.observeFor}</p></div><footer><CardSourceList citations={draft?.citations || []} refs={item.citationIds} returnTo={`/pulse/?draftId=${encodeURIComponent(draftId)}`}/></footer></section>)}</div></article>
        <article className="panel pulse-tally"><header><span>第二步 · 只记真实人数</span><h2>班级现在处在哪个起点</h2><p>三种情况之和必须等于已完成判断人数。</p></header><div className="pulse-count-grid">{numberInput('到课人数', 'presentCount', '本节实际到课')}{numberInput('已判断人数', 'respondedCount', '完成快速判断')}{numberInput('理解较稳', 'secureCount', '能找词句并解释')}{numberInput('部分理解', 'partialCount', '能找到但解释不完整')}{numberInput('暂未进入', 'notYetCount', '还不能定位或说明')}</div>{!progress.distributionValid && (pulse.presentCount > 0 || pulse.respondedCount > 0) && <p className="pulse-count-error">请核对人数：理解较稳、部分理解、暂未进入之和应等于已判断人数；已判断人数不能超过到课人数。</p>}<label className="pulse-observation"><span>班级共同表现（可选）</span><textarea rows="4" maxLength="360" disabled={readOnly} value={pulse.observedPattern} onChange={event => update({ observedPattern: event.target.value })} placeholder="例如：多数学生能说出“壮阔”，但还没有指出“衔”“吞”两个动词。"/><small>只写共同现象，不写学生姓名或联系方式。</small></label></article>
      </section>
      <section className={`panel pulse-recommendation ${recommendation?.level || 'waiting'}`}><header><div><span>第三步 · 教师确定课堂起步</span><h2>{recommendation?.title || '人数核对完成后，系统给出起步建议'}</h2><p>{recommendation?.rationale || '建议只根据本次班级汇总和当前提问卡形成，不会补造学生表现。'}</p></div><Badge tone={readOnly ? 'green' : recommendation ? 'gold' : 'neutral'}>{readOnly ? '教师已确认' : recommendation ? '等待教师决定' : '等待人数'}</Badge></header>{recommendation && <div className="pulse-opening"><Target/><div><span>建议这样开始</span><b>{recommendation.openingMove}</b><p><strong>接着追问：</strong>{recommendation.nextPrompt}</p><CardSourceList citations={draft?.citations || []} refs={recommendation.citationIds} returnTo={`/pulse/?draftId=${encodeURIComponent(draftId)}`}/></div></div>}<div className="pulse-decisions"><button type="button" disabled={readOnly || !recommendation} className={pulse.teacherDecision === 'adopt' ? 'active' : ''} onClick={() => update({ teacherDecision: 'adopt' })}><CheckCircle2/><span><b>采用这条起步建议</b><small>课堂打开时优先显示</small></span></button><button type="button" disabled={readOnly || !recommendation} className={pulse.teacherDecision === 'keep_original' ? 'active' : ''} onClick={() => update({ teacherDecision: 'keep_original' })}><Route/><span><b>保持原来的课堂主线</b><small>保留摸底记录，不改变起步</small></span></button></div><footer><div><b>{readOnly ? '本课起点已经确认' : dirty ? '本次汇总还未保存' : '当前内容已保存'}</b><small>确认后只形成课堂提醒，不改写篇目、核心问题、板书或已锁定三卡。</small></div><button type="button" onClick={() => persist(false)} disabled={readOnly || stale || !dirty || !progress.ready || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存班级汇总'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={readOnly || stale || !progress.complete || Boolean(working)}>{readOnly ? '本课起点已确认' : working === 'confirm' ? '正在确认…' : '确认并带入课堂'}</button>{readOnly && <a className="primary" href={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}><PanelTop/>打开本节课堂</a>}</footer></section>
    </>}
  </div>;
}

function ClassroomWorksheetPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [activePage, setActivePage] = useState('student');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const userId = String(session?.user?.id || '');
  useEffect(() => {
    if (!userId) { if (session !== undefined) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定课堂方案。请从一课三卡打开双页课堂任务单。'); setBusy(false); return; }
    let active = true;
    setBusy(true); setError('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => { if (active) setDraft(data.draft || data); }).catch(err => { if (active) setError(askErrorMessage(err)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [draftId, userId, session]);
  const approved = draft?.answer?.planApproval?.status === 'confirmed' && draft?.answer?.planApproval?.hasUnconfirmedChanges !== true;
  const lessonTitle = planIdentity(draft?.answer?.lesson?.title || draft?.title || draft?.question, '课堂任务单');
  const worksheet = useMemo(() => buildClassroomWorksheet({
    title: lessonTitle,
    coreQuestion: draft?.answer?.lesson?.coreQuestion || draft?.question || '',
    cards: approved ? draft?.cards || [] : [],
    citations: approved ? draft?.citations || [] : []
  }), [lessonTitle, draft?.answer?.lesson?.coreQuestion, draft?.question, draft?.cards, draft?.citations, approved]);
  const pack = useMemo(() => buildClassroomWorksheetHtml(worksheet), [worksheet]);
  const download = () => {
    if (worksheet.status === 'blocked') return;
    const url = URL.createObjectURL(new Blob([pack.html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = pack.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('双页任务单已下载。打开文件后可分别打印学生页、教师页或两页。');
  };
  const openPrint = () => {
    if (worksheet.status === 'blocked') return;
    const url = URL.createObjectURL(new Blob([pack.html], { type: 'text/html;charset=utf-8' }));
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) setNotice('浏览器阻止了新窗口。可以先下载任务单，再打开文件打印。');
    else setNotice('打印页已打开，可选择只打印学生页、只打印教师页或两页。');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const pageTask = item => activePage === 'student' ? <article className="worksheet-task" key={item.id}><header><span>{item.level}</span><div><small>{item.title}</small><h2>{item.prompt}</h2></div></header><p>{item.studentAction}</p><CardSourceList citations={draft?.citations || []} refs={item.studentCitations.map(citation => citation.id)} returnTo={`/worksheet/?draftId=${encodeURIComponent(draftId)}`}/><div className="worksheet-lines">{Array.from({ length: item.blankLines }, (_, index) => <i key={index}/>)}</div></article> : <article className="worksheet-teacher-task" key={item.id}><header><span>{item.level}</span><div><small>{item.title}</small><h2>{item.prompt}</h2></div></header><dl><div><dt>学生任务</dt><dd>{item.studentAction}</dd></div><div><dt>教师观察</dt><dd>{item.observeFor}</dd></div><div><dt>教材依据</dt><dd><CardSourceList citations={draft?.citations || []} refs={item.teacherCitations.map(citation => citation.id)} returnTo={`/worksheet/?draftId=${encodeURIComponent(draftId)}`}/></dd></div></dl><div className="worksheet-teacher-lines"><b>课堂记录</b><i/><i/></div></article>;
  return <div className="view-stack worksheet-page">
    <section className="worksheet-hero"><div><Badge tone="gold"><FileText/> 双页课堂任务单</Badge><h1>{draft?.title || '把课堂方案变成真正能用的两张纸'}</h1><p>学生页只保留任务、学生教材页码和书写空间；教师页保留观察要点、教师用书依据和课堂记录区。两页物理分离，不把参考提示提前交给学生。</p></div><div className="worksheet-hero-actions"><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}><ArrowLeft/>返回课堂设计</a><button type="button" onClick={openPrint} disabled={worksheet.status === 'blocked'}><ExternalLink/>打开打印页</button><button type="button" className="primary" onClick={download} disabled={worksheet.status === 'blocked'}><Download/>下载双页任务单</button></div></section>
    {error && <section className="ask-error"><CircleAlert/><span>{error}</span></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {busy ? <section className="panel worksheet-empty"><Activity/><h2>正在整理本课任务</h2><p>只读取当前账号中的教师定稿、三卡和已核验教材页。</p></section> : !approved ? <section className="panel worksheet-empty"><FileCheck2/><span>生成前</span><h2>请先确认本版教学方案</h2><p>任务单只能来自教师已经确认的方案与三卡，不能把问答阶段的建议直接发给学生。</p><a className="primary" href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>返回确认方案</a></section> : worksheet.status === 'blocked' ? <section className="panel worksheet-empty"><CircleAlert/><span>依据不足</span><h2>三卡还没有绑定学生教材原页</h2><p>学生任务单不能只依据教师用书生成。请回到三卡，为提问与评价补上学生教材页码。</p><a className="primary" href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>返回补充教材依据</a></section> : <>
      <section className="worksheet-control panel"><div><span>本课共生成</span><b>{worksheet.tasks.length} 个有教材依据的任务</b><small>{worksheet.usedCitationCount} 个已核验页面 · 双页严格分离</small></div><nav aria-label="选择预览页面"><button type="button" className={activePage === 'student' ? 'active' : ''} onClick={() => setActivePage('student')}><span>01</span><b>学生课堂任务单</b><small>任务、页码与书写区</small></button><button type="button" className={activePage === 'teacher' ? 'active' : ''} onClick={() => setActivePage('teacher')}><span>02</span><b>教师观察单</b><small>观察要点与全部依据</small></button></nav></section>
      {worksheet.warnings.length > 0 && <section className="worksheet-warning"><CircleAlert/><div><b>只生成有依据的内容</b>{worksheet.warnings.map(item => <p key={item}>{item}</p>)}</div></section>}
      <section className={`worksheet-paper panel ${activePage}`}>
        <header><div><span>{activePage === 'student' ? '学生课堂任务单' : '教师观察单'}</span><h1>{worksheet.title}</h1><p>{activePage === 'student' ? '所有回答都要回到学生教材原文。' : '用于观察学生怎样使用教材依据，不是标准答案。'}</p></div><b>第 {activePage === 'student' ? '1' : '2'} 页</b></header>
        {activePage === 'student' && <div className="worksheet-identity"><span>班级：<i/></span><span>姓名：<i/></span><span>日期：<i/></span></div>}
        {worksheet.coreQuestion && <div className="worksheet-core"><b>本课核心问题</b><p>{worksheet.coreQuestion}</p></div>}
        {activePage === 'teacher' && <p className="worksheet-teacher-intro">先看学生能否定位，再看能否解释关系，最后看能否形成独立表达。教师用书只出现在本页。</p>}
        <div className="worksheet-task-list">{worksheet.tasks.map(pageTask)}</div>
        {activePage === 'student' && <div className="worksheet-self-check"><span>我引用了教材词句</span><span>我解释了词句与判断的关系</span><span>我写出了完整结论</span></div>}
        <footer><span>{activePage === 'student' ? '学生页不包含教师用书内容或参考提示' : `共使用 ${worksheet.usedCitationCount} 个已核验教材页面`}</span><span>原始教材是唯一可核验依据</span></footer>
      </section>
    </>}
  </div>;
}

function LearningEvidencePage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [evidence, setEvidence] = useState(emptyLearningEvidence());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(null);
  const storageKey = `huojiaocan:learning:${session?.user?.id || 'anonymous'}:${draftId}`;

  useEffect(() => {
    if (!session?.user?.id) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!draftId) { setError('还没有选定需要回流作业学情的课堂方案。'); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setError(''); setMessage('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (cancelled) return;
      const next = data.draft || data;
      let nextEvidence = normalizeLearningEvidence(next.answer?.learningEvidence || {});
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (cached?.sourceKey === nextEvidence.sourceKey && nextEvidence.status !== 'confirmed') {
          if (cached.draftVersion === next.version) {
            nextEvidence = normalizeLearningEvidence(cached.learningEvidence);
            setDirty(true);
            setMessage('已恢复这台设备上尚未保存的班级汇总，请核对后继续。');
          } else {
            setConflict({ local: normalizeLearningEvidence(cached.learningEvidence), server: nextEvidence });
          }
        }
      } catch {}
      setDraft(next); setEvidence(nextEvidence);
    }).catch(err => { if (!cancelled) setError(askErrorMessage(err)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [draftId, session?.user?.id]);

  useEffect(() => {
    if (!dirty || !draft || evidence.status === 'confirmed') return;
    try { localStorage.setItem(storageKey, JSON.stringify({ draftVersion: draft.version, sourceKey: evidence.sourceKey, learningEvidence: evidence, savedAt: new Date().toISOString() })); } catch {}
  }, [dirty, draft?.version, evidence, storageKey]);
  useEffect(() => {
    const warn = event => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  const generate = async () => {
    if (!draft || working) return;
    setWorking('generate'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/learning-evidence/generate`, { method: 'POST', body: { version: draft.version } });
      const saved = data.draft || draft;
      setDraft(saved); setEvidence(normalizeLearningEvidence(data.learningEvidence || saved.answer?.learningEvidence)); setCurrentIndex(0); setDirty(false);
      try { localStorage.removeItem(storageKey); } catch {}
      setMessage('已按本课真实问题建立作业回流纸。只填写班级汇总，不录入学生姓名或原始答卷。');
    } catch (err) {
      if (requestCode(err) === 'edit_conflict') {
        try {
          const latestData = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`);
          const latest = latestData.draft || latestData;
          const serverEvidence = normalizeLearningEvidence(latest.answer?.learningEvidence || {});
          setDraft(latest);
          setConflict({ local: evidence, server: serverEvidence });
          setError('这份方案刚刚在其他页面更新。你的本机汇总仍然保留，请选择要继续使用的版本。');
        } catch { setError('这份方案刚刚在其他页面更新。你的本机汇总仍然保留，请稍后重试。'); }
      } else setError(askErrorMessage(err));
    } finally { setWorking(''); }
  };

  const resolveConflict = useLocal => {
    const selected = useLocal ? conflict?.local : conflict?.server;
    if (selected) setEvidence(normalizeLearningEvidence(selected));
    setDirty(Boolean(useLocal));
    setConflict(null); setError('');
    setMessage(useLocal ? '已应用这台设备上的班级汇总，请核对后保存。' : '已保留账号中的最新版本。');
    if (!useLocal) try { localStorage.removeItem(storageKey); } catch {}
  };
  const updateEntry = (id, patch) => {
    setEvidence(current => normalizeLearningEvidence({ ...current, entries: current.entries.map(item => item.id === id ? { ...item, ...patch } : item) }));
    setDirty(true); setMessage('');
  };
  const persist = async confirm => {
    if (!draft || working) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/learning-evidence`, { method: 'PATCH', body: { version: draft.version, learningEvidence: evidence, confirm } });
      const saved = data.draft || draft;
      const next = normalizeLearningEvidence(data.learningEvidence || saved.answer?.learningEvidence);
      setDraft(saved); setEvidence(next); setDirty(false);
      try { localStorage.removeItem(storageKey); } catch {}
      setMessage(confirm ? '作业回流已经确认。下一次备课只会带入班级汇总和教师判断，不会带入学生原始作答。' : '班级汇总已保存，可以稍后继续。');
    } catch (err) {
      if (requestCode(err) === 'edit_conflict') {
        try {
          const latestData = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`);
          const latest = latestData.draft || latestData;
          setDraft(latest);
          setConflict({ local: evidence, server: normalizeLearningEvidence(latest.answer?.learningEvidence || {}) });
          setError('这份方案刚刚在其他页面更新。你的本机汇总仍然保留，请选择要继续使用的版本。');
        } catch { setError('这份方案刚刚在其他页面更新。你的本机汇总仍然保留，请稍后重试。'); }
      } else setError(askErrorMessage(err));
    } finally { setWorking(''); }
  };

  const progress = learningEvidenceProgress(evidence);
  const summary = learningEvidenceSummary(evidence);
  const entry = evidence.entries[currentIndex] || null;
  const readOnly = evidence.status === 'confirmed';
  const stale = draft ? learningEvidenceIsStale({ ...draft, answer: { ...(draft.answer || {}), learningEvidence: evidence } }) : false;
  const distributionValid = entry ? entry.assignedCount >= entry.submittedCount && entry.submittedCount === entry.secureCount + entry.partialCount + entry.notYetCount : true;
  const hasInvalidDistribution = evidence.entries.some(item => {
    const touched = item.assignedCount || item.submittedCount || item.secureCount || item.partialCount || item.notYetCount;
    return touched && (item.assignedCount < item.submittedCount || item.submittedCount !== item.secureCount + item.partialCount + item.notYetCount);
  });

  return <div className="view-stack learning-page">
    <section className="learning-hero"><div><Badge tone="gold"><ClipboardCheck/> 作业回流</Badge><h1>{draft?.title || '让学生作业真正改变下一次备课'}</h1><p>按课堂问题汇总提交与达成情况，再由教师写下共同卡点和下一步动作。这里只记录班级聚合数据；请不要录入姓名、学号、逐人分数或粘贴原始答卷。</p></div><div className="learning-flow"><span><b>01</b>选择任务</span><i/><span><b>02</b>汇总达成</span><i/><span><b>03</b>确认回流</span></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>作业回流暂时没有保存</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={() => location.reload()}><RefreshCw/>重新读取</button><a href={`/reflection/?draftId=${encodeURIComponent(draftId)}`}>返回课后复盘</a></div></section>}
    {conflict && <section className="panel learning-stale" role="status"><CircleAlert/><div><b>发现两个未完成版本</b><p>本机填写和账号最新内容都还在。请选择一个继续，系统不会自动覆盖。</p></div><div className="cards-alert-actions"><button type="button" className="primary" onClick={() => resolveConflict(true)}>使用本机汇总</button><button type="button" onClick={() => resolveConflict(false)}>保留账号版本</button></div></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {busy ? <section className="panel learning-empty"><Activity/><h2>正在读取本课问题与班级汇总</h2><p>只读取当前账号中的课堂方案。</p></section> : !progress.total ? <section className="panel learning-empty"><ClipboardCheck/><span>建立回流纸</span><h2>先把本课问题变成可汇总的作业任务</h2><p>系统只从当前方案的提问卡或问题链读取任务和教材页。问题身份、页码和引用不能由浏览器伪造。</p><button type="button" className="primary" onClick={generate} disabled={working === 'generate'}>{working === 'generate' ? '正在建立…' : '按本课问题建立回流纸'}</button></section> : <>
      {stale && <section className="panel learning-stale"><CircleAlert/><div><b>本课问题已经更新</b><p>旧回流不会冒充当前任务。请按最新提问卡重新建立一份，已确认的旧记录仍会归档保留。</p></div><button type="button" onClick={generate} disabled={Boolean(working)}>按最新问题重新建立</button></section>}
      <section className="learning-workbench">
        <aside className="panel learning-question-list"><header><span>本次作业任务</span><b>{progress.completed} / {progress.total} 已完成汇总</b><small>每道题只保留班级聚合结果</small></header>{evidence.entries.map((item, index) => { const done = item.submittedCount > 0 && item.submittedCount === item.secureCount + item.partialCount + item.notYetCount; return <button type="button" className={`${index === currentIndex ? 'active' : ''} ${done ? 'done' : ''}`} key={item.id} onClick={() => setCurrentIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{item.prompt}</b><small>{done ? `${item.submittedCount} 份已汇总` : '等待填写'}</small></div>{done ? <CheckCircle2/> : <ChevronRight/>}</button>; })}</aside>
        {entry && <article className="panel learning-sheet"><header><div><span>任务 {String(currentIndex + 1).padStart(2, '0')}</span><h2>{entry.prompt}</h2></div><Badge tone={readOnly ? 'green' : distributionValid ? 'gold' : 'orange'}>{readOnly ? '教师已确认' : distributionValid ? '班级汇总' : '人数待核对'}</Badge></header>
          <div className="learning-source"><Quote/><div><b>任务对应教材位置</b><CardSourceList citations={draft?.citations || []} refs={entry.citationIds} returnTo={`/learning/?draftId=${encodeURIComponent(draftId)}`}/></div></div>
          <section className="learning-counts"><header><div><span>第一步 · 只填真实人数</span><h3>这道任务完成得怎样</h3></div><small>三种达成情况之和必须等于提交人数</small></header><div className="learning-count-grid">
            {[['assignedCount','布置人数','全班收到任务'],['submittedCount','提交人数','实际收到作业'],['secureCount','完整达成','能用依据说清'],['partialCount','部分达成','找到依据但关系不完整'],['notYetCount','尚未达成','仍需重新教学']].map(([field,label,note]) => <label key={field}><span>{label}</span><input type="number" min="0" max="200" inputMode="numeric" disabled={readOnly} value={entry[field]} onChange={event => updateEntry(entry.id, { [field]: Number(event.target.value || 0) })}/><small>{note}</small></label>)}
          </div>{!distributionValid && <p className="learning-count-error">请核对人数：完整达成、部分达成、尚未达成之和应等于提交人数；提交人数不能超过布置人数。</p>}</section>
          <section className="learning-judgement"><header><span>第二步 · 教师作出判断</span><h3>共同卡点与下一次动作</h3><p>写班级共同现象，不粘贴学生原话，也不要填写姓名或联系方式。</p></header><label><span>共同卡点或典型表现</span><textarea rows="4" maxLength="320" disabled={readOnly} value={entry.observedPattern} onChange={event => updateEntry(entry.id, { observedPattern: event.target.value })} placeholder="例如：多数学生能找出三个意象，但只逐个解释，没有说明意象之间怎样共同推进情感。"/></label><label><span>下一次先做什么</span><textarea rows="4" maxLength="400" disabled={readOnly} value={entry.teacherAction} onChange={event => updateEntry(entry.id, { teacherAction: event.target.value })} placeholder="例如：先用关系图比较意象，再回到结尾完成整体判断。"/></label></section>
          <footer><button type="button" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}><ArrowLeft/>上一题</button><button type="button" onClick={() => setCurrentIndex(Math.min(progress.total - 1, currentIndex + 1))} disabled={currentIndex >= progress.total - 1}>下一题<ArrowRight/></button></footer>
        </article>}
      </section>
      <section className="panel learning-summary"><div><span>将带入下一次备课</span><h2>{hasInvalidDistribution ? '还有任务的人数没有对齐' : summary.itemCount ? summary.itemCount === 1 ? `${summary.submittedCount} 份提交形成 1 道任务的班级学情` : `${summary.itemCount} 道任务已经完成班级汇总` : '至少完整汇总一道任务'}</h2><p>{hasInvalidDistribution ? '请逐题核对：三种达成情况之和应等于提交人数，提交人数不能超过布置人数。' : summary.itemCount ? `按题累计：完整达成 ${summary.counts.secure}，部分达成 ${summary.counts.partial}，尚未达成 ${summary.counts.not_yet}。下一次仍会重新搜索本课教材，班级学情不会冒充教材依据。` : '人数核对完成后，再由教师确认。系统不会根据零散输入推算“多数学生”或补造比例。'}</p></div><div><a href={`/reflection/?draftId=${encodeURIComponent(draftId)}`}>返回课后复盘</a><button type="button" onClick={() => persist(false)} disabled={readOnly || stale || !dirty || hasInvalidDistribution || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存班级汇总'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={readOnly || stale || !progress.ready || hasInvalidDistribution || Boolean(working)}>{readOnly ? '本次回流已确认' : working === 'confirm' ? '正在确认…' : '确认并用于下一次备课'}</button></div></section>
    </>}
  </div>;
}

function DeliberationPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [deliberation, setDeliberation] = useState(emptyTeachingDeliberation());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const storageKey = `huojiaocan:deliberation:${session?.user?.id || 'anonymous'}:${draftId}`;

  useEffect(() => {
    if (!session?.user?.id) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!draftId) { setError('还没有选定需要比较的备课方案。'); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setError('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (cancelled) return;
      const nextDraft = data.draft || data;
      let next = normalizeTeachingDeliberation(nextDraft.answer?.teachingDeliberation || {});
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (cached?.sourceKey === next.sourceKey && Number(cached?.draftVersion) === Number(nextDraft.version) && next.status !== 'confirmed') {
          next = normalizeTeachingDeliberation(cached.deliberation);
          setDirty(true); setMessage('已恢复这台设备上尚未确认的选择。');
        } else if (cached?.sourceKey === next.sourceKey && Number(cached?.draftVersion) !== Number(nextDraft.version)) {
          setMessage('账号中的方案已有更新，本机旧选择没有自动覆盖新版本。');
        }
      } catch {}
      setDraft(nextDraft); setDeliberation(next);
    }).catch(err => { if (!cancelled) setError(askErrorMessage(err)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [draftId, session?.user?.id]);

  useEffect(() => {
    if (!dirty || !draft || deliberation.status === 'confirmed') return;
    try { localStorage.setItem(storageKey, JSON.stringify({ draftVersion: draft.version, sourceKey: deliberation.sourceKey, deliberation, savedAt: new Date().toISOString() })); } catch {}
  }, [dirty, draft?.version, deliberation, storageKey]);

  useEffect(() => {
    const warn = event => {
      if (!dirty || deliberation.status === 'confirmed') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, deliberation.status]);

  const generate = async () => {
    if (!draft || working) return;
    setWorking('generate'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/deliberation/generate`, { method: 'POST', body: { version: draft.version } });
      const saved = data.draft || draft;
      setDraft(saved); setDeliberation(normalizeTeachingDeliberation(data.deliberation || saved.answer?.teachingDeliberation)); setCurrentIndex(0); setDirty(false);
      try { localStorage.removeItem(storageKey); } catch {}
      setMessage('已对照当前方案与教材依据，整理出需要教师亲自决定的课堂取舍。');
    } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); }
  };

  const selectOption = (decisionId, optionId) => {
    if (deliberation.status === 'confirmed') return;
    setDeliberation(current => normalizeTeachingDeliberation({ ...current, decisions: current.decisions.map(item => item.id === decisionId ? { ...item, selectedOptionId: optionId } : item) }));
    setDirty(true); setMessage('');
  };

  const persist = async confirm => {
    if (!draft || working) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/deliberation`, { method: 'PATCH', body: { version: draft.version, deliberation, confirm } });
      const saved = data.draft || draft;
      setDraft(saved); setDeliberation(normalizeTeachingDeliberation(data.deliberation || saved.answer?.teachingDeliberation)); setDirty(false);
      try { localStorage.removeItem(storageKey); } catch {}
      setMessage(confirm ? '本课取舍已经确认。后续问答会遵守这些教师决定。' : '当前选择已保存，可以稍后继续。');
    } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); }
  };

  const stale = draft ? teachingDeliberationIsStale({ ...draft, answer: { ...(draft.answer || {}), teachingDeliberation: deliberation } }) : false;
  const current = deliberation.decisions[currentIndex] || null;
  const selectedCount = deliberation.decisions.filter(item => item.selectedOptionId).length;
  const complete = deliberation.decisions.length > 0 && selectedCount === deliberation.decisions.length;
  const confirmed = deliberation.status === 'confirmed';
  const continueHref = `/ask/?draftId=${encodeURIComponent(draftId)}&q=${encodeURIComponent('请按我已确认的备课取舍，重新组织本课完整方案，并说明课堂流程怎样体现这些决定。')}`;

  return <div className="view-stack deliberation-page">
    <section className="deliberation-hero"><div><Badge tone="gold"><Route/> 备课取舍</Badge><h1>{draft?.title || '先把关键取舍想清楚，再生成课堂方案'}</h1><p>教材可以说明哪些处理有依据，但不会替教师决定哪条路径更适合当前班级。这里把真正会改变课堂的选择、收益和代价放在同一张纸上。</p></div><div className="deliberation-hero-meta"><span>篇目与依据来自当前草稿</span><b>{confirmed ? '教师已确认' : `${selectedCount} / ${deliberation.decisions.length || 0} 已选择`}</b></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>这次比较暂时没有完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={generate} disabled={!draft || Boolean(working)}><RefreshCw/>重新比较</button><a href={`/ask/?draftId=${encodeURIComponent(draftId)}`}>返回备课问答</a></div></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {busy ? <section className="panel deliberation-empty"><Activity/><h2>正在读取本课方案与教材依据</h2><p>接下来会呈现可选路径，以及每条路径必须接受的代价。</p></section> : !draft ? <section className="panel deliberation-empty"><Route/><span>尚未选择方案</span><h2>先从备课问答打开一份方案</h2><p>备课取舍必须绑定具体篇目、备课条件和已核验教材页，不能脱离方案单独生成。</p><a className="primary" href="/ask/">返回备课问答</a></section> : !deliberation.decisions.length ? <section className="panel deliberation-empty"><Route/><span>开始比较</span><h2>让系统先找出本课真正需要教师决定的地方</h2><p>系统只使用当前草稿和已核验教材页。不会为了凑数制造虚假分歧，也不会替教师自动选择。</p><button type="button" className="primary" onClick={generate} disabled={working === 'generate'}>{working === 'generate' ? '正在对照教材…' : '生成本课关键取舍'}</button></section> : <>
      {stale && <section className="panel learning-stale"><CircleAlert/><div><b>备课条件或教材依据已经变化</b><p>原选择仍会保留，但不能继续作为当前方案的教师决定。请按最新内容重新比较。</p></div><button type="button" onClick={generate} disabled={Boolean(working)}>按最新内容重新比较</button></section>}
      <section className="deliberation-workbench">
        <aside className="panel deliberation-index"><header><span>本课关键取舍</span><b>{selectedCount} / {deliberation.decisions.length} 已选择</b><small>每次只处理一个真正影响课堂的决定</small></header>{deliberation.decisions.map((item, index) => <button type="button" className={`${index === currentIndex ? 'active' : ''} ${item.selectedOptionId ? 'done' : ''}`} onClick={() => setCurrentIndex(index)} key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{item.question}</b><small>{item.selectedOptionId ? '已作出选择' : '等待教师决定'}</small></div>{item.selectedOptionId ? <CheckCircle2/> : <ChevronRight/>}</button>)}</aside>
        {current && <article className="panel deliberation-sheet"><header><div><span>当前需要决定</span><h2>{current.question}</h2><p>{current.whyItMatters}</p></div><Badge tone={current.selectedOptionId ? 'green' : 'orange'}>{current.selectedOptionId ? '已选择路径' : '尚未选择'}</Badge></header>
          <div className="deliberation-options" role="radiogroup" aria-label={current.question}>{current.options.map((option, optionIndex) => { const selected = current.selectedOptionId === option.id; return <article className={selected ? 'selected' : ''} key={option.id}><button type="button" className="deliberation-option-choice" role="radio" aria-checked={selected} disabled={confirmed || stale} onClick={() => selectOption(current.id, option.id)}><div className="deliberation-option-title"><span>{selected ? <CheckCircle2/> : String.fromCharCode(65 + optionIndex)}</span><div><small>{option.id === current.recommendedOptionId ? '更符合当前备课条件' : '可成立的课堂路径'}</small><h3>{option.label}</h3></div></div><div className="deliberation-option-section"><b>课堂怎样做</b><p>{option.approach}</p></div><div className="deliberation-option-section deliberation-cost"><b>需要接受什么</b><p>{option.tradeoff || '这条路径仍需要教师结合班情判断。'}</p></div></button><footer><span>教材依据</span><CardSourceList citations={draft?.citations || []} refs={option.evidenceRefs} returnTo={`/deliberation/?draftId=${encodeURIComponent(draftId)}`}/></footer></article>; })}</div>
          <div className="deliberation-basis-note"><Quote/><p><b>教材说明哪些处理有材料支持，教师决定哪一种更适合本班。</b>选项中的路径与代价属于基于教材的课堂转化，不冒充教师用书原话。</p></div>
          <footer className="deliberation-nav"><button type="button" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}><ArrowLeft/>上一项</button><button type="button" onClick={() => setCurrentIndex(Math.min(deliberation.decisions.length - 1, currentIndex + 1))} disabled={currentIndex >= deliberation.decisions.length - 1}>下一项<ArrowRight/></button></footer>
        </article>}
      </section>
      <section className="panel deliberation-confirm"><div><span>{confirmed ? '教师确认回执' : '我的决定'}</span><h2>{confirmed ? '本课将按已确认的取舍继续备课' : complete ? '所有关键取舍已经选定' : `还有 ${deliberation.decisions.length - selectedCount} 项等待选择`}</h2><p>{confirmed ? '生成课堂卡时会直接遵守这些决定。若继续修改方案正文，系统会要求重新比较，避免旧决定误用于新方案。' : '推荐项不会自动选中。确认的是课堂方向，最终方案仍需在一课三卡页面再次定稿。'}</p></div><div>{confirmed ? <><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`} className="primary">按取舍生成课堂方案 <ArrowRight/></a><a href={continueHref}>继续问答完善方案</a></> : <><button type="button" onClick={() => persist(false)} disabled={!dirty || stale || Boolean(working)}>{working === 'save' ? '正在保存…' : '暂存选择'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={!complete || stale || Boolean(working)}>{working === 'confirm' ? '正在确认…' : '确认本课取舍'}</button></>}</div></section>
    </>}
  </div>;
}

function ReflectionPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState(normalizeFeedbackForm());
  const [momentTriage, setMomentTriage] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [nextLesson, setNextLesson] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reflectionLoadRef = useRef(0);

  useEffect(() => {
    const loadId = ++reflectionLoadRef.current;
    setDraft(null); setForm(normalizeFeedbackForm()); setMomentTriage(null); setDirty(false); setMessage(''); setError('');
    if (!session?.user?.id) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!draftId) { setError('还没有选定需要复盘的课堂方案。'); setBusy(false); return; }
    setBusy(true); setError('');
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`)
      .then(data => {
        if (loadId !== reflectionLoadRef.current) return;
        const next = data.draft || data;
        const existing = next.answer?.lessonReflection || next.answer?.teachingFeedback || null;
        const run = normalizeClassroomRun(next.answer?.classroomRun || {});
        const seeded = !existing && run.status === 'pending_review' && classroomRunHasContent(run);
        setDraft(next);
        setForm(normalizeFeedbackForm(existing || (seeded ? classroomRunToReflectionSeed(run) : {})));
        setMomentTriage(run.moments.length ? normalizeClassroomMomentTriage(next.answer?.classroomMomentTriage || defaultClassroomMomentTriage(run), run) : null);
        setDirty(seeded);
        if (seeded) setMessage('已根据课堂现场记录预填。请核对并保存后，才会成为正式课后复盘。');
      })
      .catch(err => { if (loadId === reflectionLoadRef.current) setError(askErrorMessage(err)); })
      .finally(() => { if (loadId === reflectionLoadRef.current) setBusy(false); });
    return () => { reflectionLoadRef.current += 1; };
  }, [draftId, session?.user?.id]);

  useEffect(() => {
    const unitRef = draft?.lesson_context?.unitRef;
    const lessonRef = draft?.lesson_context?.lessonRef;
    if (!unitRef?.documentId || !unitRef?.nodeId || !lessonRef?.nodeId) { setNextLesson(null); return; }
    let cancelled = false;
    request(`/documents/${encodeURIComponent(unitRef.documentId)}/tree`).then(data => {
      if (cancelled) return;
      const unit = unitNodes(normalizeTree(data)).find(item => String(item.id) === String(unitRef.nodeId));
      const lessons = unitLessonNodes(unit || {});
      const index = lessons.findIndex(item => String(item.nodeId) === String(lessonRef.nodeId));
      setNextLesson(index >= 0 ? lessons[index + 1] || null : null);
    }).catch(() => { if (!cancelled) setNextLesson(null); });
    return () => { cancelled = true; };
  }, [draft?.lesson_context?.unitRef?.nodeId, draft?.lesson_context?.lessonRef?.nodeId]);

  const update = (field, value) => {
    setForm(current => normalizeFeedbackForm({ ...current, [field]: value }));
    setDirty(true); setMessage('');
  };
  const toggleCard = label => update('usedCards', form.usedCards.includes(label) ? form.usedCards.filter(item => item !== label) : [...form.usedCards, label]);
  const updateMomentTriage = (momentId, patch) => {
    if (!momentTriage || momentTriage.status === 'confirmed') return;
    const run = normalizeClassroomRun(draft?.answer?.classroomRun || {});
    const moment = run.moments.find(item => item.id === momentId);
    setMomentTriage(current => normalizeClassroomMomentTriage({
      ...current,
      items: current.items.map(item => item.sourceMomentId === momentId ? {
        ...item,
        ...patch,
        ...(patch.resolution === 'carryover' && !item.carryoverText ? { carryoverText: moment?.text || '' } : {}),
        ...(patch.resolution && patch.resolution !== 'carryover' ? { carryoverText: '' } : {})
      } : item)
    }, run));
    setDirty(true); setMessage('');
  };
  const triageReady = !momentTriage || momentTriage.items.every(item => item.resolution !== 'carryover' || Array.from(String(item.carryoverText || '').trim()).length >= 4);
  const persist = async ({ retry = true } = {}) => {
    if (!draft) return null;
    if (!triageReady) { setError('请为每条“带到下一课”的事项写清下一课要处理的动作。'); return null; }
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/feedback`, {
        method: 'PATCH', body: { reflection: feedbackStorageValue(form), momentTriage: momentTriage || undefined, version: draft.version }
      });
      const saved = data.draft || data;
      setDraft(saved); setForm(normalizeFeedbackForm(saved.answer?.lessonReflection || form)); setDirty(false);
      if (saved.answer?.classroomMomentTriage) setMomentTriage(normalizeClassroomMomentTriage(saved.answer.classroomMomentTriage, normalizeClassroomRun(saved.answer?.classroomRun || {})));
      setMessage('课后复盘已保存。课堂事实与下一课调整将留在这份方案中。');
      return saved;
    } catch (err) {
      if (retry && requestCode(err) === 'edit_conflict') {
        try {
          const latestData = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`);
          const latest = latestData.draft || latestData;
          setDraft(latest);
          const baselineReflection = feedbackStorageValue(normalizeFeedbackForm(draft.answer?.lessonReflection || draft.answer?.teachingFeedback || {}));
          const latestReflection = feedbackStorageValue(normalizeFeedbackForm(latest.answer?.lessonReflection || latest.answer?.teachingFeedback || {}));
          if (JSON.stringify(baselineReflection) !== JSON.stringify(latestReflection)) {
            setError('这节课的复盘已在另一个页面更新。你的输入仍保留在当前页面，请先核对后再保存。');
            return null;
          }
          const baselineRun = normalizeClassroomRun(draft.answer?.classroomRun || {});
          const latestRun = normalizeClassroomRun(latest.answer?.classroomRun || {});
          if (JSON.stringify(baselineRun) !== JSON.stringify(latestRun)) {
            setError('课堂现场记录已在另一个页面更新。当前复盘仍保留，请重新读取最新记录并核对后再确认。');
            return null;
          }
          const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/feedback`, {
            method: 'PATCH', body: { reflection: feedbackStorageValue(form), momentTriage: momentTriage || undefined, version: latest.version }
          });
          const saved = data.draft || data;
          setDraft(saved); setDirty(false); setMessage('已读取方案的最新版本，并保存本次课后复盘。');
          return saved;
        } catch (retryError) { setError(askErrorMessage(retryError)); return null; }
      }
      setError(askErrorMessage(err)); return null;
    } finally { setSaving(false); }
  };
  const createNext = async () => {
    if (!draft || creating) return;
    setCreating(true); setError('');
    try {
      const current = dirty || !draft.answer?.lessonReflection ? await persist() : draft;
      if (!current) return;
      const data = await rootRequest(`/api/assets/${encodeURIComponent(draftId)}/copy`, {
        method: 'POST', body: { version: current.version, useFeedback: true }
      });
      const copied = data.draft || data.asset;
      if (!copied?.id && !copied?.draftId) throw Object.assign(new Error('draft_missing'), { code: 'draft_missing' });
      location.href = `/ask/?draftId=${encodeURIComponent(copied.id || copied.draftId)}`;
    } catch (err) { setError(askErrorMessage(err)); } finally { setCreating(false); }
  };
  const continueUnit = async () => {
    if (!draft || !nextLesson || continuing) return;
    setContinuing(true); setError('');
    try {
      const current = dirty || !draft.answer?.lessonReflection ? await persist() : draft;
      if (!current) return;
      const storageKey = `huojiaocan:unit-next:${current.id}:${nextLesson.nodeId}`;
      let operationId = '';
      try { operationId = localStorage.getItem(storageKey) || ''; } catch {}
      if (!operationId) {
        operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try { localStorage.setItem(storageKey, operationId); } catch {}
      }
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(current.id)}/continue-next`, {
        method: 'POST', body: { sourceVersion: current.version, nextNodeId: nextLesson.nodeId, operationId }
      });
      const created = data.draft;
      if (!created?.id) throw Object.assign(new Error('draft_missing'), { code: 'draft_missing' });
      location.href = `/ask/?draftId=${encodeURIComponent(created.id)}`;
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'lesson_reflection_required' ? '请先记录至少一项真实课堂表现，再继续备下一课。' : code === 'unit_context_required' ? '这份方案还没有加入单元轨道，请先从“单元接力”打开对应篇目。' : code === 'unit_lesson_not_found' || code === 'unit_lesson_not_next' ? '教材目录中的下一篇已变化，请返回单元轨道重新选择。' : askErrorMessage(err));
    } finally { setContinuing(false); }
  };
  const advice = feedbackAdviceFromForm(form);
  const cardOptions = [
    ['板书卡', '课堂主线与现场补写'],
    ['提问卡', '把学生带回具体词句'],
    ['评价卡', '观察学生是否真正学会']
  ];
  const reflectionRun = normalizeClassroomRun(draft?.answer?.classroomRun || {});
  const pendingClassroomReview = reflectionRun.status === 'pending_review' && !draft?.answer?.lessonReflection;

  return <div className="view-stack reflection-page">
    <section className="hero compact-hero reflection-hero"><div><Badge tone="gold"><History/> 课后复盘</Badge><h1>{draft?.title || '把课堂发生的事，留给下一次备课'}</h1><p>用一分钟记录学生真实表现、没有说清的内容和课堂节奏。系统只整理你的观察，不把课堂经验冒充成教材结论。</p></div><div className="reflection-flow"><span><b>01</b>记课堂事实</span><i/><span><b>02</b>确认调整</span><i/><span><b>03</b>{nextLesson ? '继续下一课' : '建立复备版本'}</span></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>课后复盘暂时没有保存</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={() => location.reload()}><RefreshCw/>重新读取</button><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>返回课堂设计</a></div></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {busy ? <section className="panel answer-loading"><p>正在读取本节课堂方案…</p></section> : draft && <>
      {pendingClassroomReview && <section className="panel classroom-review-banner"><div><Badge tone="orange">课堂现场记录</Badge><h2>现场标记已经整理成复盘初稿</h2><p>以下内容只来自你在课堂中的阶段标记、关键词和随手记，尚未成为正式结论。请核对学生表现、补充节奏与调整，再保存确认。</p></div><a href={`/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`}>返回查看课堂记录</a></section>}
      {reflectionRun.moments.length > 0 && <section className="panel reflection-moment-review"><header><div><span>课堂时间线 · 逐条决定去向</span><h2>哪些留在本课，哪些必须带到下一课</h2><p>课堂观察不属于教材结论。每条记录都由教师决定：写入本课复盘、变成下一课待办，或忽略。</p></div><Badge tone={momentTriage?.status === 'confirmed' ? 'green' : 'orange'}>{momentTriage?.status === 'confirmed' ? '去向已确认' : `${reflectionRun.moments.length} 条待核对`}</Badge></header><div>{reflectionRun.moments.map(item => { const triageItem = momentTriage?.items?.find(value => value.sourceMomentId === item.id); const readOnly = momentTriage?.status === 'confirmed'; return <article key={item.id} data-type={item.type} className="reflection-moment-item"><div className="reflection-moment-fact"><time>第 {item.elapsedMinutes} 分钟</time><span><b>{{ breakthrough:'学生说通了', confusion:'共同卡点', question:'意外好问题', timing:'时间变化' }[item.type]}</b><p>{item.text}</p></span><small>{CLASSROOM_STAGE_LABELS[item.stage - 1]}</small></div><div className="reflection-moment-actions" role="group" aria-label={`决定课堂记录去向：${item.text}`}>{[['reflection','写入本课复盘'],['carryover','带到下一课'],['dismissed','本次忽略']].map(([value,label]) => <button type="button" key={value} disabled={readOnly} className={triageItem?.resolution === value ? 'active' : ''} aria-pressed={triageItem?.resolution === value} onClick={() => updateMomentTriage(item.id,{ resolution:value })}>{label}</button>)}</div>{triageItem?.resolution === 'carryover' && <label className="reflection-carryover-copy"><span>下一课具体要处理什么</span><input value={triageItem.carryoverText || ''} maxLength={160} disabled={readOnly} onChange={event => updateMomentTriage(item.id,{ carryoverText:event.target.value })} placeholder="例如：先画出意象关系，再让学生说明情感推进"/><small>{Array.from(String(triageItem.carryoverText || '')).length < 4 ? '至少写 4 个字，避免下一课只看到模糊提醒。' : '下一课会作为可勾选事项出现。'}</small></label>}</article>; })}</div></section>}
      <section className="panel reflection-form-panel">
        <header><div><span>第一步 · 只记事实</span><h2>学生在这节课里真正学会了什么</h2><p>先写可观察到的回答、朗读、圈画或表达，不急着替学生下结论。</p></div><Badge tone={dirty ? 'orange' : 'green'}>{dirty ? '有未保存记录' : '已保存'}</Badge></header>
        <div className="reflection-grid">
          <label className="wide"><span>学生的实际表现</span><textarea rows="4" value={form.classResponse} onChange={event => update('classResponse', event.target.value)} placeholder="例如：多数学生能圈出‘北风’‘腐烂的土地’，但还不能说明这些意象怎样共同推进情感。"/><small>写学生说了什么、做了什么，避免只写“效果较好”。</small></label>
          <label><span>学生还没有说清的内容</span><textarea rows="4" value={form.unfinishedQuestions} onChange={event => update('unfinishedQuestions', event.target.value)} placeholder="例如：为什么诗人用‘嘶哑’而不是‘清亮’来写鸟的歌唱？"/></label>
          <label><span>实际用时与课堂节奏</span><textarea rows="4" value={form.timeManagement} onChange={event => update('timeManagement', event.target.value)} placeholder="例如：第二次朗读交流比预期多用 8 分钟，结尾归纳较仓促。"/></label>
        </div>
        <fieldset className="reflection-card-usage"><legend>本节实际使用</legend><p>只勾选真正进入课堂的卡片，复备时会优先保留其中有效的部分。</p><div>{cardOptions.map(([label, note]) => <button type="button" className={form.usedCards.includes(label) ? 'active' : ''} aria-pressed={form.usedCards.includes(label)} onClick={() => toggleCard(label)} key={label}><CheckCircle2/><span><b>{label}</b><small>{note}</small></span></button>)}</div></fieldset>
      </section>
      <section className="panel reflection-advice-panel">
        <header><div><span>第二步 · 形成调整</span><h2>把课堂记录变成下一次可执行的改动</h2><p>以下内容来自你的课堂记录，不属于教材原文；生成新方案前仍由你确认。</p></div></header>
        <div className="reflection-advice-layout"><ol>{advice.map((item, index) => <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></li>)}</ol><label><span>下次教学调整</span><textarea rows="7" value={form.nextStep} onChange={event => update('nextStep', event.target.value)} placeholder="例如：保留第一次朗读；把核心问题拆成‘找意象—说特点—连情感’三步，并预留 5 分钟完成结尾归纳。"/><small>教师决定优先于系统建议。创建复备方案时，这一项会作为明确要求带入。</small></label></div>
        <footer><div><b>{dirty ? '本次记录还未保存' : '本次记录已保存在账号中'}</b><small>{triageReady ? '保存时会同时确认课堂记录去向；已定稿方案和锁定卡片不会改变。' : '请先写清带到下一课的具体处理动作。'}</small></div><a href={`/learning/?draftId=${encodeURIComponent(draftId)}`}><ClipboardCheck/>汇总作业达成</a><a href={`/study/?draftId=${encodeURIComponent(draftId)}`}><Microscope/>整理一课一研</a><button type="button" onClick={() => persist()} disabled={saving || !dirty || !triageReady}>{saving ? '正在保存…' : '保存复盘并确认去向'}</button>{nextLesson && <button type="button" className="primary" onClick={continueUnit} disabled={saving || continuing || !triageReady}>{continuing ? '正在建立下一课…' : `用本课学情继续备《${nextLesson.title}》`}<ArrowRight/></button>}<button type="button" onClick={createNext} disabled={saving || creating || !triageReady}>{creating ? '正在建立复备版本…' : '基于本课创建复备版本'}</button></footer>
      </section>
    </>}
  </div>;
}

const STUDY_DECISIONS = [
  ['retain', '保留', '这项处理值得在相近班级继续使用'],
  ['adjust', '调整', '保留核心思路，只改变一个关键环节'],
  ['replace', '更换', '本次处理没有形成预期学习表现']
];

function lessonStudyRecoveryKey(userId, draftId) {
  return `huojiaocan:lesson-study:${userId || 'anonymous'}:${draftId || 'unknown'}`;
}

function LessonStudyPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || params.get('id') || '';
  const [draft, setDraft] = useState(null);
  const [study, setStudy] = useState(emptyLessonStudy());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const studyLoadRef = useRef(0);
  const userId = session?.user?.id || '';
  const readiness = useMemo(() => lessonStudyReadiness(draft || {}), [draft]);
  const stale = useMemo(() => Boolean(draft?.answer?.lessonStudy && lessonStudyIsStale(draft)), [draft]);
  const confirmed = study.status === 'confirmed' && !stale;
  const sourceCount = [readiness.hasClassroomFacts, readiness.hasReflection, readiness.hasLearningEvidence].filter(Boolean).length;

  useEffect(() => {
    const loadId = ++studyLoadRef.current;
    setBusy(true); setError(''); setNotice(''); setDraft(null); setStudy(emptyLessonStudy()); setDirty(false);
    if (!userId) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return undefined;
    }
    if (!draftId) { setError('还没有选定需要整理的课堂。请先从课后复盘或教研资产进入。'); setBusy(false); return undefined; }
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (loadId !== studyLoadRef.current) return;
      const next = data.draft || data;
      const serverStudy = normalizeLessonStudy(next.answer?.lessonStudy || {});
      let recovered = null;
      try { recovered = JSON.parse(localStorage.getItem(lessonStudyRecoveryKey(userId, draftId)) || 'null'); } catch {}
      const canRecover = recovered?.userId === userId
        && recovered?.draftId === draftId
        && Number(recovered?.baseVersion) === Number(next.version)
        && recovered?.study?.sourceKey === serverStudy.sourceKey
        && serverStudy.status !== 'confirmed';
      setDraft(next);
      setStudy(canRecover ? normalizeLessonStudy(recovered.study) : serverStudy);
      setDirty(Boolean(canRecover));
      if (canRecover) setNotice('已恢复这台设备上尚未保存的研究结论。');
    }).catch(err => { if (loadId === studyLoadRef.current) setError(askErrorMessage(err)); })
      .finally(() => { if (loadId === studyLoadRef.current) setBusy(false); });
    return () => { studyLoadRef.current += 1; };
  }, [draftId, userId]);

  useEffect(() => {
    if (!dirty || !draft?.version || !study.sourceKey || !userId) return;
    try {
      localStorage.setItem(lessonStudyRecoveryKey(userId, draftId), JSON.stringify({ userId, draftId, baseVersion: draft.version, study }));
    } catch {}
  }, [dirty, draft?.version, draftId, study, userId]);

  const clearRecovery = () => { try { localStorage.removeItem(lessonStudyRecoveryKey(userId, draftId)); } catch {} };
  const generate = async () => {
    if (!draft || working) return;
    setWorking('generate'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/lesson-study/generate`, { method: 'POST', body: { version: draft.version } });
      const next = data.draft || data;
      setDraft(next); setStudy(normalizeLessonStudy(data.lessonStudy || next.answer?.lessonStudy || {})); setDirty(false); clearRecovery();
      setNotice('已把教学设想、课堂事实和作业结果整理到同一张研究记录中。结论仍由教师确认。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'lesson_study_observation_required' ? '还没有课堂事实。请先完成课堂记录、课后复盘或作业回流中的至少一项。' : code === 'lesson_study_confirmed' ? '这份研究记录已经确认。若课堂事实发生变化，系统会保留旧版并允许重新整理。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const updateConclusion = (field, value) => {
    if (confirmed) return;
    setStudy(current => normalizeLessonStudy({ ...current, conclusion: { ...current.conclusion, [field]: value } }));
    setDirty(true); setNotice('');
  };
  const persist = async confirm => {
    if (!draft || !study.sourceKey || working || confirmed) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/lesson-study`, {
        method: 'PATCH', body: { version: draft.version, lessonStudy: study, confirm }
      });
      const next = data.draft || data;
      setDraft(next); setStudy(normalizeLessonStudy(data.lessonStudy || next.answer?.lessonStudy || {})); setDirty(false); clearRecovery();
      setNotice(confirm ? '本次教学判断已由教师确认，可以进入教研资产库或用于下一轮复备。' : '研究结论已保存到当前账号。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'lesson_study_incomplete' ? '请先选择“保留、调整或更换”，并写清本次发现与下一轮尝试。' : code === 'lesson_study_stale' ? '课堂记录或作业结果已经变化。请按最新事实重新整理，旧结论不会覆盖新记录。' : code === 'lesson_study_contains_student_identifier' ? '请删除姓名、学号、手机号等个人信息，只保留班级层面的学习表现。' : code === 'edit_conflict' ? '这份方案已在其他页面更新。当前输入仍保留在本机，请刷新核对后再保存。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };

  const summary = study.evidence.learningSummary;
  return <div className="view-stack lesson-study-page">
    <section className="hero compact-hero lesson-study-hero"><div><Badge tone="gold"><Microscope/> 一课一研</Badge><h1>把“这节课上完了”，<br/><em>变成“我知道下次为什么这样教”</em></h1><p>教学设想来自方案与教材依据，课堂事实来自教师记录，作业结果来自班级汇总。三者分开呈现，最后由教师确认本次判断。</p><div className="hero-actions"><a href={`/reflection/?draftId=${encodeURIComponent(draftId)}`}><History/>返回课后复盘</a><a href={`/assets/`}><Archive/>打开教研资产</a></div></div><div className="study-seal"><strong>{sourceCount}<small>/3</small></strong><span>类课堂事实</span><em>{confirmed ? '教师已确认' : study.sourceKey ? '等待形成判断' : '等待整理'}</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>本次研究记录暂时没有完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={() => location.reload()}><RefreshCw/>重新读取</button></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {stale && <section className="panel study-stale"><div><RefreshCw/><span><b>课堂事实已经更新</b><small>当前研究记录不会继续冒充最新判断。重新整理时，已确认旧版会进入历史记录。</small></span></div><button type="button" className="primary" onClick={generate} disabled={Boolean(working)}>按最新事实重新整理</button></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在汇集本课记录</h2><p>只读取当前账号中的方案、课堂事实和班级汇总。</p></section> : draft && !study.sourceKey ? <>
      <section className="panel study-readiness"><header><div><span>开始前</span><h2>先确认这节课留下了哪些真实记录</h2><p>不需要三项全部完成；至少有一项课堂或课后事实，才能形成研究记录。</p></div><Badge tone={sourceCount ? 'green' : 'orange'}>{sourceCount ? '可以开始整理' : '还缺课堂事实'}</Badge></header><div>{[
        [readiness.hasPlan, '教学设想', '当前方案、核心问题与评价任务', `/cards/?draftId=${encodeURIComponent(draftId)}`],
        [readiness.hasClassroomFacts, '课堂现场', '课堂阶段、学生关键词与实际用卡', `/cards/?draftId=${encodeURIComponent(draftId)}&classroom=1`],
        [readiness.hasReflection, '教师复盘', '已观察到与尚未解决的学习表现', `/reflection/?draftId=${encodeURIComponent(draftId)}`],
        [readiness.hasLearningEvidence, '作业回流', '同一任务的班级达成汇总', `/learning/?draftId=${encodeURIComponent(draftId)}`]
      ].map(([ready, title, note, href]) => <article className={ready ? 'ready' : ''} key={title}><span>{ready ? <CheckCircle2/> : <CircleAlert/>}</span><div><b>{title}</b><small>{note}</small></div><a href={href}>{ready ? '查看' : '去补充'} <ArrowRight/></a></article>)}</div><footer><p><ShieldCheck/>只保存班级层面的教学观察，不填写学生姓名、学号或逐人分数。</p><button type="button" className="primary" onClick={generate} disabled={!sourceCount || Boolean(working)}>{working === 'generate' ? '正在整理…' : '建立本课研究记录'}</button></footer></section>
    </> : draft && <>
      <section className="study-question panel"><div><span>01 · 本课研究问题</span><h2>{study.inquiryQuestion}</h2><p>这不是教材结论，而是本次课堂要验证的教学问题。</p></div><Badge tone={confirmed ? 'green' : 'orange'}>{confirmed ? '教师确认版' : '研究草稿'}</Badge></section>
      <section className="study-canvas">
        <article className="panel study-hypothesis"><header><span>02</span><div><small>上课前怎么想</small><h2>教学设想</h2></div></header><div><b>我的假设</b><p>{study.hypothesis}</p></div><div><b>实际采用的课堂处理</b><p>{study.plannedMove}</p></div><div><b>预期看到的学习表现</b><p>{study.expectedEvidence}</p></div><footer><span>教材依据</span><CardSourceList citations={draft.citations || []} refs={study.citationIds} returnTo={`/study/?draftId=${encodeURIComponent(draftId)}`}/></footer></article>
        <article className="panel study-observation"><header><span>03</span><div><small>课堂里发生了什么</small><h2>事实记录</h2></div></header><section><b>课堂现场</b>{study.evidence.classroomFacts.length ? <ul>{study.evidence.classroomFacts.map(item => <li key={item}><Check/>{item}</li>)}</ul> : <p className="muted">本次没有课堂现场标记。</p>}</section><section><b>教师复盘</b>{study.evidence.reflectionFacts.length ? <ul>{study.evidence.reflectionFacts.map(item => <li key={item}><History/>{item}</li>)}</ul> : <p className="muted">本次还没有教师复盘。</p>}</section>{summary && <section className="study-learning-result"><b>作业达成 · {summary.submittedCount} 份提交</b><div><span><strong>{summary.counts.secure}</strong>完整达成</span><span><strong>{summary.counts.partial}</strong>部分达成</span><span><strong>{summary.counts.notYet}</strong>尚未达成</span></div>{summary.focus.length ? <p>{summary.focus[0]}</p> : null}</section>}</article>
      </section>
      <section className="panel study-conclusion"><header><div><span>04 · 教师形成判断</span><h2>下一轮保留什么，只改什么</h2><p>系统只整理事实，不替教师宣布“教学有效”。请选择本次结论，并写清适用边界。</p></div><Badge tone={confirmed ? 'green' : dirty ? 'orange' : 'neutral'}>{confirmed ? '已确认' : dirty ? '待保存' : '已保存草稿'}</Badge></header><div className="study-decision-grid">{STUDY_DECISIONS.map(([value, label, note]) => <button type="button" key={value} disabled={confirmed} className={study.conclusion.decision === value ? 'active' : ''} aria-pressed={study.conclusion.decision === value} onClick={() => updateConclusion('decision', value)}><span>{label}</span><small>{note}</small></button>)}</div><div className="study-conclusion-fields"><label><span>本次发现</span><textarea rows="5" maxLength="1200" disabled={confirmed} value={study.conclusion.finding} onChange={event => updateConclusion('finding', event.target.value)} placeholder="例如：比较阴晴两景帮助学生找到景情关系，但从景情关系走向古仁人之心时仍缺少中间支架。"/><small>写可由课堂记录或作业结果支持的判断，不写“学生都已经掌握”。</small></label><label><span>下一轮只尝试这一项改变</span><textarea rows="5" maxLength="1200" disabled={confirmed} value={study.conclusion.nextTrial} onChange={event => updateConclusion('nextTrial', event.target.value)} placeholder="例如：保留两景比较，只在归纳前增加“景—情—志”关系图。"/><small>一次只改变一个关键环节，下一轮才知道变化来自哪里。</small></label></div><div className="study-boundary"><ShieldCheck/><span><b>适用边界</b><small>{study.conclusion.scopeBoundary}</small></span></div><footer><div><b>{confirmed ? '本次判断已经确认' : '教师确认后，才会成为可复用的教研结论'}</b><small>确认后保持只读；课堂事实变化时可重新整理，并保留旧版。</small></div>{!confirmed && <><button type="button" onClick={() => persist(false)} disabled={!dirty || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存研究草稿'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={study.conclusion.decision === 'undecided' || !study.conclusion.finding || !study.conclusion.nextTrial || Boolean(working)}>{working === 'confirm' ? '正在确认…' : '确认本次教学判断'}</button></>} {confirmed && <><a href={`/assets/`} className="primary">收进教研资产 <ArrowRight/></a><a href={`/share/?draftId=${encodeURIComponent(draftId)}`} title="只分享方案、三卡和公开教材页码，不包含课堂观察"><Share2/>分享方案快照</a></>}</footer></section>
    </>}
  </div>;
}

const SAME_LESSON_DECISIONS = [
  ['local_only', '保留差异', '两次课堂条件不同，暂不提炼通用做法'],
  ['transferable', '形成共识', '已有足够事实支持一条可迁移的教学判断'],
  ['needs_more', '继续验证', '当前差异值得再做一次有控制的课堂尝试']
];

function comparisonRecoveryKey(userId, leftId, rightId) {
  return `huojiaocan:same-lesson:${userId || 'anonymous'}:${leftId || 'left'}:${rightId || 'right'}`;
}

function ComparisonPractice({ profile, side }) {
  if (!profile) return null;
  const learning = profile.learning;
  return <article className={`panel comparison-practice comparison-${side}`}>
    <header><span>{side === 'left' ? 'A' : 'B'}</span><div><small>{profile.label || `实践 ${side === 'left' ? 'A' : 'B'}`}</small><h2>{profile.title}</h2></div><Badge tone={profile.decision === 'retain' ? 'green' : profile.decision === 'replace' ? 'orange' : 'gold'}>{({ retain: '保留', adjust: '调整', replace: '更换' })[profile.decision] || '教师判断'}</Badge></header>
    <section><b>本次课堂发现</b><p>{profile.finding || '本次尚未形成文字发现。'}</p></section>
    <section><b>下一轮准备改变</b><p>{profile.nextTrial || '本次尚未记录下一轮尝试。'}</p></section>
    {learning && <section className="comparison-learning"><b>作业达成 · {learning.submittedCount} 份</b><div><span><strong>{learning.secureRate ?? '—'}%</strong>完整达成</span><span><strong>{learning.partial}</strong>部分达成</span><span><strong>{learning.notYet}</strong>尚未达成</span></div></section>}
    <footer><a href={`/study/?draftId=${encodeURIComponent(profile.draftId)}`}>打开这次一课一研 <ArrowRight/></a></footer>
  </article>;
}

function SameLessonComparisonPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const leftId = params.get('left') || '';
  const rightId = params.get('right') || '';
  const userId = session?.user?.id || '';
  const [comparison, setComparison] = useState(emptySameLessonComparison());
  const [leftVersion, setLeftVersion] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const confirmed = comparison.status === 'confirmed';

  useEffect(() => {
    setBusy(true); setError(''); setNotice(''); setDirty(false); setComparison(emptySameLessonComparison());
    if (!userId) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!leftId || !rightId) { setError('还没有选定两次同篇目实践。请从教研资产库选择一组课堂记录。'); setBusy(false); return; }
    rootRequest(`/api/assets/${encodeURIComponent(leftId)}/compare/${encodeURIComponent(rightId)}`).then(data => {
      const serverValue = normalizeSameLessonComparison(data.comparison || {});
      let recovered = null;
      try { recovered = JSON.parse(localStorage.getItem(comparisonRecoveryKey(userId, leftId, rightId)) || 'null'); } catch {}
      const canRecover = recovered?.userId === userId && recovered?.sourceKey === serverValue.sourceKey && Number(recovered?.leftVersion) === Number(data.leftVersion) && serverValue.status !== 'confirmed';
      setComparison(canRecover ? normalizeSameLessonComparison(recovered.comparison) : serverValue);
      setLeftVersion(Number(data.leftVersion));
      setDirty(Boolean(canRecover));
      if (data.stale) setNotice('其中一次课堂记录已经更新，页面已按最新事实重新建立对照；旧结论仍保留在历史记录中。');
      else if (canRecover) setNotice('已恢复这台设备上尚未保存的同课对照结论。');
    }).catch(err => {
      const code = requestCode(err);
      setError(code === 'same_lesson_identity_mismatch' ? '这两份记录不属于同一篇目，不能进行同课对照。' : code === 'same_lesson_confirmed_studies_required' ? '两次课堂都需要先完成并确认“一课一研”，才能开始对照。' : askErrorMessage(err));
    }).finally(() => setBusy(false));
  }, [leftId, rightId, userId]);

  useEffect(() => {
    if (!dirty || !comparison.sourceKey || !leftVersion || !userId) return;
    try { localStorage.setItem(comparisonRecoveryKey(userId, leftId, rightId), JSON.stringify({ userId, sourceKey: comparison.sourceKey, leftVersion, comparison })); } catch {}
  }, [comparison, dirty, leftId, leftVersion, rightId, userId]);

  const updateSynthesis = (field, value) => {
    if (confirmed) return;
    setComparison(current => normalizeSameLessonComparison({ ...current, synthesis: { ...current.synthesis, [field]: value } }));
    setDirty(true); setNotice('');
  };
  const persist = async confirm => {
    if (!comparison.sourceKey || !leftVersion || working || confirmed) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/assets/${encodeURIComponent(leftId)}/compare/${encodeURIComponent(rightId)}`, { method: 'PATCH', body: { version: leftVersion, comparison, confirm } });
      setComparison(normalizeSameLessonComparison(data.comparison || {})); setLeftVersion(Number(data.leftVersion)); setDirty(false);
      try { localStorage.removeItem(comparisonRecoveryKey(userId, leftId, rightId)); } catch {}
      setNotice(confirm ? '同课对照结论已由教师确认，可作为下一轮集体备课的起点。' : '同课对照草稿已保存到当前账号。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'same_lesson_comparison_incomplete' ? '请先选择判断，并写清可迁移发现、适用边界和下一次验证方式。' : code === 'same_lesson_comparison_contains_student_identifier' ? '请删除姓名、学号、手机号等个人信息，只保留班级层面的课堂事实。' : code === 'edit_conflict' ? '其中一份记录已在其他页面更新。当前输入仍保留在本机，请刷新核对。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };

  return <div className="view-stack same-lesson-page">
    <section className="hero compact-hero comparison-hero"><div><Badge tone="gold"><GitCompareArrows/> 同课异构</Badge><h1>不评哪节课更好，<br/><em>只判断什么能够迁移</em></h1><p>把同一篇目的两次课堂事实并列呈现。系统负责保持材料边界，教师负责解释差异、写清适用条件，并决定下一次怎样验证。</p><div className="hero-actions"><a href="/assets/"><Archive/>重新选择课堂</a>{comparison.left?.draftId && <a href={`/study/?draftId=${encodeURIComponent(comparison.left.draftId)}`}><Microscope/>回到一课一研</a>}</div></div><div className="comparison-seal"><strong>A<small>×</small>B</strong><span>两次真实课堂</span><em>{confirmed ? '教师已确认' : comparison.sourceKey ? '等待形成共识' : '等待选择'}</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>本次同课对照暂时没有完成</b><p>{error}</p></div><div className="cards-alert-actions"><a href="/assets/">返回教研资产</a></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在并列两次课堂事实</h2><p>只读取当前账号中已确认的研究记录，不对学生建立个人画像。</p></section> : comparison.sourceKey && <>
      <section className="panel comparison-question"><div><span>01 · 对照对象</span><h2>{comparison.lessonTitle}</h2><p>同篇目、不同课堂条件；不把达成比例直接解释为教学因果。</p></div><Badge tone={confirmed ? 'green' : 'orange'}>{confirmed ? '教师确认版' : '对照草稿'}</Badge></section>
      <section className="comparison-grid"><ComparisonPractice profile={comparison.left} side="left"/><ComparisonPractice profile={comparison.right} side="right"/></section>
      <section className="panel comparison-observations"><header><div><span>02 · 系统只整理可见差异</span><h2>先看事实，不急着下结论</h2></div><ShieldCheck/></header><ul>{comparison.observations.map(item => <li key={item}><Check/>{item}</li>)}</ul><p>比例、课堂节奏和教师判断只说明两次实践发生了什么；是否能够迁移，仍需教师结合班级条件确认。</p></section>
      <section className="panel comparison-synthesis"><header><div><span>03 · 教师形成跨课堂判断</span><h2>留下一个可验证的教研命题</h2><p>不要写“这个方法一定有效”，而要写“在什么条件下，下一次准备怎样验证”。</p></div><Badge tone={confirmed ? 'green' : dirty ? 'orange' : 'neutral'}>{confirmed ? '已确认' : dirty ? '待保存' : '已保存草稿'}</Badge></header>
        <div className="comparison-decisions">{SAME_LESSON_DECISIONS.map(([value, label, note]) => <button type="button" key={value} disabled={confirmed} className={comparison.synthesis.decision === value ? 'active' : ''} onClick={() => updateSynthesis('decision', value)}><b>{label}</b><small>{note}</small></button>)}</div>
        <div className="comparison-fields"><label><span>可迁移的教学发现</span><textarea rows="5" disabled={confirmed} maxLength="1200" value={comparison.synthesis.transferableFinding} onChange={event => updateSynthesis('transferableFinding', event.target.value)} placeholder="例如：完成文意疏通后，先建立“景—情”关系，再进入价值判断，两次课堂都更容易形成有依据的表达。"/><small>只写两次事实共同支持的部分，不把相关性写成因果。</small></label><label><span>下一次怎样继续验证</span><textarea rows="5" disabled={confirmed} maxLength="1200" value={comparison.synthesis.nextExperiment} onChange={event => updateSynthesis('nextExperiment', event.target.value)} placeholder="例如：保持核心问题不变，只调整关系图出现的时机，继续观察学生能否独立完成价值归纳。"/><small>一次只改变一个变量，并沿用同一学习表现观察。</small></label><label className="comparison-boundary-field"><span>适用边界</span><textarea rows="3" disabled={confirmed} maxLength="500" value={comparison.synthesis.contextBoundary} onChange={event => updateSynthesis('contextBoundary', event.target.value)}/><small>写清班级基础、课时或前置任务，避免把局部经验包装成普遍结论。</small></label></div>
        <footer><div><b>{confirmed ? '这条教研命题已经确认' : '教师确认后，才会进入可复用教研资产'}</b><small>任一课堂事实更新后，对照会自动失效并按最新记录重建。</small></div>{!confirmed && <><button type="button" onClick={() => persist(false)} disabled={!dirty || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存对照草稿'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={comparison.synthesis.decision === 'undecided' || !comparison.synthesis.transferableFinding || !comparison.synthesis.contextBoundary || !comparison.synthesis.nextExperiment || Boolean(working)}>{working === 'confirm' ? '正在确认…' : '确认教研命题'}</button></>}{confirmed && <a className="primary" href={`/observation/?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`}><ClipboardCheck/>生成听评课观察单</a>}</footer>
      </section>
    </>}
  </div>;
}

function TeachingSlidesPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession(), stageRef = useRef(null);
  const draftId = params.get('draftId') || '', userId = session?.user?.id || '';
  const [deck, setDeck] = useState(null), [draftVersion, setDraftVersion] = useState(0), [active, setActive] = useState(0);
  const [mode, setMode] = useState('student'), [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [stale, setStale] = useState(false);
  const load = () => {
    setBusy(true); setError(''); setNotice('');
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定课堂方案。请先从课堂设计进入。'); setBusy(false); return; }
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/slides`).then(data => {
      setDeck(data.deck || null); setDraftVersion(Number(data.draftVersion || 0)); setStale(Boolean(data.stale)); setDirty(false); setActive(0);
    }).catch(err => {
      const code = requestCode(err);
      setError(code === 'teaching_slides_require_confirmed_plan' ? '请先确认当前教学方案，再生成课堂课件。' : code === 'teaching_slides_require_cards' ? '请先生成一课三卡，再把课堂主线整理成课件。' : code === 'draft_not_found' ? '没有找到这份课堂方案，或它不属于当前账号。' : askErrorMessage(err));
    }).finally(() => setBusy(false));
  };
  useEffect(load, [draftId, userId]);
  useEffect(() => {
    const onKey = event => {
      if (!deck || ['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return;
      if (event.key === 'ArrowRight') setActive(index => Math.min(deck.slides.length - 1, index + 1));
      if (event.key === 'ArrowLeft') setActive(index => Math.max(0, index - 1));
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [deck]);
  const current = deck?.slides?.[active] || null, readOnly = deck?.status === 'confirmed';
  const updateSlide = (field, value) => {
    if (!current || readOnly) return;
    setDeck(previous => ({ ...previous, slides: previous.slides.map((slide, index) => index === active ? { ...slide, [field]: value } : slide) }));
    setDirty(true); setNotice('');
  };
  const persist = async confirm => {
    if (!deck || !draftVersion || readOnly) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/slides`, { method: 'PATCH', body: JSON.stringify({ version: draftVersion, deck, confirm }) });
      setDeck(data.deck); setDraftVersion(Number(data.draftVersion || data.draft?.version || draftVersion + 1)); setDirty(false); setStale(false);
      setNotice(confirm ? '课件已经定稿。投屏文件只包含学生可见内容。' : '课件修改已保存，可以继续编辑其他页面。');
    } catch (err) {
      setError(requestCode(err) === 'edit_conflict' ? '这份方案刚刚在其他页面更新。请重新读取后再保存，当前页面内容暂未覆盖服务器版本。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const downloadProjector = () => {
    if (!deck) return;
    const url = URL.createObjectURL(new Blob([teachingSlideDeckHtml(deck)], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${String(deck.lessonTitle || '课堂').replace(/[《》]/gu, '')}-课堂投屏稿.html`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('离线投屏稿已下载。文件中不包含教师提示和教师用书答案。');
  };
  const references = useMemo(() => new Map((deck?.references || []).map(item => [String(item.id), item])), [deck?.references]);
  const refText = id => { const item = references.get(String(id)); return item ? `${docName(item.documentId)} 第 ${item.pdfPage} 页` : ''; };
  return <div className="view-stack teaching-slides-page">
    <section className="hero compact-hero slides-hero"><div><Badge tone="gold"><PanelTop/> 教材驱动课件</Badge><h1>不用从空白 PPT 开始，<br/><em>把已确认方案直接变成课堂投屏稿</em></h1><p>学生看到核心问题、原文任务、问题链和离堂任务；教师用书只进入备课提示，不会出现在下载的投屏文件中。</p><div className="hero-actions"><a href={draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}><ArrowLeft/>{draftId ? '返回课堂设计' : '先打开一份备课方案'}</a>{deck && <><button type="button" onClick={downloadProjector}><Download/>下载离线投屏稿</button><button type="button" onClick={() => stageRef.current?.requestFullscreen?.()}><Maximize2/>全屏预览</button></>}</div></div><div className="slides-hero-seal"><strong>{deck?.slides?.length || 7}</strong><span>页课堂主线</span><em>教师提示与学生投屏分开</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>课堂课件暂时没有准备好</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button><a href={draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>{draftId ? '返回课堂设计' : '先打开一份备课方案'}</a></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {stale && <section className="slides-stale"><RefreshCw/><div><b>方案或三卡已经更新</b><p>这里已按最新内容重建课件。保存前可以逐页检查，不会覆盖旧课件中的教材依据身份。</p></div></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在把课堂主线整理成课件</h2><p>只读取当前账号已确认的方案、三卡和真实教材页码。</p></section> : deck && <>
      <section className="slides-toolbar panel"><div><span>查看方式</span><div className="slides-mode-switch"><button type="button" className={mode === 'student' ? 'active' : ''} onClick={() => setMode('student')}><Eye/>学生投屏</button><button type="button" className={mode === 'teacher' ? 'active' : ''} onClick={() => setMode('teacher')}><FileCheck2/>教师备课</button></div></div><div className="slides-status"><Badge tone={readOnly ? 'green' : dirty ? 'orange' : 'gold'}>{readOnly ? '课件已定稿' : dirty ? '有未保存修改' : '可继续编辑'}</Badge><small>{mode === 'student' ? '当前隐藏全部教师提示' : '教师提示只在备课视图显示'}</small></div><div className="slides-save-actions">{!readOnly && <><button type="button" onClick={() => persist(false)} disabled={!dirty || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存修改'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={dirty || Boolean(working)}>{working === 'confirm' ? '正在定稿…' : '确认课件定稿'}</button></>}<button type="button" onClick={downloadProjector}><Download/>下载投屏稿</button></div></section>
      <section className="slides-workbench">
        <nav className="slides-thumbnails" aria-label="课件页面">{deck.slides.map((slide, index) => <button type="button" className={active === index ? 'active' : ''} onClick={() => setActive(index)} key={slide.id}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{slide.title}</b><small>{slide.body[0] || '等待教师补充'}</small></div></button>)}</nav>
        <section className={`slides-stage ${mode}`} ref={stageRef} aria-live="polite"><div className="slides-stage-counter">{String(active + 1).padStart(2, '0')} / {String(deck.slides.length).padStart(2, '0')}</div><span>{current.kind}</span><h2>{current.title}</h2><ul>{current.body.map((item, index) => <li key={`${current.id}-${index}`}>{item}</li>)}</ul>{current.prompt && <p>{current.prompt}</p>}{current.citationIds.length > 0 && <footer>{current.citationIds.map(refText).filter(Boolean).map(item => <small key={item}>{item}</small>)}</footer>}<div className="slides-stage-nav"><button type="button" onClick={() => setActive(index => Math.max(0, index - 1))} disabled={active === 0}><ArrowLeft/>上一页</button><button type="button" onClick={() => setActive(index => Math.min(deck.slides.length - 1, index + 1))} disabled={active === deck.slides.length - 1}>下一页<ArrowRight/></button></div></section>
        <aside className="slides-editor"><header><span>{mode === 'student' ? '编辑学生看到的内容' : '教师备课提示'}</span><h2>第 {active + 1} 页</h2><p>{readOnly ? '课件已经定稿；如需调整，请先回到课堂设计修改方案并重新生成。' : '每页只承担一个课堂动作，避免把教案整段搬上屏幕。'}</p></header>{mode === 'student' ? <div className="slides-editor-fields"><label><span>页面标题</span><input value={current.title} disabled={readOnly} maxLength="100" onChange={event => updateSlide('title', event.target.value)}/></label><label><span>投屏内容（每行一项）</span><textarea rows="8" value={current.body.join('\n')} disabled={readOnly} onChange={event => updateSlide('body', event.target.value.split(/\r?\n/u).slice(0, 7))}/></label><label><span>学生行动提示</span><textarea rows="4" value={current.prompt} disabled={readOnly} onChange={event => updateSlide('prompt', event.target.value)}/></label></div> : <div className="slides-editor-fields"><label><span>教师提示（不会进入投屏文件）</span><textarea rows="10" value={current.teacherNotes.join('\n')} disabled={readOnly} onChange={event => updateSlide('teacherNotes', event.target.value.split(/\r?\n/u).slice(0, 5))}/></label><div className="slides-teacher-sources"><b>教师用书核验页</b>{current.teacherCitationIds.map(refText).filter(Boolean).length ? current.teacherCitationIds.map(refText).filter(Boolean).map(item => <span key={item}>{item}</span>) : <p>本页没有绑定教师用书页面，不会伪造参考答案。</p>}</div></div>}<footer><ShieldCheck/><p><b>学生投屏隔离</b>下载文件只包含学生视图和学生教材页码，不包含此处教师提示。</p></footer></aside>
      </section>
    </>}
  </div>;
}

function LayeredHomeworkPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession();
  const draftId = params.get('draftId') || '', userId = session?.user?.id || '';
  const [pack, setPack] = useState(null), [draftVersion, setDraftVersion] = useState(0), [active, setActive] = useState(0);
  const [mode, setMode] = useState('student'), [busy, setBusy] = useState(true), [working, setWorking] = useState('');
  const [dirty, setDirty] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = () => {
    setBusy(true); setError(''); setNotice('');
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定课堂方案。请先从一课三卡进入。'); setBusy(false); return; }
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-pack`).then(data => {
      setPack(data.pack || null); setDraftVersion(Number(data.draftVersion || 0)); setStale(Boolean(data.stale)); setActive(0); setDirty(false);
    }).catch(err => {
      const code = requestCode(err);
      setError(code === 'homework_requires_confirmed_plan' ? '请先确认教学方案，再生成课后作业。' : code === 'homework_requires_cards' ? '请先生成一课三卡，再把课堂目标转成分层作业。' : code === 'homework_requires_textbook_evidence' ? '当前三卡还没有绑定学生教材页码。请先补充教材依据，避免生成脱离课文的题目。' : code === 'draft_not_found' ? '没有找到这份课堂方案，或它不属于当前账号。' : askErrorMessage(err));
    }).finally(() => setBusy(false));
  };
  useEffect(load, [draftId, userId]);
  const task = pack?.tasks?.[active] || null, readOnly = pack?.status === 'confirmed';
  const updateTask = changes => {
    if (!task || readOnly) return;
    setPack(previous => ({ ...previous, tasks: previous.tasks.map((item, index) => index === active ? { ...item, ...changes } : item) }));
    setDirty(true); setNotice('');
  };
  const updateCriterion = (criterionId, changes) => updateTask({ rubric: task.rubric.map(item => item.id === criterionId ? { ...item, ...changes } : item) });
  const persist = async confirm => {
    if (!pack || !draftVersion || readOnly || working) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-pack`, { method: 'PATCH', body: { version: draftVersion, pack, confirm } });
      setPack(data.pack); setDraftVersion(Number(data.draftVersion || data.draft?.version || draftVersion + 1)); setDirty(false); setStale(false);
      setNotice(confirm ? '作业与批改单已经定稿。学生版不会包含参考答案和教师用书内容。' : '修改已保存到当前账号，可以继续调整其他层级。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'edit_conflict' ? '这份方案刚刚在其他页面更新。当前输入仍保留，请重新读取后核对。' : code === 'homework_incomplete' ? '还有题目、作答要求、参考要点或评分项未填写完整。' : askErrorMessage(err));
    } finally { setWorking(''); }
  };
  const download = (content, type, suffix) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${String(pack?.lessonTitle || '课堂').replace(/[《》]/gu, '')}-${suffix}`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadStudent = () => { if (pack) { download(layeredHomeworkStudentHtml(pack), 'text/html;charset=utf-8', '学生分层作业.html'); setNotice('学生作业已下载，可直接打印；其中不含参考答案和教师用书内容。'); } };
  const downloadTeacher = () => { if (pack) { download(layeredHomeworkTeacherMarkdown(pack), 'text/markdown;charset=utf-8', '参考批改单.md'); setNotice('教师参考批改单已下载，包含参考要点、评分量规和核验页码。'); } };
  const references = useMemo(() => new Map((pack?.references || []).map(item => [String(item.id), item])), [pack?.references]);
  const refText = id => { const item = references.get(String(id)); return item ? `${docName(item.documentId)} 第 ${item.pdfPage} 页` : ''; };
  return <div className="view-stack layered-homework-page">
    <section className="hero compact-hero homework-hero"><div><Badge tone="gold"><ClipboardCheck/> 分层作业</Badge><h1>同一篇教材，<br/><em>同时准备学生作业与教师批改单</em></h1><p>依据学生教材生成 A、B、C 三层任务；教师用书只用于参考要点与评分说明。题目、答案和教材页码分开管理，减少出题与批改之间的重复劳动。</p><div className="hero-actions"><a href={draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}><ArrowLeft/>{draftId ? '返回课堂设计' : '先打开一份备课方案'}</a>{pack && <><button type="button" onClick={downloadStudent}><Download/>下载学生作业</button><button type="button" onClick={downloadTeacher}><FileCheck2/>下载教师批改单</button>{readOnly && <a href={`/marking/?draftId=${encodeURIComponent(draftId)}`}><FileCheck2/>批改匿名答案</a>}</>}</div></div><div className="homework-hero-seal"><strong>{pack?.tasks?.length || 3}</strong><span>层学习任务</span><em>{pack?.totalScore || 0} 分 · 教师答案独立保存</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>分层作业暂时没有准备好</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button><a href={draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>{draftId ? '返回课堂设计' : '先打开一份备课方案'}</a></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {stale && <section className="homework-stale"><RefreshCw/><div><b>教学方案或三卡已经更新</b><p>作业已按最新教材依据重建。请重新核对题目与评分说明后再定稿。</p></div></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在整理三层学习任务</h2><p>只读取当前账号已确认的方案、三卡和真实教材页码。</p></section> : pack && <>
      <section className="homework-toolbar panel"><div><span>当前查看</span><div className="homework-mode-switch"><button type="button" className={mode === 'student' ? 'active' : ''} onClick={() => setMode('student')}><Eye/>学生作业</button><button type="button" className={mode === 'teacher' ? 'active' : ''} onClick={() => setMode('teacher')}><FileCheck2/>教师批改单</button></div></div><div className="homework-status"><Badge tone={readOnly ? 'green' : dirty ? 'orange' : 'gold'}>{readOnly ? '作业已定稿' : dirty ? '有未保存修改' : '可继续编辑'}</Badge><small>{mode === 'student' ? '当前不显示参考答案与教师用书内容' : '参考要点用于统一批改，不要求学生使用唯一措辞'}</small></div><div className="homework-save-actions">{!readOnly && <><button type="button" onClick={() => persist(false)} disabled={!dirty || Boolean(working)}>{working === 'save' ? '正在保存…' : '保存修改'}</button><button type="button" className="primary" onClick={() => persist(true)} disabled={Boolean(working)}>{working === 'confirm' ? '正在定稿…' : '确认作业定稿'}</button></>}<button type="button" onClick={mode === 'student' ? downloadStudent : downloadTeacher}><Download/>{mode === 'student' ? '下载学生版' : '下载教师版'}</button></div></section>
      <section className={`homework-workbench ${mode}`}>
        <nav className="homework-levels" aria-label="作业层级">{pack.tasks.map((item, index) => <button type="button" key={item.id} className={`${active === index ? 'active' : ''} level-${item.level.toLowerCase()}`} onClick={() => setActive(index)}><span>{item.level}</span><div><b>{item.label}</b><small>{item.score} 分 · {item.prompt}</small></div></button>)}</nav>
        <article className={`homework-paper level-${task.level.toLowerCase()}`}><header><div><span>学生分层作业 · {task.level} 层</span><h2>{pack.lessonTitle}</h2><p>{task.label}｜{task.score} 分</p></div><strong>{task.level}</strong></header><section className="homework-core"><b>本课核心问题</b><p>{pack.coreQuestion}</p></section><section className="homework-question"><span>学习任务</span><h3>{task.prompt}</h3><p>{task.directions}</p><div>{task.studentCitationIds.map(refText).filter(Boolean).map(item => <small key={item}>{item}</small>)}</div></section><section className="homework-answer-space"><span>作答区</span>{Array.from({ length: task.level === 'C' ? 9 : task.level === 'B' ? 7 : 5 }, (_, index) => <i key={index}/>)}</section><footer>班级：____________　姓名：____________　日期：____________</footer></article>
        <aside className="homework-editor"><header><span>{mode === 'student' ? '编辑学生任务' : '编辑教师参考'}</span><h2>{task.level} · {task.label}</h2><p>{readOnly ? '作业已经定稿。如需调整，请回到课堂设计修改方案并重新生成。' : mode === 'student' ? '题目必须能够回到学生教材核验，避免脱离本课另起炉灶。' : '参考要点与评分量规只提供给教师，不进入学生版。'}</p></header>{mode === 'student' ? <div className="homework-editor-fields"><label><span>题目</span><textarea rows="6" disabled={readOnly} value={task.prompt} maxLength="360" onChange={event => updateTask({ prompt: event.target.value })}/></label><label><span>作答要求</span><textarea rows="6" disabled={readOnly} value={task.directions} maxLength="420" onChange={event => updateTask({ directions: event.target.value })}/></label><div className="homework-source-box"><b>学生教材核验页</b>{task.studentCitationIds.map(refText).filter(Boolean).map(item => <span key={item}>{item}</span>)}</div></div> : <div className="homework-editor-fields"><label><span>参考要点（每行一项）</span><textarea rows="7" disabled={readOnly} value={task.answerGuide.join('\n')} onChange={event => updateTask({ answerGuide: event.target.value.split(/\r?\n/u).slice(0, 5) })}/></label><div className="homework-rubric"><b>评分量规 · 共 {task.score} 分</b>{task.rubric.map(item => <section key={item.id}><header><input disabled={readOnly} value={item.label} maxLength="80" onChange={event => updateCriterion(item.id, { label: event.target.value })}/><strong>{item.points} 分</strong></header><textarea rows="3" disabled={readOnly} value={item.description} maxLength="260" onChange={event => updateCriterion(item.id, { description: event.target.value })}/></section>)}</div><div className="homework-source-box teacher"><b>教师备课核验页</b>{task.teacherCitationIds.map(refText).filter(Boolean).length ? task.teacherCitationIds.map(refText).filter(Boolean).map(item => <span key={item}>{item}</span>) : <p>当前任务没有绑定教师用书页面，不会补写虚构答案。</p>}</div></div>}<footer><ShieldCheck/><p><b>学生与教师内容分开</b>学生下载版只包含题目、作答区和学生教材页码。</p></footer></aside>
      </section>
    </>}
  </div>;
}

function AnonymousMarkingPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession();
  const draftId = params.get('draftId') || '', userId = session?.user?.id || '';
  const [tasks, setTasks] = useState([]), [taskId, setTaskId] = useState(''), [draftVersion, setDraftVersion] = useState(0);
  const [review, setReview] = useState(null), [results, setResults] = useState([]), [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [dirty, setDirty] = useState(false), [stale, setStale] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const responses = useMemo(() => raw.split(/\n\s*---+\s*\n/u).map(item => item.trim()).filter(Boolean).slice(0, 41), [raw]);
  const load = () => {
    setBusy(true); setError(''); setNotice(''); setResults([]);
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定已定稿的分层作业。请先从课堂设计进入。'); setBusy(false); return; }
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review`).then(data => {
      const available = Array.isArray(data.tasks) ? data.tasks : [];
      setTasks(available); setReview(data.review || null); setStale(Boolean(data.stale)); setDraftVersion(Number(data.draftVersion || 0));
      setTaskId(data.review?.taskId || available[0]?.id || ''); setDirty(false);
    }).catch(err => { const code = requestCode(err); setError(code === 'draft_not_found' ? '没有找到这份课堂方案，或它不属于当前账号。' : code === 'homework_marking_requires_confirmed_pack' ? '请先在分层作业页面完成定稿，再开始批改。' : code === 'homework_marking_pack_stale' ? '分层作业已经随教学方案变化。请先重新定稿作业。' : askErrorMessage(err)); }).finally(() => setBusy(false));
  };
  useEffect(load, [draftId, userId]);
  const selectedTask = tasks.find(item => item.id === taskId) || tasks[0] || null, readOnly = review?.status === 'confirmed';
  const explainError = err => {
    const code = requestCode(err);
    return code === 'homework_marking_requires_confirmed_pack' ? '请先在分层作业页面完成定稿，再开始批改。'
      : code === 'homework_marking_pack_stale' ? '分层作业已经随教学方案变化。请先重新定稿作业。'
      : code === 'homework_marking_responses_invalid' ? '请粘贴 1—40 份有效答案，并用单独一行“---”分隔。'
      : code === 'homework_marking_contains_identifier' ? '答案中可能包含姓名、学号或联系方式。请删除身份信息后再分析。'
      : code === 'homework_marking_invalid_response' ? '本次批改结果结构不完整，未保存结论。请重新分析。'
      : code === 'homework_review_incomplete' ? '确认前请勾选至少一项后续动作，并写下教师判断。'
      : code === 'edit_conflict' ? '这份方案刚刚在其他页面更新。当前输入仍保留，请重新读取后核对。'
      : askErrorMessage(err);
  };
  const analyze = async () => {
    if (!selectedTask || responses.length < 1 || responses.length > 40 || working) return;
    setWorking('analyze'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review/analyze`, { method: 'POST', body: { version: draftVersion, taskId: selectedTask.id, responses } });
      setReview(data.review); setResults(data.results || []); setDraftVersion(Number(data.draftVersion || draftVersion + 1)); setRaw(''); setDirty(false); setStale(false);
      setNotice(`已完成 ${data.results?.length || 0} 份匿名答案分析。答案原文已从页面清除，服务器只保存班级汇总。`);
    } catch (err) { setError(explainError(err)); } finally { setWorking(''); }
  };
  const updateReview = changes => { if (readOnly) return; setReview(current => ({ ...current, ...changes })); setDirty(true); setNotice(''); };
  const persist = async confirm => {
    if (!review || readOnly || working) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review`, { method: 'PATCH', body: { version: draftVersion, review, confirm } });
      setReview(data.review); setDraftVersion(Number(data.draftVersion || draftVersion + 1)); setDirty(false);
      setNotice(confirm ? '班级批改结论已经确认，可用于下一课调整。' : '班级汇总与教师判断已保存。');
    } catch (err) { setError(explainError(err)); } finally { setWorking(''); }
  };
  const downloadCsv = () => {
    if (!results.length) return;
    const url = URL.createObjectURL(new Blob([`\ufeff${homeworkReviewCsv(results)}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selectedTask?.level || ''}-${selectedTask?.label || '匿名批改'}-反馈.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('匿名反馈表已下载，不包含学生答案原文和身份信息。');
  };
  const statusText = status => status === 'secure' ? '已达成' : status === 'partial' ? '部分达成' : '需要支持';
  return <div className="view-stack anonymous-marking-page">
    <section className="hero compact-hero marking-hero"><div><Badge tone="gold"><FileCheck2/> 匿名批改</Badge><h1>不保存学生原文，<br/><em>只把批改变成下一课可用的判断</em></h1><p>粘贴去姓名后的答案，系统按照已定稿题目、教材依据和评分量规逐份反馈。完成后清除答案原文，只把班级达成情况、共性问题和教师确认的后续动作保存到方案中。</p><div className="hero-actions"><a href={draftId ? `/homework/?draftId=${encodeURIComponent(draftId)}` : '/homework/'}><ArrowLeft/>返回分层作业</a>{results.length > 0 && <button type="button" onClick={downloadCsv}><Download/>下载匿名反馈表</button>}</div></div><div className="marking-hero-seal"><strong>0</strong><span>份学生原文留存</span><em>只保存班级汇总和教师判断</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>本次匿名批改没有完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {stale && <section className="marking-stale"><RefreshCw/><div><b>题目或评分量规已经更新</b><p>旧汇总不再代表当前作业。请回到分层作业重新定稿，再分析新答案。</p></div></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在读取已定稿作业</h2><p>不会读取或恢复任何学生答案原文。</p></section> : <>
      <section className="marking-flow panel"><div className="done"><Check/>作业定稿</div><ArrowRight/><div className={results.length ? 'done' : 'current'}>匿名答案分析</div><ArrowRight/><div className={review ? 'current' : ''}>教师确认班级判断</div><ArrowRight/><div>进入下一课调整</div></section>
      <section className="marking-workbench">
        <aside className="marking-input panel"><header><span>01 · 选择题目</span><h2>粘贴匿名答案</h2><p>每份答案之间用单独一行 <b>---</b> 分隔。请先删除姓名、学号、电话和其他身份信息。</p></header><label><span>作业层级</span><select value={taskId} onChange={event => { setTaskId(event.target.value); setResults([]); }}>{tasks.map(item => <option key={item.id} value={item.id}>{item.level} · {item.label}（{item.score} 分）</option>)}</select></label>{selectedTask && <div className="marking-task"><span>{selectedTask.level}</span><div><b>{selectedTask.prompt}</b><small>满分 {selectedTask.score} 分</small></div></div>}<label><span>去姓名后的答案</span><textarea rows="15" value={raw} onChange={event => setRaw(event.target.value)} placeholder={'第一份匿名答案……\n---\n第二份匿名答案……'}/></label><div className={`marking-count ${responses.length > 40 ? 'invalid' : ''}`}><span>{responses.length} 份待分析</span><small>单次最多 40 份；输入内容不会写入本地恢复或草稿。</small></div><button type="button" className="primary marking-analyze" disabled={!selectedTask || responses.length < 1 || responses.length > 40 || Boolean(working) || stale} onClick={analyze}>{working === 'analyze' ? <><Activity/>正在依据量规分析…</> : <><FileCheck2/>开始匿名批改</>}</button></aside>
        <main className="marking-results panel"><header><div><span>02 · 逐份反馈</span><h2>{results.length ? `${results.length} 份答案的匿名反馈` : '分析后在这里逐份核对'}</h2><p>{results.length ? '序号只代表本次粘贴顺序；页面不会显示或恢复答案原文。' : '系统只返回达成状态、分数、已经做到和下一步建议。'}</p></div>{results.length > 0 && <button type="button" onClick={downloadCsv}><Download/>导出反馈</button>}</header>{results.length ? <div className="marking-result-list">{results.map(item => <article className={`status-${item.status}`} key={item.id}><div className="marking-result-number"><span>{String(item.sequence).padStart(2, '0')}</span><b>{item.score}<small>/{item.maxScore}</small></b></div><div><Badge tone={item.status === 'secure' ? 'green' : item.status === 'partial' ? 'orange' : 'purple'}>{statusText(item.status)}</Badge><h3>{item.strengths.length ? item.strengths.join('；') : '已经完成基本作答'}</h3><p><b>下一步：</b>{item.nextStep}</p></div></article>)}</div> : <div className="marking-empty"><FileCheck2/><h3>这里不会出现学生答案原文</h3><p>分析完成后只显示匿名序号与反馈。刷新页面后，逐份反馈也不会从服务器恢复；需要留存时请下载匿名反馈表。</p></div>}</main>
        <aside className="marking-summary"><section className="panel"><header><span>03 · 班级层面</span><h2>教师确认后再回流</h2><p>系统汇总不是教材结论。请结合课堂观察写下你的判断。</p></header>{review ? <><div className="marking-metrics"><div><strong>{review.responseCount}</strong><small>本批答案</small></div><div><strong>{review.averageScore}</strong><small>平均分 / {review.maxScore}</small></div></div><div className="marking-distribution"><span style={{'--value': `${review.responseCount ? review.counts.secure / review.responseCount * 100 : 0}%`}}><b>已达成</b><i/><small>{review.counts.secure}</small></span><span style={{'--value': `${review.responseCount ? review.counts.partial / review.responseCount * 100 : 0}%`}}><b>部分达成</b><i/><small>{review.counts.partial}</small></span><span style={{'--value': `${review.responseCount ? review.counts.notYet / review.responseCount * 100 : 0}%`}}><b>需要支持</b><i/><small>{review.counts.notYet}</small></span></div><div className="marking-patterns"><b>共性问题</b><ul>{review.patterns.map(item => <li key={item}>{item}</li>)}</ul></div><div className="marking-actions"><b>选择下一课动作</b>{review.nextActions.map(item => <label key={item.id}><input type="checkbox" disabled={readOnly} checked={review.selectedActionIds.includes(item.id)} onChange={event => updateReview({ selectedActionIds: event.target.checked ? [...review.selectedActionIds, item.id] : review.selectedActionIds.filter(id => id !== item.id) })}/><span>{item.text}</span></label>)}</div><label className="marking-teacher-note"><span>教师判断</span><textarea rows="5" disabled={readOnly} value={review.teacherNote} onChange={event => updateReview({ teacherNote: event.target.value })} placeholder="例如：多数学生能定位词句，但还不能解释景物与情感之间的关系；下节课先用关系图集中复盘。"/></label><footer>{!readOnly ? <><button type="button" disabled={!dirty || Boolean(working)} onClick={() => persist(false)}>{working === 'save' ? '正在保存…' : '保存班级汇总'}</button><button type="button" className="primary" disabled={Boolean(working)} onClick={() => persist(true)}>{working === 'confirm' ? '正在确认…' : '确认并用于下一课'}</button></> : <div className="marking-confirmed"><CheckCircle2/><span><b>教师已确认</b><small>新一批答案可以重新分析，旧汇总会进入历史记录。</small></span></div>}</footer></> : <div className="marking-summary-empty"><Network/><b>等待形成班级概况</b><p>分析答案后，这里只保存数量、共性问题和后续动作，不保存学生原文。</p></div>}</section></aside>
      </section>
    </>}
  </div>;
}

function ObservationProtocolPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession();
  const leftId = params.get('left') || '', rightId = params.get('right') || '', userId = session?.user?.id || '';
  const [protocol, setProtocol] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    setBusy(true); setError(''); setProtocol(null);
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!leftId || !rightId) { setError('还没有选定已确认的同课对照。请先从教研问题簿进入。'); setBusy(false); return; }
    rootRequest(`/api/assets/${encodeURIComponent(leftId)}/compare/${encodeURIComponent(rightId)}/observation`).then(data => setProtocol(data.protocol || null)).catch(err => {
      const code = requestCode(err);
      setError(code === 'observation_protocol_requires_confirmed_comparison' ? '这份同课对照还没有经过教师确认，暂时不能生成听评课观察单。' : code === 'same_lesson_comparison_stale' ? '其中一次课堂事实已经更新。请先重新完成同课对照，再生成观察单。' : code === 'same_lesson_comparison_not_found' ? '没有找到对应的同课对照，请从教研问题簿重新选择。' : askErrorMessage(err));
    }).finally(() => setBusy(false));
  }, [leftId, rightId, userId]);
  const download = () => {
    if (!protocol) return;
    const url = URL.createObjectURL(new Blob([observationProtocolMarkdown(protocol)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${String(protocol.lessonTitle || '课堂').replace(/[《》]/gu, '')}-听评课观察单.md`; anchor.click(); URL.revokeObjectURL(url);
    setNotice('观察单 Markdown 已下载，可以继续编辑或打印。');
  };
  return <div className="view-stack observation-page"><section className="hero compact-hero observation-hero no-print"><div><Badge tone="gold"><ClipboardCheck/> 听评课观察单</Badge><h1>不评价教师表现，<br/><em>只记录教研命题在课堂里发生了什么</em></h1><p>观察指标来自教师已经确认的同课对照。课堂中只记时刻、事件、学生表现、教师动作和原文依据，不记录学生身份。</p><div className="hero-actions"><a href="/research/"><FileText/>返回教研问题簿</a>{protocol && <><button type="button" onClick={() => window.print()}><FileText/>打印观察单</button><button type="button" onClick={download}><Download/>下载 Markdown</button></>}</div></div></section>{error && <section className="cards-alert no-print" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>听评课观察单暂时没有生成</b><p>{error}</p></div><div className="cards-alert-actions"><a href="/research/">返回教研问题簿</a></div></section>}{notice && <section className="quality-box no-print"><CheckCircle2/><span>{notice}</span></section>}{busy ? <section className="panel study-empty no-print"><Activity/><h2>正在建立课堂观察协议</h2><p>只读取教师已经确认的教研命题和可核验教材页码。</p></section> : protocol && <article className="observation-sheet"><header><div><span>活教参 · 教研观察协议</span><h1>{protocol.lessonTitle}｜听评课观察单</h1><p>围绕一个命题观察，不做笼统评分</p></div><div className="observation-meta"><label>观察人<strong></strong></label><label>日期<strong></strong></label><label>班级<strong></strong></label></div></header><section className="observation-proposition"><span>本次教研命题</span><h2>{protocol.researchQuestion}</h2><p><b>适用边界</b>{protocol.contextBoundary}</p></section><section className="observation-variable-grid"><div><span>保持不变</span><p>{protocol.keepConstant}</p></div><div><span>本次只改变</span><p>{protocol.changeVariable}</p></div></section><section className="observation-indicators"><header><span>观察指标</span><p>只勾选和记录可观察行为，不推测学生心理。</p></header><div>{protocol.indicators.map((item, index) => <article key={item.id}><strong>{String(index + 1).padStart(2, '0')}</strong><div><b>{item.title}</b><p>{item.watchFor}</p><small>来源：{item.source}</small></div><i>□ 出现　□ 部分出现　□ 未出现</i></article>)}</div></section><section className="observation-record"><header><span>课堂观察记录</span><p>{protocol.privacyNotice}</p></header><table><thead><tr><th>时间段</th><th>课堂事件</th><th>学生表现</th><th>教师动作</th><th>教材原文依据</th></tr></thead><tbody>{protocol.timeWindows.map(item => <tr key={item.id}><th><b>{item.time}</b><small>{item.label}</small></th><td></td><td></td><td></td><td></td></tr>)}</tbody></table></section><section className="observation-reflection"><header><span>课后只形成三个判断</span><p>先引用观察记录，再写结论。</p></header><div><label><b>哪一条观察支持当前命题？</b><span></span></label><label><b>哪一条观察与预期不一致？</b><span></span></label><label><b>下一次只保留或改变什么？</b><span></span></label></div></section><footer><div><b>教材核验页面</b><p>{protocol.references.length ? protocol.references.map(item => `${docName(item.documentId)} 第 ${item.pdfPage} 页`).join('　·　') : '当前观察单没有绑定可核验页面，请回到原方案补充教材依据。'}</p></div><small>本观察单由教师确认的教研命题生成，不代表教材结论，也不用于评价教师绩效。</small></footer></article>}</div>;
}

function sourceCoverageLabel(coverage) {
  if (!coverage) return '本轮回答尚未标记材料覆盖情况';
  return coverage.complete ? '学生教材、教师用书与课程标准均已覆盖' : (coverage.label || `已覆盖 ${3 - (coverage.missing || []).length}/3 类材料`);
}
function AssetCoverage({ coverage }) {
  const rows = [['textbook', '学生教材', '锁定课文原文、任务和页码'], ['teacherGuide', '教师用书', '参考教学目标、重点难点与活动处理'], ['curriculumStandard', '课程标准', '补充课程目标与评价依据']];
  return <div className="asset-coverage"><header><div><span>材料覆盖</span><b>{sourceCoverageLabel(coverage)}</b></div><small>没有导入的材料不会被虚构为已引用</small></header><div className="asset-coverage-grid">{rows.map(([key, title, note]) => <div className={coverage?.[key] ? 'covered' : 'missing'} key={key}><span>{coverage?.[key] ? <CheckCircle2/> : <CircleAlert/>}</span><div><b>{title}</b><small>{coverage?.[key] ? '本方案已有可核验页面' : `尚未覆盖 · ${note}`}</small></div></div>)}</div></div>;
}
function PlanQualitySummary({ quality }) {
  const errors = quality?.issues?.filter(item => item.severity === 'error').length || 0;
  const warnings = quality?.issues?.filter(item => item.severity === 'warning').length || 0;
  const ready = quality?.status === 'ready';
  return <div className={`plan-quality-summary ${ready ? 'ready' : 'review'}`}>
    <div><span>方案检查</span><b>{ready ? '已具备课堂使用基础' : '还需要补充或核对'}</b></div>
    <strong>{quality?.score ?? 0}<small>分</small></strong>
    <p>{ready ? '三张卡、课堂流程与教材依据已形成闭环。锁定前仍建议回看关键页面。' : `还有 ${errors} 项必补内容${warnings ? `，${warnings} 项建议核对` : ''}。完善后再锁定，课堂使用会更稳妥。`}</p>
  </div>;
}
function assetWorkflowBadge(asset = {}) {
  if (asset.classroomStatus === 'in_progress') return { label: '课堂进行中', tone: 'gold' };
  if (asset.classroomStatus === 'pending_review') return { label: '待确认复盘', tone: 'purple' };
  if (asset.lessonStudyStale) return { label: '研究记录待更新', tone: 'orange' };
  if (asset.lessonStudyStatus === 'confirmed') return { label: '教学判断已确认', tone: 'green' };
  if (asset.lessonStudyStatus === 'draft') return { label: '一课一研待确认', tone: 'purple' };
  if (asset.learningEvidenceStale) return { label: '作业回流待更新', tone: 'orange' };
  if (asset.learningEvidenceStatus === 'confirmed') return { label: '作业学情已确认', tone: 'gold' };
  if (asset.learningEvidenceStatus === 'draft') return { label: '作业回流进行中', tone: 'orange' };
  if (asset.status === 'published') return { label: '已归档', tone: 'green' };
  if (asset.hasUnconfirmedChanges) return { label: '有待确认修改', tone: 'orange' };
  if (asset.rehearsalStatus === 'confirmed') return { label: '问题链已预演', tone: 'gold' };
  if (asset.rehearsalStatus === 'draft') return { label: '预演进行中', tone: 'orange' };
  if (asset.cardsGenerated) return { label: '三卡已生成', tone: 'green' };
  if (asset.teacherConfirmed) return { label: '教师已定稿', tone: 'green' };
  return { label: '方案草稿', tone: 'orange' };
}
function assetPrimaryAction(asset = {}) {
  const id = encodeURIComponent(asset.draftId || '');
  if (asset.classroomStatus === 'in_progress') return { href: `/cards/?draftId=${id}&classroom=1`, label: '继续本节课堂' };
  if (asset.classroomStatus === 'pending_review') return { href: `/reflection/?draftId=${id}`, label: '确认课后复盘' };
  if (asset.lessonStudyStale) return { href: `/study/?draftId=${id}`, label: '更新一课一研' };
  if (asset.lessonStudyStatus === 'draft') return { href: `/study/?draftId=${id}`, label: '形成教学判断' };
  if (asset.lessonStudyStatus === 'confirmed') return { href: `/study/?draftId=${id}`, label: '查看一课一研' };
  if (asset.learningEvidenceStale) return { href: `/learning/?draftId=${id}`, label: '更新作业回流' };
  if (asset.learningEvidenceStatus === 'draft') return { href: `/learning/?draftId=${id}`, label: '继续作业回流' };
  if (asset.learningEvidenceStatus === 'confirmed' || asset.hasReflection) return { href: `/study/?draftId=${id}`, label: '整理一课一研' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'confirmed' && !asset.rehearsalStale) return { href: `/cards/?draftId=${id}&classroom=1`, label: '打开本节课堂' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStale) return { href: `/rehearsal/?draftId=${id}`, label: '更新问题链预演' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'draft') return { href: `/rehearsal/?draftId=${id}`, label: '继续问题链预演' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'none') return { href: `/rehearsal/?draftId=${id}`, label: '课前预演问题链' };
  return { href: `/cards/?draftId=${id}`, label: asset.status === 'published' ? '打开方案' : asset.teacherConfirmed && asset.cardsGenerated ? '检查方案' : '继续定稿' };
}
function sharedItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return item.teacherAction || item.studentTask || item.content || item.title || item.question || item.text || '';
}
function SharedPlanList({ title, items }) {
  const values = (Array.isArray(items) ? items : []).filter(sharedItemText);
  if (!values.length) return null;
  return <section className="share-plan-section"><h3>{title}</h3><ol>{values.map((item, index) => <li key={`${title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{sharedItemText(item)}</b>{typeof item === 'object' && item.studentTask && item.studentTask !== sharedItemText(item) && <p>学生任务：{item.studentTask}</p>}{typeof item === 'object' && item.expectedEvidence && <small>可观察表现：{item.expectedEvidence}</small>}{typeof item === 'object' && item.duration && <em>{item.duration}</em>}</div></li>)}</ol></section>;
}
function TeachingSharePage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || '';
  const token = useMemo(() => { const raw = String(location.hash || '').replace(/^#(?:token=)?/u, '').trim(); try { return decodeURIComponent(raw); } catch { return raw; } }, []);
  const recipientMode = Boolean(token);
  const [draft, setDraft] = useState(null);
  const [shares, setShares] = useState([]);
  const [share, setShare] = useState(null);
  const [expiryDays, setExpiryDays] = useState(14);
  const [freshLink, setFreshLink] = useState('');
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOwner = async () => {
    if (!draftId) { setError('还没有选定要分享的备课方案。'); setBusy(false); return; }
    setBusy(true); setError('');
    try {
      const [draftData, shareData] = await Promise.all([
        rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`),
        rootRequest(`/api/shares?draftId=${encodeURIComponent(draftId)}`)
      ]);
      setDraft(draftData.draft || draftData);
      setShares(Array.isArray(shareData.shares) ? shareData.shares : []);
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (recipientMode) {
      setBusy(true); setError('');
      rootRequest('/api/shares/resolve', { method: 'POST', body: { token } })
        .then(data => setShare(data.share || null))
        .catch(err => setError(['share_not_found', 'share_token_invalid'].includes(requestCode(err)) ? '这份共备链接已失效或已被撤销。' : askErrorMessage(err)))
        .finally(() => setBusy(false));
      return;
    }
    if (!session?.user?.id) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    loadOwner();
  }, [recipientMode, token, draftId, session?.user?.id]);

  const create = async () => {
    if (!draft || working) return;
    setWorking('create'); setError(''); setMessage(''); setFreshLink('');
    try {
      const data = await rootRequest('/api/shares', { method: 'POST', body: { draftId, version: draft.version, expiresInDays: expiryDays } });
      const link = `${location.origin}/share/#${data.token}`;
      setFreshLink(link);
      setShares(items => [data.share, ...items]);
      setMessage('已生成一份独立快照。以后继续编辑原方案，不会悄悄改动这份共备内容。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setWorking(''); }
  };
  const copyLink = async () => {
    if (!freshLink) return;
    try { await navigator.clipboard.writeText(freshLink); setMessage('共备链接已复制。'); }
    catch { setMessage('请手动选中链接后复制。'); }
  };
  const revoke = async item => {
    if (working) return;
    setWorking(`revoke:${item.id}`); setError('');
    try {
      const data = await rootRequest(`/api/shares/${encodeURIComponent(item.id)}/revoke`, { method: 'POST', body: { version: item.version } });
      setShares(values => values.map(value => value.id === item.id ? data.share : value));
      setMessage('该链接已撤销，原方案和其他分享不受影响。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setWorking(''); }
  };

  if (recipientMode) {
    const snapshot = share?.snapshot;
    const reference = id => snapshot?.citations?.find(item => item.id === id);
    const shareReturnTo = `/share/#${token}`;
    return <div className="view-stack share-viewer-page">
      <section className="share-viewer-hero"><div><Badge tone="gold"><Share2/> 教研共备快照</Badge><h1>{snapshot?.title || '正在打开共备方案'}</h1><p>{snapshot?.notice || '这是一份只读备课快照。其中的页码来自发布时已确认的教材依据。'}</p></div>{share && <div className="share-seal"><ShieldCheck/><span>快照校验</span><b>{String(share.snapshotDigest || snapshot?.digest || '').slice(0, 10)}</b><small>{new Date(share.createdAt).toLocaleDateString()}发布</small></div>}</section>
      {error && <section className="panel share-error"><CircleAlert/><h2>暂时无法打开这份共备方案</h2><p>{error}</p><a className="primary" href="/library/">返回教材库</a></section>}
      {busy && <section className="panel share-loading"><Activity/><h2>正在核验共备快照</h2><p>只读取这一次发布的方案，不会访问教师的账号和历史对话。</p></section>}
      {snapshot && <>
        <section className="panel share-overview"><header><div><span>本课核心问题</span><h2>{snapshot.lesson?.coreQuestion || snapshot.question || '待教师补充'}</h2></div><div className="share-context"><span>{snapshot.lessonContext?.periods || 1}课时</span><span>{snapshot.lessonContext?.classLevel || '班情未标注'}</span><span>{snapshot.lessonContext?.teachingMode || '教学方式未标注'}</span></div></header><p>{snapshot.plan?.summary || '发布者未填写方案概述。'}</p></section>
        <div className="share-plan-grid"><SharedPlanList title="教学目标" items={snapshot.plan?.objectives}/><SharedPlanList title="重点与难点" items={snapshot.plan?.keyPoints}/><SharedPlanList title="课堂流程" items={snapshot.plan?.lessonPlan}/><SharedPlanList title="问题链" items={snapshot.plan?.questionChain}/></div>
        <section className="share-cards"><header><span>一课三卡</span><h2>从方案到课堂动作</h2><p>这些内容来自发布时的固定快照，不会跟随原方案后续变动。</p></header><div>{snapshot.cards.map(card => <article className={`share-card share-card-${card.type}`} key={card.id}><header><span>{card.type === 'board' ? '板书卡' : card.type === 'question' ? '提问卡' : card.type === 'assessment' ? '评价卡' : '课堂卡'}</span><h3>{card.title}</h3><p>{card.subtitle}</p></header><ol>{card.items.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><p>{item.text}</p><footer>{item.citationIds.map(id => { const ref = reference(id); const href = ref ? citationLink(ref, shareReturnTo) : ''; return href ? <a key={id} href={href}><Quote/>{docName(ref.documentId)} 第 {ref.pdfPage} 页</a> : null; })}</footer></div></li>)}</ol></article>)}</div></section>
        <section className="panel share-evidence"><div><span>可核对的教材页码</span><h2>只分享定位信息，不复制教材原文</h2><p>点击页码可返回活教参的原始教材核验页。</p></div><div>{snapshot.citations.map(item => { const href = citationLink(item, shareReturnTo); return href ? <a href={href} key={item.id}><FileText/><span><b>{docName(item.documentId)}</b><small>第 {item.pdfPage} 页{item.printedPage ? ` · 书页 ${item.printedPage}` : ''}</small></span><ExternalLink/></a> : null; })}</div></section>
        <section className="share-next"><div><span>想将这份方案用在自己的班级？</span><h2>先回到教材，再按你的班情重新备课</h2><p>共备快照用于参考，不直接写入你的账号，也不会覆盖现有方案。</p></div><a className="primary" href="/library/">从教材库开始 <ArrowRight/></a></section>
      </>}
    </div>;
  }

  const activeShares = shares.filter(item => item.status === 'active');
  const confirmed = draft?.answer?.planApproval?.status === 'confirmed' && draft?.answer?.planApproval?.hasUnconfirmedChanges !== true;
  return <div className="view-stack share-owner-page">
    <section className="hero compact-hero share-owner-hero"><div><Badge tone="gold"><Share2/> 教研共备</Badge><h1>分享的不是一个会变的页面，<br/><em>而是一份可核对的教学快照</em></h1><p>共备链接只包含已确认方案、三卡和公开教材页码。账号信息、历史对话、私人教材和连接信息不会进入分享内容。</p></div><div className="share-owner-count"><strong>{activeShares.length}</strong><span>条有效链接</span><small>每一条都可以单独撤销</small></div></section>
    {error && <section className="cards-alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>这次共备操作没有完成</b><p>{error}</p></div></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {busy ? <section className="panel share-loading"><Activity/><h2>正在读取当前方案</h2><p>会先确认方案状态，再决定是否允许发布。</p></section> : draft && <div className="share-owner-layout">
      <section className="panel share-publish-sheet"><header><div><span>要发布的方案</span><h2>{draft.title || '未命名备课'}</h2><p>当前第 {draft.version || 1} 版 · {(draft.cards || []).length} 张课堂卡 · {(draft.citations || []).length} 条教材依据</p></div><Badge tone={confirmed ? 'green' : 'orange'}>{confirmed ? '教师已确认' : '还不能发布'}</Badge></header><div className="share-safety-list">{[['独立快照','原方案后续修改，不影响已发布内容'],['最小信息','不包含账号、对话、连接信息和私人文档原文'],['可随时撤销','每条链接独立管理，不影响其他分享']].map(([title, note]) => <div key={title}><ShieldCheck/><span><b>{title}</b><small>{note}</small></span></div>)}</div><footer><label><span>链接有效期</span><select value={expiryDays} onChange={event => setExpiryDays(Number(event.target.value))}><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></label><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>返回检查方案</a><button type="button" className="primary" onClick={create} disabled={!confirmed || !(draft.cards || []).length || Boolean(working)}>{working === 'create' ? '正在生成快照…' : '生成共备链接'}</button></footer>{!confirmed && <div className="share-blocked-note"><CircleAlert/><p>请先回到课堂设计确认当前版本。未确认修改不会被包装成可分享成果。</p></div>}</section>
      <aside className="panel share-link-ledger"><header><span>链接管理</span><h2>{activeShares.length ? `${activeShares.length} 条正在生效` : '还没有发布过'}</h2><p>出于安全考虑，旧链接的完整地址不会再次显示。</p></header>{freshLink && <div className="share-fresh-link"><span>请现在复制，完整链接只显示这一次</span><div><input readOnly value={freshLink} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={copyLink}><Copy/>复制</button></div></div>}<div className="share-ledger-list">{shares.length ? shares.map(item => <article className={item.status} key={item.id}><div><span>{item.status === 'active' ? '生效中' : item.status === 'revoked' ? '已撤销' : '已到期'}</span><b>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '创建时间未知'}</b><small>有效至 {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : '—'} · 校验 {String(item.snapshotDigest || '').slice(0, 8)}</small></div>{item.status === 'active' && <button type="button" onClick={() => revoke(item)} disabled={Boolean(working)}>{working === `revoke:${item.id}` ? '正在撤销…' : '撤销链接'}</button>}</article>) : <div className="share-ledger-empty"><Link2/><b>第一条链接会出现在这里</b><p>发送给同事前，可以先自己打开链接核对内容。</p></div>}</div></aside>
    </div>}
  </div>;
}

function researchStage(action = {}) {
  return ({ collect_second_sample: { label: '等待第二次课堂', tone: 'neutral' }, start_comparison: { label: '可以开始对照', tone: 'gold' }, finish_comparison: { label: '对照待完成', tone: 'purple' }, refresh_comparison: { label: '事实已更新', tone: 'orange' }, continue_validation: { label: '继续验证', tone: 'orange' }, review_hypothesis: { label: '命题已确认', tone: 'green' } })[action.type] || { label: '研究进行中', tone: 'neutral' };
}

function ResearchLedgerPage() {
  const session = useAuthSession(), userId = session?.user?.id || '';
  const [ledger, setLedger] = useState({ items: [], summary: {} }), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const load = async () => { setBusy(true); setError(''); try { const data = await rootRequest('/api/assets/research'); setLedger(data.ledger || { items: [], summary: {} }); } catch (err) { if (['auth_required', 'auth_invalid'].includes(requestCode(err))) { location.href = `/login/?next=${encodeURIComponent('/research/')}`; return; } setError(askErrorMessage(err)); } finally { setBusy(false); } };
  useEffect(() => { if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent('/research/')}`; return; } load(); }, [userId]);
  const summary = ledger.summary || {};
  return <div className="view-stack research-ledger-page"><section className="hero compact-hero research-hero"><div><Badge tone="gold"><FileText/> 教研问题簿</Badge><h1>不统计做了多少份方案，<br/><em>只记录一个问题怎样被课堂推进</em></h1><p>每次“一课一研”是一份课堂样本，两次同篇目实践可以形成对照，教师确认后才成为教研命题。问题簿只显示下一步，不用生成量代替教研进展。</p><div className="hero-actions"><a href="/assets/"><Archive/>打开教研资产</a><a href="/study/"><Microscope/>整理一课一研</a></div></div><div className="research-seal"><strong>{summary.lessonCount || 0}</strong><span>条教研问题线</span><em>{summary.needsValidationCount ? `${summary.needsValidationCount} 条等待继续验证` : '等待课堂继续推进'}</em></div></section>{error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>教研问题簿暂时没有读取完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button></div></section>}{busy ? <section className="panel research-empty"><Activity/><h2>正在整理你的教研问题线</h2><p>只读取当前账号中由教师确认的课堂记录和教研命题。</p></section> : ledger.items?.length ? <><section className="research-progress-strip" aria-label="教研问题推进情况"><div><span>课堂样本</span><strong>{summary.sampleCount || 0}</strong><small>教师确认的一课一研</small></div><ArrowRight/><div><span>可开始对照</span><strong>{summary.readyToCompareCount || 0}</strong><small>已有两次同篇目课堂</small></div><ArrowRight/><div><span>已确认命题</span><strong>{summary.confirmedHypothesisCount || 0}</strong><small>写清适用边界与验证方式</small></div></section><section className="research-ledger-list">{ledger.items.map(item => { const stage = researchStage(item.nextAction), latestHypothesis = item.comparisons.find(comparison => comparison.status === 'confirmed' && !comparison.stale); return <article className="panel research-line" key={item.lessonIdentity}><header><div><span>教研问题线</span><h2>{item.lessonTitle}</h2><p>{item.samples.length} 次确认课堂 · {item.comparisons.length} 次同课对照</p></div><Badge tone={stage.tone}>{stage.label}</Badge></header><div className="research-line-body"><section><b>课堂样本</b><div className="research-sample-list">{item.samples.slice(0, 3).map((sample, index) => <a href={`/study/?draftId=${encodeURIComponent(sample.draftId)}`} key={sample.draftId}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{sample.label}</strong><p>{sample.finding || '教师已确认本次课堂记录。'}</p><small>{sample.confirmedAt ? new Date(sample.confirmedAt).toLocaleDateString() : '确认时间未知'}</small></div><ArrowRight/></a>)}</div></section><section className={latestHypothesis ? 'research-hypothesis confirmed' : 'research-hypothesis'}><b>{latestHypothesis ? '当前教研命题' : '目前还不能形成跨课堂结论'}</b>{latestHypothesis ? <><blockquote>{latestHypothesis.transferableFinding || '教师已经确认本次同课对照。'}</blockquote><p><span>下一次验证</span>{latestHypothesis.nextExperiment || '等待教师补充下一次验证方式。'}</p><a href={`/observation/?left=${encodeURIComponent(latestHypothesis.leftId)}&right=${encodeURIComponent(latestHypothesis.rightId)}`}><ClipboardCheck/>生成听评课观察单 <ArrowRight/></a></> : <p>{item.samples.length > 1 ? '已经具备两次课堂样本，可以开始并列事实。' : '需要再完成一次同篇目课堂，并保持观察指标一致。'}</p>}</section></div><footer><div><b>下一步</b><p>{item.nextAction.note}</p></div><a className="primary" href={item.nextAction.href}>{item.nextAction.label} <ArrowRight/></a></footer></article>; })}</section></> : <section className="panel research-empty"><div className="empty-orbit"><FileText/></div><h2>问题簿还没有课堂样本</h2><p>先完成一次课堂记录和课后复盘，再把“一课一研”确认下来。这里会自动形成第一条教研问题线。</p><div><a className="primary" href="/assets/">从教研资产开始</a><a href="/library/">选择教材篇目</a></div></section>}</div>;
}

function AssetsPage() {
  const [assets, setAssets] = useState([]), [query, setQuery] = useState(''), [favoriteOnly, setFavoriteOnly] = useState(false), [tagFilter, setTagFilter] = useState(''), [tagOptions, setTagOptions] = useState([]), [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [history, setHistory] = useState(null), [historyTitle, setHistoryTitle] = useState(''), [historyAssetId, setHistoryAssetId] = useState(''), [publishTarget, setPublishTarget] = useState(null), [tagDraft, setTagDraft] = useState(''), [compareBusy, setCompareBusy] = useState(false);
  const loadRequest = useRef(0);
  const load = async () => { const requestId = ++loadRequest.current; setBusy(true); setError(''); try { const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim()); if (favoriteOnly) params.set('favorite', 'true'); if (tagFilter) params.set('tag', tagFilter); const data = await rootRequest(`/api/assets${params.toString() ? `?${params}` : ''}`); if (requestId !== loadRequest.current) return; setAssets(Array.isArray(data.assets) ? data.assets : []); setTagOptions(Array.isArray(data.tags) ? data.tags : []); } catch (err) { if (requestId !== loadRequest.current) return; if (['auth_required', 'auth_invalid'].includes(requestCode(err))) { location.href = `/login/?next=${encodeURIComponent('/assets/')}`; return; } setError(askErrorMessage(err)); } finally { if (requestId === loadRequest.current) setBusy(false); } };
  useEffect(() => { const timer = setTimeout(load, query.trim() ? 240 : 0); return () => clearTimeout(timer); }, [query, favoriteOnly, tagFilter]);
  const openPublish = asset => { setPublishTarget(asset); setTagDraft((asset.tags || []).join(', ')); setError(''); };
  const publish = async asset => { setWorking(asset.draftId); setError(''); setMessage(''); try { const tags = [...new Set(tagDraft.split(/[,，\s]+/u).map(tag => tag.trim()).filter(Boolean))].slice(0, 20); const data = await rootRequest('/api/assets', { method: 'POST', body: { draftId: asset.draftId, tags, favorite: asset.favorite, version: asset.version } }); setAssets(items => items.map(item => item.draftId === asset.draftId ? data.asset : item)); setPublishTarget(null); setMessage('方案已收进教研资产库。之后可以按篇目、标签和关键词找回。'); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const favorite = async asset => { setWorking(`favorite:${asset.draftId}`); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/favorite`, { method: 'PATCH', body: { favorite: !asset.favorite, version: asset.version } }); setAssets(items => items.map(item => item.draftId === asset.draftId ? data.asset : item)); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const showHistory = async asset => { setHistoryTitle(asset.title); setHistoryAssetId(asset.draftId); setHistory(null); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/versions`); setHistory({ versions: data.versions || [], comparison: null }); } catch (err) { setError(askErrorMessage(err)); } };
  const compareVersion = async revisionId => { if (!historyAssetId || !revisionId) return; setCompareBusy(true); setError(''); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(historyAssetId)}/versions?compare=${encodeURIComponent(revisionId)}`); setHistory(previous => previous ? { ...previous, comparison: data.comparison || null } : previous); } catch (err) { setError(askErrorMessage(err)); } finally { setCompareBusy(false); } };
  const copyAsset = async (asset, { useFeedback = false } = {}) => { const workId = `${useFeedback ? 'reflect' : 'copy'}:${asset.draftId}`; setWorking(workId); setError(''); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/copy`, { method: 'POST', body: { version: asset.version, useFeedback } }); const copied = data.asset; setMessage(useFeedback ? '已建立复备方案。上一课记录会作为参考，新方案的课后复盘保持空白。' : '已复制为新的可编辑方案，原方案保持不变。'); if (copied?.draftId) location.href = `${useFeedback ? '/ask/' : '/cards/'}?draftId=${encodeURIComponent(copied.draftId)}`; } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const restore = async revisionId => { if (!historyAssetId || !revisionId) return; const currentAsset = assets.find(item => item.draftId === historyAssetId); if (!currentAsset?.version) { setError('当前方案版本尚未读取完成，请刷新后再试。'); return; } setWorking(`restore:${revisionId}`); setError(''); try { const data = await rootRequest(`/api/drafts/${encodeURIComponent(historyAssetId)}/restore`, { method: 'POST', body: { revisionId, version: currentAsset.version } }); const next = data.draft; setAssets(items => items.map(item => item.draftId === historyAssetId ? { ...item, ...{ title: next.title, version: next.version, status: next.answer?.assetMeta?.status || item.status, updatedAt: next.updated_at || item.updatedAt, sourceCoverage: next.answer?.sourceCoverage || item.sourceCoverage } } : item)); setHistory(null); setMessage('历史版本已恢复。请打开课堂设计确认内容，再决定是否锁定。'); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  return <div className="view-stack assets-page"><section className="hero compact-hero assets-hero"><div><Badge tone="gold"><Archive/> 教研资产库</Badge><h1>把备过的课，<br/><em>留成下一次还能用的方案</em></h1><p>保存、修改、锁定后的课堂材料会按篇目和标签归档，下一次备课可以直接打开、复制和继续完善。</p></div><div className="hero-actions"><a className="primary" href="/library/"><Library/>从教材库选篇目</a><a href="/ask/"><MessageCircle/>继续备课问答</a><a href="/research/"><FileText/>打开教研问题簿</a></div></section><section className="panel assets-toolbar"><div><span>我的教研资产</span><b>{busy ? '正在读取…' : `${assets.length} 份方案`}</b></div><label className="asset-search"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索篇目、方案标题或标签"/></label><label className="asset-tag-filter"><span>标签</span><select value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="">全部标签</option>{tagOptions.map(tag => <option value={tag} key={tag}>{tag}</option>)}</select></label><button type="button" className={favoriteOnly ? 'active' : ''} onClick={() => setFavoriteOnly(value => !value)}><CheckCircle2/>{favoriteOnly ? '只看已收藏' : '筛选收藏'}</button></section>{error && <section className="ask-error" role="alert"><CircleAlert/><span>{error}</span><button type="button" onClick={load}>重新读取</button></section>}{message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}{busy ? <section className="panel assets-empty"><Activity/><h2>正在读取你的备课方案</h2><p>已保存的内容会在这里按篇目集中呈现。</p></section> : assets.length ? <section className="asset-grid">{assets.map(asset => { const workflowBadge = assetWorkflowBadge(asset); const primaryAction = assetPrimaryAction(asset); const comparisonPeer = asset.lessonStudyStatus === 'confirmed' && !asset.lessonStudyStale ? assets.find(candidate => candidate.draftId !== asset.draftId && candidate.lessonStudyStatus === 'confirmed' && !candidate.lessonStudyStale && normalizeLessonIdentity(candidate.lessonKey || candidate.title) === normalizeLessonIdentity(asset.lessonKey || asset.title)) : null; const comparisonPair = comparisonPeer ? [asset, comparisonPeer].sort((left, right) => String(left.draftId).localeCompare(String(right.draftId))) : null; return <article className="panel asset-card" key={asset.draftId}><header><div><Badge tone={workflowBadge.tone}>{workflowBadge.label}</Badge><h2>{asset.title}</h2><p>{asset.lessonKey || '尚未标记篇目'} · 第 {asset.version || 1} 版</p></div><button type="button" className={`asset-favorite ${asset.favorite ? 'active' : ''}`} aria-label={asset.favorite ? '取消收藏' : '收藏方案'} onClick={() => favorite(asset)} disabled={working === `favorite:${asset.draftId}`}>★</button></header><div className="asset-card-meta"><span>教材依据 <b>{asset.citationsCount || 0}</b></span><span>最近更新 <b>{asset.updatedAt ? new Date(asset.updatedAt).toLocaleDateString() : '—'}</b></span></div><AssetCoverage coverage={asset.sourceCoverage}/>{asset.tags?.length ? <div className="asset-tags">{asset.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : <p className="asset-no-tags">还没有标签，可以在归档时补充。</p>}{asset.lessonStudySummary && <div className="asset-study-summary"><Microscope/><div><span>{asset.lessonStudyStatus === 'confirmed' ? '教师确认的教学判断' : '一课一研草稿'}</span><b>{asset.lessonStudySummary.finding || '等待教师写下本次发现'}</b>{asset.lessonStudySummary.nextTrial && <small>下一轮：{asset.lessonStudySummary.nextTrial}</small>}</div></div>}{comparisonPeer && <a className="asset-comparison-entry" href={`/compare/?left=${encodeURIComponent(comparisonPair[0].draftId)}&right=${encodeURIComponent(comparisonPair[1].draftId)}`}><GitCompareArrows/><span><b>发现另一份同篇目课堂</b><small>与“{comparisonPeer.title}”并列事实，形成同课异构结论</small></span><ArrowRight/></a>}<footer><a className="primary" href={primaryAction.href}>{primaryAction.label} <ArrowRight/></a>{asset.status !== 'published' && asset.teacherConfirmed && asset.cardsGenerated && <button type="button" onClick={() => openPublish(asset)} disabled={working === asset.draftId}>{working === asset.draftId ? '正在归档…' : '收进资产库'}</button>}<button type="button" onClick={() => copyAsset(asset)} disabled={working === `copy:${asset.draftId}`}>{working === `copy:${asset.draftId}` ? '正在复制…' : '复制为新方案'}</button>{asset.teacherConfirmed && asset.cardsGenerated && <a href={`/share/?draftId=${encodeURIComponent(asset.draftId)}`}><Share2/>分享共备快照</a>}<button type="button" onClick={() => showHistory(asset)}>查看版本</button></footer></article>; })}</section> : <section className="panel assets-empty"><div className="empty-orbit"><Archive/></div><h2>{favoriteOnly ? '还没有收藏的方案' : tagFilter ? `还没有“${tagFilter}”标签的方案` : '这里还没有备课资产'}</h2><p>完成一次备课问答并保存三卡后，可以把方案收进这里，按篇目再次使用。</p><div><a className="primary" href="/library/">打开教材库</a><a href="/ask/">开始提问</a></div></section>}{history && <div className="modal-backdrop" role="presentation" onClick={() => setHistory(null)}><section className="panel asset-history-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><header><div><span>方案历史</span><h2>{historyTitle}</h2></div><button type="button" onClick={() => setHistory(null)} aria-label="关闭"><X/></button></header><p>每次保存都会留下一个快照。你可以先对比，再决定是否恢复；已经锁定的课堂卡片不会被覆盖。</p><div className="asset-history-list">{(history.versions || []).map((item, index) => <div key={item.id || index}><span>{item.id === 'current' ? '当前' : `V${item.version || '—'}`}</span><div><b>{item.id === 'current' ? '当前方案' : item.reason || '已保存版本'}</b><small>{item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : '时间未知'}</small></div>{item.id === 'current' ? <Badge tone="green">正在使用</Badge> : <div className="asset-history-actions"><button type="button" onClick={() => compareVersion(item.id)} disabled={compareBusy}>{compareBusy ? '对比中…' : '对比当前'}</button><button type="button" onClick={() => restore(item.id)} disabled={working === `restore:${item.id}`}>{working === `restore:${item.id}` ? '恢复中…' : '恢复此版'}</button></div>}</div>)}</div>{history.comparison && <div className="asset-comparison"><header><b>与当前方案的差异</b><small>{history.comparison.changed ? `${history.comparison.changes.length} 处内容发生变化` : '内容没有变化'}</small></header>{history.comparison.changes.length ? <ul>{history.comparison.changes.map(change => <li key={change.field}><b>{change.label}</b><span>旧版：{change.before}</span><span>当前：{change.after}</span></li>)}</ul> : <p>这两个版本的主要内容一致。</p>}</div>}<footer><button type="button" onClick={() => setHistory(null)}>关闭</button></footer></section></div>}{publishTarget && <div className="modal-backdrop" role="presentation" onClick={() => setPublishTarget(null)}><section className="panel asset-history-modal asset-publish-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><header><div><span>归档到教研资产库</span><h2>{publishTarget.title}</h2></div><button type="button" onClick={() => setPublishTarget(null)} aria-label="关闭"><X/></button></header><p>归档后仍可继续编辑；标签用于以后按篇目、年级或教学任务找回方案。</p><label className="asset-tag-input"><b>方案标签</b><input value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="例如：古诗文、两课时、朗读训练"/><small>多个标签用空格或逗号分隔</small></label><footer><button type="button" onClick={() => setPublishTarget(null)}>取消</button><button type="button" className="primary" onClick={() => publish(publishTarget)} disabled={working === publishTarget.draftId}>{working === publishTarget.draftId ? '正在归档…' : '确认归档'}</button></footer></section></div>}</div>;
}
function pageNumber(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Math.floor(Number(value));
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}
function searchResultDocumentId(result = {}) {
  result = result && typeof result === 'object' ? result : {};
  return canonicalDocumentId(result.documentId || result.document_id || result.docId || result.doc_id || result.viewer?.documentId || result.viewer?.document_id);
}
function searchResultPage(result = {}) {
  result = result && typeof result === 'object' ? result : {};
  return pageNumber(result.pdfPage ?? result.pdf_page ?? result.pageNumber ?? result.page ?? result.viewer?.page ?? result.viewer?.page_number);
}
function firstPage(...values) {
  for (const value of values) {
    const page = pageNumber(value);
    if (page > 0) return page;
  }
  return 0;
}
function nodePageRange(node = {}) {
  const range = node.pageRange ?? node.page_range ?? node.range;
  const rangeStart = Array.isArray(range) ? range[0] : range?.start ?? range?.from ?? range?.startPage ?? range?.start_page;
  const rangeEnd = Array.isArray(range) ? range[1] : range?.end ?? range?.to ?? range?.endPage ?? range?.end_page;
  const start = firstPage(
    node.startPdfPage, node.start_pdf_page, node.startPage, node.start_page,
    node.pdfPage, node.pdf_page, node.pageNumber, node.page, rangeStart
  );
  const end = firstPage(node.endPdfPage, node.end_pdf_page, node.endPage, node.end_page, rangeEnd) || start;
  return { start, end: Math.max(start, end) };
}
function normalizeTree(payload) {
  const source = payload?.data ?? payload;
  const root = source?.tree ?? source?.root ?? source?.children ?? source?.nodes ?? source;
  if (!root) return [];
  const roots = Array.isArray(root) ? root : [root];
  const walk = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    if (!node || typeof node !== 'object') return [];
    const id = String(node.id || node.nodeId || `${parentPath.join('-') || 'root'}-${index}`);
    const title = String(node.title || node.name || node.label || '未命名节点');
    const rawChildren = node.children ?? node.nodes ?? [];
    const children = Array.isArray(rawChildren) ? walk(rawChildren, [...parentPath, id]) : [];
    const direct = nodePageRange(node);
    const descendantRanges = children.map(child => child.pageRange).filter(item => item?.start > 0);
    const start = direct.start || (descendantRanges.length ? Math.min(...descendantRanges.map(item => item.start)) : 0);
    const end = Math.max(direct.end || 0, ...(descendantRanges.length ? descendantRanges.map(item => item.end) : [start]));
    return [{
      ...node,
      id,
      title,
      level: Number.isFinite(Number(node.level)) ? Number(node.level) : parentPath.length + 1,
      startPage: start,
      endPage: Math.max(start, end),
      pageRange: { start, end: Math.max(start, end) },
      children
    }];
  });
  return walk(roots);
}
function findTreeNode(nodes, page, preferredId = '') {
  let preferred = null;
  let best = null;
  const rank = (node, depth, range) => ({ node, depth, width: Math.max(0, range.end - range.start) });
  const isBetter = (candidate, current) => {
    if (!current) return true;
    if (candidate.depth !== current.depth) return candidate.depth > current.depth;
    if (candidate.width !== current.width) return candidate.width < current.width;
    return String(candidate.node.id || '').localeCompare(String(current.node.id || '')) < 0;
  };
  const visit = (list, depth = 0) => (list || []).forEach(node => {
    const range = node.pageRange || nodePageRange(node);
    if (range.start && page >= range.start && page <= range.end) {
      const candidate = rank(node, depth, range);
      if (preferredId && String(node.id) === String(preferredId)) preferred = candidate;
      if (isBetter(candidate, best)) best = candidate;
      visit(node.children, depth + 1);
    }
  });
  visit(nodes);
  // Keep the user's selected node only when it is as specific as the best
  // match. A parent node must not remain highlighted after the page moves into
  // one of its more specific child lessons.
  if (preferred && best && preferred.depth === best.depth && preferred.width === best.width) return preferred.node;
  return best?.node || null;
}
function findTreeNodeById(nodes, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  for (const node of nodes || []) {
    if (String(node?.id || '') === wanted) return node;
    const child = findTreeNodeById(node?.children, wanted);
    if (child) return child;
  }
  return null;
}
function nodeContainsPage(node, page) {
  const range = node?.pageRange || nodePageRange(node || {});
  const value = Number(page);
  return Boolean(range?.start && Number.isInteger(value) && value >= range.start && value <= (range.end || range.start));
}
function Tree({ nodes, current, onPick, error, retry, loading }) {
  const collectIds = list => list.flatMap(node => { const children = Array.isArray(node.children) ? node.children : []; return [node.id, ...collectIds(children)]; });
  const [expanded, setExpanded] = useState(() => new Set(collectIds(nodes || [])));
  useEffect(() => setExpanded(new Set(collectIds(nodes || []))), [nodes]);
  if (error) return <div className="tree-loading"><CircleAlert/><b>目录加载失败</b><button type="button" onClick={retry}>重试</button></div>;
  if (loading) return <div className="tree-loading"><Activity/><b>正在读取目录</b><small>按教材结构加载篇目和教学建议…</small></div>;
  if (!nodes?.length) return <div className="tree-loading"><FileSearch/><b>目录暂时为空</b><small>请稍后重试或查看教材处理状态。</small></div>;
  const toggle = id => setExpanded(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const render = node => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const open = expanded.has(node.id);
    const { start: startPage, end: endPage } = node.pageRange || nodePageRange(node);
    return <div key={node.id} className="tree-node">
      <div className="tree-row" style={{paddingLeft:`${8+Math.max(0,(node.level||1)-1)*12}px`}}>
        {hasChildren && <button type="button" className={`tree-toggle ${open ? 'open' : ''}`} aria-label={open ? '收起目录节点' : '展开目录节点'} onClick={()=>toggle(node.id)}><ChevronRight/></button>}
        {!hasChildren && <span className="tree-toggle-spacer"/>}
        <button type="button" className={`tree-item ${current===node.id ? 'selected' : ''}`} onClick={()=>{if(startPage>0)onPick(node);}} disabled={!startPage}>
          <span className="tree-item-title"><b>{node.title}</b><small>{startPage ? `${startPage}—${endPage}` : '暂无页码'}</small></span>
        </button>
      </div>
      {hasChildren && open && <div className="index-tree-children">{node.children.map(render)}</div>}
    </div>;
  };
  return <div className="index-tree">{nodes.map(render)}</div>;
}
function LibraryPage() {
  const params = useMemo(() => queryParams(), []);
  const [doc,setDoc]=useState(canonicalDocumentId(params.get('doc')) || '');
  const [docs,setDocs]=useState([]); const [docsError,setDocsError]=useState(''); const [tree,setTree]=useState([]); const [treeError,setTreeError]=useState(''); const [treeBusy,setTreeBusy]=useState(false); const [treeDocumentId,setTreeDocumentId]=useState(''); const [selectedNode,setSelectedNode]=useState(params.get('node')||''); const [selectedLessonTitle,setSelectedLessonTitle]=useState(params.get('lesson') || ''); const [page,setPage]=useState(null); const [pageNo,setPageNo]=useState(Number(params.get('page'))||1); const [query,setQuery]=useState(params.get('q')||''); const rawRequestedScope=params.get('scope'); const requestedScope=canonicalDocumentId(rawRequestedScope); const [scope,setScope]=useState(rawRequestedScope==='all'||rawRequestedScope==='both'?rawRequestedScope:requestedScope==='teacher-guide'||requestedScope==='textbook'||requestedScope==='curriculum-standard'?requestedScope:'both'); const [results,setResults]=useState([]); const [visibleResults,setVisibleResults]=useState(6); const [searched,setSearched]=useState(Boolean(params.get('q'))); const [searchError,setSearchError]=useState(''); const [busy,setBusy]=useState(false); const initialSearch=useRef(Boolean(params.get('q')));
  const treeRequestRef = useRef(0);
  const initialAddressCorrected = useRef({});
  const treesCache = useRef({});
  const treePromises = useRef({});
  const currentDoc = docs.find(item => item.id === doc) || docs[0] || null;
  const loadDocs = async()=>{ setDocsError(''); try { const data=await request('/documents'); const list=(data.documents||[]).map(normalizeCatalogItem).filter(Boolean); setDocs(list); const selected=list.find(item=>item.id===doc)||list[0]; if (selected && selected.id!==doc) setDoc(selected.id); } catch(error) { setDocs([]); setDocsError(error.status === 401 || String(error.code || '').startsWith('auth_') ? '登录已过期，请重新登录后继续。' : '教材目录暂时无法读取，请重试。'); } };
  useEffect(()=>{loadDocs();},[]);
  const ensureTree = async (docId) => {
    const id = String(docId || '').trim();
    if (!id) return null;
    const cached = treesCache.current[id];
    if (cached) return cached;
    // Deduplicate concurrent requests for the same document
    if (treePromises.current[id]) return treePromises.current[id];
    const promise = (async () => {
      const data = await request(`/documents/${encodeURIComponent(id)}/tree`);
      const normalized = normalizeTree(data);
      treesCache.current[id] = normalized;
      delete treePromises.current[id];
      return normalized;
    })();
    treePromises.current[id] = promise;
    try {
      return await promise;
    } catch (error) {
      delete treePromises.current[id];
      throw error;
    }
  };
  const loadTree=async()=>{ if(!doc)return; const requestId=++treeRequestRef.current; setTree([]); setTreeDocumentId(''); setTreeBusy(true); setTreeError(''); try { const normalized = await ensureTree(doc); if(requestId!==treeRequestRef.current)return; setTree(normalized || []); setTreeDocumentId(doc); } catch(error) { if(requestId!==treeRequestRef.current)return; setTree([]); setTreeDocumentId(''); setTreeError('目录暂时无法读取，请重试。'); } finally { if(requestId===treeRequestRef.current)setTreeBusy(false); } };
  useEffect(()=>{loadTree();},[doc]);
  useEffect(()=>{ if(!currentDoc)return; const max=Math.max(1,currentDoc.pageCount||1); setPageNo(value=>Math.min(max,Math.max(1,value))); },[currentDoc?.id,currentDoc?.pageCount]);
  useEffect(()=>{ if(!doc)return; let cancelled=false; setPage(null); request(`/documents/${encodeURIComponent(doc)}/pages/${pageNo}`).then(data=>{if(!cancelled)setPage(data.page||data)}).catch(()=>{if(!cancelled)setPage(null)}); return()=>{cancelled=true}; },[doc,pageNo]);
  // 目录 / URL 同步：首次地址校正 + 普通翻页节点匹配，合并为单一确定性效果。
  // 首次必须处理显式 node/lesson 意图并 return，防止普通按页匹配先覆盖 selectedLesson。
  useEffect(() => {
    if (!tree.length || !pageNo || treeDocumentId !== doc) return;
    const docId = doc;

    // ---- Phase 1: 首次地址校正 ------------------------------------------
    // 旧分享链接的 node/lesson 与 page 可能矛盾，以显式意图（node/lesson）为准。
    if (!initialAddressCorrected.current[docId]) {
      // 每次读取当前地址，而非 useMemo 初始 params，避免切换教材后读到旧参数
      const currentParams = new URLSearchParams(location.search);
      const urlNode = currentParams.get('node');
      const urlLesson = currentParams.get('lesson');
      const urlPage = Number(currentParams.get('page'));

      if (!urlNode && !urlLesson) {
        // 没有显式意图——标记为已校正，交给 Phase 2 做普通页匹配
        initialAddressCorrected.current[docId] = true;
      } else {
        // 先在当前树中按 nodeId 查找
        let intendedNode = urlNode ? findTreeNodeById(tree, urlNode) : null;
        // nodeId 未命中时，按规范化篇名兜底匹配
        if (!intendedNode && urlLesson) {
          const normalized = normalizeReaderLessonIdentity(urlLesson);
          if (normalized) {
            intendedNode = findTreeNodeByNormalizedTitle(tree, normalized);
          }
        }
        if (intendedNode && intendedNode.startPage) {
          if (Number.isInteger(urlPage) && urlPage > 0 && nodeContainsPage(intendedNode, urlPage)) {
            // urlPage 在节点范围内——保留精确页，只同步 node/lesson
            setSelectedNode(intendedNode.id);
            setSelectedLessonTitle(intendedNode.title);
            updateUrl({
              documentId: doc,
              pageNumber: urlPage,
              nodeId: intendedNode.id,
              lessonTitle: intendedNode.title,
              keepSearch: true
            });
          } else {
            // urlPage 不在节点范围内或不是正整数——校正到 startPage
            setSelectedNode(intendedNode.id);
            setSelectedLessonTitle(intendedNode.title);
            setPageNo(intendedNode.startPage);
            updateUrl({
              documentId: doc,
              pageNumber: intendedNode.startPage,
              nodeId: intendedNode.id,
              lessonTitle: intendedNode.title,
              keepSearch: true
            });
          }
        }
        initialAddressCorrected.current[docId] = true;
        // 首次校正已处理显式意图——跳过 Phase 2，防止普通按页匹配覆盖
        return;
      }
    }

    // ---- Phase 2: 普通翻页节点匹配 ------------------------------------
    // 目录点击是教师的显式选择；在 PDF 页在该节点范围内变化时保持该节点选中，
    // 否则普通页匹配会立即用更深的子节点替换选中节点，使高亮跳转到别处。
    const selected = findTreeNodeById(tree, selectedNode);
    if (selected && nodeContainsPage(selected, pageNo)) {
      // 首次地址校正完成后，如果篇名与当前节点不一致，同步篇名与 URL
      if (initialAddressCorrected.current[doc] && selected.title !== selectedLessonTitle) {
        setSelectedLessonTitle(selected.title);
        updateUrl({
          documentId: doc,
          pageNumber: pageNo,
          nodeId: selected.id,
          lessonTitle: selected.title,
          keepSearch: true
        });
      }
      return;
    }
    const located = findTreeNode(tree, pageNo);
    if (located && (located.id !== selectedNode || located.title !== selectedLessonTitle)) {
      setSelectedNode(located.id);
      setSelectedLessonTitle(located.title);
      // 首次地址校正完成后，普通翻页以当前教材页码所在节点同步完整 URL
      if (initialAddressCorrected.current[doc]) {
        updateUrl({
          documentId: doc,
          pageNumber: pageNo,
          nodeId: located.id,
          lessonTitle: located.title,
          keepSearch: true
        });
      }
    }
  }, [tree, pageNo, selectedNode, selectedLessonTitle, doc, treeDocumentId]);
  const updateUrl = ({documentId, pageNumber, nodeId = '', lessonTitle = selectedLessonTitle, keepSearch = true}) => { const url=new URL(location.href); url.pathname='/library/'; url.search=new URLSearchParams({doc:documentId,page:String(pageNumber),...(keepSearch&&query?{q:query}:{}),...(scope?{scope}:{}),...(nodeId?{node:nodeId}:{}),...(lessonTitle?{lesson:lessonTitle}:{})}).toString(); history.replaceState(null,'',url); };
  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URLSearchParams(location.search);
      const nextDoc = canonicalDocumentId(next.get('doc'));
      if (nextDoc && docs.some(item => item.id === nextDoc)) setDoc(nextDoc);
      const nextPage = Number(next.get('page'));
      if (Number.isInteger(nextPage) && nextPage > 0) setPageNo(nextPage);
      setSelectedNode(next.get('node') || '');
      setSelectedLessonTitle(next.get('lesson') || '');
      setQuery(next.get('q') || '');
      const nextScope = next.get('scope');
      if (['all', 'both', 'textbook', 'teacher-guide', 'curriculum-standard'].includes(nextScope)) setScope(nextScope);
      setSearched(Boolean(next.get('q')));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [docs.length]);
  const openReaderTarget = async ({ documentId = doc, pageNumber = 1, nodeId = '', lessonTitle = '', keepSearch = true, clearSearch = false } = {}) => { const canonicalId = canonicalDocumentId(documentId); const target = docs.find(item => item.id === canonicalId); const requestedPage = Number(pageNumber); if (!target || !Number.isInteger(requestedPage) || requestedPage < 1) return false; const max = Math.max(1, target.pageCount || 1); const safePage = Math.min(max, requestedPage); const explicit = canonicalId === doc ? findTreeNodeById(tree, nodeId) : null; let resolvedPage = explicit && explicit.pageRange?.start && !nodeContainsPage(explicit, safePage) ? explicit.pageRange.start : safePage; let resolvedNodeId = explicit?.id || ''; let nextLessonTitle = lessonTitle || (canonicalId === doc ? selectedLessonTitle : ''); if (canonicalId !== doc && nextLessonTitle) {
      try {
        await ensureTree(canonicalId);
        setTreeError('');
        const crossDoc = resolveCrossDocTarget({
          targetDocId: canonicalId,
          lessonTitle: nextLessonTitle,
          pageNo: resolvedPage,
          treesCache: treesCache.current,
          docs
        });
        if (crossDoc) {
          resolvedPage = crossDoc.page;
          resolvedNodeId = crossDoc.nodeId || '';
          nextLessonTitle = crossDoc.lessonTitle || nextLessonTitle;
        }
      } catch (error) {
        setTreeError('目标教材目录暂时无法读取，当前页面未切换。请重试。');
        return false;
      }
    }
  const located = explicit || (canonicalId === doc ? findTreeNode(tree, resolvedPage) : null);
  if (!resolvedNodeId) {
    resolvedNodeId = located?.id || '';
    // Cross-document: never pass the source document's nodeId into the
    // target document's URL — the target tree has no matching node.
    if (canonicalId !== doc) resolvedNodeId = '';
  }
  if (!nextLessonTitle) {
    nextLessonTitle = canonicalId === doc ? selectedLessonTitle : '';
  }
  setDoc(target.id);
  setSelectedNode(resolvedNodeId);
  setSelectedLessonTitle(nextLessonTitle);
  setPageNo(Math.min(max, resolvedPage));
  if (clearSearch) {
    setQuery('');
    setResults([]);
    setVisibleResults(6);
    setSearched(false);
    setSearchError('');
  }
  updateUrl({
    documentId: target.id,
    pageNumber: Math.min(max, resolvedPage),
    nodeId: resolvedNodeId,
    lessonTitle: nextLessonTitle,
    keepSearch: !clearSearch && keepSearch
  });
  return true;
  };
  const searchRequest = useRef(0);
  const search=async e=>{e?.preventDefault(); const text=query.trim(); const requestId=++searchRequest.current; if(!text){setResults([]);setVisibleResults(6);setSearched(false);setSearchError('');return;} if(text.length<2){setResults([]);setVisibleResults(6);setSearched(true);setSearchError('请输入至少两个字符，再开始搜索。');return;} setBusy(true);setSearched(true);setSearchError('');try { const scopes=scope==='all'?docs.map(item=>item.id):scope==='both'?['textbook','teacher-guide']:[scope]; const data=await request('/search',{method:'POST',body:{query:text,scope:scopes,limit:12}}); if(requestId !== searchRequest.current)return; setResults(Array.isArray(data.results)?data.results:[]); setVisibleResults(6); const url=new URL(location.href);url.searchParams.set('q',text);url.searchParams.set('scope',scope);history.replaceState(null,'',url); } catch(error) { if(requestId !== searchRequest.current)return; setResults([]);setVisibleResults(6);setSearchError('搜索暂时不可用，请稍后重试。'); } finally {if(requestId === searchRequest.current)setBusy(false)} };
  useEffect(() => {
    // A copied library URL with `q` should restore its result rail instead of
    // leaving the teacher at an empty state. The manual search flow remains
    // unchanged; this only runs once after the dynamic catalogue is ready.
    if (!initialSearch.current || !docs.length || busy) return;
    initialSearch.current = false;
    if (query.trim().length >= 2) search();
  }, [docs.length]);
  const clearSearch=()=>{searchRequest.current += 1;setBusy(false);setQuery('');setResults([]);setVisibleResults(6);setSearched(false);setSearchError('');const url=new URL(location.href);url.searchParams.delete('q');if(scope)url.searchParams.set('scope',scope);history.replaceState(null,'',url)};
  const switchDocument = async id => { return openReaderTarget({ documentId: id, pageNumber: pageNo, nodeId: '', lessonTitle: selectedLessonTitle, clearSearch: true, keepSearch: false }); };
  const pick=node=>{const { start: nextPage }=node.pageRange||nodePageRange(node); if(nextPage>0)openReaderTarget({documentId:doc,pageNumber:nextPage,nodeId:node.id,lessonTitle:node.title});};
  const pagePdf=String(page?.viewer?.pdfUrl||page?.pdfUrl||currentDoc?.pdfUrl||'').split('#')[0];
  const maxPage=currentDoc?.pageCount||1;
  const goPage = next => openReaderTarget({ documentId: doc, pageNumber: next });
  return (
    <div className="view-stack index-page">
      <section className="hero index-hero">
        <div><Badge tone="green"><Library/> 教材库</Badge><h1>先选定要查的材料，<br/>再从目录进入具体篇目</h1><p>课程标准说明学段要求与学业质量，学生教材用于核对课文原页，教师教学用书用于参考课时、活动和教学处理。目录、搜索和 教材原页核验会始终同步。</p></div>
        <div className="index-health"><b>{docs.reduce((sum, item) => sum + item.pageCount, 0)}</b><span>页可定位</span><small>{docs.length} 份材料 · 状态来自后台材料库</small></div>
      </section>
      <section className="panel source-selector">
        <SectionHead icon={BookOpen} eyebrow="选择教材来源" title="你现在要查哪一本？" note="仅切换阅读与搜索范围，不会重复处理整本教材。"/>
        <div className="source-selector-grid">{docs.length ? docs.map(item => {
          const selected = doc === item.id;
          const kind = item.documentType === "teacher_guide" ? "教师教学用书" : item.documentType === "textbook" ? "学生教材" : item.documentType === 'curriculum_standard' ? '课程标准' : "教学资料";
          const indexed = item.indexedPages || item.pageCount;
          return <article className={`source-choice ${selected ? "selected" : ""}`} key={item.id}>
            <button type="button" className="source-choice-main" onClick={() => switchDocument(item.id)}>
              <span className={`source-cover ${item.tone}`}><b>{item.documentType === "teacher_guide" ? "用书" : item.documentType === 'curriculum_standard' ? '课标' : "教材"}</b><small>{item.documentType === 'curriculum_standard' ? <>2022年<br/>版</> : <>九年级<br/>上册</>}</small></span>
              <span className="source-choice-copy"><strong>{item.title}</strong><small>{kind} · {item.pageCount} 页</small><em>{statusLabel(item.indexStatus)} · {indexed}/{item.pageCount || indexed} 页可搜索</em></span>
              {selected && <Badge tone="green">当前阅读</Badge>}
            </button>
            <div className="source-choice-actions"><button type="button" onClick={() => switchDocument(item.id)}>查看目录</button><a href={`/ask/?scope=${encodeURIComponent(item.id)}`}>进入备课问答 <ArrowRight/></a></div>
          </article>;
        }) : <div className="catalog-empty"><FileSearch/><b>{docsError || "正在读取教材目录…"}</b><div className="catalog-empty-actions">{docsError === '登录已过期，请重新登录后继续。' ? <a className="primary" href={"/login/?next=" + encodeURIComponent(location.pathname + location.search)}>重新登录</a> : <button type="button" onClick={loadDocs}>重新读取</button>}</div></div>}</div>
      </section>
      <div className="index-toolbar"><form onSubmit={search}>
        <label className="search-scope"><span>搜索范围</span><select value={scope} onChange={e => setScope(e.target.value)}><option value="all">课标、学生教材与教师用书</option><option value="both">学生教材与教师用书</option>{docs.map(item => <option value={item.id} key={item.id}>{item.short}</option>)}</select></label>
        <label className="search-input"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索篇名、章节或教学问题" aria-label="搜索篇名、章节或教学问题"/></label>
        <div className="search-actions"><button type="submit" disabled={busy}>{busy ? "正在搜索…" : "搜索"}</button>{(searched || query) && <button type="button" className="search-clear" onClick={clearSearch}>清除</button>}</div>
      </form></div>
      <div className={`index-workspace ${searched || busy ? 'search-active' : 'catalog-reading'}`}>
        <aside className="index-outline"><header><span>教材目录</span><small>点击篇目标题定位起始页 · 教材页码范围</small></header><Tree nodes={tree} current={selectedNode} onPick={pick} error={treeError} loading={treeBusy} retry={loadTree}/></aside>
        <section className="index-reader">
          <header><div><Badge tone={currentDoc?.tone || "green"}>{currentDoc?.short || "教材"}</Badge><h2>{pageTitle(page)}</h2><small>第 {pageNo} 页 {page?.printedPage ? `· 书页 ${page.printedPage}` : ""}</small></div>
            <div><button type="button" disabled={pageNo <= 1} onClick={() => goPage(pageNo - 1)}>上一页</button><input aria-label="教材页码" value={pageNo} onChange={e => goPage(Math.max(1, Math.min(maxPage, Number(e.target.value) || 1)))}/><button type="button" disabled={pageNo >= maxPage} onClick={() => goPage(pageNo + 1)}>下一页</button><a className="reader-prepare-link" href={`/ask/?scope=${encodeURIComponent(scope)}&doc=${encodeURIComponent(doc)}&page=${pageNo}${selectedNode ? `&node=${encodeURIComponent(selectedNode)}` : ''}&lesson=${encodeURIComponent(selectedLessonTitle || pageTitle(page))}`}>从当前篇目开始备课 <ArrowRight/></a><a href={buildReaderHref({ documentId: doc, page: pageNo, nodeId: selectedNode, lessonTitle: selectedLessonTitle || pageTitle(page), scope, returnTo: currentPageReturn() })}><ExternalLink/>核验原始教材</a></div>
          </header>
          <article className="library-pdf-article"><div className="library-pdf-meta"><span>原始教材是唯一可核验的依据</span><b>第 {pageNo} 页 · 书页 {page?.printedPage || "未标注"}</b></div>{pagePdf ? <iframe key={`${doc}-${pageNo}`} title={`${currentDoc?.short || "教材"} 第 ${pageNo} 页`} src={pdfPageUrl(pagePdf,pageNo)}/> : <div className="index-empty"><FileText/><b>当前文档暂时没有可用教材页面</b><p>请稍后重试；如果问题持续，请检查文档存储配置。</p></div>}</article>
        </section>
        <aside className="index-results"><header><span>搜索结果</span><small>{busy ? "正在查阅教材…" : results.length ? `${results.length} 条相关页面` : searched ? "暂时没有找到相关页面" : "输入关键词开始搜索"}</small></header>{searchError ? <div className="index-empty search-error"><CircleAlert/><b>{searchError}</b><button type="button" onClick={search}>再试一次</button></div> : results.length ? <>{results.slice(0,visibleResults).map((r, i) => { const resultDocumentId=searchResultDocumentId(r); const resultPage=searchResultPage(r); const disabled=!resultDocumentId || !resultPage; const resultTitle=r.title || r.sectionPath?.at(-1) || "相关页面"; return <button type="button" disabled={disabled} key={`${resultDocumentId || 'unknown'}-${resultPage || 'unknown'}-${i}`} onClick={() => resultPage && openReaderTarget({documentId: resultDocumentId, pageNumber: resultPage, nodeId: r.nodeId || r.node_id || "", lessonTitle: resultTitle})}><b>{resultTitle}</b><small>{r.documentTitle || r.document_title || docName(resultDocumentId)} · {resultPage ? `第${resultPage}页` : '页码待确认'} · 书页 {r.printedPage || r.printed_page || "未标注"}</small><p>{citationText(r)}</p><span className="result-open-hint">{resultPage ? '点击在中间阅读区打开这一页' : '该结果暂缺教材页码，暂不能定位'}</span></button>; })}{results.length>visibleResults && <button className="show-more-results" type="button" onClick={()=>setVisibleResults(value=>Math.min(results.length,value+6))}>查看更多相关页面（还有 {results.length-visibleResults} 条）</button>}</> : <div className="index-empty"><Search/><b>{searched ? "暂时没有找到相关页面" : "在教材库中搜索"}</b><p>{searched ? "可以试试完整篇名、单元名，或换成“教学重点”“朗读处理”等更具体的说法。" : "输入篇名、章节、关键词或教学问题，结果会显示文档、章节、教材页码和书页。"}</p></div>}</aside>
      </div>
    </div>
  );
}

function citationByRef(citations, refs = []) {
  return uniqueCitations(citations, refs);
}
function CitationChips({ citations, refs, returnTo = 'ask', limit = 4 }) {
  const items = citationByRef(citations, refs);
  if (!items.length) return null;
  return <div className="citation-chips">{items.slice(0, limit).map(item => { const href = citationLink(item, returnTo); return href ? <a href={href} key={`${item.documentId}-${citationPage(item)}`} title={`${item.documentTitle} · ${item.sectionPath?.join(' › ') || ''}`}><Quote size={11}/>{docName(item.documentId)} · 第 {citationPage(item)}页</a> : null; })}</div>;
}
function RouteTrace({ route }) {
  const docs = route?.documents || [];
  const ranges = route?.pageRanges || [];
  const reactSteps = Array.isArray(route?.reactTrace) ? route.reactTrace.filter(item => item?.action === 'search' && item.query) : [];
  return <details className="route-trace" open><summary><Route size={15}/><b>资料定位</b><span>{route?.evidenceCount || 0} 个相关页面</span><ChevronDown size={14}/></summary><div className="route-trace-body"><div className="route-steps">{(route?.retrievalSteps || ['读取教材目录', '定位相关篇目与段落', '打开对应 教材原页']).map((step, index) => <span key={`${step}-${index}`}><i>{index + 1}</i>{step}{index < (route?.retrievalSteps || []).length - 1 && <ChevronRight/>}</span>)}</div>{reactSteps.length > 0 && <div className="route-agent-note"><Sparkles size={14}/><span>本轮根据当前问题补查了 {reactSteps.length} 次更具体的教材页面。</span></div>}<div className="route-docs">{docs.map(doc => { const range = ranges.find(item => item.documentId === doc.id); return <span key={doc.id}><b>{doc.title || docName(doc.id)}</b>{range && ` · 第 ${range.from}—${range.to}页`}</span>; })}</div></div></details>;
}
function WorkflowStrip({ lessonTitle }) {
  const steps = [
    ['01', '确认本课材料', '锁定当前篇目，同时找到教师用书处理和学生教材原文；课标只说明学段要求。'],
    ['02', '回答当前问题', '围绕教师这一轮真正想解决的问题，给出课堂主张、学生任务和可核验页码。'],
    ['03', '定稿课堂设计', '教师确认取舍后，再生成板书、提问和评价三卡；后续追问仍留在同一篇目。']
  ];
  return <section className="workflow-strip"><header><div><span>本课工作路径</span><h2>{lessonTitle || '从教材到课堂'}</h2></div><small>三步都围绕同一篇目进行；追问只调整当前问题，不会改写篇目身份。</small></header><div className="workflow-steps">{steps.map(([number, title, description], index) => <article key={number} className={index === 1 ? 'priority' : ''}><b>{number}</b><div><strong>{title}</strong><p>{description}</p></div>{index < steps.length - 1 && <ArrowRight/>}</article>)}</div></section>;
}
function PlanAnswer({ answer, citations, cardSuggestions, draftId, returnTo = 'ask' }) {
  if (!answer) return null;
  const [readPage, setReadPage] = useState(1);
  const plan = answer.lessonPlan || [];
  const questions = answer.questionChain || [];
  const layers = answer.sourceLayers || {};
  const sourceLayer = (key, fallbackLabel, fallbackText, tone) => {
    const layer = layers[key] || {};
    const priority = key === 'curriculumStandard' ? '学段要求与学业质量' : key === 'teacherGuide' ? '编写意图与教学建议' : key === 'textbook' ? '原文与页码核对' : '基于三类材料的转化';
    const summary = String(layer.summary || fallbackText || '').replace(/\s+/gu, ' ').trim();
    const layerRefs = Array.isArray(layer.citationIds) ? layer.citationIds : [];
    return <article className={`answer-source-layer ${tone || ''}`} key={key}><header><span>{layer.label || fallbackLabel}</span><small>{layer.available === false ? '当前未找到直接依据' : priority}</small></header><p>{summary.slice(0, 220)}{summary.length > 220 ? '…' : ''}</p>{layer.available !== false && layerRefs.length > 0 ? <CitationChips citations={citations} refs={layerRefs} returnTo={returnTo}/> : null}</article>;
  };
  const materialBasis = <section className="answer-material-map"><header><div><Badge tone="green">教材依据</Badge><h3>这条建议从哪里来</h3></div><small>先看教师用书怎样处理，再回到学生教材原文；课标只说明学段要求。</small></header><div className="answer-source-layers">{sourceLayer('teacherGuide', '教师用书怎么建议', '本轮未定位教师用书的直接处理建议。', 'guide')}{sourceLayer('textbook', '学生要回到哪里', '本轮未定位学生教材的直接原文依据。', 'textbook')}{sourceLayer('curriculumStandard', '课标要求到什么程度', '本轮未定位课程标准原文，不会把教学推断写成课标结论。', 'standard')}</div>{answer.teachingBasis?.transformation && <p className="answer-material-note"><b>转成课堂：</b>{answer.teachingBasis.transformation}</p>}</section>;
  const objectives = (answer.objectives?.length || answer.keyPoints?.length) ? <div className="answer-two-col">{answer.objectives?.length ? <article><small>教学目标</small><ul>{answer.objectives.map(item => <li key={item}>{item}</li>)}</ul></article> : null}{answer.keyPoints?.length ? <article><small>重点与难点</small><ul>{answer.keyPoints.map(item => <li key={item}>{item}</li>)}</ul></article> : null}</div> : null;
  const execution = <><section className="answer-page-heading"><Badge tone="blue">第 2 部分 · 课堂执行</Badge><h3>把依据变成教师可以直接使用的动作</h3><p>每个环节都写清教师做什么、学生回到哪里、期待出现什么文本证据，以及这一环节如何推进到下一步。</p></section>{plan.length ? <section className="answer-section"><header><div><Badge tone="blue">课堂流程</Badge><p className="answer-section-lead">按“核对教师用书建议 → 学生回到教材原文 → 课堂形成结论”展开，不把教材依据压缩成一句口号。</p></div><span>{plan.length} 个环节</span></header><div className="lesson-plan">{plan.map((step, index) => <article key={`${step.title}-${index}`}><div className="lesson-plan-index">{String(index + 1).padStart(2, '0')}</div><div><div className="lesson-plan-title"><b>{step.title}</b>{step.duration && <small>{step.duration}</small>}</div><p><strong>教师动作：</strong>{step.content}</p>{step.studentTask && <p><strong>学生任务：</strong>{step.studentTask}</p>}{step.expectedEvidence && <p><strong>观察表现：</strong>{step.expectedEvidence}</p>}{step.teacherGuideBasis && <p className="lesson-plan-basis"><strong>教师用书提示：</strong>{step.teacherGuideBasis}</p>}<CitationChips citations={citations} refs={step.evidenceRefs} returnTo={returnTo}/></div></article>)}</div></section> : <div className="answer-empty-detail">教师用书暂未返回可展开的课堂环节，请补充篇名或章节后重试。</div>}{questions.length ? <section className="answer-section"><header><Badge tone="orange">问题链</Badge><span>每个问题都回到原文</span></header><div className="question-chain">{questions.map((item, index) => <article key={`${item.question}-${index}`}><i>{index + 1}</i><div><b>{item.question}</b>{item.purpose && <p>{item.purpose}</p>}<CitationChips citations={citations} refs={item.evidenceRefs} returnTo={returnTo}/></div></article>)}</div></section> : null}{(answer.homework?.length || answer.assessment?.length) ? <div className="answer-two-col answer-bottom">{answer.homework?.length ? <article><small>课后延伸</small><ul>{answer.homework.map(item => <li key={item}>{item}</li>)}</ul></article> : null}{answer.assessment?.length ? <article><small>课堂评价</small><ul>{answer.assessment.map(item => <li key={item}>{item}</li>)}</ul></article> : null}</div> : null}<section className="card-prompt"><div><b>这是一份依据教材形成的初步方案</b><small>先比较真正会改变课堂的路径与代价；教师确认取舍后，再生成最终方案并定稿。</small></div><div><a className="primary" href={draftId ? `/deliberation/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>比较备课取舍 <ArrowRight/></a><a href={draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>跳过取舍，直接定稿</a></div></section></>;
  return <div className="structured-answer chat-answer"><section className="chat-reply"><Badge tone="green">先回答你的问题</Badge><p>{answer.reply || answer.summary}</p><CitationChips citations={citations} refs={answer.evidenceRefs} returnTo={returnTo}/></section><details className="workflow-collapsed"><summary>查看本课三步路径</summary><WorkflowStrip lessonTitle={answer.lesson?.title}/></details><div className="answer-page-tabs" role="tablist" aria-label="备课方案分段阅读"><button type="button" className={readPage === 1 ? 'active' : ''} onClick={() => setReadPage(1)} role="tab" aria-selected={readPage === 1}><b>01</b><span>本轮建议</span><small>先看主张与教材依据</small></button><button type="button" className={readPage === 2 ? 'active' : ''} onClick={() => setReadPage(2)} role="tab" aria-selected={readPage === 2}><b>02</b><span>课堂方案</span><small>需要时再展开细节</small></button></div>{readPage === 1 ? <section className="answer-page answer-page-one"><section className="answer-summary"><Badge tone="green">针对当前问题的建议</Badge><h2>{answer.summary}</h2>{answer.lessonPosition && <p className="answer-position">{answer.lessonPosition}</p>}<CitationChips citations={citations} refs={answer.evidenceRefs} returnTo={returnTo}/></section>{materialBasis}{objectives}<div className="answer-page-next"><span>主张和依据确认后</span><b>继续查看课堂怎样实施</b><button type="button" onClick={() => setReadPage(2)}>查看课堂方案 <ArrowRight/></button></div></section> : <section className="answer-page answer-page-two">{execution}<div className="answer-page-prev"><button type="button" onClick={() => setReadPage(1)}><ArrowRight/>返回本轮建议</button><span>第 2 部分 / 2</span></div></section>}</div>;
}
function ContextSelect({ label, value, onChange, options, hint }) {
  return <label className="context-control"><span className="context-control-label">{label}</span><span className="context-select"><select value={value} onChange={onChange}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={14}/></span>{hint && <small>{hint}</small>}</label>;
}
function ContextText({ label, value, onChange, hint, placeholder }) {
  return <label className="context-control context-text"><span className="context-control-label">{label}</span><span className="context-select"><input value={value} onChange={onChange} maxLength="40" placeholder={placeholder}/></span>{hint && <small>{hint}</small>}</label>;
}
function ConversationTurn({ turn, draftId, onQuickAsk, onSaveEvidence }) {
  const response = turn.response;
  const blocked = response?.generation === 'blocked-no-evidence' || response?.evidenceSufficient === false;
  if (!response) return null;
  const cardsDraftId = draftId || response.draftId || '';
  const cardsHref = cardsDraftId ? `/cards/?draftId=${encodeURIComponent(cardsDraftId)}` : '';
  const askReturnTo = cardsDraftId ? `/ask/?draftId=${encodeURIComponent(cardsDraftId)}` : 'ask';
  return <article className="conversation-turn"><div className="turn-question"><small>你的问题</small><p>{turn.question}</p>{turn.operationLabel && <span className="turn-operation">本轮调整：{turn.operationLabel.replace(/请保持当前篇目与核心问题，/u, '').replace(/。$/u, '')}</span>}{response.conversation?.historyUsed && <span className="turn-context-used"><CheckCircle2 size={13}/>已沿用本场对话上下文</span>}</div>{response.retrievalMode === 'stable_snapshot' && <div className="snapshot-banner"><CheckCircle2/><div><b>{UI_COPY.recovery.snapshotBanner}</b><small>{UI_COPY.recovery.snapshotBody}{response.fallbackAt ? ` 快照时间：${new Date(response.fallbackAt).toLocaleString()}` : ''}</small></div></div>}{blocked ? <div className="answer-blocked compact-blocked"><div className="answer-blocked-head"><CircleAlert/><div><Badge tone="orange">依据不足，已停止生成</Badge><h2>{UI_COPY.ask.blockedTitle}</h2><p>{UI_COPY.ask.blockedBody}</p></div></div></div> : <>{Number(response.generationRounds) > 1 && <div className="agent-review-note"><CheckCircle2 size={16}/><span><b>{Number(response.generationRounds) >= 3 ? '已完成教材校核与课堂可用性修订' : '已完成两轮教材校核'}</b><small>{Number(response.generationRounds) >= 3 ? '初稿仍有顺序或时间问题时，系统已增加一轮定向修订。' : '先形成课堂初稿，再按教师用书、学生教材与真实页码逐项修订。'}</small></span></div>}{Array.isArray(response.teachingPlanIssues) && response.teachingPlanIssues.length > 0 && <div className="agent-teaching-warning"><CircleAlert/><div><b>当前流程仍需教师确认</b><ul>{response.teachingPlanIssues.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul></div></div>}<div className="understanding-card"><small>问题理解</small><p>{response.understanding || response.question}</p></div><RouteTrace route={response.route}/><PlanAnswer answer={response.answer} citations={response.citations || []} cardSuggestions={response.cardSuggestionItems || response.cardSuggestions || response.threeCardSuggestions} draftId={cardsDraftId} returnTo={askReturnTo}/><div className="turn-followups"><button onClick={() => onQuickAsk({ prompt: '请优先展开教师用书中的教学建议，并保留当前篇目。' })}>展开教师用书依据</button><button onClick={() => onQuickAsk({ prompt: '请只呈现最直接的原始教材依据，并保留当前篇目。' })}>只看原始依据</button><button onClick={() => onQuickAsk({ prompt: '请调整为两课时课堂节奏。', operation: { type: 'change_periods', periods: 2 }, lessonContextPatch: { periods: 2 } })}>换成两课时</button>{cardsHref ? <a className="turn-followup-primary" href={cardsHref}>查看并定稿方案 <ArrowRight size={14}/></a> : <button onClick={() => onQuickAsk({ prompt: '请先保存当前备课方案，再进入教师定稿。' })}>保存方案后定稿</button>}</div><div className="turn-evidence-actions"><button type="button" onClick={() => onSaveEvidence?.(response.citations || [])}><Plus size={14}/>加入本课依据夹</button><small>把本轮已核验页面收好，之后可从右侧直接回看。</small></div><details className="raw-evidence"><summary>查看原文片段与页码</summary><div>{(response.citations || []).slice(0, 6).map(item => <a href={citationLink(item, askReturnTo)} key={item.id}><b>{docName(item.documentId)} · 第{item.pdfPage}页</b><small>{item.sectionPath?.join(' › ') || '原始页面'}</small><p>{citationText(item)}</p></a>)}</div></details></>}</article>;
}
function EvidenceShelf({ items, onRemove, onClear, returnTo = 'ask' }) {
  return <section className="evidence-shelf"><header><div><b>本课依据夹</b><small>{items.length ? `${items.length} 个已核验页面` : '把重要页面收在这里'}</small></div>{items.length ? <button type="button" onClick={onClear}>清空</button> : null}</header>{items.length ? <div className="evidence-shelf-list">{items.map(item => <div className="evidence-shelf-item" key={`${item.documentId}:${item.pdfPage}`}><a href={citationLink(item, returnTo)}><b>{docName(item.documentId)} · 第{item.pdfPage}页</b><small>{item.sectionPath?.join(' › ') || '原始页面'}{item.printedPage ? ` · 书页 ${item.printedPage}` : ''}</small></a><button type="button" aria-label="移除依据" onClick={() => onRemove(item)}><X size={13}/></button></div>)}</div> : <p>在回答下方点击“加入本课依据夹”，把需要反复核对的教师用书和教材页面集中起来。</p>}</section>;
}
function DualSourceEvidenceDesk({ title, evidence, busy, error, onSave, returnTo = 'ask' }) {
  if (!title) return null;
  const sources = [
    { id: 'textbook', label: '学生教材', purpose: '核对课文原文、助学任务和关键语句', result: evidence?.textbook },
    { id: 'teacher-guide', label: '教师教学用书', purpose: '参考教学重点、活动顺序、问题链和评价建议', result: evidence?.teacherGuide }
  ];
  const available = sources.map(item => item.result).filter(Boolean);
  return <section className="panel dual-source-desk"><header><div><span>同课双源依据</span><h2>{title}</h2><p>先对照两份材料，再开始生成方案。页码来自教材搜索结果，不根据另一份材料猜测。</p></div>{available.length ? <button type="button" onClick={() => onSave?.(available)}><Plus size={15}/>加入本课依据夹</button> : null}</header>{busy ? <div className="dual-source-loading"><Activity size={18}/><span>正在定位学生教材和教师教学用书的对应页面…</span></div> : error ? <div className="dual-source-error"><CircleAlert size={17}/><span>{error}</span></div> : <div className="dual-source-grid">{sources.map(source => { const item = source.result; const page = citationPage(item); const link = item ? citationLink(item, returnTo) : ''; return <article className={item ? 'ready' : 'missing'} key={source.id}><div className="dual-source-head"><span>{source.label}</span>{item ? <b>已定位</b> : <b>待补充</b>}</div><h3>{item?.title || item?.sectionPath?.at?.(-1) || (item ? title : '暂未找到对应页面')}</h3><p>{item ? citationText(item).slice(0, 180) || source.purpose : `没有找到足以确认的${source.label}页面，不会用另一份材料的页码代替。`}</p><footer><small>{item ? `${source.label} · 第${page}页${item.printedPage ? ` · 书页 ${item.printedPage}` : ''}` : source.purpose}</small>{link ? <a href={link}>核验原始页<ExternalLink size={13}/></a> : null}</footer></article>; })}</div>}</section>;
}
function WorkflowChecklist({ messages, draft, cards, onQuickAsk, draftId }) {
  const items = deriveWorkflowChecklist({ messages, draft, cards });
  const progress = checklistProgress(items);
  const actionFor = item => {
    if (item.id === 'standard') return { label: '核对课标', prompt: '请继续沿用当前篇目，定位第四学段、相关学习任务群和学业质量的课标原页。篇目对齐如果是推断，请明确标为待教师确认。' };
    if (item.id === 'guide') return { label: '读取教师用书', prompt: '请继续沿用当前篇目，先读取教师用书中的教学重点、课时安排和课堂活动。' };
    if (item.id === 'textbook') return { label: '回到学生教材', prompt: '请继续沿用当前篇目，回到学生教材核对课文段落、关键语句和助学任务。' };
    if (item.id === 'plan') return { label: '整理课堂方案', prompt: '请根据当前已核验的课程标准、教师用书和学生教材依据，整理出可直接执行的课堂流程。' };
    return null;
  };
  const order = { lesson: '01', standard: '02', guide: '03', textbook: '04', plan: '05', cards: '06' };
  return <section className="workflow-checklist"><header><div><span>本课准备清单</span><b>每一步都有可核验依据</b></div><strong>{progress.done}/{progress.total}</strong></header><p className="workflow-checklist-intro">把“定位篇目 → 核对课标 → 读取教师用书 → 回到学生教材 → 形成课堂方案 → 进入三卡”做成一条可追踪的备课路径。</p><div className="workflow-checklist-list">{items.map(item => { const action = actionFor(item); return <div className={`workflow-checklist-item ${item.done ? 'done' : ''}`} key={item.id}><span className="workflow-checklist-mark">{item.done ? <Check size={14}/> : order[item.id] || '—'}</span><div><b>{item.label}</b><small>{item.detail}</small></div>{!item.done && action ? <button type="button" onClick={() => onQuickAsk?.({ prompt: action.prompt })}>{action.label}<ArrowRight size={13}/></button> : null}{item.id === 'cards' && !item.done && draftId ? <a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>进入三卡<ArrowRight size={13}/></a> : null}</div>; })}</div></section>;
}
function scopeLabel(value) {
  if (value === 'textbook') return '学生教材';
  if (value === 'teacher-guide') return '教师教学用书';
  if (value === 'curriculum-standard') return '课程标准';
  if (value === 'all') return '课程标准 + 学生教材 + 教师教学用书';
  return '学生教材 + 教师教学用书';
}
function scopeDocumentIds(value) {
  if (value === 'all') return ['curriculum-standard', 'textbook', 'teacher-guide'];
  if (value === 'both') return ['textbook', 'teacher-guide'];
  return [canonicalDocumentId(value || 'textbook')];
}
function persistedConversationTurn(turn) {
  if (!turn || !turn.response) return null;
  return {
    role: 'user',
    question: String(turn.question || '').trim(),
    operationLabel: String(turn.operationLabel || ''),
    response: turn.response
  };
}
function ConversationSide({
  messages,
  history,
  lessonTitle,
  scope,
  lessonContext,
  existingDraft,
  draftId,
  restoredAt,
  restoredFromLocal = false,
  recentDrafts = [],
  localSessions = [],
  onContinue,
  onQuickAsk,
  onNewConversation,
  onExportConversation,
  shelf,
  onRemoveShelf,
  onClearShelf,
  readerReturnTo = 'ask'
}) {
  const hasConversation = Array.isArray(messages) && messages.length > 0;
  const title = lessonTitle || '尚未定位篇目';
  const recent = (hasConversation ? messages : []).slice(-3).reverse();
  const visibleDrafts = recentDrafts.slice(0, 6);
  const cloudDraftIds = new Set(recentDrafts.map(item => String(item.id || '')));
  const visibleLocalSessions = localSessions
    .filter(item => !item.draftId || !cloudDraftIds.has(String(item.draftId)))
    .slice(0, 4);
  const nextPrompts = hasConversation
    ? [
      { label: '展开教师用书处理', prompt: '请继续沿用当前篇目，具体展开教师用书中的课堂活动和问题链。' },
      { label: '回到学生教材核对', prompt: '请继续沿用当前篇目，指出学生教材中必须回读的段落或关键语句。' },
      { label: '调整为两课时', prompt: '请保持当前篇目与核心问题，改为两课时安排，只调整课堂节奏和环节分配。', operation: { type: 'change_periods', periods: 2 }, lessonContextPatch: { periods: 2 } }
    ]
    : [{ label: '从当前篇目开始', prompt: `请围绕${title === '尚未定位篇目' ? '当前选定篇目' : title}，先说明教师用书中的教学主线。` }];
  return <aside className="panel ask-side conversation-side">
    <SectionHead icon={MessageCircle} eyebrow="当前备课" title={hasConversation ? '继续追问' : '等待你的第一问'} note={hasConversation ? '后续提问会沿用当前篇目、教材范围和已核验页面。' : '先确认当前篇目，再提出一个具体备课问题。'} />
    <div className={`conversation-status ${hasConversation ? 'active' : ''}`}><i/><span>{hasConversation ? `已保存 ${messages.length} 轮对话` : '尚未开始对话'}</span></div>
    {hasConversation && <div className="conversation-persistence"><CheckCircle2 size={15}/><span>{restoredFromLocal ? '已从本机恢复，建议继续提问后同步账号' : restoredAt ? `已恢复上次对话 · ${new Date(restoredAt).toLocaleString()}` : '本轮已自动保存，刷新后仍可继续'}</span></div>}
    <section className="conversation-dossier"><small>当前篇目</small><strong>{title}</strong><div className="dossier-grid"><span><b>{messages?.length || 0}</b><small>轮对话</small></span><span><b>{lessonContext?.periods || 1}</b><small>课时</small></span><span><b>{scopeLabel(scope).includes('教师') ? '双源' : '单源'}</b><small>材料</small></span></div><p>当前问题只会调整本课方案，不会改写篇目与已核验页码。</p></section>
    <section className="conversation-next"><header><b>{hasConversation ? '接下来想解决什么' : '从当前篇目开始'}</b><small>点击后仍留在同一备课</small></header>{nextPrompts.map(item => <button type="button" key={item.label} onClick={() => onQuickAsk?.(item)}><span>{item.label}</span><ArrowRight size={14}/></button>)}</section>
    <div className="conversation-footer-actions"><button type="button" className="conversation-continue" onClick={onContinue}><MessageCircle size={16}/>{hasConversation ? '输入自己的追问' : '开始提问'}<ArrowRight size={15}/></button>{hasConversation && <button type="button" className="conversation-new" onClick={onNewConversation}>另起一课</button>}{hasConversation && <button type="button" className="conversation-export" onClick={onExportConversation}><Download size={15}/>导出记录</button>}</div>
    <details className="conversation-secondary"><summary>查看本课准备清单</summary><WorkflowChecklist messages={messages} draft={existingDraft} cards={existingDraft?.cards} onQuickAsk={onQuickAsk} draftId={draftId}/></details>
    {shelf?.length ? <details className="conversation-secondary"><summary>已收藏的教材依据（{shelf.length}）</summary><EvidenceShelf items={shelf} onRemove={onRemoveShelf} onClear={onClearShelf} returnTo={readerReturnTo}/></details> : null}
    {(recentDrafts.length || visibleLocalSessions.length) ? <details className="conversation-secondary compact-history" open={!hasConversation}><summary>备课记录（{recentDrafts.length + visibleLocalSessions.length}）</summary><section className="conversation-drafts">{visibleDrafts.map(item => <a className={draftId && String(item.id) === String(draftId) ? 'current' : ''} href={`/ask/?draftId=${encodeURIComponent(item.id)}`} key={item.id}><span><History size={14}/></span><div><b>{item.title || item.question || '未命名备课'}</b><small>{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '最近保存'} · 已同步</small></div><ArrowRight size={14}/></a>)}{visibleLocalSessions.map(item => <a href={`/ask/?resume=${encodeURIComponent(item.resumeId)}`} key={item.resumeId}><span><History size={14}/></span><div><b>{item.lessonRef?.title || planIdentity(item.planQuestion || item.question, '未命名备课')}</b><small>{item.savedAt ? new Date(item.savedAt).toLocaleString() : '最近保存'} · 仅本机</small></div><ArrowRight size={14}/></a>)}</section></details> : null}
    {recent.length ? <details className="conversation-secondary"><summary>查看最近提问（{recent.length}）</summary><section className="conversation-recent">{recent.map((item, index) => <div key={`${item.question}-${index}`}><span>{messages.length - index}</span><p>{item.question}</p></div>)}</section></details> : null}
  </aside>;
}
function AskPage() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const isNewConversation = params.get('new') === '1';
  const isClassAdaptation = params.get('adapt') === '1';
  const authRecovery = useMemo(() => isNewConversation ? null : readAuthRecovery(), [isNewConversation]);
  // A lesson target from the library is a deliberate request for a new
  // thread. Do not silently attach an older local snapshot to it.
  const hasExplicitLessonTarget = Boolean(params.get('doc') || params.get('page') || params.get('node') || params.get('lesson'));
  const activeAuthRecovery = hasExplicitLessonTarget && !params.get('draftId') ? null : authRecovery;
  const initialUser = useMemo(() => getSession()?.user?.id || '', []);
  const requestedResumeId = isNewConversation ? '' : params.get('resume') || '';
  const localConversation = useMemo(() => readConversationSnapshot(initialUser, requestedResumeId), [initialUser, requestedResumeId]);
  const recoveredDraft = activeAuthRecovery?.draftSnapshot?.draft
    ? { ...activeAuthRecovery.draftSnapshot.draft, cards: activeAuthRecovery.draftSnapshot.cards || [] }
    : null;
  const requestedDraftId = isNewConversation ? '' : params.get('draftId') || activeAuthRecovery?.draftId || '';
  const canResumeLocal = !isNewConversation && !hasExplicitLessonTarget && !params.get('q') && Boolean(localConversation) && (Boolean(requestedResumeId) || !requestedDraftId || !localConversation?.draftId || String(localConversation.draftId) === String(requestedDraftId));
  // `adapt=1` means “open the newly copied plan for review”, not “run a
  // hidden prompt from the URL”. Older links may still contain q; ignore it
  // so the copied plan and cards are loaded before any new model turn.
  const initialQuestion = (isClassAdaptation ? '' : params.get('q')) || activeAuthRecovery?.question || (canResumeLocal ? localConversation?.question : '') || '';
  // Keep the already-rendered answer turns while a follow-up is waiting for
  // re-authentication. The turns contain the trusted citations, so returning
  // to /ask/ does not show an empty page or force the teacher to reconstruct
  // the material context from memory.
  const recoveredMessages = Array.isArray(activeAuthRecovery?.messages)
    ? activeAuthRecovery.messages.filter(item => item && item.response).slice(-6)
    : canResumeLocal && Array.isArray(localConversation?.messages) ? localConversation.messages.slice(-12) : [];
  const requestedScope = params.get('scope');
  // A new preparation starts with all three teaching sources. Teachers can
  // narrow the scope deliberately, but the default should not silently omit
  // the curriculum-standard layer from the first grounded answer.
  const initialScope = ['all', 'both', 'textbook', 'teacher-guide', 'curriculum-standard'].includes(requestedScope) ? requestedScope : 'all';
  const initialLessonRef = lessonRefFromUrl(params, initialScope) || activeAuthRecovery?.lessonRef;
  const askLibraryHref = useMemo(() => {
    const target = new URLSearchParams();
    for (const key of ['doc', 'page', 'node', 'scope', 'lesson']) {
      const value = params.get(key);
      if (value) target.set(key, value);
    }
    const queryString = target.toString();
    return `/library/${queryString ? `?${queryString}` : ''}`;
  }, [params]);
  const initialUnitRef = unitRefFromUrl(params);
  const requestedClassName = String(params.get('className') || '').trim().slice(0, 40);
  const [question, setQuestion] = useState(initialQuestion);
  const [messages, setMessages] = useState(recoveredMessages);
  const session = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastErrorCode, setLastErrorCode] = useState('');
  const [retryQuestion, setRetryQuestion] = useState(initialQuestion);
  const [retryTarget, setRetryTarget] = useState(initialQuestion);
  const [scope, setScope] = useState(activeAuthRecovery?.scope || initialScope);
  const [keys, setKeys] = useState([]);
  const [keyId, setKeyId] = useState('');
  const [gatewayAvailable, setGatewayAvailable] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [lessonContext, setLessonContext] = useState(activeAuthRecovery?.lessonContext || (canResumeLocal && localConversation?.lessonContext) || { periods: 1, className: requestedClassName, classLevel: '普通', teachingGoal: '理解文本', teachingMode: '探究', ...(initialUnitRef ? { unitRef: initialUnitRef } : {}) });
  const [lessonRef, setLessonRef] = useState(initialLessonRef || (canResumeLocal ? localConversation?.lessonRef : null));
  const [pairedEvidence, setPairedEvidence] = useState({ textbook: null, teacherGuide: null });
  const [pairedEvidenceBusy, setPairedEvidenceBusy] = useState(false);
  const [pairedEvidenceError, setPairedEvidenceError] = useState('');
  const [draftId, setDraftId] = useState(requestedDraftId || (canResumeLocal ? localConversation?.draftId : '') || '');
  const [existingDraft, setExistingDraft] = useState(recoveredDraft);
  const [carryoverWorking, setCarryoverWorking] = useState('');
  const [conversationHistory, setConversationHistory] = useState(activeAuthRecovery?.conversationHistory || (canResumeLocal ? localConversation?.conversationHistory : []) || []);
  const [restoredAt, setRestoredAt] = useState(activeAuthRecovery?.savedAt || (canResumeLocal ? localConversation?.savedAt : ''));
  const [restoredFromLocal, setRestoredFromLocal] = useState(Boolean(canResumeLocal && (initialQuestion || Boolean(recoveredMessages.length))));
  const [evidenceShelf, setEvidenceShelf] = useState([]);
  const [evidenceShelfReady, setEvidenceShelfReady] = useState(false);
  const shelfReadyForDraft = useRef('');
  const shelfSyncHash = useRef('');
  const shelfSyncTimer = useRef(null);
  const [recentDrafts, setRecentDrafts] = useState([]);
  const [classProfiles, setClassProfiles] = useState([]);
  const [localSessions, setLocalSessions] = useState(() => readRecentConversationSnapshots(initialUser));
  const [planQuestion, setPlanQuestion] = useState(activeAuthRecovery?.planQuestion || initialQuestion);
  const conversationOwner = useRef(initialUser);
  const ownerTransitioning = useRef(false);
  const pairedLessonTitle = lessonRef?.title || (messages.length && planQuestion ? planIdentity(planQuestion, '') : '');
  const composerRef = useRef(null);
  const autoAsked = useRef(false);
  const localResumeRef = useRef(Boolean(recoveredMessages.length || (canResumeLocal && localConversation?.draftId)));
  const ownerPersistenceAllowed = () => canPersistAuthOwner(conversationOwner.current, session?.user?.id, ownerTransitioning.current);
  useEffect(() => {
    const nextOwner = String(session?.user?.id || '');
    const previousOwner = String(conversationOwner.current || '');
    if (authOwnersConflict(previousOwner, nextOwner)) {
      // Quarantine the old account's in-memory state before any owner-keyed
      // persistence effect below can observe the new session. Keep the guard
      // raised until the clean page replaces this component.
      ownerTransitioning.current = true;
      if (shelfSyncTimer.current) clearTimeout(shelfSyncTimer.current);
      setEvidenceShelfReady(false);
      setEvidenceShelf([]);
      setMessages([]);
      setQuestion('');
      setPlanQuestion('');
      setDraftId('');
      setExistingDraft(null);
      setConversationHistory([]);
      setRestoredAt('');
      setRestoredFromLocal(false);
      setRecentDrafts([]);
      setLocalSessions([]);
      shelfReadyForDraft.current = '';
      shelfSyncHash.current = '';
      location.replace('/ask/?new=1');
      return;
    }
    if (nextOwner) conversationOwner.current = nextOwner;
  }, [session?.user?.id]);
  useEffect(() => {
    if (!ownerPersistenceAllowed()) return;
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem(evidenceShelfKey(session?.user?.id)) || '[]'); } catch {}
    setEvidenceShelf(Array.isArray(stored) ? stored : []);
    setEvidenceShelfReady(true);
  }, [session?.user?.id]);
  useEffect(() => {
    if (!evidenceShelfReady || !ownerPersistenceAllowed()) return;
    try { localStorage.setItem(evidenceShelfKey(session?.user?.id), JSON.stringify(evidenceShelf)); } catch {}
  }, [evidenceShelf, evidenceShelfReady, session?.user?.id]);
  useEffect(() => () => {
    if (shelfSyncTimer.current) clearTimeout(shelfSyncTimer.current);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!session) { setRecentDrafts([]); setClassProfiles([]); return undefined; }
    setRecentDrafts([]); setClassProfiles([]);
    Promise.all([
      rootRequest('/api/drafts'),
      rootRequest('/api/drafts/class-profiles').catch(() => ({ profiles: [] }))
    ]).then(([data, classData]) => {
      if (!cancelled) {
        setRecentDrafts(Array.isArray(data?.drafts) ? data.drafts.slice(0, 50) : []);
        setClassProfiles(Array.isArray(classData?.profiles) ? classData.profiles : []);
      }
    }).catch(() => { if (!cancelled) { setRecentDrafts([]); setClassProfiles([]); } });
    return () => { cancelled = true; };
  }, [session?.user?.id, session?.access_token]);
  useEffect(() => {
    let cancelled = false;
    if (!pairedLessonTitle) {
      setPairedEvidence({ textbook: null, teacherGuide: null });
      setPairedEvidenceError('');
      return undefined;
    }
    setPairedEvidenceBusy(true);
    setPairedEvidenceError('');
    request('/search', {
      method: 'POST',
      body: { query: pairedLessonTitle, scope: ['textbook', 'teacher-guide'], limit: 12 }
    }).then(data => {
      if (!cancelled) setPairedEvidence(pairLessonEvidence(data?.results));
    }).catch(() => {
      if (!cancelled) {
        setPairedEvidence({ textbook: null, teacherGuide: null });
        setPairedEvidenceError('暂时无法定位两份材料。你仍可继续提问，稍后再核验原始页面。');
      }
    }).finally(() => { if (!cancelled) setPairedEvidenceBusy(false); });
    return () => { cancelled = true; };
  }, [pairedLessonTitle]);
  useEffect(() => {
    if (!ownerPersistenceAllowed()) return;
    setLocalSessions(readRecentConversationSnapshots(session?.user?.id || initialUser));
  }, [session?.user?.id, initialUser]);
  useEffect(() => {
    let cancelled = false;
    setAiReady(false);
    // The public ask page still needs the server configuration to explain
    // whether logging in is enough. Only personal-key metadata is protected.
    Promise.all([
      rootRequest('/api/config').catch(() => ({})),
      session ? rootRequest('/api/ai/keys').catch(() => ({ keys: [] })) : Promise.resolve({ keys: [] })
    ]).then(([config, keyData]) => {
      if (cancelled) return;
      const list = Array.isArray(keyData.keys) ? keyData.keys : [];
      const available = Boolean(config.gatewayConfigured && config.textModelConfigured);
      setKeys(list);
      setGatewayAvailable(available);
      let rememberedKeyId = '';
      try { rememberedKeyId = sessionStorage.getItem('activeDeepSeekKeyId') || ''; } catch {}
      // A key activated in AI 设置 is the account's explicit choice. The
      // system gateway remains available as a visible fallback, but it must
      // not silently override the user's selected personal connection.
      const selectedKey = list.find(item => item.id === rememberedKeyId)
        || list.find(item => item.isActive)
        || (!available ? list[0] : null);
      setKeyId(selectedKey?.id || '');
    }).catch(() => {
      if (!cancelled) {
        setKeys([]);
        setGatewayAvailable(false);
      }
    }).finally(() => { if (!cancelled) setAiReady(true); });
    return () => { cancelled = true; };
  }, [session?.user?.id, session?.access_token]);
  useEffect(() => {
    // The recovery payload has already been copied into React state above.
    // Clear only after the target page mounts, never before the login redirect.
    if (authRecovery) clearAuthRecovery();
  }, [authRecovery]);
  useEffect(() => {
    try {
      if (keyId) sessionStorage.setItem('activeDeepSeekKeyId', keyId);
      else sessionStorage.removeItem('activeDeepSeekKeyId');
    } catch {}
  }, [keyId]);
  useEffect(() => {
    if (!draftId || !session || !ownerPersistenceAllowed()) return;
    rootRequest(`/api/drafts/${draftId}`).then(data => {
      const draft = data.draft || data;
      setExistingDraft(draft);
      setRestoredFromLocal(false);
      const savedShelf = Array.isArray(draft.answer?.evidenceShelf) ? draft.answer.evidenceShelf : [];
      setEvidenceShelf(savedShelf);
      shelfReadyForDraft.current = String(draftId);
      shelfSyncHash.current = JSON.stringify(savedShelf || (Array.isArray(evidenceShelf) ? evidenceShelf : []));
      if (draft.question) {
        setPlanQuestion(value => value || draft.question);
        if (!question) setQuestion(draft.question);
      }
      if (draft.lesson_context) {
        setLessonContext(value => ({ ...value, ...draft.lesson_context }));
        if (draft.lesson_context.lessonRef) setLessonRef(draft.lesson_context.lessonRef);
      }
      if (Array.isArray(draft.scope)) {
        const normalizedScope = [...new Set(draft.scope.map(canonicalDocumentId))];
        if (normalizedScope.length === 1) setScope(normalizedScope[0]);
        else if (normalizedScope.includes('curriculum-standard') && normalizedScope.includes('textbook') && normalizedScope.includes('teacher-guide')) setScope('all');
        else if (normalizedScope.includes('textbook') && normalizedScope.includes('teacher-guide')) setScope('both');
      }
      if (Array.isArray(draft.answer?.conversationHistory)) setConversationHistory(draft.answer.conversationHistory);
      const savedTurns = Array.isArray(draft.answer?.conversationTurns)
        ? draft.answer.conversationTurns.filter(item => item?.question && item?.response).slice(-12)
        : [];
      if (savedTurns.length) {
        setMessages(savedTurns);
        setRestoredAt(draft.updated_at || draft.updatedAt || new Date().toISOString());
      }
    }).catch(error => {
      if (['auth_invalid', 'auth_required'].includes(requestCode(error))) {
        const next = `${location.pathname}${location.search}`;
        saveAuthRecovery({ ownerUserId: session?.user?.id || initialUser, next, question, planQuestion, scope, lessonContext, lessonRef, draftId, messages: messages.slice(-12), conversationHistory, draftSnapshot: draftRecoverySnapshot(existingDraft), savedAt: new Date().toISOString() });
        location.href = `/login/?next=${encodeURIComponent(next)}`;
        return;
      }

      const fallback = readConversationSnapshot(session?.user?.id || initialUser);
      const sameDraft = !fallback?.draftId || !draftId || String(fallback.draftId) === String(draftId);
      if (!fallback || !sameDraft) {
        setRestoredAt('');
        setRestoredFromLocal(false);
        return;
      }

      if (Array.isArray(fallback.conversationHistory)) setConversationHistory(fallback.conversationHistory);
      if (fallback.scope) setScope(fallback.scope);
      if (fallback.lessonContext) setLessonContext(value => ({ ...value, ...fallback.lessonContext }));
      if (fallback.lessonRef) setLessonRef(fallback.lessonRef);
      if (fallback.question) setQuestion(value => value || fallback.question);
      if (fallback.planQuestion) setPlanQuestion(value => value || fallback.planQuestion);
      if (!requestedDraftId) setDraftId(fallback.draftId || '');
      const fallbackTurns = Array.isArray(fallback.messages)
        ? fallback.messages.filter(item => item && item.response).slice(-12)
        : [];
      if (fallbackTurns.length) {
        setMessages(fallbackTurns);
      }
      if (fallback.savedAt) {
        setRestoredAt(fallback.savedAt);
      } else {
        setRestoredAt(new Date().toISOString());
      }
      setRestoredFromLocal(true);
    });
  }, [draftId, session?.user?.id]);
  useEffect(() => {
    if (!draftId || !session || !existingDraft || !ownerPersistenceAllowed() || shelfReadyForDraft.current !== String(draftId)) return undefined;
    const serialized = JSON.stringify(evidenceShelf);
    if (serialized === shelfSyncHash.current) return undefined;
    if (shelfSyncTimer.current) clearTimeout(shelfSyncTimer.current);
    shelfSyncTimer.current = setTimeout(async () => {
      try {
        const answer = existingDraft.answer && typeof existingDraft.answer === 'object' ? existingDraft.answer : {};
        const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`, {
          method: 'PATCH',
          body: { answer: { ...answer, evidenceShelf }, version: existingDraft.version }
        });
        shelfSyncHash.current = serialized;
        if (data?.draft) setExistingDraft(data.draft);
      } catch {
        // The browser copy remains available; the next explicit save or shelf change retries.
      }
    }, 450);
    return () => { if (shelfSyncTimer.current) clearTimeout(shelfSyncTimer.current); };
  }, [draftId, session?.user?.id, existingDraft?.id, existingDraft?.version, evidenceShelf]);
  useEffect(() => {
    if (!ownerPersistenceAllowed() || (!messages.length && !draftId && !question.trim())) return;
    saveConversationSnapshot({
      draftId,
      question,
      planQuestion,
      scope,
      lessonContext,
      lessonRef,
      messages,
      conversationHistory,
      next: `${location.pathname}${location.search}`
    }, session?.user?.id || initialUser);
    setLocalSessions(readRecentConversationSnapshots(session?.user?.id || initialUser));
  }, [draftId, question, planQuestion, scope, lessonContext, lessonRef, messages, conversationHistory, session?.user?.id, initialUser]);
  useEffect(() => {
    // A saved draft is the durable conversation snapshot. Restoring its last
    // answer makes refresh/back-navigation continue the same lesson instead
    // of presenting a blank composer with only a draft id in the URL.
    if (!existingDraft?.answer || messages.length) return;
    if (Array.isArray(existingDraft.answer.conversationHistory)) setConversationHistory(existingDraft.answer.conversationHistory);
    const savedTurns = Array.isArray(existingDraft.answer.conversationTurns)
      ? existingDraft.answer.conversationTurns.filter(item => item?.question && item?.response)
      : [];
    if (savedTurns.length) {
      setMessages(savedTurns);
      return;
    }
    setMessages([{
      role: 'user',
      question: existingDraft.question || existingDraft.title || '当前篇目',
      response: {
        answer: existingDraft.answer,
        citations: Array.isArray(existingDraft.citations) ? existingDraft.citations : [],
        cardSuggestionItems: existingDraft.cards,
        evidenceSufficient: true,
        generation: 'restored-draft'
      }
    }]);
  }, [existingDraft, messages.length]);
  const ask = async (event, directQuestion, options = {}) => {
    event?.preventDefault();
    // Quick follow-ups pass an action object as the second argument. Do not
    // stringify it into "[object Object]": keep the lesson identity in
    // `planQuestion` and pass only the follow-up instruction to the model.
    const normalizedAction = normalizeAskAction(directQuestion, options, question);
    const requestOptions = normalizedAction.options;
    const text = normalizedAction.text;
    if (!text || busy) return;
    // A quick-action object is an instruction about the current plan. A new
    // sentence typed into the composer is a real follow-up question and must
    // not be silently replaced by the first question in the conversation.
    const askContext = buildAskContext({
      text,
      identityQuestion: String(planQuestion || initialQuestion || '').trim(),
      lessonRef,
      requestOptions: { ...requestOptions, isAction: typeof directQuestion === 'object' },
      planTitle: existingDraft?.title || ''
    });
    const { currentQuestion, canonicalQuestion, nextIdentityQuestion, identityTitle, retrievalQuery, teachingFocus, stableCoreQuestion, followUpInstruction } = askContext;
    const nextLessonContext = { ...lessonContext, ...(requestOptions.lessonContextPatch || {}) };
    const nextLessonRef = requestOptions.lessonRef || lessonRef;
    const resolvedIdentityTitle = nextLessonRef?.title || identityTitle || planIdentity(nextIdentityQuestion, '当前篇目');
    const operation = requestOptions.operation && typeof requestOptions.operation === 'object' ? requestOptions.operation : undefined;
    const followUpHistory = requestOptions.prompt ? [{ role: 'user', content: requestOptions.prompt }] : [];
    setBusy(true); setError(''); setLastErrorCode(''); setRetryQuestion(currentQuestion); setRetryTarget(typeof directQuestion === 'object' ? directQuestion : currentQuestion);
    let pendingTurn = null;
    let pendingHistory = [];
    try {
      const activeSession = await ensureSession();
      if (!activeSession) {
        const next = `${location.pathname}${location.search}`;
        saveAuthRecovery({ ownerUserId: session?.user?.id || initialUser, next, question: text, planQuestion: nextIdentityQuestion, scope, lessonContext: nextLessonContext, lessonRef: nextLessonRef, draftId, pendingAction: typeof directQuestion === 'object' ? directQuestion : null, messages: messages.slice(-12), conversationHistory, draftSnapshot: draftRecoverySnapshot(existingDraft), savedAt: new Date().toISOString() });
        location.href = `/login/?next=${encodeURIComponent(next)}`;
        return;
      }
      if (!aiReady) throw Object.assign(new Error('ai_checking'), { code: 'ai_checking' });
      if (!keyId && !gatewayAvailable) throw Object.assign(new Error('key_not_found'), { code: 'key_not_found' });
      const selectedScope = requestOptions.scope || scope;
      const lessonIdentity = {
        title: resolvedIdentityTitle,
        coreQuestion: existingDraft?.answer?.lesson?.coreQuestion || stableCoreQuestion || canonicalQuestion
      };
      const groundedHistory = conversationHistory.length ? [...conversationHistory, ...followUpHistory] : buildConversationHistory(messages, followUpHistory);
      const askBody = {
        draftId: existingDraft?.id || draftId || '',
        question: currentQuestion,
        retrievalQuery,
        teachingFocus,
        scope: scopeDocumentIds(selectedScope),
        limit: 8,
        keyId,
        retrievalMode: requestOptions.retrievalMode,
        lessonContext: nextLessonContext,
        lessonIdentity,
        followUpInstruction,
        operation,
        // The model receives the last grounded turns, not only the current
        // sentence. This is what makes “那教师用书怎么处理？” a follow-up
        // instead of a new unrelated search.
        history: groundedHistory.slice(-10)
      };
      // PageIndex and the model gateway are external read services. Retry one
      // transient failure before showing recovery controls, but never retry a
      // malformed request, auth failure, or an evidence insufficiency result.
      const response = await withAskRetry(
        () => request('/ask', { method: 'POST', body: askBody }),
        { maxRetries: 1 }
      );
      // The server rebinds identity to the owned lessonRef and retrieved
      // catalogue pages. Prefer that corrected title over an old browser
      // draft that may still contain conversational text such as “我岳阳楼记”.
      const lessonTitle = planIdentity(response?.answer?.lesson?.title || resolvedIdentityTitle || identityTitle || canonicalQuestion, '当前篇目');
      const stableCoreQuestion = response?.answer?.lesson?.coreQuestion || canonicalQuestion;
      const previousLessonTitle = planIdentity(existingDraft?.answer?.lesson?.title || existingDraft?.lesson_context?.lessonRef?.title || existingDraft?.title, '');
      const sameLesson = sameLessonRef(existingDraft?.lesson_context?.lessonRef, nextLessonRef)
        || Boolean(previousLessonTitle && lessonTitle && previousLessonTitle === lessonTitle);
      const previousCitations = sameLesson
        ? (Array.isArray(existingDraft?.citations) ? existingDraft.citations : messages.flatMap(item => Array.isArray(item.response?.citations) ? item.response.citations : []))
        : [];
      const nextCitations = [...previousCitations, ...(response.citations || [])];
      const nextTurn = { role: 'user', question: currentQuestion, operationLabel: requestOptions.prompt || '', response };
      const nextHistory = conversationHistory.length
        ? [...conversationHistory, { role: 'user', content: currentQuestion }, { role: 'assistant', content: response.answer?.reply || response.answer?.summary || '' }].slice(-10)
        : buildConversationHistory([...messages, nextTurn]);
      pendingTurn = nextTurn;
      pendingHistory = nextHistory;
      const nextConversationTurns = [...messages, nextTurn].map(persistedConversationTurn).filter(Boolean).slice(-12);
      const draftPayload = { title: lessonTitle, question: nextIdentityQuestion, scope: scopeDocumentIds(selectedScope), lessonContext: { ...nextLessonContext, ...(nextLessonRef ? { lessonRef: nextLessonRef } : {}) }, answer: { ...(response.answer || {}), ...(sameLesson && existingDraft?.answer?.planApproval ? { planApproval: { ...existingDraft.answer.planApproval, hasUnconfirmedChanges: true } } : {}), sourceCoverage: response.sourceCoverage || response.answer?.sourceCoverage, conversationHistory: nextHistory, conversationTurns: nextConversationTurns, evidenceShelf, ...(sameLesson && existingDraft?.answer?.previousLessonReflection ? { previousLessonReflection: existingDraft.answer.previousLessonReflection } : {}), ...(sameLesson && existingDraft?.answer?.lessonReflection ? { lessonReflection: existingDraft.answer.lessonReflection } : {}) }, citations: nextCitations, cards: sameLesson ? cardsForAskDraft(existingDraft) : [] };
      let savedDraftId = draftId;
      let savedDraft = null;
      if (!draftId) { const created = await rootRequest('/api/drafts', { method: 'POST', body: draftPayload }); savedDraft = created?.draft || null; savedDraftId = savedDraft?.id || ''; setDraftId(savedDraftId); } else { const updated = await rootRequest(`/api/drafts/${draftId}`, { method: 'PATCH', body: { ...draftPayload, version: existingDraft?.version } }); savedDraft = updated?.draft || null; }
      if (savedDraftId) {
        const url = new URL(location.href);
        url.searchParams.set('draftId', savedDraftId);
        url.searchParams.delete('new');
        history.replaceState(null, '', url);
      }
      if (savedDraft) {
        setExistingDraft(savedDraft);
        shelfReadyForDraft.current = String(savedDraft.id);
        shelfSyncHash.current = JSON.stringify(evidenceShelf);
        setRecentDrafts(items => [{
          id: savedDraft.id,
          title: savedDraft.title || lessonTitle,
          question: savedDraft.question || nextIdentityQuestion,
          updated_at: savedDraft.updated_at || new Date().toISOString()
        }, ...items.filter(item => String(item.id) !== String(savedDraft.id))].slice(0, 6));
      } else if (savedDraftId) {
        // Some deployments return only the new id. Keep the durable thread
        // visible immediately; the next refresh will hydrate its full title.
        setRecentDrafts(items => [{ id: savedDraftId, title: lessonTitle, question: nextIdentityQuestion, updated_at: new Date().toISOString() }, ...items.filter(item => String(item.id) !== String(savedDraftId))].slice(0, 6));
      }
      response.draftId = savedDraftId;
      setConversationHistory(nextHistory);
      setRestoredAt('');
      setRestoredFromLocal(false);

      if (!planQuestion) setPlanQuestion(nextIdentityQuestion);
      clearAuthRecovery();
      setLessonContext(nextLessonContext); setLessonRef(nextLessonRef);
      setMessages(items => [...items, nextTurn]);
      setQuestion('');
    } catch (err) {
      const code = requestCode(err);
      if (code === 'auth_invalid' || code === 'auth_required') {
        const next = `${location.pathname}${location.search}`;
        saveAuthRecovery({ ownerUserId: session?.user?.id || initialUser, next, question: text, planQuestion: nextIdentityQuestion, scope, lessonContext: nextLessonContext, lessonRef: nextLessonRef, draftId, pendingAction: typeof directQuestion === 'object' ? directQuestion : null, messages: [...messages, ...(pendingTurn ? [pendingTurn] : [])].slice(-12), conversationHistory: pendingHistory || conversationHistory, draftSnapshot: draftRecoverySnapshot(existingDraft), savedAt: new Date().toISOString() });
        location.href = `/login/?next=${encodeURIComponent(next)}`;
        return;
      }
      if (pendingTurn) {
        const recoveredMessages = [...messages, pendingTurn].slice(-12);
        setMessages(recoveredMessages);
        setConversationHistory(pendingHistory);
        setRestoredAt(new Date().toISOString());
        saveConversationSnapshot({ draftId, question: currentQuestion, planQuestion: nextIdentityQuestion, scope, lessonContext: nextLessonContext, lessonRef: nextLessonRef, messages: recoveredMessages, conversationHistory: pendingHistory, next: `${location.pathname}${location.search}` }, session?.user?.id || initialUser);
        setError('回答已经生成，但暂时没有保存到账号；内容已保留在本机，稍后可重新保存。');
        return;
      }
      setLastErrorCode(code); setError(askErrorMessage(err));
    }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!initialQuestion || !aiReady || autoAsked.current || localResumeRef.current || isClassAdaptation || (requestedDraftId && !existingDraft)) return;
    autoAsked.current = true;
    ask(null, activeAuthRecovery?.pendingAction || initialQuestion);
  }, [aiReady, existingDraft?.id]);
  const alternateScope = scope === 'textbook' ? 'teacher-guide' : 'textbook';
  const recovery = isIndexRecoveryCode(lastErrorCode);
  const canAsk = Boolean(session && aiReady && (keyId || gatewayAvailable));
  const askBlocked = Boolean(session && (!aiReady || !keyId && !gatewayAvailable));
  const savedContext = existingDraft?.lesson_context || existingDraft?.lessonContext;
  const priorReflection = existingDraft?.answer?.previousLessonReflection || null;
  const priorReflectionForm = normalizeFeedbackForm(priorReflection?.feedback || {});
  const priorCarryover = normalizePreviousLessonCarryover(existingDraft?.answer?.previousLessonCarryover || {});
  const priorLearning = existingDraft?.answer?.previousLessonLearningEvidence || null;
  const priorLearningSummary = priorLearning?.summary || null;
  const currentDeliberation = existingDraft?.answer?.teachingDeliberation?.status === 'confirmed' && !teachingDeliberationIsStale(existingDraft) ? existingDraft.answer.teachingDeliberation : null;
  const contextChanged = Boolean(messages.length && savedContext && ['periods', 'className', 'classLevel', 'teachingGoal', 'teachingMode'].some(key => String(savedContext[key] ?? '') !== String(lessonContext[key] ?? '')));
  const selectedClassProfile = classProfiles.find(item => item.className === String(lessonContext.className || '').trim()) || null;
  const askButtonLabel = busy ? '正在查阅并整理' : !session ? '登录后开始提问' : !aiReady ? '正在检查 AI 服务' : !keyId && !gatewayAvailable ? '请先配置 AI' : '开始提问';
  const loginHref = `/login/?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  const rememberCurrentAsk = () => saveAuthRecovery({ ownerUserId: session?.user?.id || initialUser, next: `${location.pathname}${location.search}`, question, planQuestion, scope, lessonContext, lessonRef, draftId, messages: messages.slice(-12), conversationHistory, draftSnapshot: draftRecoverySnapshot(existingDraft), savedAt: new Date().toISOString() });
  const retryableTarget = retryTarget || retryQuestion || question;
  const focusComposer = () => { composerRef.current?.focus(); composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const saveEvidence = items => setEvidenceShelf(current => mergeEvidenceShelf(current, items));
  const removeShelfItem = item => setEvidenceShelf(current => removeEvidenceShelfItem(current, item.documentId, item.pdfPage));
  const updateCarryover = async item => {
    if (!existingDraft?.id || carryoverWorking) return;
    setCarryoverWorking(item.sourceMomentId); setError('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(existingDraft.id)}/carryover/${encodeURIComponent(item.sourceMomentId)}`, {
        method: 'PATCH',
        body: { version: existingDraft.version, status: item.status === 'done' ? 'todo' : 'done' }
      });
      setExistingDraft(data.draft || existingDraft);
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setCarryoverWorking(''); }
  };
  const exportConversation = () => {
    const title = lessonRef?.title || planIdentity(planQuestion || question, '备课记录');
    const lines = [`# ${title}`, '', `- 材料范围：${scopeLabel(scope)}`, `- 课时：${lessonContext.periods || 1} 课时`, ...(lessonContext.className ? [`- 任教班级：${lessonContext.className}`] : []), `- 班级水平：${lessonContext.classLevel || '普通'}`, '', '## 备课对话'];
    messages.forEach((turn, index) => {
      const response = turn.response || {};
      const answer = response.answer || {};
      lines.push('', `### 第 ${index + 1} 轮：${turn.question}`, '', answer.summary || answer.reply || response.understanding || '本轮未返回文字结论。');
      if (answer.lessonPlan?.length) lines.push('', '**课堂流程**', ...answer.lessonPlan.map((step, stepIndex) => `${stepIndex + 1}. ${step.title || '课堂环节'}：${step.content || ''}`));
      const citations = Array.isArray(response.citations) ? response.citations.slice(0, 8) : [];
      if (citations.length) lines.push('', '**教材依据**', ...citations.map(item => `- ${docName(item.documentId)} · 第${item.pdfPage}页：${citationText(item)}`));
    });
    if (evidenceShelf.length) lines.push('', '## 本课依据夹', ...evidenceShelf.map(item => `- ${docName(item.documentId)} · 第${item.pdfPage}页${item.printedPage ? `（书页 ${item.printedPage}）` : ''}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `活教参-${title.replace(/[《》]/gu, '')}-备课记录.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const startNewConversation = () => {
    if (typeof window !== 'undefined' && messages.length && !window.confirm('另起一场备课会保留当前草稿，但会清空本页对话。是否继续？')) return;
    clearConversationSnapshot(session?.user?.id || initialUser);
    setMessages([]); setConversationHistory([]); setExistingDraft(null); setDraftId(''); setQuestion(''); setPlanQuestion(''); setLessonRef(null); setRestoredAt(''); setRestoredFromLocal(false);
    const url = new URL(location.href);
    // Keep the current draft addressable in the account history. The `new`
    // marker explicitly prevents the browser-local active snapshot and any
    // auth hand-off from silently reopening the previous thread.
    url.search = '?new=1';
    history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  const askReaderReturn = draftId ? `/ask/?draftId=${encodeURIComponent(draftId)}` : 'ask';
  const emptyState = !busy && messages.length === 0 ? (
    <div className="ask-empty">
      <Sparkles/>
      <h2>从一个真实备课问题开始</h2>
      <p>{!aiReady ? '正在检查教材与 AI 服务…' : !session ? (gatewayAvailable ? UI_COPY.ask.loginReady : UI_COPY.ask.noProvider) : keyId ? UI_COPY.ask.personalReady : gatewayAvailable ? UI_COPY.ask.ready : UI_COPY.ask.noProvider}</p>
      <div className="ask-suggestions">
        {EXAMPLES.concat(['我怎么备课《沁园春·雪》']).map(item => (
          <button disabled={busy || askBlocked} onClick={() => ask(null, item)} key={item}>
            {item}<ArrowRight/>
          </button>
        ))}
      </div>
    </div>
  ) : null;
  const conversationState = messages.length > 0 ? (
    <>
      <div className="conversation-continuity">
        <Sparkles size={16}/>
        <span>这是同一场备课对话。下一次提问会沿用当前篇目、教材范围和已核验内容；需要时会继续查找更具体的教材页面。</span>
        <button type="button" onClick={focusComposer}>继续追问</button>
      </div>
      <div className="conversation-list">
        {messages.map((turn, index) => (
          <ConversationTurn key={`${turn.question}-${index}`} turn={turn} draftId={draftId} onQuickAsk={value => ask(null, value)} onSaveEvidence={saveEvidence}/>
        ))}
      </div>
    </>
  ) : null;
  return (
    <div className="view-stack ask-page">
      <section className="hero compact-hero">
        <div>
          <Badge tone="green"><MessageCircle/> 备课问答</Badge>
          <h1>{UI_COPY.ask.title}<br/>{UI_COPY.ask.subtitle}</h1>
          <p>{UI_COPY.ask.description}</p>
          <div className="hero-actions"><a href={askLibraryHref}><ArrowLeft/>{params.get('doc') ? '返回刚才的教材页' : '返回教材库'}</a></div>
        </div>
        <div className="scope-switch">
          {[['all','课标·学生教材·教师用书'],['both','学生教材·教师用书'],['textbook','只查学生教材'],['teacher-guide','只查教师用书'],['curriculum-standard','只查课程标准']].map(([id, label]) => (
            <button type="button" className={scope === id ? 'active' : ''} onClick={() => setScope(id)} key={id}>{label}</button>
          ))}
        </div>
      </section>
      {isClassAdaptation && <section className="ask-adaptation-entry" role="status"><CheckCircle2/><div><span>已建立独立的班级版本</span><b>{existingDraft?.answer?.classAdaptation?.targetClassName || existingDraft?.lesson_context?.className || '目标班级'}将沿用当前篇目、教材页码和原方案</b><p>先核对班级情况，再在下方提出要调整的具体问题。系统不会自动改写方案，也不会清空原有三卡。</p></div>{draftId && <a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>先查看复制结果 <ArrowRight/></a>}</section>}
      {lessonContext.unitRef && <section className="ask-unit-strip"><Network/><div><span>{lessonContext.unitRef.title}</span><b>第 {(lessonRef?.lessonIndex ?? 0) + 1}{lessonRef?.lessonTotal ? ` / ${lessonRef.lessonTotal}` : ''} 课 · {lessonRef?.title || '当前篇目'}</b><p>本课拥有独立教材依据和问答；课后记录可以安全交给轨道中的下一篇。</p></div><a href={`/unit/?doc=${encodeURIComponent(lessonContext.unitRef.documentId)}&unit=${encodeURIComponent(lessonContext.unitRef.nodeId)}`}>返回单元轨道 <ArrowRight/></a></section>}
      {priorReflection && <section className="prior-reflection-banner"><History/><div><span>上一课记录已带入</span><b>{priorReflectionForm.nextStep || priorReflectionForm.unfinishedQuestions || '复备时将参考上一课的课堂表现'}</b><p>这部分来自教师课后记录，只用于调整课堂组织；教材结论仍以学生教材和教师用书为准。</p></div><a href={`/reflection/?draftId=${encodeURIComponent(priorReflection.sourceDraftId || draftId)}`}>查看原记录</a></section>}
      {priorCarryover.items.length > 0 && <section className={`prior-carryover-panel ${priorCarryover.status}`}><header><div><span>上一课待接事项</span><h2>{priorCarryover.status === 'completed' ? '上一课留下的问题已经全部处理' : `还有 ${priorCarryover.items.filter(item => item.status !== 'done').length} 项需要在本课接住`}</h2><p>这些事项由教师在上一课复盘时明确选择，不属于教材结论。处理时仍要回到本课学生教材与教师用书。</p></div><Badge tone={priorCarryover.status === 'completed' ? 'green' : 'orange'}>{priorCarryover.status === 'completed' ? '已完成' : '课堂待办'}</Badge></header><div>{priorCarryover.items.map(item => <button type="button" key={item.sourceMomentId} className={item.status === 'done' ? 'done' : ''} disabled={Boolean(carryoverWorking)} onClick={() => updateCarryover(item)}><span>{item.status === 'done' ? <CheckCircle2/> : <span className="carryover-checkbox"/>}</span><b>{item.text}</b><small>{carryoverWorking === item.sourceMomentId ? '正在保存…' : item.status === 'done' ? '已在本课处理，点击可撤回' : '处理后点一下完成'}</small></button>)}</div></section>}
      {priorLearningSummary?.itemCount > 0 && <section className="prior-learning-banner"><ClipboardCheck/><div><span>上一课作业回流</span><b>{priorLearningSummary.itemCount} 道任务，单题最多 {priorLearningSummary.submittedCount} 份；按题累计：完整 {priorLearningSummary.counts?.secure || 0}，部分 {priorLearningSummary.counts?.partial || 0}，尚未达成 {priorLearningSummary.counts?.not_yet || 0}</b><p>这是教师确认的班级聚合学情，只解释“为什么调整”；本课在哪里落实，仍要重新查找学生教材和教师用书。</p></div><a href={`/learning/?draftId=${encodeURIComponent(priorLearning.sourceDraftId || draftId)}`}>查看汇总</a></section>}
      {currentDeliberation && <section className="prior-deliberation-banner"><Route/><div><span>本课备课取舍已确认</span><b>{currentDeliberation.decisions.map(item => item.options.find(option => option.id === item.selectedOptionId)?.label).filter(Boolean).join(' · ')}</b><p>后续问答会遵守这些教师决定；教材结论仍只来自当前学生教材和教师用书。</p></div><a href={`/deliberation/?draftId=${encodeURIComponent(draftId)}`}>查看取舍</a></section>}
      <section className="panel lesson-context">
        <div className="lesson-context-heading">
          <div><span>备课条件</span><b>先确定课堂的边界，再生成方案</b></div>
          <small>这些选择会影响课堂流程、问题难度和评价方式</small>
        </div>
        <div className="context-controls">
          <ContextSelect label="课时" value={String(lessonContext.periods)} onChange={e => setLessonContext(x => ({ ...x, periods: Number(e.target.value) }))} options={[{value:'1', label:'1 课时'}, {value:'2', label:'2 课时'}]} hint="课堂长度"/>
          <ContextText label="任教班级" value={lessonContext.className || ''} onChange={e => setLessonContext(x => ({ ...x, className: e.target.value }))} placeholder="例如：九年级 3 班" hint="只记录班级名称"/>
          <ContextSelect label="班级水平" value={lessonContext.classLevel} onChange={e => setLessonContext(x => ({ ...x, classLevel: e.target.value }))} options={['基础','普通','较强'].map(value => ({value, label: value}))} hint="学生起点"/>
          <ContextSelect label="教学目标" value={lessonContext.teachingGoal} onChange={e => setLessonContext(x => ({ ...x, teachingGoal: e.target.value }))} options={['理解文本','朗读训练','写作迁移'].map(value => ({value, label: value}))} hint="本课主线"/>
          <ContextSelect label="教学方式" value={lessonContext.teachingMode} onChange={e => setLessonContext(x => ({ ...x, teachingMode: e.target.value }))} options={['讲授','探究','小组合作'].map(value => ({value, label: value}))} hint="课堂组织"/>
          <ContextSelect label="AI 来源" value={keyId} onChange={e => setKeyId(e.target.value)} options={[{value:'', label: gatewayAvailable ? UI_COPY.provider.systemGateway : '暂无可用 AI'}, ...keys.map(key => ({value:key.id, label:`我的智能连接（${key.keyHint}）`}))]} hint={!aiReady ? '正在检查 AI 服务' : keyId ? '我的智能连接' : gatewayAvailable ? '系统智能' : '请稍后重试'}/>
        </div>
        {selectedClassProfile && <div className="class-memory-strip"><History/><div><span>已接上 {selectedClassProfile.className} 的教学记录</span><b>{selectedClassProfile.nextFocus || selectedClassProfile.confirmedObservation || '此前课堂已经留下教师确认的班级事实。'}</b><p>来自 {selectedClassProfile.lessonCount} 节已保存课程；只影响课堂组织，不会替代当前教材与教师用书依据。</p></div><a href={`/ask/?draftId=${encodeURIComponent(selectedClassProfile.latestDraftId)}`}>查看最近一课</a></div>}
        {contextChanged && <div className="context-recompute"><div><b>备课条件已变化</b><p>当前方案仍按上一组条件生成。重新整理后，会同步调整课堂流程、问题链、评价和三张卡；已锁定的卡片不会被覆盖。</p></div><button type="button" className="primary" disabled={busy || askBlocked} onClick={() => ask(null, { prompt: '请根据当前备课条件重新整理完整课堂方案。保持当前篇目与核心问题不变；先核对教师用书的教学建议，再回到学生教材核对原文，并结合当前班情取舍。请同步更新课堂流程、问题链、评价和未锁定的三张卡。', operation: { type: 'recompute_plan' } })}>重新整理本方案</button></div>}
      </section>
      <DualSourceEvidenceDesk title={pairedLessonTitle} evidence={pairedEvidence} busy={pairedEvidenceBusy} error={pairedEvidenceError} onSave={saveEvidence} returnTo={askReaderReturn}/>
      <div className="ask-layout">
        <section className="panel ask-main">
          <form className="ask-large" onSubmit={ask}>
            <MessageCircle/>
            <textarea ref={composerRef} value={question} onChange={event => setQuestion(event.target.value)} placeholder={messages.length ? '继续追问，例如：教师用书建议对应学生教材哪一段？' : '例如：怎样备课《沁园春·雪》？'}/>
            <button className="primary" disabled={busy || !question.trim() || askBlocked}><Send/>{askButtonLabel}</button>
          </form>
          {!session && <div className="ask-auth-note"><ShieldCheck/><span>公共教材可以浏览；登录后才能发起连续问答、保存方案和生成三卡。</span><a href={loginHref} onClick={rememberCurrentAsk}>立即登录</a></div>}
          {session && !canAsk && aiReady && <div className="ask-auth-note"><CircleAlert/><span>当前没有可用的 AI 连接。可以先在 AI 设置中添加或测试连接。</span><a href="/settings/">打开 AI 设置</a></div>}
          {error && <div className="ask-error"><CircleAlert/><span>{error}</span></div>}
          {error && recovery && <div className="ask-recovery"><div className="ask-recovery-copy"><b>{UI_COPY.recovery.title}</b><p>{UI_COPY.recovery.body}</p></div><div className="ask-recovery-actions"><button onClick={() => ask(null, retryableTarget)} disabled={busy || askBlocked}>{UI_COPY.recovery.retry}</button><button onClick={() => { setScope(alternateScope); ask(null, retryableTarget, { scope: alternateScope }); }} disabled={busy || askBlocked}>{UI_COPY.recovery.switchBook}</button><a href="/validation/">{UI_COPY.recovery.status}</a><button onClick={() => ask(null, retryableTarget, { retrievalMode: 'stable_snapshot' })} disabled={busy || askBlocked}>{UI_COPY.recovery.snapshot}</button><a href={askLibraryHref}>返回教材库核对</a></div></div>}
          {busy && <div className="answer-loading"><span/><span/><span/><p>{UI_COPY.ask.loading}</p></div>}
          {emptyState}
          {conversationState}
        </section>
        <ConversationSide messages={messages} history={conversationHistory} lessonTitle={lessonRef?.title || (planQuestion ? planIdentity(planQuestion, '') : '')} scope={scope} lessonContext={lessonContext} existingDraft={existingDraft} draftId={draftId} restoredAt={restoredAt} restoredFromLocal={restoredFromLocal} recentDrafts={recentDrafts} localSessions={localSessions} onContinue={focusComposer} onQuickAsk={value => ask(null, value)} onNewConversation={startNewConversation} onExportConversation={exportConversation} shelf={evidenceShelf} onRemoveShelf={removeShelfItem} onClearShelf={() => setEvidenceShelf([])} readerReturnTo={askReaderReturn}/>
      </div>
    </div>
  );
}

function IngestPage() {
  const [file,setFile]=useState(null),[step,setStep]=useState(1),[kind,setKind]=useState('teacher_guide'),[policy,setPolicy]=useState('auto'),[working,setWorking]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null);
  const displayFile=file;
  const preflight=()=>{
    setError('');
    if(!file) { setError('请先选择一个真实的 PDF 文件。'); return; }
    if((file.type && file.type!=='application/pdf') || !file.name.toLowerCase().endsWith('.pdf')) { setError('请选择 PDF 文件。'); return; }
    setStep(2);
  };
  const createTask=async()=>{
    if(working)return;
    setWorking(true);setError('');setCreated(null);
    try{
      if(!file)throw new Error('pdf_file_required');
      const title=file.name.replace(/\.pdf$/i,'');
      const registered=await uploadPdf(file,{documentType:kind,title,extractionPolicy:policy});
      const documentId=registered?.upload?.documentId||registered?.registration?.document?.id||registered?.document?.id||registered?.documentId||registered?.id;
      if(!documentId)throw new Error('document_id_missing');
      const indexing=registered?.indexing||{};
      if(indexing.status==='failed')throw new Error(indexing.error||'indexing_failed');
      if(indexing.status==='deferred')throw new Error(indexing.reason||'indexing_failed');
      let jobId=indexing.jobId||indexing.id;
      if(!jobId){
        const job=await request(`/documents/${encodeURIComponent(documentId)}/build`,{method:'POST',body:{extractionPolicy:policy,documentType:kind}});
        jobId=job?.jobId||job?.id;
      }
      if(!jobId)throw new Error('job_id_missing');
      setCreated({documentId,jobId});setStep(4);
      location.assign(`/jobs/?jobId=${encodeURIComponent(jobId)}&documentId=${encodeURIComponent(documentId)}&doc=${encodeURIComponent(kind==='teacher_guide'?'teacher-guide':kind)}`);
    }catch(err){setError(`创建索引任务失败：${ingestErrorMessage(err.message)}`)}finally{setWorking(false)}
  };
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Upload/> 教材导入向导</Badge><h1>原始文件不可变保存，<br/>页面内容按教材页码逐页处理</h1><p>扫描 PDF、页面文字 PDF 和混合 PDF 都可导入；公开界面始终展示原始教材页面。</p></div><div className="wizard-steps">{['选择文件','文档预检','确认策略','创建任务'].map((x,i)=><span className={step>i?'active':''} key={x}><b>{i+1}</b>{x}</span>)}</div></section>
    {error&&<div className="ask-error"><CircleAlert/>{error}</div>}
    {step===1?<section className="panel upload-panel"><label className="dropzone"><Upload/><h2>拖入 PDF，或点击选择文件</h2><p>支持页面文字、扫描页与混合文档。原始教材不会被解析结果覆盖。</p><input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/><span>{file?file.name:'选择 PDF 文件'}</span></label><button className="primary wide-action" onClick={preflight} disabled={!file}>检查当前文件</button></section>:<><section className="panel"><SectionHead icon={FileCheck2} eyebrow="文档预检" title={displayFile.name} note="当前页面先检查文件；提交后会逐页读取内容并建立目录。"/><div className="preflight-grid"><Stat icon={FileText} label="文件大小" value={`${(displayFile.size/1024/1024).toFixed(1)} MB`} note="登记后由服务端计算 SHA-256"/><Stat icon={BookOpen} label="预计页数" value="提交后读取" note="教材页码由解析任务确认"/><Stat icon={FileSearch} label="页面文字" value="逐页检查" note="质量合格时直接使用" tone="green"/><Stat icon={Eye} label="扫描页面" value="自动判断" note="只识别缺失或质量不足的页面" tone="gold"/></div><div className="preview-strip">{['起始页','中段页','末页'].map(label=><div key={label}><div className="preview-paper"><FileText/><span>原始教材<br/>{label}</span></div><b>任务完成后可核验</b></div>)}</div></section><section className="panel confirm-grid"><div><label>文档分类</label><select value={kind} onChange={e=>setKind(e.target.value)}><option value="textbook">学生教材</option><option value="teacher_guide">教师教学用书</option><option value="other">其他教学资料</option></select></div><div><label>提取策略</label><select value={policy} onChange={e=>setPolicy(e.target.value)}><option value="auto">自动判断（推荐）</option><option value="native">仅使用页面文字</option><option value="ocr">强制重新识别页面</option></select></div><div className="policy-note"><CheckCircle2/><span><b>教材页码保护</b><small>任何解析和人工修正都不会改变 第几页。</small></span></div><button className="primary" onClick={createTask} disabled={working}>{working?'正在登记并创建任务…':'确认并开始处理'} <ArrowRight/></button>{created&&<small>已开始处理，正在进入进度页面。</small>}</section></>}
  </div>;
}

function JobsPage() {
  const params=useMemo(()=>queryParams(),[]), jobId=params.get('jobId')||params.get('job'), documentId=canonicalDocumentId(params.get('documentId')||params.get('doc'))||'teacher-guide';
  const [job,setJob]=useState(null),[loading,setLoading]=useState(Boolean(jobId)),[error,setError]=useState('');
  const refresh=async(signal)=>{
    if(!jobId)return;
    try{const next=await request(`/status/${encodeURIComponent(jobId)}`,{signal});setJob(next);setError('');return next}catch(err){if(err.name!=='AbortError')setError('暂时无法读取处理状态，请稍后刷新。');return null}finally{setLoading(false)}
  };
  useEffect(()=>{
    if(!jobId)return;
    const controller=new AbortController();let timer;
    const poll=async()=>{const next=await refresh(controller.signal);if(next&&!terminalJob(next.status))timer=setTimeout(poll,1800)};
    poll();return()=>{controller.abort();clearTimeout(timer)};
  },[jobId]);
  const catalogInfo=useCatalogDocument(documentId);
  const info=catalogInfo||{short:docName(documentId),tone:'green',pageCount:0};
  const total=Number(job?.totalPages||info.pageCount||0), processed=Number(job?.processedPages||0), stage=Math.max(0,Number(job?.stage||0)), percent=total?Math.min(100,Math.round(processed/total*100)):0;
  const issues=Array.isArray(job?.issues)?job.issues:Array.isArray(job?.failedPageDetails)?job.failedPageDetails:[];
  if (!jobId) return <div className="view-stack jobs-empty-page"><section className="hero compact-hero"><div><Badge tone="green"><Activity/> 教材处理</Badge><h1>这里查看新教材何时可以开始搜索，<br/>不会在阅读或提问时重复构建。</h1><p>现有教材已经可以直接阅读和搜索。只有导入新的 PDF，或明确选择重新处理页面时，才会在这里创建任务。</p></div></section><section className="panel jobs-empty-card"><div><span className="jobs-empty-icon"><CheckCircle2/></span><h2>暂时没有正在处理的任务</h2><p>可先从教材库选择篇目和原始教材；需要导入新材料时，再创建一次处理任务。</p></div><div><a className="primary" href="/library/"><Library/>进入教材库</a><a href="/ingest/"><Upload/>导入新教材</a></div></section></div>;
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Activity/> 教材处理进度</Badge><h1>{total||'长文档'} 页任务持续反馈进度，<br/>单页失败不让整本作废</h1><p>教材在后台逐页处理；本页会持续读取真实进度，不会因为单页异常让整本教材失效。</p></div><div className="job-summary"><b>{percent}%</b><span>已处理 {processed} / {total||'—'} 页</span><small>状态：{loading?'正在读取…':statusLabel(job?.status)}</small></div></section>{error&&<div className="ask-error"><CircleAlert/>{error}</div>}{!jobId&&<div className="ask-error"><CircleAlert/>当前页面还没有对应的处理任务。请从“导入教材”开始，或返回教材库选择已准备好的材料。</div>}<section className="panel"><SectionHead icon={Route} eyebrow="七阶段任务" title={`${info.short} · ${job?.options?.extractionPolicy||'自动判断'}策略`} action={<a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=1`}>查看页面处理结果 <ArrowRight/></a>}/><div className="job-stage-list">{JOB_STAGES.map((name,i)=>{const number=i+1,done=number<stage||(number===stage&&terminalJob(job?.status)),active=number===stage&&!terminalJob(job?.status);return <article className={done?'done':active?'active':''} key={name}><span>{done?<Check/>:number}</span><div><b>{name}</b><small>{done?'已完成':active?`正在执行：${job?.stageName||name}`:'等待前序阶段'}</small></div>{done&&<Badge tone="green">通过</Badge>}</article>})}</div></section><div className="two-col"><section className="panel"><SectionHead icon={Activity} eyebrow="页面统计" title="处理结果"/><div className="mini-stats"><div><b>{Number(job?.successPages||0)}</b><small>正常页</small></div><div><b>{Number(job?.warningPages||0)}</b><small>需检查</small></div><div><b>{Number(job?.failedPages||0)}</b><small>失败页</small></div><div><b>{job?.elapsed||job?.elapsedTime||'—'}</b><small>已耗时</small></div></div><div className="progress-bar"><i style={{width:`${percent}%`}}/></div><p className="muted">失败页应从回答和三卡生成中排除，其余有效页面保持可搜索。</p></section><section className="panel"><SectionHead icon={CircleAlert} eyebrow="需要检查" title="异常页面"/><div className="issue-list">{issues.length?issues.map((issue,i)=>{const p=Number(issue.page||issue.pdfPage||issue.pageNumber||1);return <a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=${p}`} key={`${p}-${i}`}><Badge tone="orange">PDF {p}</Badge><span>{issue.message||issue.error||'需要人工检查'}</span><ChevronRight/></a>}):<p className="muted">{job?'暂时没有返回需要核对的页面。':'正在等待处理状态。'}</p>}</div><div className="retry-actions"><button onClick={()=>refresh()} disabled={!jobId||loading}><RefreshCw/>{loading?'读取中':'刷新任务状态'}</button><a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=1`}>前往页面检查</a></div></section></div></div>;
}

function InspectPage() {
  const params=useMemo(()=>queryParams(),[]), doc=canonicalDocumentId(params.get('documentId')||params.get('doc'))||'teacher-guide';
  const [page,setPage]=useState(Math.max(1,Number(params.get('page'))||1)),[source,setSource]=useState('retrieval'),[record,setRecord]=useState(null),[retrievalText,setRetrievalText]=useState(''),[included,setIncluded]=useState(true),[title,setTitle]=useState(''),[printedPage,setPrintedPage]=useState(''),[sectionPath,setSectionPath]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[rerunning,setRerunning]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const catalogInfo=useCatalogDocument(doc);
  const info=catalogInfo||{short:docName(doc),tone:'green',pdfUrl:''};
  const applyPage=data=>{const next=data?.page||data;setRecord(next);setSource(next?.selectedTextSource||next?.textSource||'retrieval');setRetrievalText(pageText(next,'retrieval'));setIncluded(next?.includeInIndex!==false);setTitle(next?.pageTitle||next?.title||'');setPrintedPage(String(next?.printedPageLabel??next?.printedPage??''));setSectionPath(Array.isArray(next?.sectionPath)?next.sectionPath.join(' › '):String(next?.sectionPath||''));};
  const loadPage=async(target=page,signal)=>{setLoading(true);setError('');try{const data=await request(`/page/${encodeURIComponent(doc)}/${target}`,{signal});applyPage(data)}catch(err){if(err.name!=='AbortError')setError(`暂时无法读取第 ${target} 页，请稍后重试。`)}finally{setLoading(false)}};
  useEffect(()=>{const controller=new AbortController();history.replaceState(null,'',`/inspect/?doc=${encodeURIComponent(doc)}&page=${page}`);loadPage(page,controller.signal);return()=>controller.abort()},[doc,page]);
  const save=async()=>{if(saving)return;setSaving(true);setError('');setNotice('');try{const data=await request(`/documents/${encodeURIComponent(doc)}/pages/${page}`,{method:'PATCH',body:{pageTitle:title,printedPageLabel:printedPage,sectionPath:sectionPath.split(/\s*[›>/]\s*/).filter(Boolean),retrievalText,includeInIndex:included}});applyPage(data);setNotice('页面调整已保存；原始教材和教材页码保持不变。')}catch(err){setError('暂时无法保存页面调整，请稍后重试。')}finally{setSaving(false)}};
  const rerun=async()=>{if(rerunning)return;setRerunning(true);setError('');setNotice('');try{await request(`/documents/${encodeURIComponent(doc)}/pages/rerun`,{method:'POST',body:{pages:[page],extractionPolicy:'auto'}});setNotice('已安排重新读取当前页；完成后会更新搜索文字和质量状态。');await loadPage(page)}catch(err){setError('暂时无法重新读取当前页，请稍后重试。')}finally{setRerunning(false)}};
  const shownText=source==='retrieval'?retrievalText:pageText(record,source);
  const activeSource=record?.selectedTextSource||record?.textSource||source;
  const sourceName=activeSource==='ocr'
    ? `页面识别${record?.ocrProvider ? `（${record.ocrProvider === 'paddleocr' ? 'PaddleOCR' : record.ocrProvider}）` : ''}`
    : activeSource==='native'
      ? 'PDF 原生文字层（未重复识别）'
      : activeSource==='merged' ? '原生文字与页面识别组合' : '暂无可用文字';
  const ocrText=pageText(record,'ocr');
  const ocrNote=record?.ocrError
    ? `页面识别未完成：${record.ocrError === 'ocr_unavailable' ? 'OCR 服务未安装或未启动' : record.ocrError === 'ocr_input_missing' ? '没有可供识别的页面图像' : '识别服务返回失败'}`
    : ocrText ? `页面识别已完成${record?.ocrModel ? ` · ${record.ocrModel}` : ''}${record?.ocrConfidence != null ? ` · 置信度 ${(Number(record.ocrConfidence) * 100).toFixed(0)}%` : ''}`
      : '本页已有可用原生文字层，未重复进行页面识别。';
  const rawPdfUrl=String(record?.viewer?.pdfUrl||record?.pdfUrl||info.pdfUrl||'').split('#')[0];
  return <div className="view-stack"><section className="panel inspect-toolbar"><div><Badge tone={info.tone}>{info.short}</Badge><h1>页面校正</h1><p>原始教材不可修改；这里只调整用于搜索的页面文字、标题、章节和书页码。</p></div><div><button onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button><input value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/><button onClick={()=>setPage(p=>p+1)}>下一页</button><a href={`/document/?doc=${encodeURIComponent(doc)}&page=${page}`}>核验原页 <ExternalLink/></a></div></section>{error&&<div className="ask-error"><CircleAlert/>{error}</div>}{notice&&<div className="quality-box"><CheckCircle2/>{notice}</div>}<div className="inspect-layout"><section className="panel original-preview"><header><b>原始教材· 教材页码 {page}</b><Badge tone="green">唯一可核验的依据</Badge></header>{rawPdfUrl?<iframe key={`${doc}-${page}`} title="原始教材页面" src={pdfPageUrl(rawPdfUrl,page)}/>:<div className="index-empty"><FileText/><b>正在读取原始教材</b><p>页面信息加载后会在这里显示对应原页。</p></div>}</section><section className="panel extraction-editor"><SectionHead icon={FileSearch} eyebrow="用于教材搜索的文字" title={loading?'正在读取页面…':'当前生效文字'}/><div className="source-tabs"><button className={source==='native'?'active':''} onClick={()=>setSource('native')}>页面文字</button><button className={source==='ocr'?'active':''} onClick={()=>setSource('ocr')}>扫描页文字</button><button className={source==='retrieval'?'active':''} onClick={()=>setSource('retrieval')}>当前生效文字</button></div><p className="inspect-source-note">{ocrNote}</p><textarea value={shownText} readOnly={source!=='retrieval'} onChange={e=>setRetrievalText(e.target.value)} placeholder={loading?'正在加载…':source==='ocr'&&!ocrText?'本页没有页面识别文字':'该文本来源暂无内容'}/><div className="editor-fields"><label>页面标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>书页码<input value={printedPage} onChange={e=>setPrintedPage(e.target.value)}/></label><label>章节路径<input value={sectionPath} onChange={e=>setSectionPath(e.target.value)}/></label></div><div className="quality-box"><CheckCircle2/><span><b>质量状态：{record?.textQualityStatus||record?.qualityStatus||'待读取'}</b><small>页面文字来源：{sourceName} · 教材页码 {page} 保持不变</small></span></div><div className="editor-actions"><label><input type="checkbox" checked={included} onChange={e=>setIncluded(e.target.checked)}/>纳入教材搜索</label><button onClick={rerun} disabled={rerunning||loading}><RefreshCw/>{rerunning?'正在创建任务':'重新读取当前页'}</button><button className="primary" onClick={save} disabled={saving||loading}>{saving?'正在保存':'保存页面调整'}</button></div></section></div></div>;
}

const VALIDATION_QUESTIONS = [
  ['《我爱这土地》第二节为什么不能删', '学生教材与教师用书相关页'],
  ['第一单元三项任务之间是什么关系', '第一单元任务设计'],
  ['《我爱这土地》的教学重点和依据', '教师用书教学建议'],
  ['朗读的重音和节奏建议来自哪里', '朗读教学建议'],
  ['某项练习如何处理', '练习处理建议'],
  ['单元目标和篇目目标有什么关系', '单元与篇目目标'],
  ['教师用书如何说明诗歌意象', '诗歌意象教学'],
  ['《乡愁》的教学入口是什么', '篇目教学入口'],
  ['诗歌朗诵任务如何评价', '朗诵评价建议'],
  ['尝试创作任务如何承接鉴赏学习', '鉴赏与创作任务关系']
];

function questionResult(validation, question) {
  const items = validation?.questionResults || validation?.questions || [];
  const result = items.find(item => item.question === question) || null;
  if (!result || result.hit || !result.hits?.length) return result;
  const hit = result.hits[0];
  return {
    ...result,
    evidenceSufficient: Boolean(result.passed),
    hit: {
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      documentType: hit.documentType,
      pdfPage: hit.pdfPage,
      printedPage: hit.printedPage,
      sectionPath: hit.sectionPath,
      text: hit.text || '',
      viewer: hit.viewer
    }
  };
}

function questionState(result) {
  if (!result) return { label: '未运行', tone: 'neutral' };
  return result.passed ? { label: '已定位', tone: 'green' } : { label: '需检查', tone: 'orange' };
}

function ValidationPage() {
  const params = useMemo(() => queryParams(), []);
  const documentId = canonicalDocumentId(params.get('documentId') || params.get('doc')) || 'teacher-guide';
  const [selected, setSelected] = useState(0);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const loadValidation = async signal => {
    setLoading(true);
    try {
      const data = await request(`/documents/${encodeURIComponent(documentId)}/validation`, { signal });
      setValidation(data);
      setError('');
      return data;
    } catch (err) {
      if (err.name !== 'AbortError') setError('暂时无法读取教材质量检查结果，请稍后重试。');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadValidation(controller.signal);
    return () => controller.abort();
  }, [documentId]);

  const startValidation = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      await request(`/documents/${encodeURIComponent(documentId)}/validate`, {
        method: 'POST',
        body: { questions: VALIDATION_QUESTIONS.map(([question]) => question) }
      });
      await loadValidation();
    } catch (err) {
      setError('暂时无法启动教材质量检查，请稍后重试。');
    } finally {
      setRunning(false);
    }
  };

  const localValidation = validation?.local
    || (validation?.providerKind === 'local' ? validation : null);
  const pageIndexValidation = validation?.pageindex
    || validation?.shadow
    || (validation?.providerKind === 'pageindex' ? validation : null)
    || (validation?.provider === 'pageindex' ? validation : null)
    // The service report is intentionally provider-neutral and exposes its
    // question results as `questions`. Treat that production response as the
    // active index report instead of rendering the old empty comparison state.
    || (Array.isArray(validation?.questions) ? validation : null);
  const activeQuestion = VALIDATION_QUESTIONS[selected][0];
  const localResult = questionResult(localValidation, activeQuestion);
  const pageIndexResult = questionResult(pageIndexValidation, activeQuestion);
  const currentValidation = pageIndexValidation || localValidation;
  const currentQuestions = currentValidation?.questionResults || currentValidation?.questions || [];
  const passed = currentQuestions.filter(item => item.passed).length;
  const total = currentQuestions.length;

  return <div className="view-stack">
    <section className="hero compact-hero">
      <div>
        <Badge tone="blue"><ClipboardCheck/> 教材质量检查</Badge>
        <h1>确认篇目、页码与引用，<br/>让每次回答都能回到原始教材</h1>
        <p>逐题检查教材目录的真实定位结果、教材页码和引用片段；检查未通过的页面不会被当作可靠依据。</p>
        <button className="primary" onClick={startValidation} disabled={running}>
          {running ? '正在检查教材…' : '重新检查教材质量'}
        </button>
      </div>
      <div className="validation-score">
        <b>{total ? `${passed} / ${total}` : '—'}</b>
        <span>{loading ? '正在读取检查结果' : `当前状态：${statusLabel(currentValidation?.status || 'not_run')}`}</span>
        <small>当前文档：{docName(documentId)}</small>
      </div>
    </section>

    {error && <div className="ask-error"><CircleAlert/>{error}</div>}

    <div className="validation-layout">
      <aside className="panel question-set">
        <SectionHead icon={Target} eyebrow="关键问题检查" title="教材质量问题"/>
        <div>{VALIDATION_QUESTIONS.map(([question, expected], index) => {
          const state = questionState(questionResult(currentValidation, question));
          return <button className={selected === index ? 'active' : ''} onClick={() => setSelected(index)} key={question}>
            <span>{index + 1}</span>
            <div><b>{question}</b><small>预期依据：{expected}</small></div>
            <Badge tone={state.tone}>{state.label}</Badge>
          </button>;
        })}</div>
      </aside>

      <section className="compare-grid">
        <ProviderResult
          title="教材目录"
          time={currentValidation?.checkedAt ? new Date(currentValidation.checkedAt).toLocaleString() : '尚未运行'}
          tone="blue"
          question={activeQuestion}
          result={pageIndexResult || localResult}
          status={currentValidation?.status || 'not_run'}
          providerState={currentValidation ? '已运行' : '未运行'}
        />
      </section>
    </div>
  </div>;
}

function ProviderResult({ title, time, tone, question, result, status, providerState }) {
  const state = questionState(result);
  const hit = result?.hit || null;
  const typeLabel = hit?.documentType === 'textbook' ? '学生教材' : hit?.documentType === 'teacher_guide' ? '教师用书' : '教学资料';
  const section = Array.isArray(hit?.sectionPath) ? hit.sectionPath.join(' › ') : String(hit?.sectionPath || '未标注章节');
  const openHref = hit ? citationLink(hit, 'validation') : '';

  return <article className="panel provider-result">
    <header><Badge tone={tone}>{title}</Badge><span>{time}</span></header>
    <div className="provider-question">
      <div><small>当前问题</small><h3>{question}</h3></div>
      <Badge tone={state.tone}>{result ? state.label : providerState}</Badge>
    </div>
    {hit ? <>
      <div className="provider-hit-meta">
        <span><small>命中文档</small><b>{hit.documentTitle || typeLabel}</b></span>
        <span><small>来源</small><b>{typeLabel}</b></span>
        <span><small>教材页码</small><b>{hit.pdfPage}</b></span>
        <span><small>书页</small><b>{hit.printedPage || '未标注'}</b></span>
        <span><small>章节路径</small><b>{section}</b></span>
        <span><small>定位状态</small><b>已定位原始页</b></span>
      </div>
      <blockquote>{hit.text || '暂时没有可展示的页面片段。'}</blockquote>
      <a className="provider-open" href={openHref}>打开原始教材核验 <ExternalLink/></a>
    </> : <div className="evidence-missing">
      <CircleAlert/>
      <div><b>{providerState}</b><small>{status === 'ready' ? '验证已完成，但当前问题没有返回可核验的定位结果。' : '尚无该问题的真实定位结果，不展示推测页码。'}</small></div>
    </div>}
  </article>;
}

function DocumentPage() {
  const params = useMemo(() => queryParams(), []);
  const doc = canonicalDocumentId(params.get('doc')) || '';
  const nodeId = params.get('node') || '';
  const [catalog, setCatalog] = useState([]);
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState('evidence');
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState(false);
  const [paired, setPaired] = useState(params.get('paired') === '1');
  const [pairedResult, setPairedResult] = useState(null);
  const [pairedLoading, setPairedLoading] = useState(false);
  const [pairedError, setPairedError] = useState('');
  const [pairedPdfError, setPairedPdfError] = useState(false);
  const [pairedRetry, setPairedRetry] = useState(0);
  const [focusInput, setFocusInput] = useState(() => String(params.get('focus') || '').trim());
  const [pairedFocus, setPairedFocus] = useState(() => String(params.get('focus') || '').trim());
  const [teachingCardNotice, setTeachingCardNotice] = useState('');
  const frame = useRef(null);

  const info = catalog.find(item => item.id === doc) || null;
  const maxPage = info?.pageCount || 1;
  const counterpartId = pairedDocumentId(doc);
  const explicitLesson = String(params.get('lesson') || '').trim();
  const lessonQuery = pairedLessonQuery({
    explicitTitle: explicitLesson,
    sectionPath: record?.sectionPath,
    pageTitle: record?.pageTitle || record?.title
  });
  const pairedSearchQuery = pairedFocusQuery({ lessonTitle: lessonQuery, focus: pairedFocus });

  useEffect(() => {
    request('/documents').then(data => setCatalog((data.documents || []).map(normalizeCatalogItem).filter(Boolean))).catch(() => {});
  }, []);
  useEffect(() => {
    if (info) setPage(value => Math.min(info.pageCount || 1, Math.max(1, value)));
  }, [info?.id, info?.pageCount]);
  useEffect(() => {
    if (!doc) return undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    request(`/page/${encodeURIComponent(doc)}/${page}`, { signal: controller.signal })
      .then(data => setRecord(data?.page || data || null))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setRecord(null);
          setError(`第 ${page} 页暂时没有可读取的页面信息。`);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [doc, page]);
  useEffect(() => {
    if (!paired || !counterpartId || !pairedSearchQuery) {
      setPairedResult(null); setPairedError(''); setPairedLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setPairedLoading(true); setPairedError(''); setPairedResult(null); setPairedPdfError(false);
    request('/search', {
      method: 'POST', signal: controller.signal,
      body: { query: pairedSearchQuery, scope: [counterpartId], limit: 8 }
    }).then(data => {
      const results = (Array.isArray(data?.results) ? data.results : []).map(item => ({
        ...item,
        documentId: searchResultDocumentId(item),
        documentType: canonicalDocumentId(item.documentType || item.document_type || searchResultDocumentId(item)),
        pdfPage: searchResultPage(item)
      }));
      const pair = pairLessonEvidence(results);
      const match = counterpartId === 'teacher-guide' ? pair.teacherGuide : pair.textbook;
      if (!match) throw Object.assign(new Error('paired_page_missing'), { code: 'paired_page_missing' });
      setPairedResult(match);
    }).catch(err => {
      if (err.name !== 'AbortError') setPairedError(requestCode(err) === 'paired_page_missing'
        ? pairedFocus ? '教师用书中暂未直接找到这处句段的对应处理。可以缩短关键词，或回到篇目起点查看整体教学建议。' : '暂时没有找到同篇目的对应原页。可以返回教材目录换一页再试。'
        : '对应材料暂时没有响应，当前原始教材仍可继续阅读。');
    }).finally(() => setPairedLoading(false));
    return () => controller.abort();
  }, [paired, counterpartId, pairedSearchQuery, pairedRetry]);

  const goto = value => {
    const next = Math.max(1, Math.min(maxPage, Number(value) || 1));
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('doc', doc); nextParams.set('page', String(next));
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPage(next); setPdfError(false);
  };
  const togglePaired = () => {
    const next = !paired;
    const nextParams = new URLSearchParams(location.search);
    if (next) {
      nextParams.set('paired', '1');
      if (lessonQuery) nextParams.set('lesson', lessonQuery);
    } else nextParams.delete('paired');
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPaired(next); setPairedError(''); setPairedPdfError(false);
  };
  const applyPairedFocus = event => {
    event?.preventDefault();
    const next = focusInput.replace(/\s+/gu, ' ').trim().slice(0, 100);
    const nextParams = new URLSearchParams(location.search);
    if (next) nextParams.set('focus', next); else nextParams.delete('focus');
    nextParams.set('paired', '1');
    if (lessonQuery) nextParams.set('lesson', lessonQuery);
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPaired(true); setPairedFocus(next); setPairedError(''); setPairedPdfError(false); setTeachingCardNotice('');
  };
  const clearPairedFocus = () => {
    setFocusInput(''); setPairedFocus(''); setPairedError(''); setPairedPdfError(false); setTeachingCardNotice('');
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('focus');
    history.replaceState(null, '', `/document/?${nextParams}`);
  };

  const returnTarget = params.get('return');
  const libraryHref = `/library/?${new URLSearchParams({
    doc,
    page: String(page),
    ...(nodeId ? { node: nodeId } : {}),
    ...(explicitLesson ? { lesson: explicitLesson } : {}),
    ...(params.get('scope') ? { scope: params.get('scope') } : {})
  })}`;
  const readerReturn = resolveReaderReturn(returnTarget, { libraryHref });
  const returnHref = readerReturn.href;
  const returnLabel = readerReturn.label;
  const physicalPage = Number(record?.pdfPage || record?.pageNumber || record?.viewer?.page || page);
  const printedPage = record?.printedPageLabel ?? record?.printedPage ?? '未标注';
  const sectionPath = Array.isArray(record?.sectionPath) ? record.sectionPath.join(' › ') : String(record?.sectionPath || '尚未标注章节');
  const title = record?.pageTitle || record?.title || `第 ${physicalPage} 页`;
  const retrievalText = record?.retrievalText || record?.text || '';
  const textSource = record?.selectedTextSource || record?.textSource || 'none';
  const qualityStatus = record?.textQualityStatus || record?.qualityStatus || 'review';
  const sourceLabel = textSource === 'native' ? '页面文字' : textSource === 'ocr' ? '页面识别文本' : textSource === 'merged' ? '组合文本' : '暂无文本';
  const qualityLabel = qualityStatus === 'normal' ? '正常' : qualityStatus === 'failed' ? '失败' : '需检查';
  const rawPdfUrl = String(record?.viewer?.pdfUrl || record?.pdfUrl || info?.pdfUrl || '').split('#')[0];
  const pdfSrc = buildPdfPageUrl(rawPdfUrl, page, { zoom, view: 'FitH' });
  const pairedPage = searchResultPage(pairedResult);
  const pairedInfo = catalog.find(item => item.id === counterpartId) || null;
  const pairedRawPdfUrl = String(pairedResult?.viewer?.pdfUrl || pairedResult?.viewer_url || pairedResult?.pdfUrl || pairedInfo?.pdfUrl || '').split('#')[0];
  const pairedPdfSrc = buildPdfPageUrl(pairedRawPdfUrl, pairedPage, { zoom, view: 'FitH' });
  const pairedPrintedPage = pairedResult?.printedPage || pairedResult?.printed_page || '未标注';
  const pairedSection = Array.isArray(pairedResult?.sectionPath) ? pairedResult.sectionPath.join(' › ') : String(pairedResult?.sectionPath || lessonQuery || '对应篇目');
  const swapHref = pairedResult ? buildReaderHref({ documentId: counterpartId, page: pairedPage, lessonTitle: lessonQuery, focus: pairedFocus, returnTo: returnTarget || '', paired: true }) : '';
  const dualSourceTeachingCard = buildDualSourceTeachingCard({
    lessonTitle: lessonQuery,
    focus: pairedFocus,
    sources: [
      { documentId: doc, pdfPage: physicalPage, printedPage, title, sectionPath, text: retrievalText },
      { ...(pairedResult || {}), documentId: counterpartId, pdfPage: pairedPage, printedPage: pairedPrintedPage, sectionPath: pairedSection, text: citationText(pairedResult) }
    ]
  });
  const copyTeachingCard = async () => {
    if (!dualSourceTeachingCard) return;
    try {
      await navigator.clipboard.writeText(dualSourceTeachingCard.markdown);
      setTeachingCardNotice('讲解卡已复制，可以粘贴到教案或备课记录。');
    } catch {
      setTeachingCardNotice('浏览器没有允许复制，请使用“下载讲解卡”。');
    }
  };
  const downloadTeachingCard = () => {
    if (!dualSourceTeachingCard) return;
    const url = URL.createObjectURL(new Blob([dualSourceTeachingCard.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = dualSourceTeachingCard.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTeachingCardNotice('讲解卡已下载，原始教材页码已保留。');
  };

  return <div className="view-stack document-page">
    <section className="panel document-head">
      <div><Badge tone={info?.tone || 'green'}>{info?.short || '教材'}</Badge><h1>{record?.documentTitle || info?.title || '教材页面'}</h1><p>第 {physicalPage} 页 · 书页 {printedPage} · {sectionPath}</p></div>
      <div><a href={returnHref}><ArrowLeft/>{returnLabel}</a>{counterpartId && <button type="button" className={paired ? 'paired-active' : ''} onClick={togglePaired} disabled={!lessonQuery && !paired}><BookOpen/>{paired ? '退出双源对照' : '打开双源对照'}</button>}{rawPdfUrl && <><a href={rawPdfUrl} download><Download/>下载</a><a className="primary" href={buildPdfPageUrl(rawPdfUrl, page)} target="_blank" rel="noreferrer"><ExternalLink/>新窗口打开</a></>}</div>
    </section>
    {paired && <section className="paired-reading-intro"><div><span>双源对照</span><b>{lessonQuery || '当前篇目'}</b></div><p>左边核对学生实际看到的原文，右边查看教师用书的教学处理。系统只负责定位，不把两份材料混写成新的结论。</p></section>}
    {paired && <section className="paired-focus-panel">
      <div className="paired-focus-copy"><span>句段追踪</span><h2>在这一句停住，直接寻找教师用书的相关建议</h2><p>输入课文中的句子、关键词或课后题。篇目身份保持不变，右侧只重新定位对应材料的真实教材页面。</p></div>
      <form onSubmit={applyPairedFocus}><Search/><label><span className="sr-only">输入需要追踪的句段</span><input value={focusInput} onChange={event => setFocusInput(event.target.value)} maxLength={100} placeholder="例如：先天下之忧而忧，后天下之乐而乐"/></label><button type="submit" disabled={!focusInput.trim() || pairedLoading}>{pairedLoading && pairedFocus ? '正在追踪…' : '追踪这一句'}</button>{pairedFocus && <button type="button" className="quiet" onClick={clearPairedFocus}>回到篇目起点</button>}</form>
      {pairedFocus && <div className="paired-focus-status"><b>当前追踪：</b><span>{pairedFocus}</span><small>{pairedLoading ? '正在搜索对应教学处理…' : pairedResult && pairedPage ? `已定位到${docName(counterpartId)} 第 ${pairedPage} 页` : '暂未找到对应页面'}</small></div>}
    </section>}
    <section className="pdf-toolbar"><button onClick={() => goto(page - 1)} disabled={page <= 1}>上一页</button><label>教材页码 <input value={page} onChange={event => goto(event.target.value)}/> / {maxPage}</label><button onClick={() => goto(page + 1)} disabled={page >= maxPage}>下一页</button><i/><button onClick={() => setZoom(value => Math.max(70, value - 10))}><ZoomOut/>缩小</button><span>{zoom}%</span><button onClick={() => setZoom(value => Math.min(160, value + 10))}><ZoomIn/>放大</button><button onClick={() => frame.current?.requestFullscreen?.()}><Maximize2/>全屏</button></section>
    <div className={`verification-workbench${paired ? ' paired-reading-workbench' : ''}`}>
      <section className="pdf-frame" ref={frame}>{rawPdfUrl && !pdfError ? <iframe key={`${doc}-${page}-${zoom}`} title={`${info?.short || '教材'} 第 ${page} 页`} src={pdfSrc} onError={() => setPdfError(true)}/> : <div className="index-empty"><CircleAlert/><b>原始教材页面暂时无法显示</b><p>请重试或在新窗口打开原始文件。</p>{rawPdfUrl && <a className="primary" href={buildPdfPageUrl(rawPdfUrl, page)} target="_blank" rel="noreferrer">新窗口打开</a>}</div>}</section>
      {paired ? <section className="paired-pdf-pane">
        <header><div><Badge tone={counterpartId === 'teacher-guide' ? 'guide' : 'textbook'}>{docName(counterpartId)}</Badge><b>{pairedSection}</b><small>{pairedPage ? `第 ${pairedPage} 页 · 书页 ${pairedPrintedPage}` : '正在定位对应原页'}</small></div>{swapHref && <a href={swapHref}>切换主次 <ArrowRight/></a>}</header>
        {pairedLoading ? <div className="paired-reading-state"><Activity/><b>{pairedFocus ? '正在寻找这处原文的教学处理' : '正在定位同篇目对应原页'}</b><p>{pairedFocus ? '篇目保持不变，只用当前句段缩小教师用书范围。' : '先匹配篇目，再核对教材页码，不会猜测页码。'}</p></div> : pairedError ? <div className="paired-reading-state error"><CircleAlert/><b>{pairedFocus ? '暂时没有找到这处句段的对应处理' : '对应原页暂时没有打开'}</b><p>{pairedError}</p><button type="button" onClick={() => setPairedRetry(value => value + 1)}>重新定位</button></div> : pairedPdfSrc && !pairedPdfError ? <iframe key={`${counterpartId}-${pairedPage}-${zoom}`} title={`${docName(counterpartId)} 第 ${pairedPage} 页`} src={pairedPdfSrc} onError={() => setPairedPdfError(true)}/> : <div className="paired-reading-state error"><CircleAlert/><b>对应教材页面暂时无法显示</b><p>页码已经定位，可以在新窗口打开原始页面。</p>{pairedRawPdfUrl && pairedPage && <a href={buildPdfPageUrl(pairedRawPdfUrl, pairedPage)} target="_blank" rel="noreferrer">新窗口打开对应原页</a>}</div>}
      </section> : <aside className="panel evidence-inspector">
        <div className="source-tabs"><button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>当前依据</button><button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>相邻页面</button><button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>可复制文本</button></div>
        {loading && <div className="evidence-missing"><Activity/><div><b>正在读取页面信息</b><small>左侧原始教材可继续查看。</small></div></div>}
        {!loading && error && <div className="evidence-missing"><CircleAlert/><div><b>本页暂时没有可用教材依据</b><small>{error}。左侧仍显示原始教材。</small></div></div>}
        {!loading && !error && tab === 'evidence' && <><Badge tone={info?.tone || 'green'}>{info?.short || '教材'}依据</Badge><h2>{title}</h2>{retrievalText ? <details open><summary>查看原文片段</summary><blockquote>{retrievalText}</blockquote></details> : <div className="evidence-missing"><CircleAlert/><div><b>暂无可复制片段</b><small>请以左侧原始页面为准。</small></div></div>}<div className="source-meta"><span>教材页码</span><b>{physicalPage}</b><span>书页</span><b>{printedPage}</b><span>文本来源</span><b>{sourceLabel}</b><span>质量</span><b>{qualityLabel}</b></div></>}
        {!loading && !error && tab === 'context' && <div className="related-citations"><b>相邻原页</b><p>相邻页面仅供核验，不会自动纳入本次依据。</p>{[page - 1, page + 1].filter(value => value >= 1 && value <= maxPage).map(value => <button onClick={() => goto(value)} key={value}><b>打开 第 {value} 页</b></button>)}</div>}
        {!loading && !error && tab === 'text' && <textarea readOnly value={retrievalText || '本页暂无可复制解析文本。'}/>}<div className="document-switch"><b>关联材料</b><span>点击“打开双源对照”，在同一屏核对两份原始教材。</span></div>
      </aside>}
    </div>
    {paired && <section className="panel paired-reading-summary"><article><span>学生此刻看到什么</span><b>{doc === 'textbook' ? title : pairedResult?.title || lessonQuery}</b><p>{doc === 'textbook' ? retrievalText || '请直接核对左侧学生教材原页。' : citationText(pairedResult) || '请直接核对右侧学生教材原页。'}</p></article><i/><article><span>教师此刻参考什么</span><b>{doc === 'teacher-guide' ? title : pairedResult?.title || lessonQuery}</b><p>{doc === 'teacher-guide' ? retrievalText || '请直接核对左侧教师用书原页。' : citationText(pairedResult) || '请直接核对右侧教师用书原页。'}</p></article><small>以上文字只帮助辨认页面；备课结论仍需回到两侧原始教材核验。</small></section>}
    {dualSourceTeachingCard && <section className="panel dual-source-teaching-card">
      <header><div><span>双源讲解卡</span><h2>一处课文，对齐学生怎么读、教师怎么教</h2><p>只整理当前已经定位的教材和教师用书原页，不调用模型，也不替学生预写结论。</p></div><div><Badge tone={dualSourceTeachingCard.status === 'direct' ? 'green' : 'orange'}>{dualSourceTeachingCard.status === 'direct' ? '双侧原文均已定位' : dualSourceTeachingCard.status === 'partial' ? '一侧原文已定位' : '已定位相关页面'}</Badge><button type="button" onClick={copyTeachingCard}><ClipboardCheck/>复制讲解卡</button><button type="button" onClick={downloadTeachingCard}><Download/>下载讲解卡</button></div></header>
      <div className="dual-source-card-focus"><small>本次聚焦</small><b>{dualSourceTeachingCard.focus}</b>{teachingCardNotice && <span>{teachingCardNotice}</span>}</div>
      <div className="dual-source-card-columns">
        {[['学生先读什么', dualSourceTeachingCard.textbook], ['教师再参考什么', dualSourceTeachingCard.teacherGuide]].map(([label, source]) => <article key={source.documentId}><div><span>{label}</span><b>{docName(source.documentId)} · 第 {source.pdfPage} 页{source.printedPage ? ` · 书页 ${source.printedPage}` : ''}</b><small>{source.section || source.title || '当前篇目'}</small></div><blockquote>{source.excerpt || '当前页面没有可复制片段，请直接打开原始教材核验。'}</blockquote><a href={buildReaderHref({ documentId: source.documentId, page: source.pdfPage, lessonTitle: lessonQuery, focus: pairedFocus, paired: true, returnTo: `${location.pathname}${location.search}` })}>打开这份原始页面 <ExternalLink/></a></article>)}
      </div>
      <ol>{dualSourceTeachingCard.steps.map(item => <li key={item}>{item}</li>)}</ol>
    </section>}
  </div>;
}

function focusedCurriculumExcerpt(item) {
  const source = String(item?.source?.excerpt || '').replace(/\s+/gu, ' ').trim();
  if (!source) return '';
  const anchors = item?.id === 'stage'
    ? ['【阅读与鉴赏】', '在通读课文的基础上', '阅读与鉴赏']
    : item?.id === 'task-group'
      ? ['第四学段', '识别文本隐含的情感、观点、立场', '本学习任务群旨在']
      : ['阅读简单议论性文章', '区分观点与材料', '阅读与鉴赏类问题或任务'];
  const index = anchors.map(anchor => source.indexOf(anchor)).filter(value => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, index - (index ? 18 : 0));
  const excerpt = source.slice(start, start + 300);
  return `${start > 0 ? '…' : ''}${excerpt}${start + 300 < source.length ? '…' : ''}`;
}

function CurriculumAlignmentPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || '';
  const alignmentReaderReturn = draftId ? `/alignment/?draftId=${encodeURIComponent(draftId)}` : 'alignment';
  const [draft, setDraft] = useState(null);
  const [lessonTitle, setLessonTitle] = useState(params.get('lesson') || '');
  const [groups, setGroups] = useState({ stage: [], taskGroup: [], quality: [] });
  const [confirmedTaskGroup, setConfirmedTaskGroup] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!draftId || !session) return undefined;
    let active = true;
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (!active) return;
      const next = data.draft || data;
      setDraft(next);
      setLessonTitle(next.title || next.lesson_context?.lessonRef?.title || next.question || '当前篇目');
      setConfirmedTaskGroup(next.answer?.curriculumAlignment?.sections?.find(item => item.id === 'task-group')?.teacherDecision || '');
    }).catch(err => { if (active) setError(askErrorMessage(err)); });
    return () => { active = false; };
  }, [draftId, session?.user?.id]);
  useEffect(() => {
    if (draftId && session && !draft) return undefined;
    if (!lessonTitle.trim()) {
      setGroups({ stage: [], taskGroup: [], quality: [] });
      setBusy(false); setError(''); setNotice('');
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true); setError(''); setNotice('');
      try {
        const guide = await request('/search', { method: 'POST', body: { query: `${lessonTitle} 教学重点 文体 观点 立场`, scope: ['teacher-guide'], limit: 3 } });
        const guideContext = (Array.isArray(guide.results) ? guide.results : []).map(item => `${item.title || ''} ${item.text || item.quote || ''}`).join(' ');
        const { searches, taskGroup } = curriculumSearchQueries({ lessonTitle, guideContext });
        const entries = await Promise.all(searches.map(async ([key, query]) => {
          const data = await request('/search', { method: 'POST', body: { query, scope: ['curriculum-standard'], limit: 8 } });
          return [key, Array.isArray(data.results) ? data.results : []];
        }));
        if (active) setGroups({ ...Object.fromEntries(entries), taskGroupHint: taskGroup });
      } catch {
        if (active) { setGroups({ stage: [], taskGroup: [], quality: [] }); setError('课程标准原页暂时无法定位，本次不生成对齐结论。'); }
      } finally { if (active) setBusy(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [refreshKey, lessonTitle, draftId, session?.user?.id, draft?.id]);
  const report = useMemo(() => buildCurriculumAlignment({ lessonTitle, resultGroups: groups, confirmedTaskGroup }), [lessonTitle, groups, confirmedTaskGroup]);
  const taskCandidates = useMemo(() => {
    const values = groups.taskGroup.map(item => item.title || item.sectionPath?.at?.(-1) || '').map(value => String(value).trim()).filter(value => /(阅读|表达|任务群)/u.test(value));
    return [...new Set(values)].slice(0, 6);
  }, [groups.taskGroup]);
  const save = async () => {
    if (!draftId || !draft || !session || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        body: { version: draft.version, answer: { ...(draft.answer || {}), curriculumAlignment: report } }
      });
      setDraft(data.draft || data);
      setNotice('课标对齐已保存到当前方案；教师确认与课标原文仍分开记录。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setSaving(false); }
  };
  return <div className="view-stack alignment-page">
    <section className="hero alignment-hero"><div><Badge tone="green"><Target/> 课标依据</Badge><h1>先看课标要求，<br/><em>再决定本课怎样落实</em></h1><p>页面只做三件事：找到学段要求、选择本课适合的学习任务、确定可观察的评价表现。每一项都能打开课标原页。</p></div><div className={`alignment-score ${report.status}`}><b>{report.sourceCount}<small>/3</small></b><span>已找到的课标页面</span><em>{report.status === 'confirmed' ? '本课任务已确认' : report.status === 'review' ? '还需教师选择' : '仍有原页待补充'}</em></div></section>
    <section className="panel alignment-lesson"><div><span>正在核对的篇目</span><label><input value={lessonTitle} onChange={event => setLessonTitle(event.target.value)} aria-label="当前篇目" placeholder="例如：《岳阳楼记》"/><small>{lessonTitle.trim() ? '课标不直接规定某篇课文的教法；下方“课堂落实”由教师确认。' : '请先输入当前篇目名称，再查找对应的学段要求、学习任务群和学业质量原页。'}</small></label></div><button type="button" disabled={busy || !lessonTitle.trim()} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw/>{busy ? '正在查找课标原页…' : '查找课标原页'}</button></section>
    {error && <section className="ask-error"><CircleAlert/><span>{error}</span></section>}
    {lessonTitle.trim() ? <section className="alignment-flow" aria-busy={busy}>{report.sections.map((item, index) => {
      const href = item.source ? citationLink(item.source, alignmentReaderReturn) : '';
      const excerpt = focusedCurriculumExcerpt(item);
      return <article className={`alignment-step ${item.status}`} key={item.id}><header><span>{String(index + 1).padStart(2, '0')}</span><div><small>{item.purpose}</small><h2>{item.title}</h2></div><Badge tone={item.status === 'direct' || item.status === 'confirmed' ? 'green' : item.status === 'candidate' ? 'orange' : 'neutral'}>{item.statusLabel}</Badge></header>{busy ? <div className="alignment-loading"><Activity/>正在查找课标原页…</div> : item.source ? <><div className="alignment-source"><b>与本课判断直接相关的原文</b><small>课程标准 · 第 {item.source.pdfPage} 页{item.source.printedPage ? ` · 书页 ${item.source.printedPage}` : ''}</small><p>{excerpt || '请打开原始教材阅读本页完整文字。'}</p>{href && <a href={href}>打开课标原页 <ExternalLink/></a>}</div><div className="alignment-classroom-landing"><b>教师需要做的判断</b><p>{item.note}</p></div>{item.id === 'task-group' && <div className="alignment-decision"><label><span>本课采用哪一种学习任务</span><select value={confirmedTaskGroup} onChange={event => setConfirmedTaskGroup(event.target.value)}><option value="">暂不选择，先保留候选</option>{taskCandidates.map(value => <option value={value} key={value}>{value}</option>)}</select></label><small>这里记录的是教师的课堂选择，不会改写课标原文。</small></div>}</> : <div className="alignment-missing"><FileSearch/><b>还没有找到对应课标原页</b><p>{item.note}</p></div>}</article>;
    })}</section> : <section className="panel alignment-missing"><Target/><b>先确定要核对的篇目</b><p>也可以从教材库选定篇目后进入本页，系统会自动带入篇名和当前教材范围。</p><a className="primary" href="/library/">从教材库选择篇目</a></section>}
    <section className="panel alignment-summary"><div><span>本页边界</span><h2>{report.warning}</h2><p>确认后只把课标依据写入当前方案；教师用书处理和学生教材原文仍分别核验。</p>{notice && <strong>{notice}</strong>}</div><div>{draftId && session ? <button type="button" className="primary" disabled={saving || busy} onClick={save}>{saving ? '正在保存…' : '确认本课课标依据'}</button> : <a className="primary" href={session ? `/ask/?scope=all&lesson=${encodeURIComponent(lessonTitle)}` : `/login/?next=${encodeURIComponent(`/alignment/?lesson=${encodeURIComponent(lessonTitle)}`)}`}>{session ? '带着课标依据开始备课' : '登录后保存对齐'}</a>}{draftId && <a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>回到本课方案 <ArrowRight/></a>}</div></section>
  </div>;
}

function App(){
  const active=routeId();
  const [callback] = useState(() => consumeAuthCallback());
  useEffect(() => {
    if (!callback || active === 'login') return;
    const recovery = readAuthRecovery();
    const destination = safeAuthReturnPath(recovery?.next || '/ask/');
    if (callback.type === 'session') {
      // Email confirmation can complete after the user started from a
      // protected page. Return to that exact page instead of discarding the
      // pending draft/question context.
      location.replace(destination);
      return;
    }
    const query = new URLSearchParams({ auth_error: callback.code, auth_description: callback.description || '' });
    if (recovery?.next) query.set('next', recovery.next);
    location.replace(`/login/?${query}`);
  }, [active, callback]);
  const pages={dashboard:<Dashboard/>,guide:<GuidancePage/>,decision:<Decision/>,unit:<Unit/>,cards:<Cards/>,slides:<TeachingSlidesPage/>,homework:<LayeredHomeworkPage/>,marking:<AnonymousMarkingPage/>,rehearsal:<RehearsalPage/>,pulse:<PreClassPulsePage/>,worksheet:<ClassroomWorksheetPage/>,alignment:<CurriculumAlignmentPage/>,learning:<LearningEvidencePage/>,deliberation:<DeliberationPage/>,reflection:<ReflectionPage/>,study:<LessonStudyPage/>,compare:<SameLessonComparisonPage/>,research:<ResearchLedgerPage/>,observation:<ObservationProtocolPage/>,assets:<AssetsPage/>,share:<TeachingSharePage/>,pitch:<Pitch/>,library:<LibraryPage/>,ask:<AskPage/>,ingest:<IngestPage/>,jobs:<JobsPage/>,inspect:<InspectPage/>,validation:<ValidationPage/>,document:<DocumentPage/>,login:<LoginPage callback={callback}/>,settings:<SettingsPage/>};
  if (active === 'login' || active === 'settings') return <Layout active={active}>{pages[active]}</Layout>;
  return <Layout active={active}>{pages[active]||<Dashboard/>}</Layout>;
}
export default App;

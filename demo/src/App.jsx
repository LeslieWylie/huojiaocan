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
import { pageNumber, useAuthSession, normalizeTree, findTreeNode, nodePageRange, firstPage, CARD_GENERATION_STEPS, CARD_SUBTITLES, boardLabelFromText, boardQuestion, cardEditGuidance, cardItemNeedsDetail, classroomRecoveryKey, clearClassroomRecovery, feedbackAdviceFromForm, feedbackStorageValue, lessonRefFromUrl, lessonTitleFrom, makeBoardPlan, normalizeCards, normalizeFeedbackForm, planIdentity, readClassroomRecovery, sameLessonRef, uniqueCitations, unitRefFromUrl, withBoardPlan, wrapSvgText, writeClassroomRecovery, sourceTypeLabel, API, fetchJson, request, rootRequest, askErrorMessage, canonicalDocumentId, citationPage, citationLink, citationText, currentPageReturn, DOC_LABELS, docName, isIndexRecoveryCode, pageText, pageTitle, pdfPageUrl, queryParams, requestCode, routeId, safeDownloadStem, statusLabel, terminalJob } from './app-core.js';
import { Badge, Logo, SectionHead, Stat } from './ui-kit.jsx';
import { Decision } from './views/decision-page.jsx';
import { Pitch } from './views/pitch-page.jsx';
import { LoginPage, SettingsPage } from './views/auth-pages.jsx';
import { Unit } from './views/unit-page.jsx';
import { AssetCoverage, PlanQualitySummary, SharedPlanList, assetPrimaryAction, assetWorkflowBadge, sharedItemText, sourceCoverageLabel } from './ui-panels.jsx';
import { LibraryPage } from './views/library-page.jsx';
import { DocumentPage } from './views/document-page.jsx';
import { Cards } from './views/cards-page.jsx';
import { AskPage } from './views/ask-page.jsx';
import { CardSourceList, MindMapBoard, PeriodPlanner, TeachingBrief, TeachingEvidenceChain } from './ui-board.jsx';
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

function readDraftRecovery(userId, id) {
  try { return readOwnedDraftRecovery(localStorage, userId, id); } catch { return null; }
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

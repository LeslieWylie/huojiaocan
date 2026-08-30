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
import { focusedCurriculumExcerpt, questionState, pageNumber, useAuthSession, normalizeTree, findTreeNode, nodePageRange, firstPage, CARD_GENERATION_STEPS, CARD_SUBTITLES, boardLabelFromText, boardQuestion, cardEditGuidance, cardItemNeedsDetail, classroomRecoveryKey, clearClassroomRecovery, feedbackAdviceFromForm, feedbackStorageValue, lessonRefFromUrl, lessonTitleFrom, makeBoardPlan, normalizeCards, normalizeFeedbackForm, planIdentity, readClassroomRecovery, sameLessonRef, uniqueCitations, unitRefFromUrl, withBoardPlan, wrapSvgText, writeClassroomRecovery, sourceTypeLabel, API, fetchJson, request, rootRequest, askErrorMessage, canonicalDocumentId, citationPage, citationLink, citationText, currentPageReturn, DOC_LABELS, docName, isIndexRecoveryCode, pageText, pageTitle, pdfPageUrl, queryParams, requestCode, routeId, safeDownloadStem, statusLabel, terminalJob } from './app-core.js';
import { Badge, Logo, SectionHead, Stat } from './ui-kit.jsx';
import { Decision } from './views/decision-page.jsx';
import { Pitch } from './views/pitch-page.jsx';
import { LoginPage, SettingsPage } from './views/auth-pages.jsx';
import { Unit } from './views/unit-page.jsx';
import { AssetCoverage, PlanQualitySummary, SharedPlanList, assetPrimaryAction, assetWorkflowBadge, sharedItemText, sourceCoverageLabel } from './ui-panels.jsx';
import { LibraryPage } from './views/library-page.jsx';
import { DocumentPage } from './views/document-page.jsx';
import { ProviderResult } from './views/document-page.jsx';
import { Cards } from './views/cards-page.jsx';
import { AskPage } from './views/ask-page.jsx';
import { ClassroomWorksheetPage, LearningEvidencePage, PreClassPulsePage, RehearsalPage } from './views/lesson-pages.jsx';
import { DeliberationPage, ReflectionPage } from './views/lesson2-pages.jsx';
import { LayeredHomeworkPage, LessonStudyPage, SameLessonComparisonPage, TeachingSlidesPage } from './views/lesson3-pages.jsx';
import { CurriculumAlignmentPage, IngestPage, InspectPage, JobsPage, ValidationPage } from './views/inspect-pages.jsx';
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

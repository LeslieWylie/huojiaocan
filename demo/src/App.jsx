import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Copy,
  CircleAlert, ClipboardCheck, Download, ExternalLink, Eye, FileCheck2, FileSearch,
  FileText, Gauge, GitCompareArrows, History, Layers3, Library, Maximize2, Menu, MessageCircle, Network,
  Link2, Microscope, PanelTop, Play, Plus, Quote, RefreshCw, Route, Search, Send, Share2, ShieldCheck,
  Sparkles, Target, Upload, X, ZoomIn, ZoomOut
} from 'lucide-react';
import { accessToken, authOwnersConflict, canPersistAuthOwner, clearAuthRecovery, consumeAuthCallback, ensureSession, getSession, readAuthRecovery, refreshSession, resendVerification, safeAuthReturnPath, saveAuthRecovery, sessionExpired, signIn, signOut, signUp, subscribeAuth } from './auth.js';
import { errorCopy, UI_COPY } from './copy.js';
import { ROUTES, focusedCurriculumExcerpt, questionState, pageNumber, useAuthSession, normalizeTree, findTreeNode, nodePageRange, firstPage, CARD_GENERATION_STEPS, CARD_SUBTITLES, boardLabelFromText, boardQuestion, cardEditGuidance, cardItemNeedsDetail, classroomRecoveryKey, clearClassroomRecovery, feedbackAdviceFromForm, feedbackStorageValue, lessonRefFromUrl, lessonTitleFrom, makeBoardPlan, normalizeCards, normalizeFeedbackForm, planIdentity, readClassroomRecovery, sameLessonRef, uniqueCitations, unitRefFromUrl, withBoardPlan, wrapSvgText, writeClassroomRecovery, sourceTypeLabel, API, fetchJson, request, rootRequest, askErrorMessage, canonicalDocumentId, citationPage, citationLink, citationText, currentPageReturn, DOC_LABELS, docName, isIndexRecoveryCode, pageText, pageTitle, pdfPageUrl, queryParams, requestCode, routeId, safeDownloadStem, statusLabel, terminalJob } from './app-core.js';
import { Badge, Logo, SectionHead, Stat } from './ui-kit.jsx';
import { AssetCoverage, PlanQualitySummary, SharedPlanList, assetPrimaryAction, assetWorkflowBadge, sharedItemText, sourceCoverageLabel } from './ui-panels.jsx';
import { Dashboard, GuidancePage, Layout, Sidebar, WORKFLOW_TOOL_NAV, MATERIAL_NAV, PRIMARY_NAV } from './views/shell-pages.jsx';
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



import { PageErrorBoundary } from './error-boundary.jsx';
// 路由级按需加载（拆分后 pages 视图均懒加载）
const Decision = lazy(() => import('./views/decision-page.jsx').then(m => ({ default: m.Decision })));
const Pitch = lazy(() => import('./views/pitch-page.jsx').then(m => ({ default: m.Pitch })));
const LoginPage = lazy(() => import('./views/auth-pages.jsx').then(m => ({ default: m.LoginPage })));
const SettingsPage = lazy(() => import('./views/auth-pages.jsx').then(m => ({ default: m.SettingsPage })));
const Unit = lazy(() => import('./views/unit-page.jsx').then(m => ({ default: m.Unit })));
const LibraryPage = lazy(() => import('./views/library-page.jsx').then(m => ({ default: m.LibraryPage })));
const DocumentPage = lazy(() => import('./views/document-page.jsx').then(m => ({ default: m.DocumentPage })));
const ProviderResult = lazy(() => import('./views/document-page.jsx').then(m => ({ default: m.ProviderResult })));
const Cards = lazy(() => import('./views/cards-page.jsx').then(m => ({ default: m.Cards })));
const AskPage = lazy(() => import('./views/ask-page.jsx').then(m => ({ default: m.AskPage })));
const ClassroomWorksheetPage = lazy(() => import('./views/lesson-pages.jsx').then(m => ({ default: m.ClassroomWorksheetPage })));
const LearningEvidencePage = lazy(() => import('./views/lesson-pages.jsx').then(m => ({ default: m.LearningEvidencePage })));
const PreClassPulsePage = lazy(() => import('./views/lesson-pages.jsx').then(m => ({ default: m.PreClassPulsePage })));
const RehearsalPage = lazy(() => import('./views/lesson-pages.jsx').then(m => ({ default: m.RehearsalPage })));
const DeliberationPage = lazy(() => import('./views/lesson2-pages.jsx').then(m => ({ default: m.DeliberationPage })));
const ReflectionPage = lazy(() => import('./views/lesson2-pages.jsx').then(m => ({ default: m.ReflectionPage })));
const LayeredHomeworkPage = lazy(() => import('./views/lesson3-pages.jsx').then(m => ({ default: m.LayeredHomeworkPage })));
const LessonStudyPage = lazy(() => import('./views/lesson3-pages.jsx').then(m => ({ default: m.LessonStudyPage })));
const SameLessonComparisonPage = lazy(() => import('./views/lesson3-pages.jsx').then(m => ({ default: m.SameLessonComparisonPage })));
const TeachingSlidesPage = lazy(() => import('./views/lesson3-pages.jsx').then(m => ({ default: m.TeachingSlidesPage })));
const AnonymousMarkingPage = lazy(() => import('./views/g4-pages.jsx').then(m => ({ default: m.AnonymousMarkingPage })));
const ObservationProtocolPage = lazy(() => import('./views/g4-pages.jsx').then(m => ({ default: m.ObservationProtocolPage })));
const AssetsPage = lazy(() => import('./views/g5-pages.jsx').then(m => ({ default: m.AssetsPage })));
const ResearchLedgerPage = lazy(() => import('./views/g5-pages.jsx').then(m => ({ default: m.ResearchLedgerPage })));
const TeachingSharePage = lazy(() => import('./views/g5-pages.jsx').then(m => ({ default: m.TeachingSharePage })));
const CurriculumAlignmentPage = lazy(() => import('./views/inspect-pages.jsx').then(m => ({ default: m.CurriculumAlignmentPage })));
const IngestPage = lazy(() => import('./views/inspect-pages.jsx').then(m => ({ default: m.IngestPage })));
const InspectPage = lazy(() => import('./views/inspect-pages.jsx').then(m => ({ default: m.InspectPage })));
const JobsPage = lazy(() => import('./views/inspect-pages.jsx').then(m => ({ default: m.JobsPage })));
const ValidationPage = lazy(() => import('./views/inspect-pages.jsx').then(m => ({ default: m.ValidationPage })));

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
  const renderPage = activePage => <Suspense fallback={<div className="page-loading"><Activity/>正在打开…</div>}><PageErrorBoundary>{activePage}</PageErrorBoundary></Suspense>;
  const pages={dashboard:<Dashboard/>,guide:<GuidancePage/>,decision:<Decision/>,unit:<Unit/>,cards:<Cards/>,slides:<TeachingSlidesPage/>,homework:<LayeredHomeworkPage/>,marking:<AnonymousMarkingPage/>,rehearsal:<RehearsalPage/>,pulse:<PreClassPulsePage/>,worksheet:<ClassroomWorksheetPage/>,alignment:<CurriculumAlignmentPage/>,learning:<LearningEvidencePage/>,deliberation:<DeliberationPage/>,reflection:<ReflectionPage/>,study:<LessonStudyPage/>,compare:<SameLessonComparisonPage/>,research:<ResearchLedgerPage/>,observation:<ObservationProtocolPage/>,assets:<AssetsPage/>,share:<TeachingSharePage/>,pitch:<Pitch/>,library:<LibraryPage/>,ask:<AskPage/>,ingest:<IngestPage/>,jobs:<JobsPage/>,inspect:<InspectPage/>,validation:<ValidationPage/>,document:<DocumentPage/>,login:<LoginPage callback={callback}/>,settings:<SettingsPage/>};
  if (active === 'login' || active === 'settings') return <Layout active={active}>{renderPage(pages[active])}</Layout>;
  return <Layout active={active}>{renderPage(pages[active] || <Dashboard/>)}</Layout>;
}
export default App;

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
import { ROUTES, focusedCurriculumExcerpt, questionState, pageNumber, useAuthSession, normalizeTree, findTreeNode, nodePageRange, firstPage, CARD_GENERATION_STEPS, CARD_SUBTITLES, boardLabelFromText, boardQuestion, cardEditGuidance, cardItemNeedsDetail, classroomRecoveryKey, clearClassroomRecovery, feedbackAdviceFromForm, feedbackStorageValue, lessonRefFromUrl, lessonTitleFrom, makeBoardPlan, normalizeCards, normalizeFeedbackForm, planIdentity, readClassroomRecovery, sameLessonRef, uniqueCitations, unitRefFromUrl, withBoardPlan, wrapSvgText, writeClassroomRecovery, sourceTypeLabel, API, fetchJson, request, rootRequest, askErrorMessage, canonicalDocumentId, citationPage, citationLink, citationText, currentPageReturn, DOC_LABELS, docName, isIndexRecoveryCode, pageText, pageTitle, pdfPageUrl, queryParams, requestCode, routeId, safeDownloadStem, statusLabel, terminalJob } from './app-core.js';
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
import { AnonymousMarkingPage, ObservationProtocolPage } from './views/g4-pages.jsx';
import { AssetsPage, ResearchLedgerPage, TeachingSharePage } from './views/g5-pages.jsx';
import { Dashboard, GuidancePage, Layout, Sidebar, WORKFLOW_TOOL_NAV, MATERIAL_NAV, PRIMARY_NAV } from './views/shell-pages.jsx';
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

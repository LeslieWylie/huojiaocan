// 一课三卡页（从 App.jsx 迁出，最大页面）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Archive, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardCheck, Download, FileCheck2, FileText, Gauge, History, Layers3, Maximize2, Menu, PanelTop, Plus, RefreshCw, Route, Share2, ShieldCheck, Sparkles, Target, X } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { AssetCoverage, PlanQualitySummary, sourceCoverageLabel } from '../ui-panels.jsx';
import { CardSourceList, MindMapBoard, PeriodPlanner, TeachingBrief, TeachingEvidenceChain } from '../ui-board.jsx';
import { CARD_GENERATION_STEPS, cacheDraftForRecovery, rememberAuthReturn, askErrorMessage, cardEditGuidance, cardItemNeedsDetail, citationPage, clearClassroomRecovery, docName, feedbackAdviceFromForm, feedbackStorageValue, normalizeFeedbackForm, queryParams, readClassroomRecovery, requestCode, rootRequest, safeDownloadStem, sourceTypeLabel, uniqueCitations, useAuthSession, withBoardPlan, writeClassroomRecovery } from '../app-core.js';
import { addClassroomMoment, CLASSROOM_STAGE_LABELS, emptyClassroomRun, normalizeClassroomRun, removeClassroomMoment, resolveClassroomRecovery, setClassroomStageOutcome } from '../../shared/classroom-run.js';
import { buildBoardWritingPlan } from '../../shared/board-writing-plan.js';
import { buildTeachingBrief } from '../../shared/teaching-brief.js';
import { buildTeachingEvidenceChain } from '../../shared/teaching-evidence-chain.js';
import { CLASSROOM_PACE_SIGNALS } from '../../shared/classroom-adaptation.js';
import { lessonTitleForDraft } from '../../shared/lesson-identity.js';
import { normalizeQuestionRehearsal, questionRehearsalIsStale } from '../../shared/question-rehearsal.js';
import { buildSubstituteTeachingPack } from '../../shared/substitute-teaching-pack.js';
import { applyPlanForm, cardsForAskDraft, deriveTeacherDraftState, isTeacherConfirmed, planFormFromDraft, readDraftRecovery } from '../teacher-finalization.js';
import { analyzeTeachingPlanQuality } from '../lesson-quality.js';
import { classroomAdaptationAdvice } from '../../shared/classroom-adaptation.js';
import { buildOfflineClassroomPack } from '../../shared/offline-classroom-pack.js';
import { preClassPulseClassroomCue } from '../../shared/preclass-pulse.js';

export function Cards() {

  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const [draft, setDraft] = useState(null);
  const [cards, setCards] = useState([]);
  const [planForm, setPlanForm] = useState(() => planFormFromDraft());
  const [planDirty, setPlanDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
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
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [supportToolsOpen, setSupportToolsOpen] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [feedbackForm, setFeedbackForm] = useState(normalizeFeedbackForm());
  const [feedbackAdvice, setFeedbackAdvice] = useState([]);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const classroomRef = useRef(null);
  const classroomSaveRef = useRef(false);
  const cardsLoadRef = useRef(0);
  const generationRequestRef = useRef(false);
  const draftId = params.get('draftId') || params.get('id') || '';
  const userId = String(session?.user?.id || '');
  const cardsReaderReturn = draftId ? `/cards/?draftId=${encodeURIComponent(draftId)}` : 'cards';

  useEffect(() => {
    const loadId = ++cardsLoadRef.current;
    setDraft(null); setCards([]); setPlanForm(planFormFromDraft()); setPlanDirty(false); setDirty(false); setHistory(null); setBusy(true); setError(''); setErrorCode(''); setRepairMessage(''); setFeedbackForm(normalizeFeedbackForm()); setFeedbackAdvice([]); setFeedbackDirty(false); setFeedbackMessage(''); setClassroom(false); setClassroomRun(emptyClassroomRun()); setClassroomDirty(false); setClassroomKeyword(''); setClassroomMoment(''); setClassroomClock(Date.now()); setClassroomNotice(''); setClassroomConflictRun(null); setWritingRehearsal(false); setPlanEditorOpen(false); setSupportToolsOpen(false); setExportNotice(''); classroomSaveRef.current = false;
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
    if (!draftId || generationRequestRef.current) return;
    generationRequestRef.current = true;
    const current = planDirty ? await savePlan() : draft;
    if (!current) {
      generationRequestRef.current = false;
      return;
    }
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
      const generateCards = base => rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/cards/generate`, {
        method: 'POST',
        body: { version: base.version, keyId: keyId || undefined }
      });
      let recoveredConcurrentGeneration = false;
      let data;
      try {
        data = await generateCards(confirmed);
      } catch (generationError) {
        if (requestCode(generationError) !== 'edit_conflict') throw generationError;
        const refreshedData = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`);
        const refreshed = refreshedData.draft || refreshedData;
        setDraft(refreshed);
        if (Array.isArray(refreshed.cards) && refreshed.cards.length) {
          data = { draft: refreshed, generations: [] };
          recoveredConcurrentGeneration = true;
        } else if (isTeacherConfirmed(refreshed)) {
          data = await generateCards(refreshed);
        } else {
          throw generationError;
        }
      }
      const saved = data.draft || data;
      const generatedCards = withBoardPlan(Array.isArray(saved.cards) ? saved.cards : [], saved.answer?.lesson?.coreQuestion || saved.question || saved.title || '');
      setDraft(saved); setCards(generatedCards); setPlanForm(planFormFromDraft(saved)); setPlanDirty(false); setDirty(false);
      setActiveCard(Math.max(0, generatedCards.findIndex(card => card.type === 'board')));
      const rounds = Math.max(1, ...(Array.isArray(data.generations) ? data.generations.map(item => Number(item?.generationRounds) || 1) : [1]));
      setAssetMessage(recoveredConcurrentGeneration
        ? '已读取刚刚完成的三卡；没有重复生成，也没有覆盖教师修改。'
        : rounds >= 3
        ? '三卡已保存：系统先形成初稿，再核对教材依据与课堂节奏，并完成了必要修订。'
        : '三卡已保存：系统已完成初稿与教材依据、课堂可用性审校。');
    } catch (err) {
      const code = requestCode(err);
      setError(code === 'plan_incomplete' ? '这份方案还缺少完整的课堂流程、问题链或评价标准，请回到问答补齐后再确认。' : code === 'evidence_insufficient' ? '当前方案还没有足够的教材页级依据，请先补充并核验原始页面。' : askErrorMessage(err));
      setErrorCode(code);
    } finally {
      setGenerating('');
      generationRequestRef.current = false;
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
    if (!window.confirm(`锁定“${card.title}”后将不能继续编辑或重新生成。确认把当前内容作为课堂版本吗？`)) return;
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

  const saveAndViewNext = async () => {
    const saved = dirty ? await save(cards) : draft;
    if (!saved) return;
    setActiveCard(index => Math.min(index + 1, Math.max(0, cards.length - 1)));
    requestAnimationFrame(() => document.getElementById('card-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const copyVersion = async () => {
    if (!draftId || !draft?.version || copying) return;
    setCopying(true);
    setError(''); setErrorCode('');
    try {
      const data = await rootRequest(`/api/assets/${encodeURIComponent(draftId)}/copy`, {
        method: 'POST',
        body: { version: draft.version }
      });
      if (!data?.asset?.draftId) throw Object.assign(new Error('copy_failed'), { code: 'copy_failed' });
      location.href = `/cards/?draftId=${encodeURIComponent(data.asset.draftId)}`;
    } catch (err) {
      setError(askErrorMessage(err)); setErrorCode(requestCode(err));
      setCopying(false);
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
    globalThis.history?.replaceState?.(null, '', url);
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
  const showPlanEditor = !workflowState.cardsGenerated || planDirty || planEditorOpen;
  const lockedCardCount = cards.filter(card => card?.status === 'locked').length;
  const scrollToSection = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      <div className="hero-actions"><button type="button" className="primary" onClick={startClassroom} disabled={!classroomReady}><PanelTop/>{classroomButtonCopy}</button><button type="button" onClick={exportMd} disabled={!cards.length}><Download/>导出方案</button><button type="button" onClick={publishAsset} disabled={!draftId || !workflowState.teacherConfirmed || !workflowState.cardsGenerated}><Archive/>收进教研资产库</button><details className="hero-more-tools"><summary><Menu/>更多课堂工具</summary><div className="hero-more-tools-grid">{draftId && <a href={`/alignment/?draftId=${encodeURIComponent(draftId)}`}><Target/>核对课标</a>}{draftId && workflowState.teacherConfirmed && workflowState.cardsGenerated && <a href={`/share/?draftId=${encodeURIComponent(draftId)}`}><Share2/>发布共备快照</a>}{draftId && workflowState.cardsGenerated && <a href={`/slides/?draftId=${encodeURIComponent(draftId)}`}><PanelTop/>生成课堂课件</a>}{draftId && workflowState.cardsGenerated && <a href={`/homework/?draftId=${encodeURIComponent(draftId)}`}><ClipboardCheck/>生成分层作业</a>}{draftId && workflowState.cardsGenerated && <a href={`/pulse/?draftId=${encodeURIComponent(draftId)}`}><Gauge/>课前学情摸底</a>}{draftId && workflowState.cardsGenerated && <a href={`/rehearsal/?draftId=${encodeURIComponent(draftId)}`}><Route/>预演问题链</a>}{draftId && workflowState.cardsGenerated && <a href={`/reflection/?draftId=${encodeURIComponent(draftId)}`}><History/>查看课后复盘</a>}</div></details></div>
    </section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>{noticeTitle}</b><p>{noticeBody}</p></div><div className="cards-alert-actions">{['auth_required','auth_invalid'].includes(errorCode) && <a className="primary" href={'/login/?next=' + encodeURIComponent(location.pathname + location.search)} onClick={() => rememberAuthReturn({ draftId })}>重新登录</a>}{citationNeedsReview && <button type="button" className="primary" onClick={confirmAndGenerate} disabled={Boolean(generating) || saving}><RefreshCw/>{generating ? '正在重试' : '重新核对并重试'}</button>}{isTeacherConfirmed(draft) && !workflowState.cardsGenerated && /^(gateway|deepseek|card_generation|evidence_)/u.test(errorCode) && <button type="button" className="primary" onClick={confirmAndGenerate} disabled={Boolean(generating)}><RefreshCw/>重试生成三卡</button>}<a href={draftId ? `/ask/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>{citationNeedsReview ? '回到本课问答核对依据' : draftId ? '返回本课问答' : '返回备课问答'}</a>{errorCode === 'draft_not_found' && <button type="button" onClick={() => location.reload()}><RefreshCw/>重新读取</button>}</div></section>}
    {busy ? <section className="panel cards-loading-skeleton" aria-label="正在读取课堂设计" aria-busy="true"><span className="sr-only">正在读取课堂设计…</span><div className="skeleton-line skeleton-title"/><div className="skeleton-line skeleton-copy"/><div className="skeleton-card-row"><i/><i/><i/></div></section> : showEmpty ? null : <>
      {assetMessage && <section className="quality-box"><CheckCircle2/><span>{assetMessage}</span><a href="/assets/">查看教研资产库</a></section>}
      {repairMessage && <section className="cards-repair-notice" role="status"><CheckCircle2/><span>{repairMessage}</span></section>}
      {exportNotice && <section className="quality-box offline-pack-notice"><CheckCircle2/><span>{exportNotice}</span><small>下载的 HTML 可以离线打开和打印；导出不会改动账号中的课堂记录。</small></section>}
      <section className="cards-workflow-guide panel" aria-label="一课三卡使用步骤">
        <header><div><span>本页使用顺序</span><b>第 {workflowGuideStep + 1} 步 · {workflowGuide[workflowGuideStep][0]}</b></div><p><strong>下一步：</strong>{workflowNextCopy}</p>{workflowState.cardsGenerated && <button type="button" className="workflow-primary-jump" onClick={() => scrollToSection('card-workspace')}>继续检查三卡 <ArrowRight/></button>}</header>
        <ol>{workflowGuide.map(([label, help], index) => <li className={index < workflowGuideStep ? 'done' : index === workflowGuideStep ? 'active' : ''} aria-current={index === workflowGuideStep ? 'step' : undefined} key={label}><span>{index < workflowGuideStep ? <Check size={14}/> : String(index + 1).padStart(2, '0')}</span><div><b>{label}</b><small>{help}</small></div></li>)}</ol>
      </section>
      <section className="cards-overview panel">
        <div className="cards-overview-title"><div><span>方案总览</span><h2>先确认这节课要带学生走到哪里</h2><p>{draft?.answer?.summary || '先从教材依据确定课堂主线。此处仍是方案草稿，不代表板书与三卡已经生成。'}</p></div><Badge tone={workflowState.unsavedChanges ? 'orange' : workflowState.teacherConfirmed ? 'green' : 'gold'}>{saving ? '正在保存' : workflowState.unsavedChanges ? '有未确认修改' : workflowState.teacherConfirmed ? '教师已定稿' : '方案草稿'}</Badge></div>
        <div className="cards-overview-meta"><span><b>课时</b>{draft?.lesson_context?.periods || draft?.lessonContext?.periods || 1} 课时</span><span><b>班级</b>{draft?.lesson_context?.className || draft?.lessonContext?.className || '未指定'} · {draft?.lesson_context?.classLevel || draft?.lessonContext?.classLevel || '普通'}</span><span><b>目标</b>{draft?.lesson_context?.teachingGoal || draft?.lessonContext?.teachingGoal || '理解文本'}</span><span><b>方式</b>{draft?.lesson_context?.teachingMode || draft?.lessonContext?.teachingMode || '探究'}</span><span><b>依据</b>{Array.isArray(draft?.citations) ? uniqueCitations(draft.citations).length : 0} 个页面</span><button type="button" onClick={loadHistory} disabled={historyBusy}><History/>{historyBusy ? '正在读取版本' : '查看版本历史'}</button></div>
        <AssetCoverage coverage={draft?.answer?.sourceCoverage}/>
        <div className={`curriculum-alignment-entry ${draft?.answer?.curriculumAlignment?.status || 'missing'}`}><Target/><div><b>{draft?.answer?.curriculumAlignment ? '已保存课标对齐' : '还没有确认课标对齐'}</b><p>{draft?.answer?.curriculumAlignment ? '学段要求、任务群候选和学业质量已分开记录，可以随时回到原始教材核验。' : '先找到课标原页，再由教师决定本课如何对齐学习任务群。'}</p></div>{draftId && <a href={`/alignment/?draftId=${encodeURIComponent(draftId)}`}>{draft?.answer?.curriculumAlignment ? '重新核对' : '开始核对'} <ArrowRight/></a>}</div>
        <PlanQualitySummary quality={planQuality}/>
      </section>
      {workflowState.cardsGenerated && <section className="cards-focus-nav panel" aria-label="课堂设计快捷入口"><div><span>当前要做</span><b>逐张检查三卡，再决定是否锁定</b><small>{lockedCardCount}/3 张已锁定；修改方案或课时编排不会在后台偷偷覆盖卡片。</small></div><div className="cards-focus-actions"><button type="button" className="primary" onClick={() => scrollToSection('card-workspace')}>编辑当前卡 <ArrowRight/></button><button type="button" onClick={() => scrollToSection('board-preview')}>预演板书</button><button type="button" onClick={() => setPlanEditorOpen(value => !value)}>{showPlanEditor ? '收起方案修改' : '修改已确认方案'}</button><button type="button" onClick={() => setSupportToolsOpen(value => !value)}>{supportToolsOpen ? '收起备课工具' : '展开课时、说课与依据'}</button></div></section>}
      {(!workflowState.cardsGenerated || supportToolsOpen) && <section className={`panel class-adaptation-panel ${classAdaptationOpen ? 'open' : ''}`}>
        <header><div><span>教学接棒</span><h2>同一份方案，可以换班，也可以交给同事接着上</h2><p>换班时建立独立教学版本；临时代课时生成可打印交接单。两种方式都保留教材页码，并隔离课堂记录与学生信息。</p></div><div className="class-adaptation-actions"><button type="button" onClick={() => setClassAdaptationOpen(value => !value)}>{classAdaptationOpen ? '收起换班设置' : '适配另一个班'}<ChevronDown/></button><button type="button" className="handoff" onClick={exportSubstituteTeachingPack} disabled={!draft}><FileCheck2/>下载代课交接单</button></div></header>
        {classAdaptationOpen && <div className="class-adaptation-body"><div className="class-adaptation-route"><span><small>当前方案</small><b>{draft?.lesson_context?.className || '尚未填写班级'}</b></span><ArrowRight/><span><small>目标班级</small><b>{targetClassName || '等待选择'}</b></span></div><div className="class-adaptation-form"><label><span>目标班级</span><input list="class-adaptation-options" value={targetClassName} maxLength="40" onChange={event => { const value = event.target.value; setTargetClassName(value); const profile = classProfiles.find(item => item.className === value); if (profile?.classLevel) setTargetClassLevel(profile.classLevel); setClassAdaptationMessage(''); }} placeholder="例如：九年级 4 班"/><datalist id="class-adaptation-options">{classProfiles.filter(item => item.className !== draft?.lesson_context?.className).map(item => <option value={item.className} key={item.className}>{item.lessonCount} 节记录</option>)}</datalist></label><label><span>班级情况</span><input value={targetClassLevel} maxLength="80" onChange={event => setTargetClassLevel(event.target.value)} placeholder="可选，例如：需要更多阅读支架"/></label><button type="button" className="primary" disabled={classAdaptationBusy || !targetClassName.trim() || planDirty || dirty} onClick={adaptToClass}>{classAdaptationBusy ? '正在建立目标班版本…' : '建立新版本并继续调整'}<ArrowRight/></button></div><div className="class-adaptation-boundary"><ShieldCheck/><p><b>保留：</b>篇目、教材页码、教学主线和三卡内容。<br/><b>重新开始：</b>教师定稿、卡片锁定、课堂记录、作业结果和课后复盘。</p></div>{classAdaptationMessage && <p className="class-adaptation-message" role="status">{classAdaptationMessage}</p>}</div>}
      </section>}
      {showPlanEditor && <section className="panel teacher-plan-editor">
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
      </section>}
      {generating && <section className="panel card-generation-progress" role="status" aria-live="polite"><div className="card-generation-spinner"><Activity/></div><div><span>{generating === 'all' ? '正在生成一课三卡' : '正在重新生成当前卡片'}</span><h2>{CARD_GENERATION_STEPS[generationStage]}</h2><p>系统会先形成课堂初稿，再核对教师用书、学生教材、问题递进和评价标准。页面可以停留在这里，原有内容会保留到新结果完整保存。</p><ol>{CARD_GENERATION_STEPS.map((step, index) => <li className={index < generationStage ? 'done' : index === generationStage ? 'active' : ''} key={step}><i>{index < generationStage ? <Check size={13}/> : index + 1}</i><b>{step}</b></li>)}</ol></div></section>}
      {(!workflowState.cardsGenerated || supportToolsOpen) && <PeriodPlanner draft={draft} onSaved={saved => { setDraft(saved); setCards(withBoardPlan(Array.isArray(saved.cards) ? saved.cards : cards, saved.answer?.lesson?.coreQuestion || saved.question || saved.title || '')); setPlanForm(planFormFromDraft(saved)); }} />}
      {history && <section className="panel cards-history"><header><div><span>方案历史</span><h2>先对比，再决定是否恢复</h2><p>恢复会把方案带回所选版本；当前已锁定的课堂卡片不会被覆盖。</p></div><button type="button" onClick={() => setHistory(null)}><X/>关闭</button></header><div>{(history.versions || []).length ? history.versions.map(item => <article key={item.id}><b>{item.id === 'current' ? '当前' : `V${item.version || '—'}`}</b><span>{item.id === 'current' ? '当前方案' : item.reason || '已保存版本'}</span><small>{item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : '—'}</small>{item.id === 'current' ? <Badge tone="green">正在使用</Badge> : <div className="cards-history-actions"><button type="button" onClick={() => compareHistory(item.id)} disabled={Boolean(historyWorking)}>{historyWorking === `compare:${item.id}` ? '对比中…' : '对比当前'}</button><button type="button" onClick={() => restoreHistory(item.id)} disabled={Boolean(historyWorking)}>{historyWorking === `restore:${item.id}` ? '恢复中…' : '恢复此版'}</button></div>}</article>) : <p>当前还没有可回看的历史版本。</p>}</div>{history.comparison && <div className="asset-comparison"><header><b>与当前方案的差异</b><small>{history.comparison.changed ? `${history.comparison.changes.length} 处变化` : '主要内容一致'}</small></header>{history.comparison.changes?.length ? <ul>{history.comparison.changes.map(change => <li key={change.field}><b>{change.label}</b><span>旧版：{change.before}</span><span>当前：{change.after}</span></li>)}</ul> : <p>所选版本与当前方案的主要内容一致。</p>}</div>}</section>}
      {!workflowState.cardsGenerated && <section className="panel cards-generation-gate"><div><FileCheck2/></div><span>下一步</span><h2>教师确认后再生成板书与三卡</h2><p>当前只有可编辑的方案草稿。保存修改并点击“确认本版”后，系统才会调用生成服务；不会把问答阶段的模型建议冒充为最终卡片。</p></section>}
      {workflowState.cardsGenerated && <>
      {supportToolsOpen && <><TeachingBrief brief={teachingBrief}/><TeachingEvidenceChain chain={teachingEvidenceChain} returnTo={cardsReaderReturn}/><section className="worksheet-entry panel"><div className="worksheet-entry-mark"><FileText/><span>03</span></div><div><span>正式课堂材料</span><h2>把定稿三卡整理成学生页与教师页</h2><p>学生页只给任务和学生教材页码；教师页保留观察要点与教师用书依据。下载后可以分别打印，不会把参考提示提前交给学生。</p></div><a className="primary" href={`/worksheet/?draftId=${encodeURIComponent(draftId)}`}>生成双页课堂任务单 <ArrowRight/></a></section></>}
      <section className="board-preview panel" id="board-preview">
        <header className="board-preview-head"><div><Badge tone="gold"><PanelTop/> 板书预览</Badge><h2>先留出问题，再跟着学生的回答补写</h2><p>课堂开始只显示课题和核心问题；学生说出关键词后，再展开教材依据、归纳结论，并保留教师现场补写的空间。</p></div><div className="board-preview-head-actions"><div className="board-preview-step"><b>0{revealed}</b><span>/ 05</span><small>{stages[revealed - 1]}</small></div><div className="board-export-actions"><button type="button" className={writingRehearsal ? 'active' : ''} onClick={() => setWritingRehearsal(value => !value)}>{writingRehearsal ? '收起落笔排练' : '查看落笔排练'}</button><button type="button" onClick={() => exportBoard('svg')}>导出 SVG</button><button type="button" onClick={() => exportBoard('png')}>导出 PNG</button><button type="button" className="offline-pack-button" onClick={exportOfflineClassroomPack}><Download/>下载离线课堂包</button></div></div></header>
      <div className="board-preview-canvas"><MindMapBoard title={lessonTitle} coreQuestion={boardCoreQuestion} items={(board && board.items) || []} stage={revealed} filterId="boardPreviewGlow" showWriteOrder={writingRehearsal}/><div className="board-stage-guide"><div><span>本步出现什么</span><b>{stageGuide[revealed - 1].reveal}</b></div><div><span>教师怎么追问</span><p>{stageGuide[revealed - 1].prompt}</p></div><div><span>学生留下什么</span><p>{stageGuide[revealed - 1].student}</p></div><div><span>下一步</span><p>{stageGuide[revealed - 1].next}</p></div></div></div>
      <section className={`board-writing-rehearsal ${boardWritingPlan.status}${writingRehearsal ? ' open' : ''}`}>
        <header><div><span>板书落笔排练</span><h3>这不是一张展示图，而是一块真正要写完的黑板</h3><p>系统只计算粉笔字量和书写顺序，不替教师改写已确认的板书内容。</p></div><div className="board-writing-metrics"><span><b>{boardWritingPlan.itemCount}</b> 条要点</span><span><b>{boardWritingPlan.totalChars}</b> 个可写字</span><span><b>约 {boardWritingPlan.estimatedMinutes}</b> 分钟</span><Badge tone={boardWritingPlan.status === 'ready' ? 'green' : 'orange'}>{boardWritingPlan.status === 'ready' ? '适合落笔' : '建议收缩'}</Badge></div></header>
        {writingRehearsal && <><div className="board-writing-steps">{boardWritingPlan.steps.map(step => <article className={revealed === step.stage ? 'active' : ''} key={step.stage} onClick={() => setRevealed(step.stage)}><span>0{step.stage}</span><small>{step.when}</small><b>{step.write.length ? step.write.join(' · ') : '本步不预写答案'}</b><p>{step.leave}</p><em>预计 {step.seconds} 秒</em></article>)}</div>{boardWritingPlan.issues.length > 0 && <div className="board-writing-issues"><CircleAlert/><div><b>上黑板前建议调整</b>{boardWritingPlan.issues.map(item => <p key={item}>{item}</p>)}</div></div>}</>}
      </section>
        <footer className="board-preview-footer"><div className="board-step-tabs" aria-label="板书展开步骤">{stages.map((stage, index) => <button type="button" className={revealed === index + 1 ? 'active' : ''} aria-current={revealed === index + 1 ? 'step' : undefined} key={stage} onClick={() => setRevealed(index + 1)}><span>0{index + 1}</span>{stage}</button>)}</div><button type="button" className="primary" onClick={startClassroom} disabled={!classroomReady}><Maximize2/>{classroomButtonCopy}</button></footer>
      </section>
      <section className="card-workspace panel" id="card-workspace">
        <header className="card-workspace-head"><div><span>课堂产物</span><h2>三张卡，分别对应课堂中的三个动作</h2><p>先选一张卡作为主编辑区；每条内容都可以修改、保存、锁定，并从依据芯片回到真实教材页面。</p></div><Badge tone="gold">{currentCard?.status === 'locked' ? '当前卡已锁定' : workflowCopy}</Badge></header>
        <nav className="card-nav" aria-label="选择课堂卡片">{cards.map((card, index) => <button type="button" className={`card-nav-item card-nav-${card.type}${activeCard === index ? ' active' : ''}`} aria-current={activeCard === index ? 'step' : undefined} onClick={() => setActiveCard(index)} key={card.id || (card.type + '-' + index)}><span className="card-nav-number">0{index + 1}</span><span><small className="card-nav-role">{CARD_META[card.type]?.role || '课堂行动'}</small><b>{card.title}</b><small>{card.subtitle || '把教材依据整理成课堂动作'}</small></span><em>{card.status === 'locked' ? '已锁定' : (card.items || []).length + ' 项内容'}</em><ChevronRight/></button>)}</nav>
        <div className="card-editor-layout">
          {currentCard && <article className={`card-editor card-editor-${currentCard.type}`}>
            <header className="card-editor-head"><div><span className="card-editor-kicker">{workflowCopy}</span><h3>{currentCard.title}</h3><p>{currentCard.subtitle || '把教材依据整理成课堂动作'}</p></div><Badge tone={currentCard.status === 'locked' ? 'gold' : dirty ? 'orange' : 'green'}>{currentCard.status === 'locked' ? '已锁定' : dirty ? '待保存' : '已保存'}</Badge></header>
            <div className="card-ribbon"><span>{workflowCopy}</span><i/></div>
            <div className="card-editor-guidance"><Sparkles/><div><b>这一张卡怎么写</b><p>{cardEditGuidance(currentCard.type)}</p></div></div>
            <ul className="card-items">{(currentCard.items || []).length ? (currentCard.items || []).map((item, itemIndex) => <li key={item.id || (currentCard.id + '-' + itemIndex)}><div className="card-item-mark"><Check/></div><div className="card-item-body"><textarea rows={3} value={item.text || ''} disabled={currentCard.status === 'locked'} onChange={event => updateItem(activeCard, itemIndex, event.target.value)} aria-label={currentCard.title + '第' + (itemIndex + 1) + '项'}/><div className="card-item-meta"><span>0{itemIndex + 1}</span><span className="source-type-chip">{sourceTypeLabel(item.sourceType)}</span>{cardItemNeedsDetail(currentCard.type, item.text) && currentCard.status !== 'locked' && <span className="detail-needed-chip">建议补全</span>}<CardSourceList citations={(draft && draft.citations) || []} refs={item.citationIds} returnTo={cardsReaderReturn}/></div></div></li>) : <li className="card-empty"><Sparkles/><span>这张卡暂时还没有内容。可以回到备课问答重新生成，也可以先保留这张卡，稍后补写。</span></li>}</ul>
            <footer className="card-actions"><span className={'save-state ' + (dirty ? 'pending' : '')}>{saving ? '正在保存…' : dirty ? '有未保存修改' : '内容已保存'}</span>{currentCard.status !== 'locked' ? <>{activeCard < cards.length - 1 ? <button type="button" className="primary" onClick={saveAndViewNext} disabled={saving}>{saving ? '保存中…' : '保存并查看下一张'}</button> : <button type="button" onClick={() => save(cards)} disabled={saving || !dirty}>{saving ? '保存中' : '保存修改'}</button>}<button type="button" onClick={() => regenerate(currentCard)} disabled={Boolean(generating)}>{generating === currentCard.id ? '正在依据中生成' : currentCard.items?.some(item => cardItemNeedsDetail(currentCard.type, item.text)) ? '补全本卡' : '重新生成本卡'}</button><button type="button" onClick={() => lock(currentCard)} disabled={saving}>锁定本卡</button></> : <button type="button" className="copy-version-action" onClick={copyVersion} disabled={copying}><Plus/>{copying ? '正在复制…' : '复制为新版本'}</button>}<a href={draftId ? `/ask/?draftId=${encodeURIComponent(draftId)}` : '/ask/'}>回到本课问答</a></footer>
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

export function rehearsalRecoveryKey(userId, draftId) { return `huojiaocan:rehearsal:${userId}:${draftId}`; }
export function readRehearsalRecovery(userId, draftId) {
  try { const value = JSON.parse(localStorage.getItem(rehearsalRecoveryKey(userId, draftId)) || 'null'); return value?.userId === userId && value?.draftId === draftId ? value : null; } catch { return null; }
}
export function clearRehearsalRecovery(userId, draftId) { try { localStorage.removeItem(rehearsalRecoveryKey(userId, draftId)); } catch {} }

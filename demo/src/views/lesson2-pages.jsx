// 备课推演与课后复盘页（Deliberation/Reflection，从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, History, Microscope, Quote, RefreshCw, Route } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { CardSourceList } from '../ui-board.jsx';
import { askErrorMessage, feedbackAdviceFromForm, feedbackStorageValue, normalizeFeedbackForm, normalizeTree, queryParams, request, requestCode, rootRequest, useAuthSession } from '../app-core.js';
import { defaultClassroomMomentTriage, normalizeClassroomMomentTriage } from '../../shared/classroom-carryover.js';
import { CLASSROOM_STAGE_LABELS, classroomRunHasContent, classroomRunToReflectionSeed, normalizeClassroomRun } from '../../shared/classroom-run.js';
import { emptyTeachingDeliberation, normalizeTeachingDeliberation, teachingDeliberationIsStale } from '../../shared/teaching-deliberation.js';
import { unitLessonNodes, unitNodes } from '../unit-planning.js';

export function DeliberationPage() {
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

export function ReflectionPage() {
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

export const STUDY_DECISIONS = [
  ['retain', '保留', '这项处理值得在相近班级继续使用'],
  ['adjust', '调整', '保留核心思路，只改变一个关键环节'],
  ['replace', '更换', '本次处理没有形成预期学习表现']
];

export function lessonStudyRecoveryKey(userId, draftId) {
  return `huojiaocan:lesson-study:${userId || 'anonymous'}:${draftId || 'unknown'}`;
}


// 学习配套页（Rehearsal/PreClassPulse/Worksheet/LearningEvidence，从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, Download, ExternalLink, FileCheck2, FileText, Gauge, PanelTop, Quote, RefreshCw, Route, ShieldCheck, Target } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { CardSourceList } from '../ui-board.jsx';
import { askErrorMessage, clearPulseRecovery, planIdentity, pulseRecoveryKey, queryParams, readPulseRecovery, requestCode, rootRequest, useAuthSession } from '../app-core.js';
import { buildClassroomWorksheet, buildClassroomWorksheetHtml } from '../../shared/classroom-worksheet.js';
import { emptyLearningEvidence, learningEvidenceIsStale, learningEvidenceProgress, learningEvidenceSummary, normalizeLearningEvidence } from '../../shared/learning-evidence.js';
import { emptyPreClassPulse, normalizePreClassPulse, preClassPulseIsStale, preClassPulseProgress } from '../../shared/preclass-pulse.js';
import { emptyQuestionRehearsal, normalizeQuestionRehearsal, questionRehearsalIsStale, rehearsalProgress } from '../../shared/question-rehearsal.js';

export function RehearsalPage() {
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

export function PreClassPulsePage() {
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

export function ClassroomWorksheetPage() {
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

export function LearningEvidencePage() {
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


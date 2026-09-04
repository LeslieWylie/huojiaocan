// 一课一研/同课异构/课件/分层作业页（从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { lessonStudyRecoveryKey, STUDY_DECISIONS } from './lesson2-pages.jsx';
import { Activity, Archive, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, ClipboardCheck, Download, Eye, FileCheck2, GitCompareArrows, History, Maximize2, Microscope, PanelTop, RefreshCw, Share2, ShieldCheck } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { CardSourceList } from '../ui-board.jsx';
import { askErrorMessage, docName, queryParams, requestCode, rootRequest, useAuthSession } from '../app-core.js';
import { layeredHomeworkStudentHtml, layeredHomeworkTeacherMarkdown } from '../../shared/layered-homework.js';
import { emptyLessonStudy, lessonStudyIsStale, lessonStudyReadiness, normalizeLessonStudy } from '../../shared/lesson-study.js';
import { emptySameLessonComparison, normalizeSameLessonComparison } from '../../shared/same-lesson-comparison.js';
import { teachingSlideDeckHtml } from '../../shared/teaching-slides.js';

export function LessonStudyPage() {
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

export function comparisonRecoveryKey(userId, leftId, rightId) {
  return `huojiaocan:same-lesson:${userId || 'anonymous'}:${leftId || 'left'}:${rightId || 'right'}`;
}

export function ComparisonPractice({ profile, side }) {
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

export function SameLessonComparisonPage() {
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

export function TeachingSlidesPage() {
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
      if (data.unavailableReason) {
        setDeck(null); setDraftVersion(Number(data.draftVersion || 0)); setStale(false);
        setError(data.unavailableReason === 'teaching_slides_require_confirmed_plan' ? '请先确认当前教学方案，再生成课堂课件。' : '请先生成一课三卡，再把课堂主线整理成课件。');
        return;
      }
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

export function LayeredHomeworkPage() {
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
      if (data.unavailableReason) {
        setPack(null); setDraftVersion(Number(data.draftVersion || 0)); setStale(false);
        setError(data.unavailableReason === 'homework_requires_confirmed_plan' ? '请先确认教学方案，再生成课后作业。' : data.unavailableReason === 'homework_requires_cards' ? '请先生成一课三卡，再把课堂目标转成分层作业。' : '当前三卡还没有绑定学生教材页码。请先补充教材依据，避免生成脱离课文的题目。');
        return;
      }
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

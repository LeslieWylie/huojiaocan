// ui-board：板书/证据链/课时编排视图组件（原在 App.jsx）
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, ClipboardCheck, Download, ExternalLink, FileSearch, Network, Play, Plus, Quote, Route, ShieldCheck } from 'lucide-react';
import { Badge, SectionHead } from './ui-kit.jsx';
import { askErrorMessage, boardLabelFromText, boardQuestion, citationLink, citationPage, classroomRecoveryKey, clearClassroomRecovery, docName, readClassroomRecovery, rootRequest, sourceTypeLabel, statusLabel, uniqueCitations, wrapSvgText, writeClassroomRecovery } from './app-core.js';
import { CLASSROOM_STAGE_LABELS, normalizeClassroomRun } from '../shared/classroom-run.js';
import { buildPeriodPlan, reorderPeriodActivity, repairPeriodSequence, serializePeriodPlan, updatePeriodActivity } from '../shared/period-planner.js';

export function SvgLabel({ x, y, text, className = 'board-svg-label', max = 13, anchor = 'middle' }) {
  return <text x={x} y={y} textAnchor={anchor} className={className}>{wrapSvgText(text, max).map((line, index) => <tspan x={x} dy={index ? 21 : 0} key={`${line}-${index}`}>{line}</tspan>)}</text>;
}
export function MindMapBoard({ title, items = [], stage = 1, filterId = 'chalkGlow', coreQuestion = '', classroomRun = null, showWriteOrder = false }) {
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
export function CardSourceList({ citations = [], refs = [], returnTo = 'cards' }) {
  const items = uniqueCitations(citations, refs);
  if (!items.length) return <span className="card-source-empty">尚未绑定教材依据</span>;
  const first = items[0];
  const rest = items.slice(1);
  const chip = item => { const href = citationLink(item, returnTo); return href ? <a href={href} key={String(item.documentId) + '-' + citationPage(item)}><Quote size={12}/>{docName(item.documentId)} · 第 {citationPage(item)}页</a> : null; };
  return <div className="card-source-list"><span className="card-source-label">教材依据</span>{chip(first)}{rest.length > 0 && <details><summary>另有 {rest.length} 个依据</summary><div>{rest.map(chip)}</div></details>}</div>;
}
export function TeachingBrief({ brief }) {
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

export function TeachingEvidenceChain({ chain, returnTo = 'cards' }) {
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

export function PeriodPlanner({ draft, onSaved }) {
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

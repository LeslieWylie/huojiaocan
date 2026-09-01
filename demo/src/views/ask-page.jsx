// 备课问答页（CitationChips/RouteTrace/ConversationSide/AskPage 等，从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardCheck, Download, ExternalLink, History, MessageCircle, Network, Plus, Quote, Route, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Badge, SectionHead } from '../ui-kit.jsx';
import { normalizeAskAction } from '../ask-actions.js';
import { withAskRetry } from '../ask-retry.js';
import { authOwnersConflict, canPersistAuthOwner, clearAuthRecovery, ensureSession, getSession, readAuthRecovery, saveAuthRecovery } from '../auth.js';
import { buildAskContext, buildConversationHistory } from '../conversation-context.js';
import { clearConversationSnapshot, readConversationSnapshot, readRecentConversationSnapshots, saveConversationSnapshot } from '../conversation-recovery.js';
import { UI_COPY } from '../copy.js';
import { evidenceShelfKey, mergeEvidenceShelf, removeEvidenceShelfItem } from '../evidence-shelf.js';
import { pairLessonEvidence } from '../lesson-evidence.js';
import { citationByRef } from './library-page.jsx';
import { draftRecoverySnapshot } from './shell-pages.jsx';
import { cardsForAskDraft } from '../teacher-finalization.js';
import { checklistProgress, deriveWorkflowChecklist } from '../workflow-checklist.js';
import { EXAMPLES, askErrorMessage, canonicalDocumentId, citationLink, citationPage, citationText, cacheDraftForRecovery, docName, isIndexRecoveryCode, lessonRefFromUrl, normalizeFeedbackForm, planIdentity, rememberAuthReturn, request, requestCode, rootRequest, sameLessonRef, unitRefFromUrl, useAuthSession } from '../app-core.js';
import { teachingDeliberationIsStale } from '../../shared/teaching-deliberation.js';
import { normalizePreviousLessonCarryover } from '../../shared/classroom-carryover.js';

export function CitationChips({ citations, refs, returnTo = 'ask', limit = 4 }) {
  const items = citationByRef(citations, refs);
  if (!items.length) return null;
  return <div className="citation-chips">{items.slice(0, limit).map(item => { const href = citationLink(item, returnTo); return href ? <a href={href} key={`${item.documentId}-${citationPage(item)}`} title={`${item.documentTitle} · ${item.sectionPath?.join(' › ') || ''}`}><Quote size={11}/>{docName(item.documentId)} · 第 {citationPage(item)}页</a> : null; })}</div>;
}
export function RouteTrace({ route }) {
  const docs = route?.documents || [];
  const ranges = route?.pageRanges || [];
  const reactSteps = Array.isArray(route?.reactTrace) ? route.reactTrace.filter(item => item?.action === 'search' && item.query) : [];
  return <details className="route-trace" open><summary><Route size={15}/><b>资料定位</b><span>{route?.evidenceCount || 0} 个相关页面</span><ChevronDown size={14}/></summary><div className="route-trace-body"><div className="route-steps">{(route?.retrievalSteps || ['读取教材目录', '定位相关篇目与段落', '打开对应 教材原页']).map((step, index) => <span key={`${step}-${index}`}><i>{index + 1}</i>{step}{index < (route?.retrievalSteps || []).length - 1 && <ChevronRight/>}</span>)}</div>{reactSteps.length > 0 && <div className="route-agent-note"><Sparkles size={14}/><span>本轮根据当前问题补查了 {reactSteps.length} 次更具体的教材页面。</span></div>}<div className="route-docs">{docs.map(doc => { const range = ranges.find(item => item.documentId === doc.id); return <span key={doc.id}><b>{doc.title || docName(doc.id)}</b>{range && ` · 第 ${range.from}—${range.to}页`}</span>; })}</div></div></details>;
}
export function WorkflowStrip({ lessonTitle }) {
  const steps = [
    ['01', '确认本课材料', '锁定当前篇目，同时找到教师用书处理和学生教材原文；课标只说明学段要求。'],
    ['02', '回答当前问题', '围绕教师这一轮真正想解决的问题，给出课堂主张、学生任务和可核验页码。'],
    ['03', '定稿课堂设计', '教师确认取舍后，再生成板书、提问和评价三卡；后续追问仍留在同一篇目。']
  ];
  return <section className="workflow-strip"><header><div><span>本课工作路径</span><h2>{lessonTitle || '从教材到课堂'}</h2></div><small>三步都围绕同一篇目进行；追问只调整当前问题，不会改写篇目身份。</small></header><div className="workflow-steps">{steps.map(([number, title, description], index) => <article key={number} className={index === 1 ? 'priority' : ''}><b>{number}</b><div><strong>{title}</strong><p>{description}</p></div>{index < steps.length - 1 && <ArrowRight/>}</article>)}</div></section>;
}
export function PlanAnswer({ answer, citations, cardSuggestions, draftId, returnTo = 'ask' }) {
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
export function ContextSelect({ label, value, onChange, options, hint }) {
  return <label className="context-control"><span className="context-control-label">{label}</span><span className="context-select"><select value={value} onChange={onChange}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select><ChevronDown size={14}/></span>{hint && <small>{hint}</small>}</label>;
}
export function ContextText({ label, value, onChange, hint, placeholder }) {
  return <label className="context-control context-text"><span className="context-control-label">{label}</span><span className="context-select"><input value={value} onChange={onChange} maxLength="40" placeholder={placeholder}/></span>{hint && <small>{hint}</small>}</label>;
}
export function ConversationTurn({ turn, draftId, onQuickAsk, onSaveEvidence }) {
  const response = turn.response;
  const blocked = response?.generation === 'blocked-no-evidence' || response?.evidenceSufficient === false;
  if (!response) return null;
  const cardsDraftId = draftId || response.draftId || '';
  const cardsHref = cardsDraftId ? `/cards/?draftId=${encodeURIComponent(cardsDraftId)}` : '';
  const askReturnTo = cardsDraftId ? `/ask/?draftId=${encodeURIComponent(cardsDraftId)}` : 'ask';
  return <article className="conversation-turn"><div className="turn-question"><small>你的问题</small><p>{turn.question}</p>{turn.operationLabel && <span className="turn-operation">本轮调整：{turn.operationLabel.replace(/请保持当前篇目与核心问题，/u, '').replace(/。$/u, '')}</span>}{response.conversation?.historyUsed && <span className="turn-context-used"><CheckCircle2 size={13}/>已沿用本场对话上下文</span>}</div>{response.retrievalMode === 'stable_snapshot' && <div className="snapshot-banner"><CheckCircle2/><div><b>{UI_COPY.recovery.snapshotBanner}</b><small>{UI_COPY.recovery.snapshotBody}{response.fallbackAt ? ` 快照时间：${new Date(response.fallbackAt).toLocaleString()}` : ''}</small></div></div>}{blocked ? <div className="answer-blocked compact-blocked"><div className="answer-blocked-head"><CircleAlert/><div><Badge tone="orange">依据不足，已停止生成</Badge><h2>{UI_COPY.ask.blockedTitle}</h2><p>{UI_COPY.ask.blockedBody}</p></div></div></div> : <>{Number(response.generationRounds) > 1 && <div className="agent-review-note"><CheckCircle2 size={16}/><span><b>{Number(response.generationRounds) >= 3 ? '已完成教材校核与课堂可用性修订' : '已完成两轮教材校核'}</b><small>{Number(response.generationRounds) >= 3 ? '初稿仍有顺序或时间问题时，系统已增加一轮定向修订。' : '先形成课堂初稿，再按教师用书、学生教材与真实页码逐项修订。'}</small></span></div>}{Array.isArray(response.teachingPlanIssues) && response.teachingPlanIssues.length > 0 && <div className="agent-teaching-warning"><CircleAlert/><div><b>当前流程仍需教师确认</b><ul>{response.teachingPlanIssues.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul></div></div>}<div className="understanding-card"><small>问题理解</small><p>{response.understanding || response.question}</p></div><RouteTrace route={response.route}/><PlanAnswer answer={response.answer} citations={response.citations || []} cardSuggestions={response.cardSuggestionItems || response.cardSuggestions || response.threeCardSuggestions} draftId={cardsDraftId} returnTo={askReturnTo}/><div className="turn-followups"><button onClick={() => onQuickAsk({ prompt: '请优先展开教师用书中的教学建议，并保留当前篇目。' })}>展开教师用书依据</button><button onClick={() => onQuickAsk({ prompt: '请只呈现最直接的原始教材依据，并保留当前篇目。' })}>只看原始依据</button><button onClick={() => onQuickAsk({ prompt: '请调整为两课时课堂节奏。', operation: { type: 'change_periods', periods: 2 }, lessonContextPatch: { periods: 2 } })}>换成两课时</button>{cardsHref ? <a className="turn-followup-primary" href={cardsHref}>查看并定稿方案 <ArrowRight size={14}/></a> : <button onClick={() => onQuickAsk({ prompt: '请先保存当前备课方案，再进入教师定稿。' })}>保存方案后定稿</button>}</div><div className="turn-evidence-actions"><button type="button" onClick={() => onSaveEvidence?.(response.citations || [])}><Plus size={14}/>加入本课依据夹</button><small>把本轮已核验页面收好，之后可从右侧直接回看。</small></div><details className="raw-evidence"><summary>查看原文片段与页码</summary><div>{(response.citations || []).slice(0, 6).map(item => <a href={citationLink(item, askReturnTo)} key={item.id}><b>{docName(item.documentId)} · 第{item.pdfPage}页</b><small>{item.sectionPath?.join(' › ') || '原始页面'}</small><p>{citationText(item)}</p></a>)}</div></details></>}</article>;
}
export function EvidenceShelf({ items, onRemove, onClear, returnTo = 'ask' }) {
  return <section className="evidence-shelf"><header><div><b>本课依据夹</b><small>{items.length ? `${items.length} 个已核验页面` : '把重要页面收在这里'}</small></div>{items.length ? <button type="button" onClick={onClear}>清空</button> : null}</header>{items.length ? <div className="evidence-shelf-list">{items.map(item => <div className="evidence-shelf-item" key={`${item.documentId}:${item.pdfPage}`}><a href={citationLink(item, returnTo)}><b>{docName(item.documentId)} · 第{item.pdfPage}页</b><small>{item.sectionPath?.join(' › ') || '原始页面'}{item.printedPage ? ` · 书页 ${item.printedPage}` : ''}</small></a><button type="button" aria-label="移除依据" onClick={() => onRemove(item)}><X size={13}/></button></div>)}</div> : <p>在回答下方点击“加入本课依据夹”，把需要反复核对的教师用书和教材页面集中起来。</p>}</section>;
}
export function DualSourceEvidenceDesk({ title, evidence, busy, error, onSave, returnTo = 'ask' }) {
  if (!title) return null;
  const sources = [
    { id: 'textbook', label: '学生教材', purpose: '核对课文原文、助学任务和关键语句', result: evidence?.textbook },
    { id: 'teacher-guide', label: '教师教学用书', purpose: '参考教学重点、活动顺序、问题链和评价建议', result: evidence?.teacherGuide }
  ];
  const available = sources.map(item => item.result).filter(Boolean);
  return <section className="panel dual-source-desk"><header><div><span>同课双源依据</span><h2>{title}</h2><p>先对照两份材料，再开始生成方案。页码来自教材搜索结果，不根据另一份材料猜测。</p></div>{available.length ? <button type="button" onClick={() => onSave?.(available)}><Plus size={15}/>加入本课依据夹</button> : null}</header>{busy ? <div className="dual-source-loading"><Activity size={18}/><span>正在定位学生教材和教师教学用书的对应页面…</span></div> : error ? <div className="dual-source-error"><CircleAlert size={17}/><span>{error}</span></div> : <div className="dual-source-grid">{sources.map(source => { const item = source.result; const page = citationPage(item); const link = item ? citationLink(item, returnTo) : ''; return <article className={item ? 'ready' : 'missing'} key={source.id}><div className="dual-source-head"><span>{source.label}</span>{item ? <b>已定位</b> : <b>待补充</b>}</div><h3>{item?.title || item?.sectionPath?.at?.(-1) || (item ? title : '暂未找到对应页面')}</h3><p>{item ? citationText(item).slice(0, 180) || source.purpose : `没有找到足以确认的${source.label}页面，不会用另一份材料的页码代替。`}</p><footer><small>{item ? `${source.label} · 第${page}页${item.printedPage ? ` · 书页 ${item.printedPage}` : ''}` : source.purpose}</small>{link ? <a href={link}>核验原始页<ExternalLink size={13}/></a> : null}</footer></article>; })}</div>}</section>;
}
export function WorkflowChecklist({ messages, draft, cards, onQuickAsk, draftId }) {
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
export function scopeLabel(value) {
  if (value === 'textbook') return '学生教材';
  if (value === 'teacher-guide') return '教师教学用书';
  if (value === 'curriculum-standard') return '课程标准';
  if (value === 'all') return '课程标准 + 学生教材 + 教师教学用书';
  return '学生教材 + 教师教学用书';
}
export function scopeDocumentIds(value) {
  if (value === 'all') return ['curriculum-standard', 'textbook', 'teacher-guide'];
  if (value === 'both') return ['textbook', 'teacher-guide'];
  return [canonicalDocumentId(value || 'textbook')];
}
export function persistedConversationTurn(turn) {
  if (!turn || !turn.response) return null;
  return {
    role: 'user',
    question: String(turn.question || '').trim(),
    operationLabel: String(turn.operationLabel || ''),
    response: turn.response
  };
}
export function ConversationSide({
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
export function AskPage() {
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
  const [newConversationPromptOpen, setNewConversationPromptOpen] = useState(false);
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
  const confirmStartNewConversation = () => {
    setNewConversationPromptOpen(false);
    clearConversationSnapshot(session?.user?.id || initialUser);
    setMessages([]); setConversationHistory([]); setExistingDraft(null); setDraftId(''); setQuestion(''); setPlanQuestion(''); setLessonRef(null); setRestoredAt(''); setRestoredFromLocal(false);
    const url = new URL(location.href);
    // Keep the current draft addressable in the account history. The `new`
    // marker explicitly prevents the browser-local active snapshot and any
    // auth hand-off from silently reopening the previous thread.
    url.search = '?new=1';
    history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  const startNewConversation = () => {
    if (messages.length) {
      setNewConversationPromptOpen(true);
      return;
    }
    confirmStartNewConversation();
  };
  useEffect(() => {
    if (!newConversationPromptOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setNewConversationPromptOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [newConversationPromptOpen]);
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
  const activeLessonLabel = pairedLessonTitle || lessonRef?.title || (planQuestion ? planIdentity(planQuestion, '') : '') || '尚未选择篇目';
  const scopeLabel = {
    all: '课标、学生教材与教师用书',
    both: '学生教材与教师用书',
    textbook: '学生教材',
    'teacher-guide': '教师用书',
    'curriculum-standard': '课程标准'
  }[scope] || '教材材料';
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
      <div className="ask-layout">
        <section className="panel ask-main">
          <div className="ask-context-summary" aria-label="当前备课范围">
            <div><span>当前篇目</span><b>{activeLessonLabel}</b></div>
            <div><span>课堂条件</span><b>{lessonContext.periods} 课时 · {lessonContext.classLevel} · {lessonContext.teachingGoal}</b></div>
            <div><span>教材范围</span><b>{scopeLabel}</b></div>
            <button type="button" onClick={() => document.getElementById('lesson-context-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>修改条件</button>
          </div>
          <form className="ask-large" onSubmit={ask}>
            <MessageCircle/>
            <textarea ref={composerRef} value={question} onChange={event => setQuestion(event.target.value)} placeholder={messages.length ? '继续追问，例如：教师用书建议对应学生教材哪一段？' : '例如：怎样备课《沁园春·雪》？'}/>
            <button type="submit" className="primary" disabled={busy || !question.trim() || askBlocked}><Send/>{askButtonLabel}</button>
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
      <section className="panel lesson-context" id="lesson-context-panel">
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
      {newConversationPromptOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setNewConversationPromptOpen(false)}><section className="panel ask-new-conversation-modal" role="dialog" aria-modal="true" aria-labelledby="ask-new-conversation-title" onMouseDown={event => event.stopPropagation()}><header><div><span>开始新的备课</span><h2 id="ask-new-conversation-title">要另起一课吗？</h2></div><button type="button" onClick={() => setNewConversationPromptOpen(false)} aria-label="关闭"><X/></button></header><p>当前草稿、教材依据和历史问答都会保留在账号中；这里只会清空本页正在进行的对话，方便你选择另一篇课文重新开始。</p><div className="ask-new-conversation-preserved"><CheckCircle2/><div><b>{activeLessonLabel}</b><small>{draftId ? '当前方案仍可从备课记录中继续打开' : '当前对话记录仍会保留'}</small></div></div><footer><button type="button" autoFocus onClick={() => setNewConversationPromptOpen(false)}>继续当前备课</button><button type="button" className="primary" onClick={confirmStartNewConversation}>保留草稿，另起一课</button></footer></section></div>}
    </div>
  );
}

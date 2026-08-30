// 应用壳：侧栏导航/布局/教学任务/引导页（从 App.jsx 迁出）
import { useEffect, useState } from 'react';
import { Activity, Archive, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardCheck, FileSearch, FileText, GitCompareArrows, History, Layers3, Library, Menu, MessageCircle, Microscope, Network, PanelTop, Play, RefreshCw, Route, ShieldCheck, Target, Upload, X } from 'lucide-react';
import { Badge, Logo } from '../ui-kit.jsx';
import { ROUTES, request, rootRequest, statusLabel, useAuthSession } from '../app-core.js';
import { signOut } from '../auth.js';

export const PRIMARY_NAV = [
  ['dashboard', '/', Route, '教学任务'],
  ['library', '/library/', Library, '教材库'],
  ['unit', '/unit/', Network, '单元接力'],
  ['ask', '/ask/', MessageCircle, '备课问答'],
  ['cards', '/cards/', Layers3, '一课三卡'],
  ['assets', '/assets/', Archive, '教研资产']
];
export const WORKFLOW_TOOL_NAV = [
  ['alignment', '/alignment/', Target, '课标对齐'],
  ['slides', '/slides/', PanelTop, '课堂课件'],
  ['study', '/study/', Microscope, '一课一研'],
  ['compare', '/compare/', GitCompareArrows, '同课异构'],
  ['research', '/research/', FileText, '教研问题簿']
];
export const MATERIAL_NAV = [
  ['ingest', '/ingest/', Upload, '导入教材'],
  ['jobs', '/jobs/', Activity, '处理进度'],
  ['inspect', '/inspect/', FileSearch, '页面校正'],
  ['validation', '/validation/', ClipboardCheck, '质量检查']
];




export function readDraftRecovery(userId, id) {
  try { return readOwnedDraftRecovery(localStorage, userId, id); } catch { return null; }
}



export function draftRecoverySnapshot(draft, cards = draft?.cards) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    draft: { ...draft, cards: undefined },
    cards: Array.isArray(cards) ? cards : Array.isArray(draft.cards) ? draft.cards : []
  };
}

export function Sidebar({ active, open, close }) {
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
export function Layout({ active, children }) {
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
  return <div className="app-shell"><Sidebar active={active} open={open} close={() => setOpen(false)}/><main className="main-area"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu" aria-label="打开侧栏导航" onClick={() => setOpen(true)}><Menu/></button><span>活教参</span><ChevronRight/><b>{title}</b></div><div className="top-actions"><span className={`mode mode-${aiState}`} title="系统 AI 仅在后台调用"><i/>{aiLabel}</span>{session ? <><a href="/settings/">AI 设置</a><button className="text-action" onClick={async()=>{await signOut();location.reload();}}>退出</button></> : <a href="/login/">登录</a>}<a href={askHref}><MessageCircle/>{currentDraftId ? '本课问答' : '提问'}</a><a href="/ingest/"><Upload/>导入</a></div></header><div className="content">{children}</div></main></div>;
}

export function normalizeCatalogItem(item) {
  if (!item || !item.id) return null;
  const rawType = String(item.documentType || item.type || '').trim().toLowerCase().replaceAll('_', '-').replace(/\s+/g, '-');
  const documentType = ['teacher-guide', 'teacher-guidebook', 'guide'].includes(rawType) || item.id === 'teacher-guide' ? 'teacher_guide' : ['textbook', 'student-textbook', 'student-book'].includes(rawType) || item.id === 'textbook' ? 'textbook' : ['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(rawType) || item.id === 'curriculum-standard' ? 'curriculum_standard' : rawType || 'other';
  return { ...item, id: String(item.id), documentType, title: item.title || item.originalFilename || String(item.id), short: item.short || item.shortTitle || (documentType === 'teacher_guide' ? '教师教学用书' : documentType === 'textbook' ? '学生教材' : documentType === 'curriculum_standard' ? '课程标准' : item.title || String(item.id)), pageCount: Number(item.pageCount || item.pages || 0), indexedPages: Number(item.indexedPages || item.indexed_pages || 0), pdfUrl: item.pdfUrl || '', issueCount: Number(item.issueCount || 0), visibility: item.visibility || 'public', tone: documentType === 'teacher_guide' ? 'blue' : documentType === 'textbook' ? 'orange' : documentType === 'curriculum_standard' ? 'standard' : 'green' };
}

export const GUIDANCE_STEPS = [
  ['选定篇目', '从教材目录或搜索结果打开课文起始页，先确认教材页码、书页和章节范围。'],
  ['核对课程标准', '找到学段要求、相关学习任务群和学业质量原页；篇目的具体对齐由教师确认。'],
  ['读教师用书', '优先查看教师用书中的教学目标、重点难点、活动顺序和参考处理。'],
  ['回到学生教材', '回到课文原页核对词句、任务和段落结构；原始教材始终是课堂核验的真源。'],
  ['连续追问', '围绕同一篇目继续追问，系统会保留本场对话、教材范围和已经核对过的页面。'],
  ['生成课堂材料', '把已经核对的内容整理成方案、三卡和渐进式板书，教师可以编辑、保存、锁定。']
];
export function GuidancePage() {
  return <div className="view-stack guidance-page">
    <section className="hero compact-hero guidance-hero"><div><Badge tone="green"><Play/> 使用引导</Badge><h1>从选篇目开始，<br/><em>一步步把课备到课堂上</em></h1><p>这不是一次性生成教案。活教参会先定位篇目，再查看教师用书、核对学生教材，最后把已经确认的依据整理成可直接使用的课堂材料。</p><div className="hero-actions"><a className="primary" href="/library/"><Library/>先选一篇课文</a><a href="/ask/"><MessageCircle/>直接开始提问</a></div></div><div className="guidance-hero-mark"><span>01</span><b>选篇目</b><i/><span>02</span><b>看教师用书</b><i/><span>03</span><b>回原文</b></div></section>
    <section className="panel guidance-video-panel"><div className="guidance-video-intro"><Badge tone="gold">三分钟看懂</Badge><h2>一条备课路径，五个动作完成</h2><p>建议第一次使用时完整看一遍。以后从教材库进入某篇课文，就可以沿着同样的顺序继续。</p><div className="guidance-video-note"><CheckCircle2/><span><b>视频中的每一步都能在页面中直接完成</b><small>目录定位、教材原页核验、连续追问和课堂材料会沿用同一篇目。</small></span></div></div><div className="guidance-video-frame"><video controls playsInline preload="metadata" poster="/guidance/活教参备课引导封面.svg"><source src="/guidance/活教参备课引导.mp4" type="video/mp4"/><track kind="captions" src="/guidance/活教参备课引导.vtt" srcLang="zh-CN" label="中文字幕" default/>当前浏览器无法播放视频。</video><p>如果视频无法播放，可以直接查看下方的文字步骤。</p></div></section>
    <section className="guidance-steps panel"><header><div><Badge tone="blue">文字版路径</Badge><h2>每一步应该看什么、做什么</h2></div><span>从材料定位到课堂使用</span></header><div className="guidance-step-grid">{GUIDANCE_STEPS.map(([title, body], index) => <article key={title}><div className="guidance-step-number">0{index + 1}</div><div><h3>{title}</h3><p>{body}</p>{index === 0 && <a href="/library/">打开教材库 <ArrowRight/></a>}{index === 3 && <a href="/ask/">进入备课问答 <ArrowRight/></a>}{index === 4 && <a href="/ask/">继续追问并保存方案 <ArrowRight/></a>}{index === 5 && <a href="/ask/">生成本课课堂材料 <ArrowRight/></a>}</div></article>)}</div></section>
    <details className="panel guidance-checklist"><summary><span><ClipboardCheck/>第一次使用，可以按这张清单走</span><ChevronDown/></summary><div><p>选好篇目后，不必重复上传或重复构建；问答、引用、三卡和板书都读取已经准备好的教材。</p><ul>{['确认课文起始页和教师用书相关页', '先看教师用书的教学处理，再回到学生教材核对原文', '追问时沿用同一场对话，不要另开一个问题丢失上下文', '生成后先编辑，再保存和锁定需要带进课堂的内容'].map(item => <li key={item}><Check/>{item}</li>)}</ul></div></details>
    </div>;
}
export const TASK_PHASE_META = {
  continue_preparation: { label: '备课', icon: MessageCircle, tone: 'prepare' },
  confirm_plan: { label: '定稿', icon: CheckCircle2, tone: 'finalize' },
  generate_cards: { label: '成课', icon: Layers3, tone: 'finalize' },
  enter_classroom: { label: '课堂', icon: Play, tone: 'classroom' },
  confirm_reflection: { label: '课后', icon: History, tone: 'reflect' },
  process_homework_return: { label: '回流', icon: ClipboardCheck, tone: 'reflect' },
  continue_next_lesson: { label: '接力', icon: Network, tone: 'relay' },
  completed: { label: '完成', icon: Check, tone: 'complete' }
};

export function Dashboard() {
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


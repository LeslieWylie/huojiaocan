// 单元接力页（从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, CircleAlert, ExternalLink, History, Library, Network, Route, ShieldCheck } from 'lucide-react';
import { Badge, SectionHead } from '../ui-kit.jsx';
import { CARD_EDIT_GUIDANCE, currentPageReturn, normalizeTree, queryParams, request, rootRequest, useAuthSession } from '../app-core.js';
import { buildReaderHref } from '../reader-target.js';
import { buildUnitTrack, stableNodeId, unitNodes, unitTrackInsights } from '../unit-planning.js';

export function Unit() {

  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const [tree, setTree] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const unitLoadRef = useRef(0);
  const requestedUnit = params.get('unit') || '';
  const [selectedUnitId, setSelectedUnitId] = useState(requestedUnit);
  const units = useMemo(() => unitNodes(tree), [tree]);
  const selectedUnit = units.find(item => String(item.id) === String(selectedUnitId))
    || units.find(item => stableNodeId(item.id) === stableNodeId(selectedUnitId))
    || units[0] || null;
  const track = useMemo(() => buildUnitTrack(selectedUnit || {}, drafts, assets), [selectedUnit, drafts, assets]);
  const insight = useMemo(() => unitTrackInsights(track), [track]);

  const load = async () => {
    const loadId = ++unitLoadRef.current;
    setBusy(true); setError('');
    // Personal progress must disappear immediately when the account changes;
    // never leave the previous account's lesson status visible during retry.
    setDrafts([]); setAssets([]);
    try {
      const treeData = await request('/documents/textbook/tree');
      if (loadId !== unitLoadRef.current) return;
      setTree(normalizeTree(treeData));
      if (session?.user?.id) {
        const [draftData, assetData] = await Promise.all([rootRequest('/api/drafts'), rootRequest('/api/assets')]);
        if (loadId !== unitLoadRef.current) return;
        setDrafts(draftData.drafts || []);
        setAssets(assetData.assets || []);
      } else {
        setDrafts([]); setAssets([]);
      }
    } catch {
      if (loadId !== unitLoadRef.current) return;
      setError('单元目录暂时没有读取完整，请稍后重试。');
    } finally { if (loadId === unitLoadRef.current) setBusy(false); }
  };
  useEffect(() => {
    load();
    return () => { unitLoadRef.current += 1; };
  }, [session?.user?.id]);
  useEffect(() => {
    if (!selectedUnit?.id || String(selectedUnit.id) === String(selectedUnitId)) return;
    setSelectedUnitId(String(selectedUnit.id));
    const url = new URL(location.href);
    url.searchParams.set('unit', String(selectedUnit.id));
    history.replaceState(null, '', url);
  }, [selectedUnit?.id, selectedUnitId]);

  const selectUnit = id => {
    const url = new URL(location.href);
    url.searchParams.set('unit', id);
    history.replaceState(null, '', url);
    setSelectedUnitId(id);
  };
  const unitRefQuery = (unit, lesson) => new URLSearchParams({
    q: `怎样备课《${lesson.title}》？请说明它在${unit.title}中的承接作用。`,
    scope: 'both',
    doc: unit.documentId || 'textbook',
    page: String(lesson.startPage),
    node: lesson.nodeId,
    lesson: lesson.title,
    unit: unit.id,
    unitTitle: unit.title,
    unitStart: String(unit.pageRange?.start || ''),
    unitEnd: String(unit.pageRange?.end || ''),
    lessonIndex: String(lesson.index),
    lessonTotal: String(lesson.total)
  }).toString();
  const statusMeta = status => ({
    not_started: ['尚未开始', 'neutral'],
    draft: ['备课中', 'orange'],
    ready: ['待上课', 'blue'],
    in_class: ['课堂进行中', 'gold'],
    recorded: ['待确认复盘', 'purple'],
    reflected: ['已复盘', 'green']
  })[status] || ['尚未开始', 'neutral'];
  const lessonAction = lesson => {
    if (!lesson?.draft) return { href: `/ask/?${unitRefQuery(selectedUnit, lesson)}`, label: '开始当前课' };
    const id = encodeURIComponent(lesson.draft.id);
    if (lesson.status === 'in_class') return { href: `/cards/?draftId=${id}&classroom=1`, label: '继续本节课堂' };
    if (lesson.status === 'recorded') return { href: `/reflection/?draftId=${id}`, label: '确认课后复盘' };
    if (lesson.status === 'ready') return { href: `/cards/?draftId=${id}`, label: '开始上课' };
    return { href: `/ask/?draftId=${id}`, label: lesson.status === 'reflected' ? '查看本课记录' : '继续当前课' };
  };

  return <div className="view-stack unit-relay-page">
    <section className="hero compact-hero unit-relay-hero"><div><Badge tone="gold"><Network/> 从教材问题到真实学情</Badge><h1>不只记录课堂感受，<br/><em>还要让作业结果改变下一次备课</em></h1><p>课前预演问题，课堂保留事实，课后按同一问题汇总班级作业达成。下一次备课先承接教师确认的学情，再重新核验当前教材与教师用书。</p><div className="hero-actions"><a className="primary" href="/library/"><Library/>回教材库核对目录</a>{insight.current && <a href={lessonAction(insight.current).href}><ArrowRight/>{session ? lessonAction(insight.current).label : '浏览本单元第一课'}</a>}</div></div><div className="unit-relay-summary"><strong>{insight.reflected}<small>已复盘</small></strong><i/><strong>{insight.ready}<small>已形成方案</small></strong><i/><strong>{insight.total}<small>篇课文</small></strong></div></section>

    {error && <section className="ask-error"><CircleAlert/><span>{error}</span><button type="button" onClick={load}>重新读取</button></section>}
    <section className="panel unit-picker"><div><span>选择单元</span><b>{selectedUnit?.title || '正在读取教材目录'}</b></div><label><span className="sr-only">选择单元</span><select value={selectedUnit?.id || ''} onChange={event => selectUnit(event.target.value)} disabled={!units.length}>{units.map(unit => <option value={unit.id} key={unit.id}>{unit.title}</option>)}</select></label>{selectedUnit && <a href={buildReaderHref({ documentId: selectedUnit.documentId || 'textbook', page: selectedUnit.pageRange?.start || 1, lessonTitle: selectedUnit.title, returnTo: currentPageReturn() })}>核验单元起始页 <ExternalLink/></a>}</section>

    {busy ? <section className="panel unit-relay-loading"><Activity/><h2>正在整理单元轨道</h2><p>篇目顺序来自学生教材目录，个人进度来自账号中的备课方案。</p></section> : selectedUnit && <div className="unit-relay-layout">
      <section className="panel unit-track-panel"><SectionHead icon={Route} eyebrow="本单元课程轨道" title="每一课都保留自己的依据和成果" note="活动任务、写作和综合实践仍可在教材目录查看；轨道先呈现正式篇目。"/><div className="unit-track-list">{track.map((lesson, index) => { const [statusLabelText, tone] = statusMeta(lesson.status); const isCurrent = insight.current?.nodeId === lesson.nodeId; const reflection = lesson.asset?.reflection; const action = lessonAction(lesson); return <article className={`${isCurrent ? 'current' : ''} ${lesson.status}`} key={lesson.nodeId}><div className="unit-track-marker"><span>{String(index + 1).padStart(2, '0')}</span><i/></div><div className="unit-track-copy"><header><div><Badge tone={tone}>{statusLabelText}</Badge><h2>{lesson.title}</h2><p>学生教材 第 {lesson.startPage}{lesson.endPage !== lesson.startPage ? `—${lesson.endPage}` : ''} 页</p></div><span className="unit-track-role">{index === 0 ? '建立方法' : index === track.length - 1 ? '整合迁移' : '继续深化'}</span></header>{reflection && <div className="unit-track-reflection"><History/><span><b>上一课已经留下课堂记录</b><small>{reflection.unresolvedLearning || reflection.observedLearning || reflection.nextLessonAdjustment}</small></span></div>}<footer><a href={buildReaderHref({ documentId: selectedUnit?.documentId || 'textbook', page: lesson.startPage, nodeId: lesson.nodeId, lessonTitle: lesson.title, returnTo: currentPageReturn() })}>核验原页</a>{lesson.draft ? <><a href={`/ask/?draftId=${encodeURIComponent(lesson.draft.id)}`}>继续备课</a><a className={['in_class','recorded','ready'].includes(lesson.status) ? 'primary' : ''} href={action.href}>{action.label}</a>{lesson.asset?.hasReflection && <a href={`/reflection/?draftId=${encodeURIComponent(lesson.draft.id)}`}>查看复盘</a>}</> : <a className="primary" href={action.href}>从这一课开始 <ArrowRight/></a>}</footer></div></article>; })}</div></section>

      <aside className="panel unit-continuity-ledger"><SectionHead icon={Network} eyebrow="连续性账本" title="现在要接住什么" note="课堂事实和教材依据严格分开。"/>{insight.current ? <><div className="continuity-step previous"><span>承接上一课</span><b>{track[insight.currentIndex - 1]?.title || '这是本单元的起点'}</b><p>{track[insight.currentIndex - 1]?.asset?.reflection?.unresolvedLearning || '还没有上一课复盘。第一课先建立本单元共同的阅读方法。'}</p></div><div className="continuity-arrow"><ArrowRight/></div><div className="continuity-step current"><span>当前要完成</span><b>{insight.current.title}</b><p>{insight.current.status === 'in_class' ? '课堂已经开始，继续记录学生真正说出的关键词和仍需追问的环节。' : insight.current.status === 'recorded' ? '现场记录已经整理好，请教师核对并保存为正式课后复盘。' : insight.current.draft ? '已有备课记录，继续核对依据、完善方案或进入课堂设计。' : '先从教师用书确定教学处理，再回到学生教材核对本课原文。'}</p></div><div className="continuity-arrow"><ArrowRight/></div><div className="continuity-step next"><span>带往下一课</span><b>{insight.next?.title || '完成本单元整合'}</b><p>课后只记录学生已经做到什么、还没做到什么，以及下一课需要优先调整什么。</p></div><a className="primary continuity-primary" href={lessonAction(insight.current).href}>{lessonAction(insight.current).label} <ArrowRight/></a></> : <div className="index-empty"><CheckCircle2/><b>本单元轨道已经完成</b><p>可以回看各课复盘，整理单元学习成果。</p></div>}{!session && <div className="unit-login-note"><ShieldCheck/><p>教材轨道可以直接浏览；登录后才会显示个人备课进度和课后学情。</p><a href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>登录并继续</a></div>}</aside>
    </div>}
  </div>;
}


// 共备分享/教研问题簿/教研资产库页（从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Archive, ArrowRight, CheckCircle2, CircleAlert, ClipboardCheck, Copy, ExternalLink, FileText, GitCompareArrows, Library, Link2, MessageCircle, Microscope, Quote, RefreshCw, Search, Share2, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { AssetCoverage, SharedPlanList, assetPrimaryAction, assetWorkflowBadge } from '../ui-panels.jsx';
import { askErrorMessage, citationLink, docName, queryParams, requestCode, rootRequest, useAuthSession } from '../app-core.js';
import { normalizeLessonIdentity as normalizeShareLessonIdentity } from '../reader-target.js';
import { normalizeLessonIdentity as normalizeComparisonLessonIdentity } from '../../shared/same-lesson-comparison.js';
import { lessonKey } from '../unit-planning.js';

export function TeachingSharePage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || '';
  const token = useMemo(() => { const raw = String(location.hash || '').replace(/^#(?:token=)?/u, '').trim(); try { return decodeURIComponent(raw); } catch { return raw; } }, []);
  const recipientMode = Boolean(token);
  const [draft, setDraft] = useState(null);
  const [shares, setShares] = useState([]);
  const [share, setShare] = useState(null);
  const [expiryDays, setExpiryDays] = useState(14);
  const [freshLink, setFreshLink] = useState('');
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOwner = async () => {
    if (!draftId) { setError('还没有选定要分享的备课方案。'); setBusy(false); return; }
    setBusy(true); setError('');
    try {
      const [draftData, shareData] = await Promise.all([
        rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`),
        rootRequest(`/api/shares?draftId=${encodeURIComponent(draftId)}`)
      ]);
      setDraft(draftData.draft || draftData);
      setShares(Array.isArray(shareData.shares) ? shareData.shares : []);
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (recipientMode) {
      setBusy(true); setError('');
      rootRequest('/api/shares/resolve', { method: 'POST', body: { token } })
        .then(data => setShare(data.share || null))
        .catch(err => setError(['share_not_found', 'share_token_invalid'].includes(requestCode(err)) ? '这份共备链接已失效或已被撤销。' : askErrorMessage(err)))
        .finally(() => setBusy(false));
      return;
    }
    if (!session?.user?.id) {
      if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    loadOwner();
  }, [recipientMode, token, draftId, session?.user?.id]);

  const create = async () => {
    if (!draft || working) return;
    setWorking('create'); setError(''); setMessage(''); setFreshLink('');
    try {
      const data = await rootRequest('/api/shares', { method: 'POST', body: { draftId, version: draft.version, expiresInDays: expiryDays } });
      const link = `${location.origin}/share/#${data.token}`;
      setFreshLink(link);
      setShares(items => [data.share, ...items]);
      setMessage('已生成一份独立快照。以后继续编辑原方案，不会悄悄改动这份共备内容。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setWorking(''); }
  };
  const copyLink = async () => {
    if (!freshLink) return;
    try { await navigator.clipboard.writeText(freshLink); setMessage('共备链接已复制。'); }
    catch { setMessage('请手动选中链接后复制。'); }
  };
  const revoke = async item => {
    if (working) return;
    setWorking(`revoke:${item.id}`); setError('');
    try {
      const data = await rootRequest(`/api/shares/${encodeURIComponent(item.id)}/revoke`, { method: 'POST', body: { version: item.version } });
      setShares(values => values.map(value => value.id === item.id ? data.share : value));
      setMessage('该链接已撤销，原方案和其他分享不受影响。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setWorking(''); }
  };

  if (recipientMode) {
    const snapshot = share?.snapshot;
    const reference = id => snapshot?.citations?.find(item => item.id === id);
    const shareReturnTo = `/share/#${token}`;
    return <div className="view-stack share-viewer-page">
      <section className="share-viewer-hero"><div><Badge tone="gold"><Share2/> 教研共备快照</Badge><h1>{snapshot?.title || '正在打开共备方案'}</h1><p>{snapshot?.notice || '这是一份只读备课快照。其中的页码来自发布时已确认的教材依据。'}</p></div>{share && <div className="share-seal"><ShieldCheck/><span>快照校验</span><b>{String(share.snapshotDigest || snapshot?.digest || '').slice(0, 10)}</b><small>{new Date(share.createdAt).toLocaleDateString()}发布</small></div>}</section>
      {error && <section className="panel share-error"><CircleAlert/><h2>暂时无法打开这份共备方案</h2><p>{error}</p><a className="primary" href="/library/">返回教材库</a></section>}
      {busy && <section className="panel share-loading"><Activity/><h2>正在核验共备快照</h2><p>只读取这一次发布的方案，不会访问教师的账号和历史对话。</p></section>}
      {snapshot && <>
        <section className="panel share-overview"><header><div><span>本课核心问题</span><h2>{snapshot.lesson?.coreQuestion || snapshot.question || '待教师补充'}</h2></div><div className="share-context"><span>{snapshot.lessonContext?.periods || 1}课时</span><span>{snapshot.lessonContext?.classLevel || '班情未标注'}</span><span>{snapshot.lessonContext?.teachingMode || '教学方式未标注'}</span></div></header><p>{snapshot.plan?.summary || '发布者未填写方案概述。'}</p></section>
        <div className="share-plan-grid"><SharedPlanList title="教学目标" items={snapshot.plan?.objectives}/><SharedPlanList title="重点与难点" items={snapshot.plan?.keyPoints}/><SharedPlanList title="课堂流程" items={snapshot.plan?.lessonPlan}/><SharedPlanList title="问题链" items={snapshot.plan?.questionChain}/></div>
        <section className="share-cards"><header><span>一课三卡</span><h2>从方案到课堂动作</h2><p>这些内容来自发布时的固定快照，不会跟随原方案后续变动。</p></header><div>{snapshot.cards.map(card => <article className={`share-card share-card-${card.type}`} key={card.id}><header><span>{card.type === 'board' ? '板书卡' : card.type === 'question' ? '提问卡' : card.type === 'assessment' ? '评价卡' : '课堂卡'}</span><h3>{card.title}</h3><p>{card.subtitle}</p></header><ol>{card.items.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><p>{item.text}</p><footer>{item.citationIds.map(id => { const ref = reference(id); const href = ref ? citationLink(ref, shareReturnTo) : ''; return href ? <a key={id} href={href}><Quote/>{docName(ref.documentId)} 第 {ref.pdfPage} 页</a> : null; })}</footer></div></li>)}</ol></article>)}</div></section>
        <section className="panel share-evidence"><div><span>可核对的教材页码</span><h2>只分享定位信息，不复制教材原文</h2><p>点击页码可返回活教参的原始教材核验页。</p></div><div>{snapshot.citations.map(item => { const href = citationLink(item, shareReturnTo); return href ? <a href={href} key={item.id}><FileText/><span><b>{docName(item.documentId)}</b><small>第 {item.pdfPage} 页{item.printedPage ? ` · 书页 ${item.printedPage}` : ''}</small></span><ExternalLink/></a> : null; })}</div></section>
        <section className="share-next"><div><span>想将这份方案用在自己的班级？</span><h2>先回到教材，再按你的班情重新备课</h2><p>共备快照用于参考，不直接写入你的账号，也不会覆盖现有方案。</p></div><a className="primary" href="/library/">从教材库开始 <ArrowRight/></a></section>
      </>}
    </div>;
  }

  const activeShares = shares.filter(item => item.status === 'active');
  const confirmed = draft?.answer?.planApproval?.status === 'confirmed' && draft?.answer?.planApproval?.hasUnconfirmedChanges !== true;
  return <div className="view-stack share-owner-page">
    <section className="hero compact-hero share-owner-hero"><div><Badge tone="gold"><Share2/> 教研共备</Badge><h1>分享的不是一个会变的页面，<br/><em>而是一份可核对的教学快照</em></h1><p>共备链接只包含已确认方案、三卡和公开教材页码。账号信息、历史对话、私人教材和连接信息不会进入分享内容。</p></div><div className="share-owner-count"><strong>{activeShares.length}</strong><span>条有效链接</span><small>每一条都可以单独撤销</small></div></section>
    {error && <section className="cards-alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>这次共备操作没有完成</b><p>{error}</p></div></section>}
    {message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}
    {busy ? <section className="panel share-loading"><Activity/><h2>正在读取当前方案</h2><p>会先确认方案状态，再决定是否允许发布。</p></section> : draft && <div className="share-owner-layout">
      <section className="panel share-publish-sheet"><header><div><span>要发布的方案</span><h2>{draft.title || '未命名备课'}</h2><p>当前第 {draft.version || 1} 版 · {(draft.cards || []).length} 张课堂卡 · {(draft.citations || []).length} 条教材依据</p></div><Badge tone={confirmed ? 'green' : 'orange'}>{confirmed ? '教师已确认' : '还不能发布'}</Badge></header><div className="share-safety-list">{[['独立快照','原方案后续修改，不影响已发布内容'],['最小信息','不包含账号、对话、连接信息和私人文档原文'],['可随时撤销','每条链接独立管理，不影响其他分享']].map(([title, note]) => <div key={title}><ShieldCheck/><span><b>{title}</b><small>{note}</small></span></div>)}</div><footer><label><span>链接有效期</span><select value={expiryDays} onChange={event => setExpiryDays(Number(event.target.value))}><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></label><a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>返回检查方案</a><button type="button" className="primary" onClick={create} disabled={!confirmed || !(draft.cards || []).length || Boolean(working)}>{working === 'create' ? '正在生成快照…' : '生成共备链接'}</button></footer>{!confirmed && <div className="share-blocked-note"><CircleAlert/><p>请先回到课堂设计确认当前版本。未确认修改不会被包装成可分享成果。</p></div>}</section>
      <aside className="panel share-link-ledger"><header><span>链接管理</span><h2>{activeShares.length ? `${activeShares.length} 条正在生效` : '还没有发布过'}</h2><p>出于安全考虑，旧链接的完整地址不会再次显示。</p></header>{freshLink && <div className="share-fresh-link"><span>请现在复制，完整链接只显示这一次</span><div><input readOnly value={freshLink} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={copyLink}><Copy/>复制</button></div></div>}<div className="share-ledger-list">{shares.length ? shares.map(item => <article className={item.status} key={item.id}><div><span>{item.status === 'active' ? '生效中' : item.status === 'revoked' ? '已撤销' : '已到期'}</span><b>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '创建时间未知'}</b><small>有效至 {item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : '—'} · 校验 {String(item.snapshotDigest || '').slice(0, 8)}</small></div>{item.status === 'active' && <button type="button" onClick={() => revoke(item)} disabled={Boolean(working)}>{working === `revoke:${item.id}` ? '正在撤销…' : '撤销链接'}</button>}</article>) : <div className="share-ledger-empty"><Link2/><b>第一条链接会出现在这里</b><p>发送给同事前，可以先自己打开链接核对内容。</p></div>}</div></aside>
    </div>}
  </div>;
}

export function researchStage(action = {}) {
  return ({ collect_second_sample: { label: '等待第二次课堂', tone: 'neutral' }, start_comparison: { label: '可以开始对照', tone: 'gold' }, finish_comparison: { label: '对照待完成', tone: 'purple' }, refresh_comparison: { label: '事实已更新', tone: 'orange' }, continue_validation: { label: '继续验证', tone: 'orange' }, review_hypothesis: { label: '命题已确认', tone: 'green' } })[action.type] || { label: '研究进行中', tone: 'neutral' };
}

export function ResearchLedgerPage() {
  const session = useAuthSession(), userId = session?.user?.id || '';
  const [ledger, setLedger] = useState({ items: [], summary: {} }), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const load = async () => { setBusy(true); setError(''); try { const data = await rootRequest('/api/assets/research'); setLedger(data.ledger || { items: [], summary: {} }); } catch (err) { if (['auth_required', 'auth_invalid'].includes(requestCode(err))) { location.href = `/login/?next=${encodeURIComponent('/research/')}`; return; } setError(askErrorMessage(err)); } finally { setBusy(false); } };
  useEffect(() => { if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent('/research/')}`; return; } load(); }, [userId]);
  const summary = ledger.summary || {};
  return <div className="view-stack research-ledger-page"><section className="hero compact-hero research-hero"><div><Badge tone="gold"><FileText/> 教研问题簿</Badge><h1>不统计做了多少份方案，<br/><em>只记录一个问题怎样被课堂推进</em></h1><p>每次“一课一研”是一份课堂样本，两次同篇目实践可以形成对照，教师确认后才成为教研命题。问题簿只显示下一步，不用生成量代替教研进展。</p><div className="hero-actions"><a href="/assets/"><Archive/>打开教研资产</a><a href="/study/"><Microscope/>整理一课一研</a></div></div><div className="research-seal"><strong>{summary.lessonCount || 0}</strong><span>条教研问题线</span><em>{summary.needsValidationCount ? `${summary.needsValidationCount} 条等待继续验证` : '等待课堂继续推进'}</em></div></section>{error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>教研问题簿暂时没有读取完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button></div></section>}{busy ? <section className="panel research-empty"><Activity/><h2>正在整理你的教研问题线</h2><p>只读取当前账号中由教师确认的课堂记录和教研命题。</p></section> : ledger.items?.length ? <><section className="research-progress-strip" aria-label="教研问题推进情况"><div><span>课堂样本</span><strong>{summary.sampleCount || 0}</strong><small>教师确认的一课一研</small></div><ArrowRight/><div><span>可开始对照</span><strong>{summary.readyToCompareCount || 0}</strong><small>已有两次同篇目课堂</small></div><ArrowRight/><div><span>已确认命题</span><strong>{summary.confirmedHypothesisCount || 0}</strong><small>写清适用边界与验证方式</small></div></section><section className="research-ledger-list">{ledger.items.map(item => { const stage = researchStage(item.nextAction), latestHypothesis = item.comparisons.find(comparison => comparison.status === 'confirmed' && !comparison.stale); return <article className="panel research-line" key={item.lessonIdentity}><header><div><span>教研问题线</span><h2>{item.lessonTitle}</h2><p>{item.samples.length} 次确认课堂 · {item.comparisons.length} 次同课对照</p></div><Badge tone={stage.tone}>{stage.label}</Badge></header><div className="research-line-body"><section><b>课堂样本</b><div className="research-sample-list">{item.samples.slice(0, 3).map((sample, index) => <a href={`/study/?draftId=${encodeURIComponent(sample.draftId)}`} key={sample.draftId}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{sample.label}</strong><p>{sample.finding || '教师已确认本次课堂记录。'}</p><small>{sample.confirmedAt ? new Date(sample.confirmedAt).toLocaleDateString() : '确认时间未知'}</small></div><ArrowRight/></a>)}</div></section><section className={latestHypothesis ? 'research-hypothesis confirmed' : 'research-hypothesis'}><b>{latestHypothesis ? '当前教研命题' : '目前还不能形成跨课堂结论'}</b>{latestHypothesis ? <><blockquote>{latestHypothesis.transferableFinding || '教师已经确认本次同课对照。'}</blockquote><p><span>下一次验证</span>{latestHypothesis.nextExperiment || '等待教师补充下一次验证方式。'}</p><a href={`/observation/?left=${encodeURIComponent(latestHypothesis.leftId)}&right=${encodeURIComponent(latestHypothesis.rightId)}`}><ClipboardCheck/>生成听评课观察单 <ArrowRight/></a></> : <p>{item.samples.length > 1 ? '已经具备两次课堂样本，可以开始并列事实。' : '需要再完成一次同篇目课堂，并保持观察指标一致。'}</p>}</section></div><footer><div><b>下一步</b><p>{item.nextAction.note}</p></div><a className="primary" href={item.nextAction.href}>{item.nextAction.label} <ArrowRight/></a></footer></article>; })}</section></> : <section className="panel research-empty"><div className="empty-orbit"><FileText/></div><h2>问题簿还没有课堂样本</h2><p>先完成一次课堂记录和课后复盘，再把“一课一研”确认下来。这里会自动形成第一条教研问题线。</p><div><a className="primary" href="/assets/">从教研资产开始</a><a href="/library/">选择教材篇目</a></div></section>}</div>;
}

export function AssetsPage() {
  const [assets, setAssets] = useState([]), [query, setQuery] = useState(''), [favoriteOnly, setFavoriteOnly] = useState(false), [tagFilter, setTagFilter] = useState(''), [tagOptions, setTagOptions] = useState([]), [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [history, setHistory] = useState(null), [historyTitle, setHistoryTitle] = useState(''), [historyAssetId, setHistoryAssetId] = useState(''), [publishTarget, setPublishTarget] = useState(null), [tagDraft, setTagDraft] = useState(''), [compareBusy, setCompareBusy] = useState(false);
  const loadRequest = useRef(0);
  const load = async () => { const requestId = ++loadRequest.current; setBusy(true); setError(''); try { const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim()); if (favoriteOnly) params.set('favorite', 'true'); if (tagFilter) params.set('tag', tagFilter); const data = await rootRequest(`/api/assets${params.toString() ? `?${params}` : ''}`); if (requestId !== loadRequest.current) return; setAssets(Array.isArray(data.assets) ? data.assets : []); setTagOptions(Array.isArray(data.tags) ? data.tags : []); } catch (err) { if (requestId !== loadRequest.current) return; if (['auth_required', 'auth_invalid'].includes(requestCode(err))) { location.href = `/login/?next=${encodeURIComponent('/assets/')}`; return; } setError(askErrorMessage(err)); } finally { if (requestId === loadRequest.current) setBusy(false); } };
  useEffect(() => { const timer = setTimeout(load, query.trim() ? 240 : 0); return () => clearTimeout(timer); }, [query, favoriteOnly, tagFilter]);
  const openPublish = asset => { setPublishTarget(asset); setTagDraft((asset.tags || []).join(', ')); setError(''); };
  const publish = async asset => { setWorking(asset.draftId); setError(''); setMessage(''); try { const tags = [...new Set(tagDraft.split(/[,，\s]+/u).map(tag => tag.trim()).filter(Boolean))].slice(0, 20); const data = await rootRequest('/api/assets', { method: 'POST', body: { draftId: asset.draftId, tags, favorite: asset.favorite, version: asset.version } }); setAssets(items => items.map(item => item.draftId === asset.draftId ? data.asset : item)); setPublishTarget(null); setMessage('方案已收进教研资产库。之后可以按篇目、标签和关键词找回。'); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const favorite = async asset => { setWorking(`favorite:${asset.draftId}`); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/favorite`, { method: 'PATCH', body: { favorite: !asset.favorite, version: asset.version } }); setAssets(items => items.map(item => item.draftId === asset.draftId ? data.asset : item)); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const showHistory = async asset => { setHistoryTitle(asset.title); setHistoryAssetId(asset.draftId); setHistory(null); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/versions`); setHistory({ versions: data.versions || [], comparison: null }); } catch (err) { setError(askErrorMessage(err)); } };
  const compareVersion = async revisionId => { if (!historyAssetId || !revisionId) return; setCompareBusy(true); setError(''); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(historyAssetId)}/versions?compare=${encodeURIComponent(revisionId)}`); setHistory(previous => previous ? { ...previous, comparison: data.comparison || null } : previous); } catch (err) { setError(askErrorMessage(err)); } finally { setCompareBusy(false); } };
  const copyAsset = async (asset, { useFeedback = false } = {}) => { const workId = `${useFeedback ? 'reflect' : 'copy'}:${asset.draftId}`; setWorking(workId); setError(''); try { const data = await rootRequest(`/api/assets/${encodeURIComponent(asset.draftId)}/copy`, { method: 'POST', body: { version: asset.version, useFeedback } }); const copied = data.asset; setMessage(useFeedback ? '已建立复备方案。上一课记录会作为参考，新方案的课后复盘保持空白。' : '已复制为新的可编辑方案，原方案保持不变。'); if (copied?.draftId) location.href = `${useFeedback ? '/ask/' : '/cards/'}?draftId=${encodeURIComponent(copied.draftId)}`; } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  const restore = async revisionId => { if (!historyAssetId || !revisionId) return; const currentAsset = assets.find(item => item.draftId === historyAssetId); if (!currentAsset?.version) { setError('当前方案版本尚未读取完成，请刷新后再试。'); return; } setWorking(`restore:${revisionId}`); setError(''); try { const data = await rootRequest(`/api/drafts/${encodeURIComponent(historyAssetId)}/restore`, { method: 'POST', body: { revisionId, version: currentAsset.version } }); const next = data.draft; setAssets(items => items.map(item => item.draftId === historyAssetId ? { ...item, ...{ title: next.title, version: next.version, status: next.answer?.assetMeta?.status || item.status, updatedAt: next.updated_at || item.updatedAt, sourceCoverage: next.answer?.sourceCoverage || item.sourceCoverage } } : item)); setHistory(null); setMessage('历史版本已恢复。请打开课堂设计确认内容，再决定是否锁定。'); } catch (err) { setError(askErrorMessage(err)); } finally { setWorking(''); } };
  return <div className="view-stack assets-page"><section className="hero compact-hero assets-hero"><div><Badge tone="gold"><Archive/> 教研资产库</Badge><h1>把备过的课，<br/><em>留成下一次还能用的方案</em></h1><p>保存、修改、锁定后的课堂材料会按篇目和标签归档，下一次备课可以直接打开、复制和继续完善。</p></div><div className="hero-actions"><a className="primary" href="/library/"><Library/>从教材库选篇目</a><a href="/ask/"><MessageCircle/>继续备课问答</a><a href="/research/"><FileText/>打开教研问题簿</a></div></section><section className="panel assets-toolbar"><div><span>我的教研资产</span><b>{busy ? '正在读取…' : `${assets.length} 份方案`}</b></div><label className="asset-search"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索篇目、方案标题或标签"/></label><label className="asset-tag-filter"><span>标签</span><select value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="">全部标签</option>{tagOptions.map(tag => <option value={tag} key={tag}>{tag}</option>)}</select></label><button type="button" className={favoriteOnly ? 'active' : ''} onClick={() => setFavoriteOnly(value => !value)}><CheckCircle2/>{favoriteOnly ? '只看已收藏' : '筛选收藏'}</button></section>{error && <section className="ask-error" role="alert"><CircleAlert/><span>{error}</span><button type="button" onClick={load}>重新读取</button></section>}{message && <section className="quality-box"><CheckCircle2/><span>{message}</span></section>}{busy ? <section className="panel assets-empty"><Activity/><h2>正在读取你的备课方案</h2><p>已保存的内容会在这里按篇目集中呈现。</p></section> : assets.length ? <section className="asset-grid">{assets.map(asset => { const workflowBadge = assetWorkflowBadge(asset); const primaryAction = assetPrimaryAction(asset); const comparisonPeer = asset.lessonStudyStatus === 'confirmed' && !asset.lessonStudyStale ? assets.find(candidate => candidate.draftId !== asset.draftId && candidate.lessonStudyStatus === 'confirmed' && !candidate.lessonStudyStale && normalizeShareLessonIdentity(candidate.lessonKey || candidate.title) === normalizeShareLessonIdentity(asset.lessonKey || asset.title)) : null; const comparisonPair = comparisonPeer ? [asset, comparisonPeer].sort((left, right) => String(left.draftId).localeCompare(String(right.draftId))) : null; return <article className="panel asset-card" key={asset.draftId}><header><div><Badge tone={workflowBadge.tone}>{workflowBadge.label}</Badge><h2>{asset.title}</h2><p>{asset.lessonKey || '尚未标记篇目'} · 第 {asset.version || 1} 版</p></div><button type="button" className={`asset-favorite ${asset.favorite ? 'active' : ''}`} aria-label={asset.favorite ? '取消收藏' : '收藏方案'} onClick={() => favorite(asset)} disabled={working === `favorite:${asset.draftId}`}>★</button></header><div className="asset-card-meta"><span>教材依据 <b>{asset.citationsCount || 0}</b></span><span>最近更新 <b>{asset.updatedAt ? new Date(asset.updatedAt).toLocaleDateString() : '—'}</b></span></div><AssetCoverage coverage={asset.sourceCoverage}/>{asset.tags?.length ? <div className="asset-tags">{asset.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : <p className="asset-no-tags">还没有标签，可以在归档时补充。</p>}{asset.lessonStudySummary && <div className="asset-study-summary"><Microscope/><div><span>{asset.lessonStudyStatus === 'confirmed' ? '教师确认的教学判断' : '一课一研草稿'}</span><b>{asset.lessonStudySummary.finding || '等待教师写下本次发现'}</b>{asset.lessonStudySummary.nextTrial && <small>下一轮：{asset.lessonStudySummary.nextTrial}</small>}</div></div>}{comparisonPeer && <a className="asset-comparison-entry" href={`/compare/?left=${encodeURIComponent(comparisonPair[0].draftId)}&right=${encodeURIComponent(comparisonPair[1].draftId)}`}><GitCompareArrows/><span><b>发现另一份同篇目课堂</b><small>与“{comparisonPeer.title}”并列事实，形成同课异构结论</small></span><ArrowRight/></a>}<footer><a className="primary" href={primaryAction.href}>{primaryAction.label} <ArrowRight/></a>{asset.status !== 'published' && asset.teacherConfirmed && asset.cardsGenerated && <button type="button" onClick={() => openPublish(asset)} disabled={working === asset.draftId}>{working === asset.draftId ? '正在归档…' : '收进资产库'}</button>}<button type="button" onClick={() => copyAsset(asset)} disabled={working === `copy:${asset.draftId}`}>{working === `copy:${asset.draftId}` ? '正在复制…' : '复制为新方案'}</button>{asset.teacherConfirmed && asset.cardsGenerated && <a href={`/share/?draftId=${encodeURIComponent(asset.draftId)}`}><Share2/>分享共备快照</a>}<button type="button" onClick={() => showHistory(asset)}>查看版本</button></footer></article>; })}</section> : <section className="panel assets-empty"><div className="empty-orbit"><Archive/></div><h2>{favoriteOnly ? '还没有收藏的方案' : tagFilter ? `还没有“${tagFilter}”标签的方案` : '这里还没有备课资产'}</h2><p>完成一次备课问答并保存三卡后，可以把方案收进这里，按篇目再次使用。</p><div><a className="primary" href="/library/">打开教材库</a><a href="/ask/">开始提问</a></div></section>}{history && <div className="modal-backdrop" role="presentation" onClick={() => setHistory(null)}><section className="panel asset-history-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><header><div><span>方案历史</span><h2>{historyTitle}</h2></div><button type="button" onClick={() => setHistory(null)} aria-label="关闭"><X/></button></header><p>每次保存都会留下一个快照。你可以先对比，再决定是否恢复；已经锁定的课堂卡片不会被覆盖。</p><div className="asset-history-list">{(history.versions || []).map((item, index) => <div key={item.id || index}><span>{item.id === 'current' ? '当前' : `V${item.version || '—'}`}</span><div><b>{item.id === 'current' ? '当前方案' : item.reason || '已保存版本'}</b><small>{item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt).toLocaleString() : '时间未知'}</small></div>{item.id === 'current' ? <Badge tone="green">正在使用</Badge> : <div className="asset-history-actions"><button type="button" onClick={() => compareVersion(item.id)} disabled={compareBusy}>{compareBusy ? '对比中…' : '对比当前'}</button><button type="button" onClick={() => restore(item.id)} disabled={working === `restore:${item.id}`}>{working === `restore:${item.id}` ? '恢复中…' : '恢复此版'}</button></div>}</div>)}</div>{history.comparison && <div className="asset-comparison"><header><b>与当前方案的差异</b><small>{history.comparison.changed ? `${history.comparison.changes.length} 处内容发生变化` : '内容没有变化'}</small></header>{history.comparison.changes.length ? <ul>{history.comparison.changes.map(change => <li key={change.field}><b>{change.label}</b><span>旧版：{change.before}</span><span>当前：{change.after}</span></li>)}</ul> : <p>这两个版本的主要内容一致。</p>}</div>}<footer><button type="button" onClick={() => setHistory(null)}>关闭</button></footer></section></div>}{publishTarget && <div className="modal-backdrop" role="presentation" onClick={() => setPublishTarget(null)}><section className="panel asset-history-modal asset-publish-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><header><div><span>归档到教研资产库</span><h2>{publishTarget.title}</h2></div><button type="button" onClick={() => setPublishTarget(null)} aria-label="关闭"><X/></button></header><p>归档后仍可继续编辑；标签用于以后按篇目、年级或教学任务找回方案。</p><label className="asset-tag-input"><b>方案标签</b><input value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="例如：古诗文、两课时、朗读训练"/><small>多个标签用空格或逗号分隔</small></label><footer><button type="button" onClick={() => setPublishTarget(null)}>取消</button><button type="button" className="primary" onClick={() => publish(publishTarget)} disabled={working === publishTarget.draftId}>{working === publishTarget.draftId ? '正在归档…' : '确认归档'}</button></footer></section></div>}</div>;
}


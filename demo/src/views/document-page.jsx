// 阅读器页（ProviderResult + DocumentPage，从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BookOpen, CircleAlert, ClipboardCheck, Download, ExternalLink, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { canonicalDocumentId, citationLink, citationText, docName, focusedCurriculumExcerpt, normalizeCatalogItem, questionState, queryParams, request, requestCode, searchResultDocumentId, searchResultPage } from '../app-core.js';
import { buildPdfPageUrl, buildReaderHref, pairedDocumentId, pairedFocusQuery, pairedLessonQuery, resolveReaderReturn } from '../reader-target.js';
import { buildDualSourceTeachingCard } from '../../shared/dual-source-teaching-card.js';
import { pairLessonEvidence } from '../lesson-evidence.js';

export function ProviderResult({ title, time, tone, question, result, status, providerState }) {
  const state = questionState(result);
  const hit = result?.hit || null;
  const typeLabel = hit?.documentType === 'textbook' ? '学生教材' : hit?.documentType === 'teacher_guide' ? '教师用书' : '教学资料';
  const section = Array.isArray(hit?.sectionPath) ? hit.sectionPath.join(' › ') : String(hit?.sectionPath || '未标注章节');
  const openHref = hit ? citationLink(hit, 'validation') : '';

  return <article className="panel provider-result">
    <header><Badge tone={tone}>{title}</Badge><span>{time}</span></header>
    <div className="provider-question">
      <div><small>当前问题</small><h3>{question}</h3></div>
      <Badge tone={state.tone}>{result ? state.label : providerState}</Badge>
    </div>
    {hit ? <>
      <div className="provider-hit-meta">
        <span><small>命中文档</small><b>{hit.documentTitle || typeLabel}</b></span>
        <span><small>来源</small><b>{typeLabel}</b></span>
        <span><small>教材页码</small><b>{hit.pdfPage}</b></span>
        <span><small>书页</small><b>{hit.printedPage || '未标注'}</b></span>
        <span><small>章节路径</small><b>{section}</b></span>
        <span><small>定位状态</small><b>已定位原始页</b></span>
      </div>
      <blockquote>{hit.text || '暂时没有可展示的页面片段。'}</blockquote>
      <a className="provider-open" href={openHref}>打开原始教材核验 <ExternalLink/></a>
    </> : <div className="evidence-missing">
      <CircleAlert/>
      <div><b>{providerState}</b><small>{status === 'ready' ? '验证已完成，但当前问题没有返回可核验的定位结果。' : '尚无该问题的真实定位结果，不展示推测页码。'}</small></div>
    </div>}
  </article>;
}

export function DocumentPage() {
  const params = useMemo(() => queryParams(), []);
  const doc = canonicalDocumentId(params.get('doc')) || '';
  const nodeId = params.get('node') || '';
  const [catalog, setCatalog] = useState([]);
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState('evidence');
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState(false);
  const [paired, setPaired] = useState(params.get('paired') === '1');
  const [pairedResult, setPairedResult] = useState(null);
  const [pairedLoading, setPairedLoading] = useState(false);
  const [pairedError, setPairedError] = useState('');
  const [pairedPdfError, setPairedPdfError] = useState(false);
  const [pairedRetry, setPairedRetry] = useState(0);
  const [focusInput, setFocusInput] = useState(() => String(params.get('focus') || '').trim());
  const [pairedFocus, setPairedFocus] = useState(() => String(params.get('focus') || '').trim());
  const [teachingCardNotice, setTeachingCardNotice] = useState('');
  const frame = useRef(null);

  const info = catalog.find(item => item.id === doc) || null;
  const maxPage = info?.pageCount || 1;
  const counterpartId = pairedDocumentId(doc);
  const explicitLesson = String(params.get('lesson') || '').trim();
  const lessonQuery = pairedLessonQuery({
    explicitTitle: explicitLesson,
    sectionPath: record?.sectionPath,
    pageTitle: record?.pageTitle || record?.title
  });
  const pairedSearchQuery = pairedFocusQuery({ lessonTitle: lessonQuery, focus: pairedFocus });

  useEffect(() => {
    request('/documents').then(data => setCatalog((data.documents || []).map(normalizeCatalogItem).filter(Boolean))).catch(() => {});
  }, []);
  useEffect(() => {
    if (info) setPage(value => Math.min(info.pageCount || 1, Math.max(1, value)));
  }, [info?.id, info?.pageCount]);
  useEffect(() => {
    if (!doc) return undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    request(`/page/${encodeURIComponent(doc)}/${page}`, { signal: controller.signal })
      .then(data => setRecord(data?.page || data || null))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setRecord(null);
          setError(`第 ${page} 页暂时没有可读取的页面信息。`);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [doc, page]);
  useEffect(() => {
    if (!paired || !counterpartId || !pairedSearchQuery) {
      setPairedResult(null); setPairedError(''); setPairedLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setPairedLoading(true); setPairedError(''); setPairedResult(null); setPairedPdfError(false);
    request('/search', {
      method: 'POST', signal: controller.signal,
      body: { query: pairedSearchQuery, scope: [counterpartId], limit: 8 }
    }).then(data => {
      const results = (Array.isArray(data?.results) ? data.results : []).map(item => ({
        ...item,
        documentId: searchResultDocumentId(item),
        documentType: canonicalDocumentId(item.documentType || item.document_type || searchResultDocumentId(item)),
        pdfPage: searchResultPage(item)
      }));
      const pair = pairLessonEvidence(results);
      const match = counterpartId === 'teacher-guide' ? pair.teacherGuide : pair.textbook;
      if (!match) throw Object.assign(new Error('paired_page_missing'), { code: 'paired_page_missing' });
      setPairedResult(match);
    }).catch(err => {
      if (err.name !== 'AbortError') setPairedError(requestCode(err) === 'paired_page_missing'
        ? pairedFocus ? '教师用书中暂未直接找到这处句段的对应处理。可以缩短关键词，或回到篇目起点查看整体教学建议。' : '暂时没有找到同篇目的对应原页。可以返回教材目录换一页再试。'
        : '对应材料暂时没有响应，当前原始教材仍可继续阅读。');
    }).finally(() => setPairedLoading(false));
    return () => controller.abort();
  }, [paired, counterpartId, pairedSearchQuery, pairedRetry]);

  const goto = value => {
    const next = Math.max(1, Math.min(maxPage, Number(value) || 1));
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('doc', doc); nextParams.set('page', String(next));
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPage(next); setPdfError(false);
  };
  const togglePaired = () => {
    const next = !paired;
    const nextParams = new URLSearchParams(location.search);
    if (next) {
      nextParams.set('paired', '1');
      if (lessonQuery) nextParams.set('lesson', lessonQuery);
    } else nextParams.delete('paired');
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPaired(next); setPairedError(''); setPairedPdfError(false);
  };
  const applyPairedFocus = event => {
    event?.preventDefault();
    const next = focusInput.replace(/\s+/gu, ' ').trim().slice(0, 100);
    const nextParams = new URLSearchParams(location.search);
    if (next) nextParams.set('focus', next); else nextParams.delete('focus');
    nextParams.set('paired', '1');
    if (lessonQuery) nextParams.set('lesson', lessonQuery);
    history.replaceState(null, '', `/document/?${nextParams}`);
    setPaired(true); setPairedFocus(next); setPairedError(''); setPairedPdfError(false); setTeachingCardNotice('');
  };
  const clearPairedFocus = () => {
    setFocusInput(''); setPairedFocus(''); setPairedError(''); setPairedPdfError(false); setTeachingCardNotice('');
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('focus');
    history.replaceState(null, '', `/document/?${nextParams}`);
  };

  const returnTarget = params.get('return');
  const libraryHref = `/library/?${new URLSearchParams({
    doc,
    page: String(page),
    ...(nodeId ? { node: nodeId } : {}),
    ...(explicitLesson ? { lesson: explicitLesson } : {}),
    ...(params.get('scope') ? { scope: params.get('scope') } : {})
  })}`;
  const readerReturn = resolveReaderReturn(returnTarget, { libraryHref });
  const returnHref = readerReturn.href;
  const returnLabel = readerReturn.label;
  const physicalPage = Number(record?.pdfPage || record?.pageNumber || record?.viewer?.page || page);
  const printedPage = record?.printedPageLabel ?? record?.printedPage ?? '未标注';
  const sectionPath = Array.isArray(record?.sectionPath) ? record.sectionPath.join(' › ') : String(record?.sectionPath || '尚未标注章节');
  const title = record?.pageTitle || record?.title || `第 ${physicalPage} 页`;
  const retrievalText = record?.retrievalText || record?.text || '';
  const textSource = record?.selectedTextSource || record?.textSource || 'none';
  const qualityStatus = record?.textQualityStatus || record?.qualityStatus || 'review';
  const sourceLabel = textSource === 'native' ? '页面文字' : textSource === 'ocr' ? '页面识别文本' : textSource === 'merged' ? '组合文本' : '暂无文本';
  const qualityLabel = qualityStatus === 'normal' ? '正常' : qualityStatus === 'failed' ? '失败' : '需检查';
  const rawPdfUrl = String(record?.viewer?.pdfUrl || record?.pdfUrl || info?.pdfUrl || '').split('#')[0];
  const pdfSrc = buildPdfPageUrl(rawPdfUrl, page, { zoom, view: 'FitH' });
  const pairedPage = searchResultPage(pairedResult);
  const pairedInfo = catalog.find(item => item.id === counterpartId) || null;
  const pairedRawPdfUrl = String(pairedResult?.viewer?.pdfUrl || pairedResult?.viewer_url || pairedResult?.pdfUrl || pairedInfo?.pdfUrl || '').split('#')[0];
  const pairedPdfSrc = buildPdfPageUrl(pairedRawPdfUrl, pairedPage, { zoom, view: 'FitH' });
  const pairedPrintedPage = pairedResult?.printedPage || pairedResult?.printed_page || '未标注';
  const pairedSection = Array.isArray(pairedResult?.sectionPath) ? pairedResult.sectionPath.join(' › ') : String(pairedResult?.sectionPath || lessonQuery || '对应篇目');
  const swapHref = pairedResult ? buildReaderHref({ documentId: counterpartId, page: pairedPage, lessonTitle: lessonQuery, focus: pairedFocus, returnTo: returnTarget || '', paired: true }) : '';
  const dualSourceTeachingCard = buildDualSourceTeachingCard({
    lessonTitle: lessonQuery,
    focus: pairedFocus,
    sources: [
      { documentId: doc, pdfPage: physicalPage, printedPage, title, sectionPath, text: retrievalText },
      { ...(pairedResult || {}), documentId: counterpartId, pdfPage: pairedPage, printedPage: pairedPrintedPage, sectionPath: pairedSection, text: citationText(pairedResult) }
    ]
  });
  const copyTeachingCard = async () => {
    if (!dualSourceTeachingCard) return;
    try {
      await navigator.clipboard.writeText(dualSourceTeachingCard.markdown);
      setTeachingCardNotice('讲解卡已复制，可以粘贴到教案或备课记录。');
    } catch {
      setTeachingCardNotice('浏览器没有允许复制，请使用“下载讲解卡”。');
    }
  };
  const downloadTeachingCard = () => {
    if (!dualSourceTeachingCard) return;
    const url = URL.createObjectURL(new Blob([dualSourceTeachingCard.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = dualSourceTeachingCard.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTeachingCardNotice('讲解卡已下载，原始教材页码已保留。');
  };

  return <div className="view-stack document-page">
    <section className="panel document-head">
      <div><Badge tone={info?.tone || 'green'}>{info?.short || '教材'}</Badge><h1>{record?.documentTitle || info?.title || '教材页面'}</h1><p>第 {physicalPage} 页 · 书页 {printedPage} · {sectionPath}</p></div>
      <div><a href={returnHref}><ArrowLeft/>{returnLabel}</a>{counterpartId && <button type="button" className={paired ? 'paired-active' : ''} onClick={togglePaired} disabled={!lessonQuery && !paired}><BookOpen/>{paired ? '退出双源对照' : '打开双源对照'}</button>}{rawPdfUrl && <><a href={rawPdfUrl} download><Download/>下载</a><a className="primary" href={buildPdfPageUrl(rawPdfUrl, page)} target="_blank" rel="noreferrer"><ExternalLink/>新窗口打开</a></>}</div>
    </section>
    {paired && <section className="paired-reading-intro"><div><span>双源对照</span><b>{lessonQuery || '当前篇目'}</b></div><p>左边核对学生实际看到的原文，右边查看教师用书的教学处理。系统只负责定位，不把两份材料混写成新的结论。</p></section>}
    {paired && <section className="paired-focus-panel">
      <div className="paired-focus-copy"><span>句段追踪</span><h2>在这一句停住，直接寻找教师用书的相关建议</h2><p>输入课文中的句子、关键词或课后题。篇目身份保持不变，右侧只重新定位对应材料的真实教材页面。</p></div>
      <form onSubmit={applyPairedFocus}><Search/><label><span className="sr-only">输入需要追踪的句段</span><input value={focusInput} onChange={event => setFocusInput(event.target.value)} maxLength={100} placeholder="例如：先天下之忧而忧，后天下之乐而乐"/></label><button type="submit" disabled={!focusInput.trim() || pairedLoading}>{pairedLoading && pairedFocus ? '正在追踪…' : '追踪这一句'}</button>{pairedFocus && <button type="button" className="quiet" onClick={clearPairedFocus}>回到篇目起点</button>}</form>
      {pairedFocus && <div className="paired-focus-status"><b>当前追踪：</b><span>{pairedFocus}</span><small>{pairedLoading ? '正在搜索对应教学处理…' : pairedResult && pairedPage ? `已定位到${docName(counterpartId)} 第 ${pairedPage} 页` : '暂未找到对应页面'}</small></div>}
    </section>}
    <section className="pdf-toolbar"><button onClick={() => goto(page - 1)} disabled={page <= 1}>上一页</button><label>教材页码 <input value={page} onChange={event => goto(event.target.value)}/> / {maxPage}</label><button onClick={() => goto(page + 1)} disabled={page >= maxPage}>下一页</button><i/><button onClick={() => setZoom(value => Math.max(70, value - 10))}><ZoomOut/>缩小</button><span>{zoom}%</span><button onClick={() => setZoom(value => Math.min(160, value + 10))}><ZoomIn/>放大</button><button onClick={() => frame.current?.requestFullscreen?.()}><Maximize2/>全屏</button></section>
    <div className={`verification-workbench${paired ? ' paired-reading-workbench' : ''}`}>
      <section className="pdf-frame" ref={frame}>{rawPdfUrl && !pdfError ? <iframe key={`${doc}-${page}-${zoom}`} title={`${info?.short || '教材'} 第 ${page} 页`} src={pdfSrc} onError={() => setPdfError(true)}/> : <div className="index-empty"><CircleAlert/><b>原始教材页面暂时无法显示</b><p>请重试或在新窗口打开原始文件。</p>{rawPdfUrl && <a className="primary" href={buildPdfPageUrl(rawPdfUrl, page)} target="_blank" rel="noreferrer">新窗口打开</a>}</div>}</section>
      {paired ? <section className="paired-pdf-pane">
        <header><div><Badge tone={counterpartId === 'teacher-guide' ? 'guide' : 'textbook'}>{docName(counterpartId)}</Badge><b>{pairedSection}</b><small>{pairedPage ? `第 ${pairedPage} 页 · 书页 ${pairedPrintedPage}` : '正在定位对应原页'}</small></div>{swapHref && <a href={swapHref}>切换主次 <ArrowRight/></a>}</header>
        {pairedLoading ? <div className="paired-reading-state"><Activity/><b>{pairedFocus ? '正在寻找这处原文的教学处理' : '正在定位同篇目对应原页'}</b><p>{pairedFocus ? '篇目保持不变，只用当前句段缩小教师用书范围。' : '先匹配篇目，再核对教材页码，不会猜测页码。'}</p></div> : pairedError ? <div className="paired-reading-state error"><CircleAlert/><b>{pairedFocus ? '暂时没有找到这处句段的对应处理' : '对应原页暂时没有打开'}</b><p>{pairedError}</p><button type="button" onClick={() => setPairedRetry(value => value + 1)}>重新定位</button></div> : pairedPdfSrc && !pairedPdfError ? <iframe key={`${counterpartId}-${pairedPage}-${zoom}`} title={`${docName(counterpartId)} 第 ${pairedPage} 页`} src={pairedPdfSrc} onError={() => setPairedPdfError(true)}/> : <div className="paired-reading-state error"><CircleAlert/><b>对应教材页面暂时无法显示</b><p>页码已经定位，可以在新窗口打开原始页面。</p>{pairedRawPdfUrl && pairedPage && <a href={buildPdfPageUrl(pairedRawPdfUrl, pairedPage)} target="_blank" rel="noreferrer">新窗口打开对应原页</a>}</div>}
      </section> : <aside className="panel evidence-inspector">
        <div className="source-tabs"><button className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>当前依据</button><button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>相邻页面</button><button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>可复制文本</button></div>
        {loading && <div className="evidence-missing"><Activity/><div><b>正在读取页面信息</b><small>左侧原始教材可继续查看。</small></div></div>}
        {!loading && error && <div className="evidence-missing"><CircleAlert/><div><b>本页暂时没有可用教材依据</b><small>{error}。左侧仍显示原始教材。</small></div></div>}
        {!loading && !error && tab === 'evidence' && <><Badge tone={info?.tone || 'green'}>{info?.short || '教材'}依据</Badge><h2>{title}</h2>{retrievalText ? <details open><summary>查看原文片段</summary><blockquote>{retrievalText}</blockquote></details> : <div className="evidence-missing"><CircleAlert/><div><b>暂无可复制片段</b><small>请以左侧原始页面为准。</small></div></div>}<div className="source-meta"><span>教材页码</span><b>{physicalPage}</b><span>书页</span><b>{printedPage}</b><span>文本来源</span><b>{sourceLabel}</b><span>质量</span><b>{qualityLabel}</b></div></>}
        {!loading && !error && tab === 'context' && <div className="related-citations"><b>相邻原页</b><p>相邻页面仅供核验，不会自动纳入本次依据。</p>{[page - 1, page + 1].filter(value => value >= 1 && value <= maxPage).map(value => <button onClick={() => goto(value)} key={value}><b>打开 第 {value} 页</b></button>)}</div>}
        {!loading && !error && tab === 'text' && <textarea readOnly value={retrievalText || '本页暂无可复制解析文本。'}/>}<div className="document-switch"><b>关联材料</b><span>点击“打开双源对照”，在同一屏核对两份原始教材。</span></div>
      </aside>}
    </div>
    {paired && <section className="panel paired-reading-summary"><article><span>学生此刻看到什么</span><b>{doc === 'textbook' ? title : pairedResult?.title || lessonQuery}</b><p>{doc === 'textbook' ? retrievalText || '请直接核对左侧学生教材原页。' : citationText(pairedResult) || '请直接核对右侧学生教材原页。'}</p></article><i/><article><span>教师此刻参考什么</span><b>{doc === 'teacher-guide' ? title : pairedResult?.title || lessonQuery}</b><p>{doc === 'teacher-guide' ? retrievalText || '请直接核对左侧教师用书原页。' : citationText(pairedResult) || '请直接核对右侧教师用书原页。'}</p></article><small>以上文字只帮助辨认页面；备课结论仍需回到两侧原始教材核验。</small></section>}
    {dualSourceTeachingCard && <section className="panel dual-source-teaching-card">
      <header><div><span>双源讲解卡</span><h2>一处课文，对齐学生怎么读、教师怎么教</h2><p>只整理当前已经定位的教材和教师用书原页，不调用模型，也不替学生预写结论。</p></div><div><Badge tone={dualSourceTeachingCard.status === 'direct' ? 'green' : 'orange'}>{dualSourceTeachingCard.status === 'direct' ? '双侧原文均已定位' : dualSourceTeachingCard.status === 'partial' ? '一侧原文已定位' : '已定位相关页面'}</Badge><button type="button" onClick={copyTeachingCard}><ClipboardCheck/>复制讲解卡</button><button type="button" onClick={downloadTeachingCard}><Download/>下载讲解卡</button></div></header>
      <div className="dual-source-card-focus"><small>本次聚焦</small><b>{dualSourceTeachingCard.focus}</b>{teachingCardNotice && <span>{teachingCardNotice}</span>}</div>
      <div className="dual-source-card-columns">
        {[['学生先读什么', dualSourceTeachingCard.textbook], ['教师再参考什么', dualSourceTeachingCard.teacherGuide]].map(([label, source]) => <article key={source.documentId}><div><span>{label}</span><b>{docName(source.documentId)} · 第 {source.pdfPage} 页{source.printedPage ? ` · 书页 ${source.printedPage}` : ''}</b><small>{source.section || source.title || '当前篇目'}</small></div><blockquote>{source.excerpt || '当前页面没有可复制片段，请直接打开原始教材核验。'}</blockquote><a href={buildReaderHref({ documentId: source.documentId, page: source.pdfPage, lessonTitle: lessonQuery, focus: pairedFocus, paired: true, returnTo: `${location.pathname}${location.search}` })}>打开这份原始页面 <ExternalLink/></a></article>)}
      </div>
      <ol>{dualSourceTeachingCard.steps.map(item => <li key={item}>{item}</li>)}</ol>
    </section>}
  </div>;
}



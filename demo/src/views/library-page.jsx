// 教材库页（Tree + LibraryPage + 其私有助手，从 App.jsx 迁出）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BookOpen, ChevronRight, CircleAlert, ExternalLink, FileSearch, FileText, Library, Search } from 'lucide-react';
import { Badge, SectionHead } from '../ui-kit.jsx';
import { canonicalDocumentId, citationText, currentPageReturn, docName, findTreeNode, groupSearchResults, nodePageRange, normalizeCatalogItem, normalizeTree, pageTitle, pdfPageUrl, prioritizeSearchResults, queryParams, request, searchResultDocumentId, searchResultPage, statusLabel, uniqueCitations } from '../app-core.js';
import { buildPreparationHref, buildReaderHref, findTreeNodeByNormalizedTitle, normalizeLessonIdentity as normalizeReaderLessonIdentity, resolveCrossDocTarget } from '../reader-target.js';







export function findTreeNodeById(nodes, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  for (const node of nodes || []) {
    if (String(node?.id || '') === wanted) return node;
    const child = findTreeNodeById(node?.children, wanted);
    if (child) return child;
  }
  return null;
}
export function nodeContainsPage(node, page) {
  const range = node?.pageRange || nodePageRange(node || {});
  const value = Number(page);
  return Boolean(range?.start && Number.isInteger(value) && value >= range.start && value <= (range.end || range.start));
}
export function Tree({ nodes, current, onPick, error, retry, loading }) {
  const collectIds = list => list.flatMap(node => { const children = Array.isArray(node.children) ? node.children : []; return [node.id, ...collectIds(children)]; });
  const [expanded, setExpanded] = useState(() => new Set(collectIds(nodes || [])));
  useEffect(() => setExpanded(new Set(collectIds(nodes || []))), [nodes]);
  if (error) return <div className="tree-loading"><CircleAlert/><b>目录加载失败</b><button type="button" onClick={retry}>重试</button></div>;
  if (loading) return <div className="tree-loading"><Activity/><b>正在读取目录</b><small>按教材结构加载篇目和教学建议…</small></div>;
  if (!nodes?.length) return <div className="tree-loading"><FileSearch/><b>目录暂时为空</b><small>请稍后重试或查看教材处理状态。</small></div>;
  const toggle = id => setExpanded(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const render = node => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const open = expanded.has(node.id);
    const { start: startPage, end: endPage } = node.pageRange || nodePageRange(node);
    return <div key={node.id} className="tree-node">
      <div className="tree-row" style={{paddingLeft:`${8+Math.max(0,(node.level||1)-1)*12}px`}}>
        {hasChildren && <button type="button" className={`tree-toggle ${open ? 'open' : ''}`} aria-label={open ? '收起目录节点' : '展开目录节点'} onClick={()=>toggle(node.id)}><ChevronRight/></button>}
        {!hasChildren && <span className="tree-toggle-spacer"/>}
        <button type="button" className={`tree-item ${current===node.id ? 'selected' : ''}`} aria-current={current===node.id ? 'location' : undefined} onClick={()=>{if(startPage>0)onPick(node);}} disabled={!startPage}>
          <span className="tree-item-title"><b>{node.title}</b><small>{startPage ? `${startPage}—${endPage}` : '暂无页码'}</small></span>
        </button>
      </div>
      {hasChildren && open && <div className="index-tree-children">{node.children.map(render)}</div>}
    </div>;
  };
  return <div className="index-tree">{nodes.map(render)}</div>;
}
export function LibraryPage() {
  const params = useMemo(() => queryParams(), []);
  const [doc,setDoc]=useState(canonicalDocumentId(params.get('doc')) || '');
  const [docs,setDocs]=useState([]); const [docsError,setDocsError]=useState(''); const [tree,setTree]=useState([]); const [treeError,setTreeError]=useState(''); const [treeBusy,setTreeBusy]=useState(false); const [treeDocumentId,setTreeDocumentId]=useState(''); const [selectedNode,setSelectedNode]=useState(params.get('node')||''); const [selectedLessonTitle,setSelectedLessonTitle]=useState(params.get('lesson') || ''); const [page,setPage]=useState(null); const [pageNo,setPageNo]=useState(Number(params.get('page'))||1); const [pageInput,setPageInput]=useState(String(Number(params.get('page'))||1)); const [pageBusy,setPageBusy]=useState(false); const [pageError,setPageError]=useState(''); const [pageRetry,setPageRetry]=useState(0); const [pdfError,setPdfError]=useState(false); const [query,setQuery]=useState(params.get('q')||''); const rawRequestedScope=params.get('scope'); const requestedScope=canonicalDocumentId(rawRequestedScope); const [scope,setScope]=useState(rawRequestedScope==='all'||rawRequestedScope==='both'?rawRequestedScope:requestedScope==='teacher-guide'||requestedScope==='textbook'||requestedScope==='curriculum-standard'?requestedScope:'both'); const [results,setResults]=useState([]); const [visibleResults,setVisibleResults]=useState(6); const [searched,setSearched]=useState(Boolean(params.get('q'))); const [searchError,setSearchError]=useState(''); const [busy,setBusy]=useState(false); const initialSearch=useRef(Boolean(params.get('q')));
  const treeRequestRef = useRef(0);
  const initialAddressCorrected = useRef({});
  const treesCache = useRef({});
  const treePromises = useRef({});
  const currentDoc = docs.find(item => item.id === doc) || docs[0] || null;
  const loadDocs = async()=>{ setDocsError(''); try { const data=await request('/documents'); const list=(data.documents||[]).map(normalizeCatalogItem).filter(Boolean); setDocs(list); const selected=list.find(item=>item.id===doc)||list[0]; if (selected && selected.id!==doc) setDoc(selected.id); } catch(error) { setDocs([]); setDocsError(error.status === 401 || String(error.code || '').startsWith('auth_') ? '登录已过期，请重新登录后继续。' : '教材目录暂时无法读取，请重试。'); } };
  useEffect(()=>{loadDocs();},[]);
  const ensureTree = async (docId) => {
    const id = String(docId || '').trim();
    if (!id) return null;
    const cached = treesCache.current[id];
    if (cached) return cached;
    // Deduplicate concurrent requests for the same document
    if (treePromises.current[id]) return treePromises.current[id];
    const promise = (async () => {
      const data = await request(`/documents/${encodeURIComponent(id)}/tree`);
      const normalized = normalizeTree(data);
      treesCache.current[id] = normalized;
      delete treePromises.current[id];
      return normalized;
    })();
    treePromises.current[id] = promise;
    try {
      return await promise;
    } catch (error) {
      delete treePromises.current[id];
      throw error;
    }
  };
  const loadTree=async()=>{ if(!doc)return; const requestId=++treeRequestRef.current; setTree([]); setTreeDocumentId(''); setTreeBusy(true); setTreeError(''); try { const normalized = await ensureTree(doc); if(requestId!==treeRequestRef.current)return; setTree(normalized || []); setTreeDocumentId(doc); } catch(error) { if(requestId!==treeRequestRef.current)return; setTree([]); setTreeDocumentId(''); setTreeError('目录暂时无法读取，请重试。'); } finally { if(requestId===treeRequestRef.current)setTreeBusy(false); } };
  useEffect(()=>{loadTree();},[doc]);
  useEffect(()=>{ if(!currentDoc)return; const max=Math.max(1,currentDoc.pageCount||1); setPageNo(value=>Math.min(max,Math.max(1,value))); },[currentDoc?.id,currentDoc?.pageCount]);
  useEffect(()=>setPageInput(String(pageNo)),[pageNo]);
  useEffect(()=>{ if(!doc)return; let cancelled=false; setPage(null); setPageBusy(true); setPageError(''); setPdfError(false); request(`/documents/${encodeURIComponent(doc)}/pages/${pageNo}`).then(data=>{if(!cancelled){setPage(data.page||data);setPageError('');}}).catch(()=>{if(!cancelled){setPage(null);setPageError(`第 ${pageNo} 页的页面信息暂时没有读取成功。`);}}).finally(()=>{if(!cancelled)setPageBusy(false)}); return()=>{cancelled=true}; },[doc,pageNo,pageRetry]);
  // 目录 / URL 同步：首次地址校正 + 普通翻页节点匹配，合并为单一确定性效果。
  // 首次必须处理显式 node/lesson 意图并 return，防止普通按页匹配先覆盖 selectedLesson。
  useEffect(() => {
    if (!tree.length || !pageNo || treeDocumentId !== doc) return;
    const docId = doc;

    // ---- Phase 1: 首次地址校正 ------------------------------------------
    // 旧分享链接的 node/lesson 与 page 可能矛盾，以显式意图（node/lesson）为准。
    if (!initialAddressCorrected.current[docId]) {
      // 每次读取当前地址，而非 useMemo 初始 params，避免切换教材后读到旧参数
      const currentParams = new URLSearchParams(location.search);
      const urlNode = currentParams.get('node');
      const urlLesson = currentParams.get('lesson');
      const urlPage = Number(currentParams.get('page'));

      if (!urlNode && !urlLesson) {
        // 没有显式意图——标记为已校正，交给 Phase 2 做普通页匹配
        initialAddressCorrected.current[docId] = true;
      } else {
        // 先在当前树中按 nodeId 查找
        let intendedNode = urlNode ? findTreeNodeById(tree, urlNode) : null;
        // nodeId 未命中时，按规范化篇名兜底匹配
        if (!intendedNode && urlLesson) {
          const normalized = normalizeReaderLessonIdentity(urlLesson);
          if (normalized) {
            intendedNode = findTreeNodeByNormalizedTitle(tree, normalized);
          }
        }
        if (intendedNode && intendedNode.startPage) {
          if (Number.isInteger(urlPage) && urlPage > 0 && nodeContainsPage(intendedNode, urlPage)) {
            // urlPage 在节点范围内——保留精确页，只同步 node/lesson
            setSelectedNode(intendedNode.id);
            setSelectedLessonTitle(intendedNode.title);
            updateUrl({
              documentId: doc,
              pageNumber: urlPage,
              nodeId: intendedNode.id,
              lessonTitle: intendedNode.title,
              keepSearch: true
            });
          } else {
            // urlPage 不在节点范围内或不是正整数——校正到 startPage
            setSelectedNode(intendedNode.id);
            setSelectedLessonTitle(intendedNode.title);
            setPageNo(intendedNode.startPage);
            updateUrl({
              documentId: doc,
              pageNumber: intendedNode.startPage,
              nodeId: intendedNode.id,
              lessonTitle: intendedNode.title,
              keepSearch: true
            });
          }
        }
        initialAddressCorrected.current[docId] = true;
        // 首次校正已处理显式意图——跳过 Phase 2，防止普通按页匹配覆盖
        return;
      }
    }

    // ---- Phase 2: 普通翻页节点匹配 ------------------------------------
    // 目录点击是教师的显式选择；在 PDF 页在该节点范围内变化时保持该节点选中，
    // 否则普通页匹配会立即用更深的子节点替换选中节点，使高亮跳转到别处。
    const selected = findTreeNodeById(tree, selectedNode);
    if (selected && nodeContainsPage(selected, pageNo)) {
      // 首次地址校正完成后，如果篇名与当前节点不一致，同步篇名与 URL
      if (initialAddressCorrected.current[doc] && selected.title !== selectedLessonTitle) {
        setSelectedLessonTitle(selected.title);
        updateUrl({
          documentId: doc,
          pageNumber: pageNo,
          nodeId: selected.id,
          lessonTitle: selected.title,
          keepSearch: true
        });
      }
      return;
    }
    const located = findTreeNode(tree, pageNo);
    if (located && (located.id !== selectedNode || located.title !== selectedLessonTitle)) {
      setSelectedNode(located.id);
      setSelectedLessonTitle(located.title);
      // 首次地址校正完成后，普通翻页以当前教材页码所在节点同步完整 URL
      if (initialAddressCorrected.current[doc]) {
        updateUrl({
          documentId: doc,
          pageNumber: pageNo,
          nodeId: located.id,
          lessonTitle: located.title,
          keepSearch: true
        });
      }
    }
  }, [tree, pageNo, selectedNode, selectedLessonTitle, doc, treeDocumentId]);
  const updateUrl = ({documentId, pageNumber, nodeId = '', lessonTitle = selectedLessonTitle, keepSearch = true}) => { const url=new URL(location.href); url.pathname='/library/'; url.search=new URLSearchParams({doc:documentId,page:String(pageNumber),...(keepSearch&&query?{q:query}:{}),...(scope?{scope}:{}),...(nodeId?{node:nodeId}:{}),...(lessonTitle?{lesson:lessonTitle}:{})}).toString(); globalThis.history?.replaceState?.(null,'',url); };
  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URLSearchParams(location.search);
      const nextDoc = canonicalDocumentId(next.get('doc'));
      if (nextDoc && docs.some(item => item.id === nextDoc)) setDoc(nextDoc);
      const nextPage = Number(next.get('page'));
      if (Number.isInteger(nextPage) && nextPage > 0) setPageNo(nextPage);
      setSelectedNode(next.get('node') || '');
      setSelectedLessonTitle(next.get('lesson') || '');
      setQuery(next.get('q') || '');
      const nextScope = next.get('scope');
      if (['all', 'both', 'textbook', 'teacher-guide', 'curriculum-standard'].includes(nextScope)) setScope(nextScope);
      setSearched(Boolean(next.get('q')));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [docs.length]);
  const openReaderTarget = async ({ documentId = doc, pageNumber = 1, nodeId = '', lessonTitle = '', keepSearch = true, clearSearch = false } = {}) => { const canonicalId = canonicalDocumentId(documentId); const target = docs.find(item => item.id === canonicalId); const requestedPage = Number(pageNumber); if (!target || !Number.isInteger(requestedPage) || requestedPage < 1) return false; const max = Math.max(1, target.pageCount || 1); const safePage = Math.min(max, requestedPage); let targetTree = canonicalId === doc ? tree : treesCache.current[canonicalId]; if (canonicalId !== doc && !targetTree) {
      try { targetTree = await ensureTree(canonicalId); }
      catch (error) { setTreeError('目标教材目录暂时无法读取，当前页面未切换。请重试。'); return false; }
    }
    const explicit = findTreeNodeById(targetTree || [], nodeId); let resolvedPage = explicit && explicit.pageRange?.start && !nodeContainsPage(explicit, safePage) ? explicit.pageRange.start : safePage; let resolvedNodeId = explicit?.id || ''; let nextLessonTitle = lessonTitle || (canonicalId === doc ? selectedLessonTitle : ''); if (canonicalId !== doc && nextLessonTitle && !explicit) {
      try {
        setTreeError('');
        const crossDoc = resolveCrossDocTarget({
          targetDocId: canonicalId,
          lessonTitle: nextLessonTitle,
          pageNo: resolvedPage,
          treesCache: treesCache.current,
          docs
        });
        if (crossDoc) {
          resolvedPage = crossDoc.page;
          resolvedNodeId = crossDoc.nodeId || '';
          nextLessonTitle = crossDoc.lessonTitle || nextLessonTitle;
        }
      } catch (error) {
        setTreeError('目标教材目录暂时无法读取，当前页面未切换。请重试。');
        return false;
      }
    }
  const located = explicit || (canonicalId === doc ? findTreeNode(tree, resolvedPage) : null);
  if (!resolvedNodeId) {
    resolvedNodeId = located?.id || '';
    // Cross-document: never pass the source document's nodeId into the
    // target document's URL — the target tree has no matching node.
    if (canonicalId !== doc) resolvedNodeId = '';
  }
  if (!nextLessonTitle) {
    nextLessonTitle = canonicalId === doc ? selectedLessonTitle : '';
  }
  setDoc(target.id);
  setSelectedNode(resolvedNodeId);
  setSelectedLessonTitle(nextLessonTitle);
  setPageNo(Math.min(max, resolvedPage));
  if (clearSearch) {
    setQuery('');
    setResults([]);
    setVisibleResults(6);
    setSearched(false);
    setSearchError('');
  }
  updateUrl({
    documentId: target.id,
    pageNumber: Math.min(max, resolvedPage),
    nodeId: resolvedNodeId,
    lessonTitle: nextLessonTitle,
    keepSearch: !clearSearch && keepSearch
  });
  return true;
  };
  const searchRequest = useRef(0);
  const search=async e=>{e?.preventDefault(); const text=query.trim(); const requestId=++searchRequest.current; if(!text){setResults([]);setVisibleResults(6);setSearched(false);setSearchError('');return;} if(text.length<2){setResults([]);setVisibleResults(6);setSearched(true);setSearchError('请输入至少两个字符，再开始搜索。');return;} setBusy(true);setSearched(true);setSearchError('');try { const scopes=scope==='all'?docs.map(item=>item.id):scope==='both'?['textbook','teacher-guide']:[scope]; const data=await request('/search',{method:'POST',body:{query:text,scope:scopes,limit:12}}); if(requestId !== searchRequest.current)return; setResults(prioritizeSearchResults(Array.isArray(data.results)?data.results:[])); setVisibleResults(6); const url=new URL(location.href);url.searchParams.set('q',text);url.searchParams.set('scope',scope);globalThis.history?.replaceState?.(null,'',url); } catch(error) { if(requestId !== searchRequest.current)return; setResults([]);setVisibleResults(6);setSearchError('搜索暂时不可用，请稍后重试。'); } finally {if(requestId === searchRequest.current)setBusy(false)} };
  useEffect(() => {
    // A copied library URL with `q` should restore its result rail instead of
    // leaving the teacher at an empty state. The manual search flow remains
    // unchanged; this only runs once after the dynamic catalogue is ready.
    if (!initialSearch.current || !docs.length || busy) return;
    initialSearch.current = false;
    if (query.trim().length >= 2) search();
  }, [docs.length]);
  const clearSearch=()=>{searchRequest.current += 1;setBusy(false);setQuery('');setResults([]);setVisibleResults(6);setSearched(false);setSearchError('');const url=new URL(location.href);url.searchParams.delete('q');if(scope)url.searchParams.set('scope',scope);globalThis.history?.replaceState?.(null,'',url)};
  const switchDocument = async id => { return openReaderTarget({ documentId: id, pageNumber: pageNo, nodeId: '', lessonTitle: selectedLessonTitle, clearSearch: true, keepSearch: false }); };
  const pick=node=>{const { start: nextPage }=node.pageRange||nodePageRange(node); if(nextPage>0)openReaderTarget({documentId:doc,pageNumber:nextPage,nodeId:node.id,lessonTitle:node.title});};
  const pagePdf=String(page?.viewer?.pdfUrl||page?.pdfUrl||currentDoc?.pdfUrl||'').split('#')[0];
  const maxPage=currentDoc?.pageCount||1;
  const goPage = next => { setPdfError(false); return openReaderTarget({ documentId: doc, pageNumber: next }); };
  const commitPageInput = () => {
    const requested = Number(pageInput);
    if (!Number.isInteger(requested) || requested < 1) {
      setPageInput(String(pageNo));
      return;
    }
    goPage(Math.min(maxPage, requested));
  };
  const preparationHref = sourceScope => buildPreparationHref({
    scope: sourceScope,
    documentId: doc,
    page: pageNo,
    nodeId: selectedNode,
    lessonTitle: selectedLessonTitle || pageTitle(page)
  });
  const visibleSearchGroups = groupSearchResults(results.slice(0, visibleResults));
  return (
    <div className="view-stack index-page">
      <section className="hero index-hero">
        <div><Badge tone="green"><Library/> 教材库</Badge><h1>先选定要查的材料，<br/>再从目录进入具体篇目</h1><p>课程标准说明学段要求与学业质量，学生教材用于核对课文原页，教师教学用书用于参考课时、活动和教学处理。目录、搜索和教材原页核验会始终同步。</p></div>
        <div className="index-health"><b>{docs.reduce((sum, item) => sum + item.pageCount, 0)}</b><span>页可定位</span><small>{docs.length} 份材料 · 已准备好按页查找</small></div>
      </section>
      <section className="panel source-selector">
        <SectionHead icon={BookOpen} eyebrow="选择教材来源" title="你现在要查哪一本？" note="仅切换阅读与搜索范围，不会重复处理整本教材。"/>
        <div className="source-selector-grid">{docs.length ? docs.map(item => {
          const selected = doc === item.id;
          const kind = item.documentType === "teacher_guide" ? "教师教学用书" : item.documentType === "textbook" ? "学生教材" : item.documentType === 'curriculum_standard' ? '课程标准' : "教学资料";
          const indexed = item.indexedPages || item.pageCount;
          return <article className={`source-choice ${selected ? "selected" : ""}`} key={item.id}>
            <button type="button" className="source-choice-main" onClick={() => switchDocument(item.id)}>
              <span className={`source-cover ${item.tone}`}><b>{item.documentType === "teacher_guide" ? "用书" : item.documentType === 'curriculum_standard' ? '课标' : "教材"}</b><small>{item.documentType === 'curriculum_standard' ? <>2022年<br/>版</> : <>九年级<br/>上册</>}</small></span>
              <span className="source-choice-copy"><strong>{item.title}</strong><small>{kind} · {item.pageCount} 页</small><em>{statusLabel(item.indexStatus)} · {indexed}/{item.pageCount || indexed} 页可搜索</em></span>
              {selected && <Badge tone="green">当前阅读</Badge>}
            </button>
            <div className="source-choice-actions"><button type="button" aria-label={`查看${item.short || item.title}目录`} onClick={() => switchDocument(item.id)}>查看目录</button><a href={preparationHref(item.id)}>进入备课问答 <ArrowRight/></a></div>
          </article>;
        }) : <div className="catalog-empty"><FileSearch/><b>{docsError || "正在读取教材目录…"}</b><div className="catalog-empty-actions">{docsError === '登录已过期，请重新登录后继续。' ? <a className="primary" href={"/login/?next=" + encodeURIComponent(location.pathname + location.search)}>重新登录</a> : <button type="button" onClick={loadDocs}>重新读取</button>}</div></div>}</div>
      </section>
      <div className="index-toolbar"><form onSubmit={search}>
        <label className="search-scope"><span>搜索范围</span><select value={scope} onChange={e => setScope(e.target.value)}><option value="all">课标、学生教材与教师用书</option><option value="both">学生教材与教师用书</option>{docs.map(item => <option value={item.id} key={item.id}>{item.short}</option>)}</select></label>
        <label className="search-input"><Search/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索篇名、章节或教学问题" aria-label="搜索篇名、章节或教学问题"/></label>
        <div className="search-actions"><button type="submit" disabled={busy}>{busy ? "正在搜索…" : "搜索"}</button>{(searched || query) && <button type="button" className="search-clear" onClick={clearSearch}>清除</button>}</div>
      </form></div>
      <div className={`index-workspace ${searched || busy ? 'search-active' : 'catalog-reading'}`}>
        <aside className="index-outline"><header><span>教材目录</span><small>点击篇目标题定位起始页 · 教材页码范围</small></header><Tree nodes={tree} current={selectedNode} onPick={pick} error={treeError} loading={treeBusy} retry={loadTree}/></aside>
        <section className="index-reader">
          <header><div><Badge tone={currentDoc?.tone || "green"}>{currentDoc?.short || "教材"}</Badge><h2>{pageTitle(page)}</h2><small>第 {pageNo} 页 {page?.printedPage ? `· 书页 ${page.printedPage}` : ""}</small></div>
            <div><button type="button" disabled={pageNo <= 1} onClick={() => goPage(pageNo - 1)}>上一页</button><input aria-label="教材页码" inputMode="numeric" value={pageInput} onChange={event => setPageInput(event.target.value.replace(/\D/gu, ''))} onBlur={commitPageInput} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPageInput(); event.currentTarget.blur(); } }}/><button type="button" disabled={pageNo >= maxPage} onClick={() => goPage(pageNo + 1)}>下一页</button><a className="reader-prepare-link" href={preparationHref(scope)}>围绕本篇开始备课 <ArrowRight/></a><a href={buildReaderHref({ documentId: doc, page: pageNo, nodeId: selectedNode, lessonTitle: selectedLessonTitle || pageTitle(page), scope, returnTo: currentPageReturn() })}><ExternalLink/>核验原始教材</a></div>
          </header>
          <article className="library-pdf-article"><div className="library-pdf-meta"><span>原始教材是唯一可核验的依据</span><b>第 {pageNo} 页 · 书页 {page?.printedPage || "未标注"}</b></div>{pageBusy ? <div className="index-empty" role="status"><Activity/><b>正在打开教材第 {pageNo} 页</b><p>目录与页码保持不变，页面读取完成后会自动显示。</p></div> : pagePdf && !pdfError ? <iframe key={`${doc}-${pageNo}-${pageRetry}`} title={`${currentDoc?.short || "教材"} 第 ${pageNo} 页`} src={pdfPageUrl(pagePdf,pageNo)} onError={() => setPdfError(true)}/> : <div className="index-empty"><FileText/><b>{pageError || '当前教材页面暂时无法显示'}</b><p>可以重试当前页，或在新窗口打开原始 PDF。</p><div className="cards-alert-actions"><button type="button" onClick={() => { setPdfError(false); setPageRetry(value => value + 1); }}>重试当前页</button>{pagePdf && <a className="primary" href={pdfPageUrl(pagePdf,pageNo)} target="_blank" rel="noreferrer">新窗口打开</a>}</div></div>}</article>
        </section>
        <aside className="index-results"><header><span>搜索结果</span><small role="status" aria-live="polite">{busy ? "正在查阅教材…" : results.length ? `${results.length} 条相关页面` : searched ? "暂时没有找到相关页面" : "输入关键词开始搜索"}</small></header>{searchError ? <div className="index-empty search-error"><CircleAlert/><b>{searchError}</b><button type="button" onClick={search}>再试一次</button></div> : busy ? <div className="index-empty search-loading" role="status"><Activity/><b>正在教材中查找</b><p>结果返回前不会显示“没有找到”，请稍候。</p></div> : results.length ? <>{visibleSearchGroups.map(group => <section className={`index-result-group result-group-${group.id}`} key={group.id}><h3>{group.label}<small>{group.items.length} 条</small></h3>{group.items.map((r, i) => { const resultDocumentId=searchResultDocumentId(r); const resultPage=searchResultPage(r); const disabled=!resultDocumentId || !resultPage; const resultTitle=r.title || r.sectionPath?.at(-1) || "相关页面"; return <button type="button" disabled={disabled} key={`${resultDocumentId || 'unknown'}-${resultPage || 'unknown'}-${i}`} onClick={() => resultPage && openReaderTarget({documentId: resultDocumentId, pageNumber: resultPage, nodeId: r.nodeId || r.node_id || "", lessonTitle: resultTitle})}><b>{resultTitle}</b><small>{r.documentTitle || r.document_title || docName(resultDocumentId)} · {resultPage ? `第${resultPage}页` : '页码待确认'} · 书页 {r.printedPage || r.printed_page || "未标注"}</small><p>{citationText(r)}</p><span className="result-open-hint">{resultPage ? '点击在中间阅读区打开这一页' : '该结果暂缺教材页码，暂不能定位'}</span></button>; })}</section>)}{results.length>visibleResults && <button className="show-more-results" type="button" onClick={()=>setVisibleResults(value=>Math.min(results.length,value+6))}>查看更多相关页面（还有 {results.length-visibleResults} 条）</button>}</> : <div className="index-empty"><Search/><b>{searched ? "暂时没有找到相关页面" : "在教材库中搜索"}</b><p>{searched ? "可以试试完整篇名、单元名，或换成“教学重点”“朗读处理”等更具体的说法。" : "输入篇名、章节、关键词或教学问题，结果会显示文档、章节、教材页码和书页。"}</p></div>}</aside>
      </div>
    </div>
  );
}

export function citationByRef(citations, refs = []) {
  return uniqueCitations(citations, refs);
}

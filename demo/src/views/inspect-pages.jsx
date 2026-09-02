// 教材处理与页面对齐（Ingest/Jobs/Inspect/Validation/课程对齐，从 App.jsx 迁出）
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, CircleAlert, ClipboardCheck, ExternalLink, Eye, FileCheck2, FileSearch, FileText, Library, RefreshCw, Route, Target, Upload } from 'lucide-react';
import { Badge, SectionHead, Stat } from '../ui-kit.jsx';
import { JOB_STAGES, askErrorMessage, canonicalDocumentId, citationLink, docName, focusedCurriculumExcerpt, ingestErrorMessage, pageNumber, pageText, pageTitle, pdfPageUrl, queryParams, questionState, request, rootRequest, statusLabel, terminalJob, uploadPdf, useAuthSession, useCatalogDocument } from '../app-core.js';
import { ProviderResult } from './document-page.jsx';
import { buildCurriculumAlignment, curriculumSearchQueries } from '../../shared/curriculum-alignment.js';
export function IngestPage() {
  const [file,setFile]=useState(null),[step,setStep]=useState(1),[kind,setKind]=useState('teacher_guide'),[policy,setPolicy]=useState('auto'),[working,setWorking]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null);
  const displayFile=file;
  const preflight=()=>{
    setError('');
    if(!file) { setError('请先选择一个真实的 PDF 文件。'); return; }
    if((file.type && file.type!=='application/pdf') || !file.name.toLowerCase().endsWith('.pdf')) { setError('请选择 PDF 文件。'); return; }
    setStep(2);
  };
  const createTask=async()=>{
    if(working)return;
    setWorking(true);setError('');setCreated(null);
    try{
      if(!file)throw new Error('pdf_file_required');
      const title=file.name.replace(/\.pdf$/i,'');
      const registered=await uploadPdf(file,{documentType:kind,title,extractionPolicy:policy});
      const documentId=registered?.upload?.documentId||registered?.registration?.document?.id||registered?.document?.id||registered?.documentId||registered?.id;
      if(!documentId)throw new Error('document_id_missing');
      const indexing=registered?.indexing||{};
      if(indexing.status==='failed')throw new Error(indexing.error||'indexing_failed');
      if(indexing.status==='deferred')throw new Error(indexing.reason||'indexing_failed');
      let jobId=indexing.jobId||indexing.id;
      if(!jobId){
        const job=await request(`/documents/${encodeURIComponent(documentId)}/build`,{method:'POST',body:{extractionPolicy:policy,documentType:kind}});
        jobId=job?.jobId||job?.id;
      }
      if(!jobId)throw new Error('job_id_missing');
      setCreated({documentId,jobId});setStep(4);
      location.assign(`/jobs/?jobId=${encodeURIComponent(jobId)}&documentId=${encodeURIComponent(documentId)}&doc=${encodeURIComponent(kind==='teacher_guide'?'teacher-guide':kind)}`);
    }catch(err){setError(`创建索引任务失败：${ingestErrorMessage(err.message)}`)}finally{setWorking(false)}
  };
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Upload/> 教材导入向导</Badge><h1>原始文件不可变保存，<br/>页面内容按教材页码逐页处理</h1><p>扫描 PDF、页面文字 PDF 和混合 PDF 都可导入；公开界面始终展示原始教材页面。</p></div><div className="wizard-steps">{['选择文件','文档预检','确认策略','创建任务'].map((x,i)=><span className={step>i?'active':''} key={x}><b>{i+1}</b>{x}</span>)}</div></section>
    {error&&<div className="ask-error"><CircleAlert/>{error}</div>}
    {step===1?<section className="panel upload-panel"><label className="dropzone"><Upload/><h2>拖入 PDF，或点击选择文件</h2><p>支持页面文字、扫描页与混合文档。原始教材不会被解析结果覆盖。</p><input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/><span>{file?file.name:'选择 PDF 文件'}</span></label><button type="button" className="primary wide-action" onClick={preflight} disabled={!file}>检查当前文件</button></section>:<><section className="panel"><SectionHead icon={FileCheck2} eyebrow="文档预检" title={displayFile.name} note="当前页面先检查文件；提交后会逐页读取内容并建立目录。"/><div className="preflight-grid"><Stat icon={FileText} label="文件大小" value={`${(displayFile.size/1024/1024).toFixed(1)} MB`} note="登记后由服务端计算 SHA-256"/><Stat icon={BookOpen} label="预计页数" value="提交后读取" note="教材页码由解析任务确认"/><Stat icon={FileSearch} label="页面文字" value="逐页检查" note="质量合格时直接使用" tone="green"/><Stat icon={Eye} label="扫描页面" value="自动判断" note="只识别缺失或质量不足的页面" tone="gold"/></div><div className="preview-strip">{['起始页','中段页','末页'].map(label=><div key={label}><div className="preview-paper"><FileText/><span>原始教材<br/>{label}</span></div><b>任务完成后可核验</b></div>)}</div></section><section className="panel confirm-grid"><div><label>文档分类</label><select value={kind} onChange={e=>setKind(e.target.value)}><option value="textbook">学生教材</option><option value="teacher_guide">教师教学用书</option><option value="other">其他教学资料</option></select></div><div><label>提取策略</label><select value={policy} onChange={e=>setPolicy(e.target.value)}><option value="auto">自动判断（推荐）</option><option value="native">仅使用页面文字</option><option value="ocr">强制重新识别页面</option></select></div><div className="policy-note"><CheckCircle2/><span><b>教材页码保护</b><small>任何解析和人工修正都不会改变 第几页。</small></span></div><button type="button" className="primary" onClick={createTask} disabled={working}>{working?'正在登记并创建任务…':'确认并开始处理'} <ArrowRight/></button>{created&&<small>已开始处理，正在进入进度页面。</small>}</section></>}
  </div>;
}

export function JobsPage() {
  const params=useMemo(()=>queryParams(),[]), jobId=params.get('jobId')||params.get('job'), documentId=canonicalDocumentId(params.get('documentId')||params.get('doc'))||'teacher-guide';
  const [job,setJob]=useState(null),[loading,setLoading]=useState(Boolean(jobId)),[error,setError]=useState('');
  const refresh=async(signal)=>{
    if(!jobId)return;
    try{const next=await request(`/status/${encodeURIComponent(jobId)}`,{signal});setJob(next);setError('');return next}catch(err){if(err.name!=='AbortError')setError('暂时无法读取处理状态，请稍后刷新。');return null}finally{setLoading(false)}
  };
  useEffect(()=>{
    if(!jobId)return;
    const controller=new AbortController();let timer;
    const poll=async()=>{const next=await refresh(controller.signal);if(next&&!terminalJob(next.status))timer=setTimeout(poll,1800)};
    poll();return()=>{controller.abort();clearTimeout(timer)};
  },[jobId]);
  const catalogInfo=useCatalogDocument(documentId);
  const info=catalogInfo||{short:docName(documentId),tone:'green',pageCount:0};
  const total=Number(job?.totalPages||info.pageCount||0), processed=Number(job?.processedPages||0), stage=Math.max(0,Number(job?.stage||0)), percent=total?Math.min(100,Math.round(processed/total*100)):0;
  const issues=Array.isArray(job?.issues)?job.issues:Array.isArray(job?.failedPageDetails)?job.failedPageDetails:[];
  if (!jobId) return <div className="view-stack jobs-empty-page"><section className="hero compact-hero"><div><Badge tone="green"><Activity/> 教材处理</Badge><h1>这里查看新教材何时可以开始搜索，<br/>不会在阅读或提问时重复构建。</h1><p>现有教材已经可以直接阅读和搜索。只有导入新的 PDF，或明确选择重新处理页面时，才会在这里创建任务。</p></div></section><section className="panel jobs-empty-card"><div><span className="jobs-empty-icon"><CheckCircle2/></span><h2>暂时没有正在处理的任务</h2><p>可先从教材库选择篇目和原始教材；需要导入新材料时，再创建一次处理任务。</p></div><div><a className="primary" href="/library/"><Library/>进入教材库</a><a href="/ingest/"><Upload/>导入新教材</a></div></section></div>;
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Activity/> 教材处理进度</Badge><h1>{total||'长文档'} 页任务持续反馈进度，<br/>单页失败不让整本作废</h1><p>教材在后台逐页处理；本页会持续读取真实进度，不会因为单页异常让整本教材失效。</p></div><div className="job-summary"><b>{percent}%</b><span>已处理 {processed} / {total||'—'} 页</span><small>状态：{loading?'正在读取…':statusLabel(job?.status)}</small></div></section>{error&&<div className="ask-error"><CircleAlert/>{error}</div>}{!jobId&&<div className="ask-error"><CircleAlert/>当前页面还没有对应的处理任务。请从“导入教材”开始，或返回教材库选择已准备好的材料。</div>}<section className="panel"><SectionHead icon={Route} eyebrow="七阶段任务" title={`${info.short} · ${job?.options?.extractionPolicy||'自动判断'}策略`} action={<a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=1`}>查看页面处理结果 <ArrowRight/></a>}/><div className="job-stage-list">{JOB_STAGES.map((name,i)=>{const number=i+1,done=number<stage||(number===stage&&terminalJob(job?.status)),active=number===stage&&!terminalJob(job?.status);return <article className={done?'done':active?'active':''} key={name}><span>{done?<Check/>:number}</span><div><b>{name}</b><small>{done?'已完成':active?`正在执行：${job?.stageName||name}`:'等待前序阶段'}</small></div>{done&&<Badge tone="green">通过</Badge>}</article>})}</div></section><div className="two-col"><section className="panel"><SectionHead icon={Activity} eyebrow="页面统计" title="处理结果"/><div className="mini-stats"><div><b>{Number(job?.successPages||0)}</b><small>正常页</small></div><div><b>{Number(job?.warningPages||0)}</b><small>需检查</small></div><div><b>{Number(job?.failedPages||0)}</b><small>失败页</small></div><div><b>{job?.elapsed||job?.elapsedTime||'—'}</b><small>已耗时</small></div></div><div className="progress-bar"><i style={{width:`${percent}%`}}/></div><p className="muted">失败页应从回答和三卡生成中排除，其余有效页面保持可搜索。</p></section><section className="panel"><SectionHead icon={CircleAlert} eyebrow="需要检查" title="异常页面"/><div className="issue-list">{issues.length?issues.map((issue,i)=>{const p=Number(issue.page||issue.pdfPage||issue.pageNumber||1);return <a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=${p}`} key={`${p}-${i}`}><Badge tone="orange">PDF {p}</Badge><span>{issue.message||issue.error||'需要人工检查'}</span><ChevronRight/></a>}):<p className="muted">{job?'暂时没有返回需要核对的页面。':'正在等待处理状态。'}</p>}</div><div className="retry-actions"><button type="button" onClick={()=>refresh()} disabled={!jobId||loading}><RefreshCw/>{loading?'读取中':'刷新任务状态'}</button><a href={`/inspect/?doc=${encodeURIComponent(documentId)}&page=1`}>前往页面检查</a></div></section></div></div>;
}

export function InspectPage() {
  const params=useMemo(()=>queryParams(),[]), doc=canonicalDocumentId(params.get('documentId')||params.get('doc'))||'teacher-guide';
  const [page,setPage]=useState(Math.max(1,Number(params.get('page'))||1)),[source,setSource]=useState('retrieval'),[record,setRecord]=useState(null),[retrievalText,setRetrievalText]=useState(''),[included,setIncluded]=useState(true),[title,setTitle]=useState(''),[printedPage,setPrintedPage]=useState(''),[sectionPath,setSectionPath]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[rerunning,setRerunning]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const catalogInfo=useCatalogDocument(doc);
  const info=catalogInfo||{short:docName(doc),tone:'green',pdfUrl:''};
  const applyPage=data=>{const next=data?.page||data;setRecord(next);setSource(next?.selectedTextSource||next?.textSource||'retrieval');setRetrievalText(pageText(next,'retrieval'));setIncluded(next?.includeInIndex!==false);setTitle(next?.pageTitle||next?.title||'');setPrintedPage(String(next?.printedPageLabel??next?.printedPage??''));setSectionPath(Array.isArray(next?.sectionPath)?next.sectionPath.join(' › '):String(next?.sectionPath||''));};
  const loadPage=async(target=page,signal)=>{setLoading(true);setError('');try{const data=await request(`/page/${encodeURIComponent(doc)}/${target}`,{signal});applyPage(data)}catch(err){if(err.name!=='AbortError')setError(`暂时无法读取第 ${target} 页，请稍后重试。`)}finally{setLoading(false)}};
  useEffect(()=>{const controller=new AbortController();globalThis.history?.replaceState?.(null,'',`/inspect/?doc=${encodeURIComponent(doc)}&page=${page}`);loadPage(page,controller.signal);return()=>controller.abort()},[doc,page]);
  const save=async()=>{if(saving)return;setSaving(true);setError('');setNotice('');try{const data=await request(`/documents/${encodeURIComponent(doc)}/pages/${page}`,{method:'PATCH',body:{pageTitle:title,printedPageLabel:printedPage,sectionPath:sectionPath.split(/\s*[›>/]\s*/).filter(Boolean),retrievalText,includeInIndex:included}});applyPage(data);setNotice('页面调整已保存；原始教材和教材页码保持不变。')}catch(err){setError('暂时无法保存页面调整，请稍后重试。')}finally{setSaving(false)}};
  const rerun=async()=>{if(rerunning)return;setRerunning(true);setError('');setNotice('');try{await request(`/documents/${encodeURIComponent(doc)}/pages/rerun`,{method:'POST',body:{pages:[page],extractionPolicy:'auto'}});setNotice('已安排重新读取当前页；完成后会更新搜索文字和质量状态。');await loadPage(page)}catch(err){setError('暂时无法重新读取当前页，请稍后重试。')}finally{setRerunning(false)}};
  const shownText=source==='retrieval'?retrievalText:pageText(record,source);
  const activeSource=record?.selectedTextSource||record?.textSource||source;
  const sourceName=activeSource==='ocr'
    ? `页面识别${record?.ocrProvider ? `（${record.ocrProvider === 'paddleocr' ? 'PaddleOCR' : record.ocrProvider}）` : ''}`
    : activeSource==='native'
      ? 'PDF 原生文字层（未重复识别）'
      : activeSource==='merged' ? '原生文字与页面识别组合' : '暂无可用文字';
  const ocrText=pageText(record,'ocr');
  const ocrNote=record?.ocrError
    ? `页面识别未完成：${record.ocrError === 'ocr_unavailable' ? 'OCR 服务未安装或未启动' : record.ocrError === 'ocr_input_missing' ? '没有可供识别的页面图像' : '识别服务返回失败'}`
    : ocrText ? `页面识别已完成${record?.ocrModel ? ` · ${record.ocrModel}` : ''}${record?.ocrConfidence != null ? ` · 置信度 ${(Number(record.ocrConfidence) * 100).toFixed(0)}%` : ''}`
      : '本页已有可用原生文字层，未重复进行页面识别。';
  const rawPdfUrl=String(record?.viewer?.pdfUrl||record?.pdfUrl||info.pdfUrl||'').split('#')[0];
  return <div className="view-stack"><section className="panel inspect-toolbar"><div><Badge tone={info.tone}>{info.short}</Badge><h1>页面校正</h1><p>原始教材不可修改；这里只调整用于搜索的页面文字、标题、章节和书页码。</p></div><div><button type="button" onClick={()=>setPage(p=>Math.max(1,p-1))}>上一页</button><input value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/><button type="button" onClick={()=>setPage(p=>p+1)}>下一页</button><a href={`/document/?doc=${encodeURIComponent(doc)}&page=${page}`}>核验原页 <ExternalLink/></a></div></section>{error&&<div className="ask-error"><CircleAlert/>{error}</div>}{notice&&<div className="quality-box"><CheckCircle2/>{notice}</div>}<div className="inspect-layout"><section className="panel original-preview"><header><b>原始教材· 教材页码 {page}</b><Badge tone="green">唯一可核验的依据</Badge></header>{rawPdfUrl?<iframe key={`${doc}-${page}`} title="原始教材页面" src={pdfPageUrl(rawPdfUrl,page)}/>:<div className="index-empty"><FileText/><b>正在读取原始教材</b><p>页面信息加载后会在这里显示对应原页。</p></div>}</section><section className="panel extraction-editor"><SectionHead icon={FileSearch} eyebrow="用于教材搜索的文字" title={loading?'正在读取页面…':'当前生效文字'}/><div className="source-tabs"><button type="button" className={source==='native'?'active':''} onClick={()=>setSource('native')}>页面文字</button><button type="button" className={source==='ocr'?'active':''} onClick={()=>setSource('ocr')}>扫描页文字</button><button type="button" className={source==='retrieval'?'active':''} onClick={()=>setSource('retrieval')}>当前生效文字</button></div><p className="inspect-source-note">{ocrNote}</p><textarea value={shownText} readOnly={source!=='retrieval'} onChange={e=>setRetrievalText(e.target.value)} placeholder={loading?'正在加载…':source==='ocr'&&!ocrText?'本页没有页面识别文字':'该文本来源暂无内容'}/><div className="editor-fields"><label>页面标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>书页码<input value={printedPage} onChange={e=>setPrintedPage(e.target.value)}/></label><label>章节路径<input value={sectionPath} onChange={e=>setSectionPath(e.target.value)}/></label></div><div className="quality-box"><CheckCircle2/><span><b>质量状态：{record?.textQualityStatus||record?.qualityStatus||'待读取'}</b><small>页面文字来源：{sourceName} · 教材页码 {page} 保持不变</small></span></div><div className="editor-actions"><label><input type="checkbox" checked={included} onChange={e=>setIncluded(e.target.checked)}/>纳入教材搜索</label><button type="button" onClick={rerun} disabled={rerunning||loading}><RefreshCw/>{rerunning?'正在创建任务':'重新读取当前页'}</button><button type="button" className="primary" onClick={save} disabled={saving||loading}>{saving?'正在保存':'保存页面调整'}</button></div></section></div></div>;
}

const VALIDATION_QUESTIONS = [
  ['《我爱这土地》第二节为什么不能删', '学生教材与教师用书相关页'],
  ['第一单元三项任务之间是什么关系', '第一单元任务设计'],
  ['《我爱这土地》的教学重点和依据', '教师用书教学建议'],
  ['朗读的重音和节奏建议来自哪里', '朗读教学建议'],
  ['某项练习如何处理', '练习处理建议'],
  ['单元目标和篇目目标有什么关系', '单元与篇目目标'],
  ['教师用书如何说明诗歌意象', '诗歌意象教学'],
  ['《乡愁》的教学入口是什么', '篇目教学入口'],
  ['诗歌朗诵任务如何评价', '朗诵评价建议'],
  ['尝试创作任务如何承接鉴赏学习', '鉴赏与创作任务关系']
];

export function questionResult(validation, question) {
  const items = validation?.questionResults || validation?.questions || [];
  const result = items.find(item => item.question === question) || null;
  if (!result || result.hit || !result.hits?.length) return result;
  const hit = result.hits[0];
  return {
    ...result,
    evidenceSufficient: Boolean(result.passed),
    hit: {
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      documentType: hit.documentType,
      pdfPage: hit.pdfPage,
      printedPage: hit.printedPage,
      sectionPath: hit.sectionPath,
      text: hit.text || '',
      viewer: hit.viewer
    }
  };
}



export function ValidationPage() {
  const params = useMemo(() => queryParams(), []);
  const documentId = canonicalDocumentId(params.get('documentId') || params.get('doc')) || 'teacher-guide';
  const [selected, setSelected] = useState(0);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const loadValidation = async signal => {
    setLoading(true);
    try {
      const data = await request(`/documents/${encodeURIComponent(documentId)}/validation`, { signal });
      setValidation(data);
      setError('');
      return data;
    } catch (err) {
      if (err.name !== 'AbortError') setError('暂时无法读取教材质量检查结果，请稍后重试。');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadValidation(controller.signal);
    return () => controller.abort();
  }, [documentId]);

  const startValidation = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      await request(`/documents/${encodeURIComponent(documentId)}/validate`, {
        method: 'POST',
        body: { questions: VALIDATION_QUESTIONS.map(([question]) => question) }
      });
      await loadValidation();
    } catch (err) {
      setError('暂时无法启动教材质量检查，请稍后重试。');
    } finally {
      setRunning(false);
    }
  };

  const localValidation = validation?.local
    || (validation?.providerKind === 'local' ? validation : null);
  const pageIndexValidation = validation?.pageindex
    || validation?.shadow
    || (validation?.providerKind === 'pageindex' ? validation : null)
    || (validation?.provider === 'pageindex' ? validation : null)
    // The service report is intentionally provider-neutral and exposes its
    // question results as `questions`. Treat that production response as the
    // active index report instead of rendering the old empty comparison state.
    || (Array.isArray(validation?.questions) ? validation : null);
  const activeQuestion = VALIDATION_QUESTIONS[selected][0];
  const localResult = questionResult(localValidation, activeQuestion);
  const pageIndexResult = questionResult(pageIndexValidation, activeQuestion);
  const currentValidation = pageIndexValidation || localValidation;
  const currentQuestions = currentValidation?.questionResults || currentValidation?.questions || [];
  const passed = currentQuestions.filter(item => item.passed).length;
  const total = currentQuestions.length;

  return <div className="view-stack">
    <section className="hero compact-hero">
      <div>
        <Badge tone="blue"><ClipboardCheck/> 教材质量检查</Badge>
        <h1>确认篇目、页码与引用，<br/>让每次回答都能回到原始教材</h1>
        <p>逐题检查教材目录的真实定位结果、教材页码和引用片段；检查未通过的页面不会被当作可靠依据。</p>
        <button type="button" className="primary" onClick={startValidation} disabled={running}>
          {running ? '正在检查教材…' : '重新检查教材质量'}
        </button>
      </div>
      <div className="validation-score">
        <b>{total ? `${passed} / ${total}` : '—'}</b>
        <span>{loading ? '正在读取检查结果' : `当前状态：${statusLabel(currentValidation?.status || 'not_run')}`}</span>
        <small>当前文档：{docName(documentId)}</small>
      </div>
    </section>

    {error && <div className="ask-error"><CircleAlert/>{error}</div>}

    <div className="validation-layout">
      <aside className="panel question-set">
        <SectionHead icon={Target} eyebrow="关键问题检查" title="教材质量问题"/>
        <div>{VALIDATION_QUESTIONS.map(([question, expected], index) => {
          const state = questionState(questionResult(currentValidation, question));
          return <button type="button" className={selected === index ? 'active' : ''} onClick={() => setSelected(index)} key={question}>
            <span>{index + 1}</span>
            <div><b>{question}</b><small>预期依据：{expected}</small></div>
            <Badge tone={state.tone}>{state.label}</Badge>
          </button>;
        })}</div>
      </aside>

      <section className="compare-grid">
        <ProviderResult
          title="教材目录"
          time={currentValidation?.checkedAt ? new Date(currentValidation.checkedAt).toLocaleString() : '尚未运行'}
          tone="blue"
          question={activeQuestion}
          result={pageIndexResult || localResult}
          status={currentValidation?.status || 'not_run'}
          providerState={currentValidation ? '已运行' : '未运行'}
        />
      </section>
    </div>
  </div>;
}

export function CurriculumAlignmentPage() {
  const params = useMemo(() => queryParams(), []);
  const session = useAuthSession();
  const draftId = params.get('draftId') || '';
  const alignmentReaderReturn = draftId ? `/alignment/?draftId=${encodeURIComponent(draftId)}` : 'alignment';
  const [draft, setDraft] = useState(null);
  const [lessonTitle, setLessonTitle] = useState(params.get('lesson') || '');
  const [groups, setGroups] = useState({ stage: [], taskGroup: [], quality: [] });
  const [confirmedTaskGroup, setConfirmedTaskGroup] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!draftId || !session) return undefined;
    let active = true;
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`).then(data => {
      if (!active) return;
      const next = data.draft || data;
      setDraft(next);
      setLessonTitle(next.title || next.lesson_context?.lessonRef?.title || next.question || '当前篇目');
      setConfirmedTaskGroup(next.answer?.curriculumAlignment?.sections?.find(item => item.id === 'task-group')?.teacherDecision || '');
    }).catch(err => { if (active) setError(askErrorMessage(err)); });
    return () => { active = false; };
  }, [draftId, session?.user?.id]);
  useEffect(() => {
    if (draftId && session && !draft) return undefined;
    if (!lessonTitle.trim()) {
      setGroups({ stage: [], taskGroup: [], quality: [] });
      setBusy(false); setError(''); setNotice('');
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true); setError(''); setNotice('');
      try {
        const guide = await request('/search', { method: 'POST', body: { query: `${lessonTitle} 教学重点 文体 观点 立场`, scope: ['teacher-guide'], limit: 3 } });
        const guideContext = (Array.isArray(guide.results) ? guide.results : []).map(item => `${item.title || ''} ${item.text || item.quote || ''}`).join(' ');
        const { searches, taskGroup } = curriculumSearchQueries({ lessonTitle, guideContext });
        const entries = await Promise.all(searches.map(async ([key, query]) => {
          const data = await request('/search', { method: 'POST', body: { query, scope: ['curriculum-standard'], limit: 8 } });
          return [key, Array.isArray(data.results) ? data.results : []];
        }));
        if (active) setGroups({ ...Object.fromEntries(entries), taskGroupHint: taskGroup });
      } catch {
        if (active) { setGroups({ stage: [], taskGroup: [], quality: [] }); setError('课程标准原页暂时无法定位，本次不生成对齐结论。'); }
      } finally { if (active) setBusy(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [refreshKey, lessonTitle, draftId, session?.user?.id, draft?.id]);
  const report = useMemo(() => buildCurriculumAlignment({ lessonTitle, resultGroups: groups, confirmedTaskGroup }), [lessonTitle, groups, confirmedTaskGroup]);
  const taskCandidates = useMemo(() => {
    const values = groups.taskGroup.map(item => item.title || item.sectionPath?.at?.(-1) || '').map(value => String(value).trim()).filter(value => /(阅读|表达|任务群)/u.test(value));
    return [...new Set(values)].slice(0, 6);
  }, [groups.taskGroup]);
  const save = async () => {
    if (!draftId || !draft || !session || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PATCH',
        body: { version: draft.version, answer: { ...(draft.answer || {}), curriculumAlignment: report } }
      });
      setDraft(data.draft || data);
      setNotice('课标对齐已保存到当前方案；教师确认与课标原文仍分开记录。');
    } catch (err) { setError(askErrorMessage(err)); }
    finally { setSaving(false); }
  };
  return <div className="view-stack alignment-page">
    <section className="hero alignment-hero"><div><Badge tone="green"><Target/> 课标依据</Badge><h1>先看课标要求，<br/><em>再决定本课怎样落实</em></h1><p>页面只做三件事：找到学段要求、选择本课适合的学习任务、确定可观察的评价表现。每一项都能打开课标原页。</p></div><div className={`alignment-score ${report.status}`}><b>{report.sourceCount}<small>/3</small></b><span>已找到的课标页面</span><em>{report.status === 'confirmed' ? '本课任务已确认' : report.status === 'review' ? '还需教师选择' : '仍有原页待补充'}</em></div></section>
    <section className="panel alignment-lesson"><div><span>正在核对的篇目</span><label><input value={lessonTitle} onChange={event => setLessonTitle(event.target.value)} aria-label="当前篇目" placeholder="例如：《岳阳楼记》"/><small>{lessonTitle.trim() ? '课标不直接规定某篇课文的教法；下方“课堂落实”由教师确认。' : '请先输入当前篇目名称，再查找对应的学段要求、学习任务群和学业质量原页。'}</small></label></div><button type="button" disabled={busy || !lessonTitle.trim()} onClick={() => setRefreshKey(value => value + 1)}><RefreshCw/>{busy ? '正在查找课标原页…' : '查找课标原页'}</button></section>
    {error && <section className="ask-error"><CircleAlert/><span>{error}</span></section>}
    {lessonTitle.trim() ? <section className="alignment-flow" aria-busy={busy}>{report.sections.map((item, index) => {
      const href = item.source ? citationLink(item.source, alignmentReaderReturn) : '';
      const excerpt = focusedCurriculumExcerpt(item);
      return <article className={`alignment-step ${item.status}`} key={item.id}><header><span>{String(index + 1).padStart(2, '0')}</span><div><small>{item.purpose}</small><h2>{item.title}</h2></div><Badge tone={item.status === 'direct' || item.status === 'confirmed' ? 'green' : item.status === 'candidate' ? 'orange' : 'neutral'}>{item.statusLabel}</Badge></header>{busy ? <div className="alignment-loading"><Activity/>正在查找课标原页…</div> : item.source ? <><div className="alignment-source"><b>与本课判断直接相关的原文</b><small>课程标准 · 第 {item.source.pdfPage} 页{item.source.printedPage ? ` · 书页 ${item.source.printedPage}` : ''}</small><p>{excerpt || '请打开原始教材阅读本页完整文字。'}</p>{href && <a href={href}>打开课标原页 <ExternalLink/></a>}</div><div className="alignment-classroom-landing"><b>教师需要做的判断</b><p>{item.note}</p></div>{item.id === 'task-group' && <div className="alignment-decision"><label><span>本课采用哪一种学习任务</span><select value={confirmedTaskGroup} onChange={event => setConfirmedTaskGroup(event.target.value)}><option value="">暂不选择，先保留候选</option>{taskCandidates.map(value => <option value={value} key={value}>{value}</option>)}</select></label><small>这里记录的是教师的课堂选择，不会改写课标原文。</small></div>}</> : <div className="alignment-missing"><FileSearch/><b>还没有找到对应课标原页</b><p>{item.note}</p></div>}</article>;
    })}</section> : <section className="panel alignment-missing"><Target/><b>先确定要核对的篇目</b><p>也可以从教材库选定篇目后进入本页，系统会自动带入篇名和当前教材范围。</p><a className="primary" href="/library/">从教材库选择篇目</a></section>}
    <section className="panel alignment-summary"><div><span>本页边界</span><h2>{report.warning}</h2><p>确认后只把课标依据写入当前方案；教师用书处理和学生教材原文仍分别核验。</p>{notice && <strong>{notice}</strong>}</div><div>{draftId && session ? <button type="button" className="primary" disabled={saving || busy} onClick={save}>{saving ? '正在保存…' : '确认本课课标依据'}</button> : <a className="primary" href={session ? `/ask/?scope=all&lesson=${encodeURIComponent(lessonTitle)}` : `/login/?next=${encodeURIComponent(`/alignment/?lesson=${encodeURIComponent(lessonTitle)}`)}`}>{session ? '带着课标依据开始备课' : '登录后保存对齐'}</a>}{draftId && <a href={`/cards/?draftId=${encodeURIComponent(draftId)}`}>回到本课方案 <ArrowRight/></a>}</div></section>
  </div>;
}


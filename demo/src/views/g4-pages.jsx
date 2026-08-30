// 匿名批改与听评课观察页（从 App.jsx 迁出）
import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, ClipboardCheck, Download, FileCheck2, FileText, Network, RefreshCw } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';
import { askErrorMessage, docName, queryParams, requestCode, rootRequest, useAuthSession } from '../app-core.js';
import { homeworkReviewCsv } from '../../shared/homework-review.js';
import { observationProtocolMarkdown } from '../../shared/observation-protocol.js';

export function AnonymousMarkingPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession();
  const draftId = params.get('draftId') || '', userId = session?.user?.id || '';
  const [tasks, setTasks] = useState([]), [taskId, setTaskId] = useState(''), [draftVersion, setDraftVersion] = useState(0);
  const [review, setReview] = useState(null), [results, setResults] = useState([]), [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [dirty, setDirty] = useState(false), [stale, setStale] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const responses = useMemo(() => raw.split(/\n\s*---+\s*\n/u).map(item => item.trim()).filter(Boolean).slice(0, 41), [raw]);
  const load = () => {
    setBusy(true); setError(''); setNotice(''); setResults([]);
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!draftId) { setError('还没有选定已定稿的分层作业。请先从课堂设计进入。'); setBusy(false); return; }
    rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review`).then(data => {
      const available = Array.isArray(data.tasks) ? data.tasks : [];
      setTasks(available); setReview(data.review || null); setStale(Boolean(data.stale)); setDraftVersion(Number(data.draftVersion || 0));
      setTaskId(data.review?.taskId || available[0]?.id || ''); setDirty(false);
    }).catch(err => { const code = requestCode(err); setError(code === 'draft_not_found' ? '没有找到这份课堂方案，或它不属于当前账号。' : code === 'homework_marking_requires_confirmed_pack' ? '请先在分层作业页面完成定稿，再开始批改。' : code === 'homework_marking_pack_stale' ? '分层作业已经随教学方案变化。请先重新定稿作业。' : askErrorMessage(err)); }).finally(() => setBusy(false));
  };
  useEffect(load, [draftId, userId]);
  const selectedTask = tasks.find(item => item.id === taskId) || tasks[0] || null, readOnly = review?.status === 'confirmed';
  const explainError = err => {
    const code = requestCode(err);
    return code === 'homework_marking_requires_confirmed_pack' ? '请先在分层作业页面完成定稿，再开始批改。'
      : code === 'homework_marking_pack_stale' ? '分层作业已经随教学方案变化。请先重新定稿作业。'
      : code === 'homework_marking_responses_invalid' ? '请粘贴 1—40 份有效答案，并用单独一行“---”分隔。'
      : code === 'homework_marking_contains_identifier' ? '答案中可能包含姓名、学号或联系方式。请删除身份信息后再分析。'
      : code === 'homework_marking_invalid_response' ? '本次批改结果结构不完整，未保存结论。请重新分析。'
      : code === 'homework_review_incomplete' ? '确认前请勾选至少一项后续动作，并写下教师判断。'
      : code === 'edit_conflict' ? '这份方案刚刚在其他页面更新。当前输入仍保留，请重新读取后核对。'
      : askErrorMessage(err);
  };
  const analyze = async () => {
    if (!selectedTask || responses.length < 1 || responses.length > 40 || working) return;
    setWorking('analyze'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review/analyze`, { method: 'POST', body: { version: draftVersion, taskId: selectedTask.id, responses } });
      setReview(data.review); setResults(data.results || []); setDraftVersion(Number(data.draftVersion || draftVersion + 1)); setRaw(''); setDirty(false); setStale(false);
      setNotice(`已完成 ${data.results?.length || 0} 份匿名答案分析。答案原文已从页面清除，服务器只保存班级汇总。`);
    } catch (err) { setError(explainError(err)); } finally { setWorking(''); }
  };
  const updateReview = changes => { if (readOnly) return; setReview(current => ({ ...current, ...changes })); setDirty(true); setNotice(''); };
  const persist = async confirm => {
    if (!review || readOnly || working) return;
    setWorking(confirm ? 'confirm' : 'save'); setError(''); setNotice('');
    try {
      const data = await rootRequest(`/api/drafts/${encodeURIComponent(draftId)}/homework-review`, { method: 'PATCH', body: { version: draftVersion, review, confirm } });
      setReview(data.review); setDraftVersion(Number(data.draftVersion || draftVersion + 1)); setDirty(false);
      setNotice(confirm ? '班级批改结论已经确认，可用于下一课调整。' : '班级汇总与教师判断已保存。');
    } catch (err) { setError(explainError(err)); } finally { setWorking(''); }
  };
  const downloadCsv = () => {
    if (!results.length) return;
    const url = URL.createObjectURL(new Blob([`\ufeff${homeworkReviewCsv(results)}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selectedTask?.level || ''}-${selectedTask?.label || '匿名批改'}-反馈.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('匿名反馈表已下载，不包含学生答案原文和身份信息。');
  };
  const statusText = status => status === 'secure' ? '已达成' : status === 'partial' ? '部分达成' : '需要支持';
  return <div className="view-stack anonymous-marking-page">
    <section className="hero compact-hero marking-hero"><div><Badge tone="gold"><FileCheck2/> 匿名批改</Badge><h1>不保存学生原文，<br/><em>只把批改变成下一课可用的判断</em></h1><p>粘贴去姓名后的答案，系统按照已定稿题目、教材依据和评分量规逐份反馈。完成后清除答案原文，只把班级达成情况、共性问题和教师确认的后续动作保存到方案中。</p><div className="hero-actions"><a href={draftId ? `/homework/?draftId=${encodeURIComponent(draftId)}` : '/homework/'}><ArrowLeft/>返回分层作业</a>{results.length > 0 && <button type="button" onClick={downloadCsv}><Download/>下载匿名反馈表</button>}</div></div><div className="marking-hero-seal"><strong>0</strong><span>份学生原文留存</span><em>只保存班级汇总和教师判断</em></div></section>
    {error && <section className="cards-alert" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>本次匿名批改没有完成</b><p>{error}</p></div><div className="cards-alert-actions"><button type="button" onClick={load}><RefreshCw/>重新读取</button></div></section>}
    {notice && <section className="quality-box"><CheckCircle2/><span>{notice}</span></section>}
    {stale && <section className="marking-stale"><RefreshCw/><div><b>题目或评分量规已经更新</b><p>旧汇总不再代表当前作业。请回到分层作业重新定稿，再分析新答案。</p></div></section>}
    {busy ? <section className="panel study-empty"><Activity/><h2>正在读取已定稿作业</h2><p>不会读取或恢复任何学生答案原文。</p></section> : <>
      <section className="marking-flow panel"><div className="done"><Check/>作业定稿</div><ArrowRight/><div className={results.length ? 'done' : 'current'}>匿名答案分析</div><ArrowRight/><div className={review ? 'current' : ''}>教师确认班级判断</div><ArrowRight/><div>进入下一课调整</div></section>
      <section className="marking-workbench">
        <aside className="marking-input panel"><header><span>01 · 选择题目</span><h2>粘贴匿名答案</h2><p>每份答案之间用单独一行 <b>---</b> 分隔。请先删除姓名、学号、电话和其他身份信息。</p></header><label><span>作业层级</span><select value={taskId} onChange={event => { setTaskId(event.target.value); setResults([]); }}>{tasks.map(item => <option key={item.id} value={item.id}>{item.level} · {item.label}（{item.score} 分）</option>)}</select></label>{selectedTask && <div className="marking-task"><span>{selectedTask.level}</span><div><b>{selectedTask.prompt}</b><small>满分 {selectedTask.score} 分</small></div></div>}<label><span>去姓名后的答案</span><textarea rows="15" value={raw} onChange={event => setRaw(event.target.value)} placeholder={'第一份匿名答案……\n---\n第二份匿名答案……'}/></label><div className={`marking-count ${responses.length > 40 ? 'invalid' : ''}`}><span>{responses.length} 份待分析</span><small>单次最多 40 份；输入内容不会写入本地恢复或草稿。</small></div><button type="button" className="primary marking-analyze" disabled={!selectedTask || responses.length < 1 || responses.length > 40 || Boolean(working) || stale} onClick={analyze}>{working === 'analyze' ? <><Activity/>正在依据量规分析…</> : <><FileCheck2/>开始匿名批改</>}</button></aside>
        <main className="marking-results panel"><header><div><span>02 · 逐份反馈</span><h2>{results.length ? `${results.length} 份答案的匿名反馈` : '分析后在这里逐份核对'}</h2><p>{results.length ? '序号只代表本次粘贴顺序；页面不会显示或恢复答案原文。' : '系统只返回达成状态、分数、已经做到和下一步建议。'}</p></div>{results.length > 0 && <button type="button" onClick={downloadCsv}><Download/>导出反馈</button>}</header>{results.length ? <div className="marking-result-list">{results.map(item => <article className={`status-${item.status}`} key={item.id}><div className="marking-result-number"><span>{String(item.sequence).padStart(2, '0')}</span><b>{item.score}<small>/{item.maxScore}</small></b></div><div><Badge tone={item.status === 'secure' ? 'green' : item.status === 'partial' ? 'orange' : 'purple'}>{statusText(item.status)}</Badge><h3>{item.strengths.length ? item.strengths.join('；') : '已经完成基本作答'}</h3><p><b>下一步：</b>{item.nextStep}</p></div></article>)}</div> : <div className="marking-empty"><FileCheck2/><h3>这里不会出现学生答案原文</h3><p>分析完成后只显示匿名序号与反馈。刷新页面后，逐份反馈也不会从服务器恢复；需要留存时请下载匿名反馈表。</p></div>}</main>
        <aside className="marking-summary"><section className="panel"><header><span>03 · 班级层面</span><h2>教师确认后再回流</h2><p>系统汇总不是教材结论。请结合课堂观察写下你的判断。</p></header>{review ? <><div className="marking-metrics"><div><strong>{review.responseCount}</strong><small>本批答案</small></div><div><strong>{review.averageScore}</strong><small>平均分 / {review.maxScore}</small></div></div><div className="marking-distribution"><span style={{'--value': `${review.responseCount ? review.counts.secure / review.responseCount * 100 : 0}%`}}><b>已达成</b><i/><small>{review.counts.secure}</small></span><span style={{'--value': `${review.responseCount ? review.counts.partial / review.responseCount * 100 : 0}%`}}><b>部分达成</b><i/><small>{review.counts.partial}</small></span><span style={{'--value': `${review.responseCount ? review.counts.notYet / review.responseCount * 100 : 0}%`}}><b>需要支持</b><i/><small>{review.counts.notYet}</small></span></div><div className="marking-patterns"><b>共性问题</b><ul>{review.patterns.map(item => <li key={item}>{item}</li>)}</ul></div><div className="marking-actions"><b>选择下一课动作</b>{review.nextActions.map(item => <label key={item.id}><input type="checkbox" disabled={readOnly} checked={review.selectedActionIds.includes(item.id)} onChange={event => updateReview({ selectedActionIds: event.target.checked ? [...review.selectedActionIds, item.id] : review.selectedActionIds.filter(id => id !== item.id) })}/><span>{item.text}</span></label>)}</div><label className="marking-teacher-note"><span>教师判断</span><textarea rows="5" disabled={readOnly} value={review.teacherNote} onChange={event => updateReview({ teacherNote: event.target.value })} placeholder="例如：多数学生能定位词句，但还不能解释景物与情感之间的关系；下节课先用关系图集中复盘。"/></label><footer>{!readOnly ? <><button type="button" disabled={!dirty || Boolean(working)} onClick={() => persist(false)}>{working === 'save' ? '正在保存…' : '保存班级汇总'}</button><button type="button" className="primary" disabled={Boolean(working)} onClick={() => persist(true)}>{working === 'confirm' ? '正在确认…' : '确认并用于下一课'}</button></> : <div className="marking-confirmed"><CheckCircle2/><span><b>教师已确认</b><small>新一批答案可以重新分析，旧汇总会进入历史记录。</small></span></div>}</footer></> : <div className="marking-summary-empty"><Network/><b>等待形成班级概况</b><p>分析答案后，这里只保存数量、共性问题和后续动作，不保存学生原文。</p></div>}</section></aside>
      </section>
    </>}
  </div>;
}

export function ObservationProtocolPage() {
  const params = useMemo(() => queryParams(), []), session = useAuthSession();
  const leftId = params.get('left') || '', rightId = params.get('right') || '', userId = session?.user?.id || '';
  const [protocol, setProtocol] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    setBusy(true); setError(''); setProtocol(null);
    if (!userId) { if (session === null) location.href = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    if (!leftId || !rightId) { setError('还没有选定已确认的同课对照。请先从教研问题簿进入。'); setBusy(false); return; }
    rootRequest(`/api/assets/${encodeURIComponent(leftId)}/compare/${encodeURIComponent(rightId)}/observation`).then(data => setProtocol(data.protocol || null)).catch(err => {
      const code = requestCode(err);
      setError(code === 'observation_protocol_requires_confirmed_comparison' ? '这份同课对照还没有经过教师确认，暂时不能生成听评课观察单。' : code === 'same_lesson_comparison_stale' ? '其中一次课堂事实已经更新。请先重新完成同课对照，再生成观察单。' : code === 'same_lesson_comparison_not_found' ? '没有找到对应的同课对照，请从教研问题簿重新选择。' : askErrorMessage(err));
    }).finally(() => setBusy(false));
  }, [leftId, rightId, userId]);
  const download = () => {
    if (!protocol) return;
    const url = URL.createObjectURL(new Blob([observationProtocolMarkdown(protocol)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${String(protocol.lessonTitle || '课堂').replace(/[《》]/gu, '')}-听评课观察单.md`; anchor.click(); URL.revokeObjectURL(url);
    setNotice('观察单 Markdown 已下载，可以继续编辑或打印。');
  };
  return <div className="view-stack observation-page"><section className="hero compact-hero observation-hero no-print"><div><Badge tone="gold"><ClipboardCheck/> 听评课观察单</Badge><h1>不评价教师表现，<br/><em>只记录教研命题在课堂里发生了什么</em></h1><p>观察指标来自教师已经确认的同课对照。课堂中只记时刻、事件、学生表现、教师动作和原文依据，不记录学生身份。</p><div className="hero-actions"><a href="/research/"><FileText/>返回教研问题簿</a>{protocol && <><button type="button" onClick={() => window.print()}><FileText/>打印观察单</button><button type="button" onClick={download}><Download/>下载 Markdown</button></>}</div></div></section>{error && <section className="cards-alert no-print" role="alert"><div className="cards-alert-icon"><CircleAlert/></div><div className="cards-alert-copy"><b>听评课观察单暂时没有生成</b><p>{error}</p></div><div className="cards-alert-actions"><a href="/research/">返回教研问题簿</a></div></section>}{notice && <section className="quality-box no-print"><CheckCircle2/><span>{notice}</span></section>}{busy ? <section className="panel study-empty no-print"><Activity/><h2>正在建立课堂观察协议</h2><p>只读取教师已经确认的教研命题和可核验教材页码。</p></section> : protocol && <article className="observation-sheet"><header><div><span>活教参 · 教研观察协议</span><h1>{protocol.lessonTitle}｜听评课观察单</h1><p>围绕一个命题观察，不做笼统评分</p></div><div className="observation-meta"><label>观察人<strong></strong></label><label>日期<strong></strong></label><label>班级<strong></strong></label></div></header><section className="observation-proposition"><span>本次教研命题</span><h2>{protocol.researchQuestion}</h2><p><b>适用边界</b>{protocol.contextBoundary}</p></section><section className="observation-variable-grid"><div><span>保持不变</span><p>{protocol.keepConstant}</p></div><div><span>本次只改变</span><p>{protocol.changeVariable}</p></div></section><section className="observation-indicators"><header><span>观察指标</span><p>只勾选和记录可观察行为，不推测学生心理。</p></header><div>{protocol.indicators.map((item, index) => <article key={item.id}><strong>{String(index + 1).padStart(2, '0')}</strong><div><b>{item.title}</b><p>{item.watchFor}</p><small>来源：{item.source}</small></div><i>□ 出现　□ 部分出现　□ 未出现</i></article>)}</div></section><section className="observation-record"><header><span>课堂观察记录</span><p>{protocol.privacyNotice}</p></header><table><thead><tr><th>时间段</th><th>课堂事件</th><th>学生表现</th><th>教师动作</th><th>教材原文依据</th></tr></thead><tbody>{protocol.timeWindows.map(item => <tr key={item.id}><th><b>{item.time}</b><small>{item.label}</small></th><td></td><td></td><td></td><td></td></tr>)}</tbody></table></section><section className="observation-reflection"><header><span>课后只形成三个判断</span><p>先引用观察记录，再写结论。</p></header><div><label><b>哪一条观察支持当前命题？</b><span></span></label><label><b>哪一条观察与预期不一致？</b><span></span></label><label><b>下一次只保留或改变什么？</b><span></span></label></div></section><footer><div><b>教材核验页面</b><p>{protocol.references.length ? protocol.references.map(item => `${docName(item.documentId)} 第 ${item.pdfPage} 页`).join('　·　') : '当前观察单没有绑定可核验页面，请回到原方案补充教材依据。'}</p></div><small>本观察单由教师确认的教研命题生成，不代表教材结论，也不用于评价教师绩效。</small></footer></article>}</div>;
}


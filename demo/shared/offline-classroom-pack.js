import { classroomAdaptationAdvice } from './classroom-adaptation.js';

const TYPE_LABELS = { board: '板书卡', question: '提问卡', assessment: '评价卡' };

function clean(value, max = 500) {
  return String(value || '').replace(/\u0000/gu, '').trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(value, 4000).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function filenamePart(value) {
  return clean(value, 50).replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '') || '课堂设计';
}

function cardItems(cards, type) {
  const card = (Array.isArray(cards) ? cards : []).find(item => item?.type === type);
  return (Array.isArray(card?.items) ? card.items : []).slice(0, 8).map(item => ({
    text: clean(item?.text || item?.content || item, 320),
    citationIds: [...new Set((Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(Boolean))].slice(0, 4)
  })).filter(item => item.text);
}

function normalizedCitations(citations) {
  const map = new Map();
  for (const item of Array.isArray(citations) ? citations : []) {
    const id = clean(item?.id, 80);
    const page = Number(item?.pdfPage ?? item?.pdf_page ?? item?.page);
    if (!id || !Number.isInteger(page) || page < 1) continue;
    map.set(id, {
      id,
      title: clean(item?.documentTitle || item?.document_title || item?.documentId || item?.document_id || '教材', 80),
      pdfPage: page,
      printedPage: clean(item?.printedPage || item?.printed_page, 20)
    });
  }
  return map;
}

function referenceText(ids, citationMap) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String))]
    .map(id => citationMap.get(id))
    .filter(Boolean)
    .map(item => `${item.title} PDF 第 ${item.pdfPage} 页${item.printedPage ? `（印刷页 ${item.printedPage}）` : ''}`)
    .join('；');
}

function textLines(text, limit = 12) {
  const chars = Array.from(clean(text, 96));
  const lines = [];
  while (chars.length && lines.length < 3) lines.push(chars.splice(0, limit).join(''));
  return lines.length ? lines : ['教师现场补写'];
}

function svgText(text, x, y, { anchor = 'middle', className = '' } = {}) {
  const lines = textLines(text);
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? 22 : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function boardSvg(title, coreQuestion, boardItems, assessmentItems) {
  const branches = boardItems.slice(0, 3);
  const positions = [{ x: 195, y: 205 }, { x: 605, y: 205 }, { x: 400, y: 340 }];
  const paths = positions.map(position => `<path d="M400 155 C400 180 ${position.x} 168 ${position.x} ${position.y - 38}"/>`).join('');
  const nodes = positions.map((position, index) => {
    const item = branches[index];
    const label = item?.text || ['文本发现', '关键依据', '课堂归纳'][index];
    return `<g data-stage="2"><rect x="${position.x - 112}" y="${position.y - 34}" width="224" height="78" rx="15"/>${svgText(label, position.x, position.y - 2, { className: item ? '' : 'blank' })}</g>`;
  }).join('');
  const evidence = branches.map((item, index) => item ? `<g data-stage="3"><text x="${positions[index].x}" y="${positions[index].y + 66}" text-anchor="middle" class="evidence">教材依据 ${String(index + 1).padStart(2, '0')}</text></g>` : '').join('');
  const conclusion = assessmentItems[0]?.text || '课堂生成结论';
  return `<svg class="board" viewBox="0 0 800 480" role="img" aria-label="${escapeHtml(title)}渐进式板书">
    <g class="chalk-lines" data-stage="2">${paths}</g>
    <g data-stage="1"><rect class="core" x="270" y="55" width="260" height="100" rx="18"/>${svgText(title, 400, 91, { className: 'title' })}${svgText(coreQuestion, 400, 124, { className: 'question' })}</g>
    ${nodes}${evidence}
    <g data-stage="4"><path d="M400 384 L400 406"/><rect class="conclusion" x="260" y="405" width="280" height="56" rx="14"/>${svgText(conclusion, 400, 435, { className: 'conclusion-text' })}</g>
    <g data-stage="5"><rect class="blank-zone" x="34" y="394" width="176" height="67" rx="12"/><text x="122" y="424" text-anchor="middle" class="blank">学生关键词</text><text x="122" y="445" text-anchor="middle" class="blank-small">此处课堂补写</text><rect class="blank-zone" x="590" y="394" width="176" height="67" rx="12"/><text x="678" y="424" text-anchor="middle" class="blank">教师补写</text><text x="678" y="445" text-anchor="middle" class="blank-small">保留现场生成</text></g>
  </svg>`;
}

function listSection(title, items, citationMap) {
  return `<section class="paper-card"><h2>${escapeHtml(title)}</h2>${items.length ? `<ol>${items.map(item => `<li><p>${escapeHtml(item.text)}</p>${referenceText(item.citationIds, citationMap) ? `<small>${escapeHtml(referenceText(item.citationIds, citationMap))}</small>` : ''}</li>`).join('')}</ol>` : '<p class="empty">本卡没有已确认内容。</p>'}</section>`;
}

export function buildOfflineClassroomPack({ title, coreQuestion, cards = [], citations = [], rehearsalStep = null } = {}) {
  const safeTitle = clean(title, 100) || '课堂设计';
  const safeQuestion = clean(coreQuestion, 180) || `围绕${safeTitle}，学生最终要说清什么？`;
  const board = cardItems(cards, 'board');
  const questions = cardItems(cards, 'question');
  const assessments = cardItems(cards, 'assessment');
  const citationMap = normalizedCitations(citations);
  const usedCitationIds = [...new Set([...board, ...questions, ...assessments].flatMap(item => item.citationIds))].filter(id => citationMap.has(id));
  const advice = ['time_short', 'students_stuck', 'ahead'].map(signal => classroomAdaptationAdvice({ signal, cards, rehearsalStep })).filter(Boolean);
  const generatedAt = new Date().toISOString();
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(safeTitle)} · 离线课堂包</title><style>
  :root{color-scheme:light;--green:#163f38;--green2:#245f54;--paper:#fffdf7;--ink:#1f4841;--gold:#c3943f;--line:#d9e3de}*{box-sizing:border-box}body{margin:0;background:#edf3f0;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.top{padding:20px 24px;background:var(--green);color:#f8f2df;display:flex;justify-content:space-between;gap:20px;align-items:center;position:sticky;top:0;z-index:3}.top span{color:#e2bd69;font-size:12px;font-weight:800;letter-spacing:.1em}.top h1{margin:4px 0 0;font-family:STSong,SimSun,serif;font-size:26px}.top p{margin:5px 0 0;color:#bdd1ca;font-size:12px}.top-actions{display:flex;gap:8px}.top button,.controls button,.pace button{border:1px solid #ffffff38;border-radius:8px;background:#ffffff0d;color:inherit;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer}.top button:hover,.controls button:hover,.pace button:hover{border-color:#e2bd69}.layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(310px,.55fr);gap:18px;max-width:1500px;margin:auto;padding:20px}.blackboard{background:#153c36;border:8px solid #7b5b37;border-radius:8px;padding:16px;color:white;box-shadow:inset 0 0 42px #051c17b3,0 16px 34px #173e351f}.controls{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}.controls button.active,.pace button.active{color:#173f39;background:#e2bd69;border-color:#e2bd69}.board{width:100%;min-height:520px}.board rect{fill:#ffffff08;stroke:#f4efdd;stroke-width:2}.board .core{fill:#ffffff0e;stroke:#e2bd69;stroke-width:3}.board path{fill:none;stroke:#d8e7df;stroke-width:2.5;stroke-linecap:round}.board text{fill:#f8f4e8;font-size:15px}.board .title{fill:#e2bd69;font-size:21px;font-weight:800}.board .question{fill:#e7f0ed;font-size:13px}.board .evidence{fill:#b9d1ca;font-size:11px}.board .conclusion{stroke:#e2bd69}.board .conclusion-text{font-size:13px}.board .blank-zone{fill:none;stroke:#b9d1ca;stroke-dasharray:7 7}.board .blank{fill:#d4e2de;font-size:13px}.board .blank-small{fill:#9bb7af;font-size:10px}[data-stage]{opacity:0;transition:opacity .2s}[data-stage].show{opacity:1}.side{display:grid;gap:14px;align-content:start}.paper-card{background:var(--paper);border:1px solid var(--line);border-top:4px solid var(--gold);padding:18px;box-shadow:0 10px 24px #173e3510}.paper-card h2{font-family:STSong,SimSun,serif;margin:0 0 12px;font-size:21px}.paper-card ol{margin:0;padding-left:24px}.paper-card li+li{margin-top:12px}.paper-card p{margin:0;font-size:15px;line-height:1.7}.paper-card small{display:block;margin-top:5px;color:#71857e;font-size:11px;line-height:1.5}.pace{grid-column:1/-1;background:#fffdf7;border:1px solid var(--line);padding:18px}.pace h2{margin:0 0 5px;font-family:STSong,SimSun,serif}.pace>p{margin:0 0 13px;color:#71857e}.pace-buttons{display:flex;gap:8px;flex-wrap:wrap}.pace button{color:#2a6157;border-color:#cbdcd5;background:#f7faf8}.pace-advice{display:none;margin-top:13px;padding:14px;border-left:4px solid var(--gold);background:#f8f2e4}.pace-advice.show{display:block}.pace-advice h3{margin:0 0 8px}.pace-advice p{margin:5px 0;line-height:1.65}.pace-advice small{color:#71857e}.sources{grid-column:1/-1}.sources ul{columns:2;margin:0;padding-left:20px}.sources li{break-inside:avoid;margin-bottom:8px;font-size:13px;line-height:1.55}.offline-note{grid-column:1/-1;color:#61766f;font-size:12px;text-align:center;padding:7px}@media(max-width:860px){.layout{grid-template-columns:1fr}.board{min-height:400px}.sources ul{columns:1}.top{align-items:flex-start;flex-direction:column}}@media print{body{background:white}.top{position:static}.top-actions,.controls,.pace{display:none}.layout{display:block;padding:0}.blackboard,.paper-card,.sources{page-break-inside:avoid;margin-bottom:14px;box-shadow:none}.side{display:grid;grid-template-columns:1fr 1fr}.board [data-stage]{opacity:1}}
  </style></head><body><header class="top"><div><span>离线课堂包</span><h1>${escapeHtml(safeTitle)}</h1><p>不连接账号、不调用模型；课堂记录不会自动写回系统。</p></div><div class="top-actions"><button type="button" id="fullscreen">全屏投影</button><button type="button" id="print">打印课堂包</button></div></header><main class="layout"><section class="blackboard"><div class="controls" aria-label="板书阶段">${['课题与核心问题', '课堂主线', '关键依据', '课堂归纳', '教师留白'].map((label, index) => `<button type="button" data-stage-button="${index + 1}">${index + 1}. ${label}</button>`).join('')}<button type="button" data-stage-button="full">完整板书</button></div>${boardSvg(safeTitle, safeQuestion, board, assessments)}</section><aside class="side">${listSection(TYPE_LABELS.question, questions, citationMap)}${listSection(TYPE_LABELS.assessment, assessments, citationMap)}</aside><section class="pace"><h2>课堂临时变化时，怎么调整下一步</h2><p>建议来自已确认的三卡，不会增加新的教材结论。</p><div class="pace-buttons"><button type="button" data-signal="on_track">节奏正常</button>${advice.map(item => `<button type="button" data-signal="${item.signal}">${item.signal === 'time_short' ? '时间不足' : item.signal === 'students_stuck' ? '学生卡住' : '提前完成'}</button>`).join('')}</div>${advice.map(item => `<article class="pace-advice" data-advice="${item.signal}"><h3>${escapeHtml(item.title)}</h3><p><b>现在这样做：</b>${escapeHtml(item.primaryAction)}</p><p><b>随后这样收：</b>${escapeHtml(item.secondaryAction)}</p><small>${escapeHtml(item.note)}${referenceText(item.citationIds, citationMap) ? ` · ${escapeHtml(referenceText(item.citationIds, citationMap))}` : ''}</small></article>`).join('')}</section><section class="paper-card sources"><h2>本课堂包使用的教材依据</h2>${usedCitationIds.length ? `<ul>${usedCitationIds.map(id => `<li>${escapeHtml(referenceText([id], citationMap))}</li>`).join('')}</ul>` : '<p class="empty">当前三卡没有绑定可核验页码，请回到系统补充依据后重新下载。</p>'}</section><p class="offline-note">生成时间：${escapeHtml(generatedAt)} · 原始 PDF 仍是唯一可核验依据 · 本文件不包含账号会话、密钥或完整教材 PDF</p></main><script>
  (()=>{let stage=1;const showStage=value=>{const selected=String(value);stage=selected==='full'?5:(Number(selected)||1);document.querySelectorAll('[data-stage]').forEach(node=>node.classList.toggle('show',Number(node.dataset.stage)<=stage));document.querySelectorAll('[data-stage-button]').forEach(button=>button.classList.toggle('active',button.dataset.stageButton===selected));};document.querySelectorAll('[data-stage-button]').forEach(button=>button.addEventListener('click',()=>showStage(button.dataset.stageButton)));document.querySelectorAll('[data-signal]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-signal]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('[data-advice]').forEach(item=>item.classList.toggle('show',item.dataset.advice===button.dataset.signal));}));document.getElementById('fullscreen').addEventListener('click',()=>document.documentElement.requestFullscreen?.());document.getElementById('print').addEventListener('click',()=>window.print());showStage('1');})();
  </script></body></html>`;
  return { filename: `活教参-${filenamePart(safeTitle)}-离线课堂包.html`, html, citationCount: usedCitationIds.length };
}

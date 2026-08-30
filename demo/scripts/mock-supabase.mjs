// 内存版 Supabase 契约 mock —— 仅用于本地 UI↔API 联调验证（不复刻生产行为）。
// 覆盖应用实际调用面：/auth/v1/* 与 /rest/v1/{lesson_drafts,user_deepseek_keys,teaching_shares}
// 用法：node scripts/mock-supabase.mjs  （默认 127.0.0.1:54321）
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 54321);
const users = new Map();          // email -> { id, email, password }
const tables = {
  lesson_drafts: [],
  user_deepseek_keys: [],
  teaching_shares: [],
  document_access: []
};

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }

function fakeToken(user) {
  return `mock.${b64({ sub: user.id, email: user.email, exp: Date.now() + 3600_000 * 24 * 7, aud: 'authenticated' })}.sig`;
}

function parseUserFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token || '').split('.')[1] || '', 'base64url').toString('utf8'));
    if (!payload?.sub || (payload.exp && payload.exp < Date.now())) return null;
    return { id: payload.sub, email: payload.email };
  } catch { return null; }
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

// --- PostgREST 简易查询：支持 select / col=eq.v / col=in.(a,b) / order / limit / offset ---
function filterRows(rows, searchParams) {
  const filters = [];
  let order = null, limit = null, offset = 0;
  for (const [key, value] of searchParams) {
    if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') {
      if (key === 'order') order = value;
      if (key === 'limit') limit = Number(value);
      if (key === 'offset') offset = Number(value) || 0;
      continue;
    }
    const m = String(value).match(/^(eq|neq|in|is)\.(.+)$/);
    if (m) filters.push({ col: key, op: m[1], val: m[2] });
  }
  let out = rows.filter(row => filters.every(f => {
    const cell = row[f.col];
    if (f.op === 'eq') return String(cell ?? '') === String(f.val);
    if (f.op === 'neq') return String(cell ?? '') !== String(f.val);
    if (f.op === 'is') return (f.val === 'null' ? cell == null : String(cell) === f.val);
    if (f.op === 'in') {
      const list = f.val.slice(1, -1).split(',').map(s => s.trim());
      return list.some(v => String(cell ?? '') === v) || (cell === null && list.includes('null'));
    }
    return true;
  }));
  if (order) {
    const [col, dir] = order.split('.');
    out = out.slice().sort((a, b) => {
      const av = a[col] ?? '', bv = b[col] ?? '';
      return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
  }
  if (limit != null) out = out.slice(offset, offset + limit);
  return out;
}

function pickColumns(row, select) {
  if (!select || select === '*') return row;
  const cols = select.split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

function handleRest(req, res, path, searchParams) {
  const table = path.replace(/^\/rest\/v1\//, '');
  if (!tables[table]) return send(res, 404, { code: 'PGRST205', message: `mock table not implemented: ${table}` });
  const rows = tables[table];
  const auth = req.headers.authorization || '';
  const actor = parseUserFromToken(auth.replace(/^Bearer\s+/i, ''));

  if (req.method === 'GET') {
    let out = filterRows(rows, searchParams);
    if (actor) out = out.filter(r => String(r.user_id ?? '') === actor.id);
    const select = searchParams.get('select');
    if (select) out = out.map(r => pickColumns(r, select));
    return send(res, 200, out);
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const nowIso = now();
      const created = items.map(item => {
        const row = { id: uuid(), created_at: nowIso, updated_at: nowIso, version: 1, ...item };
        if (actor && !row.user_id) row.user_id = actor.id;
        rows.push(row);
        return row;
      });
      return send(res, 201, created);
    });
    return;
  }
  if (req.method === 'PATCH' || req.method === 'DELETE') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const matches = filterRows(rows, searchParams);
      let affected = matches;
      if (req.method === 'PATCH') {
        const patch = JSON.parse(body || '{}');
        const updated = [];
        for (const r of matches) {
          Object.assign(r, patch, { updated_at: now() });
          updated.push(r);
        }
        affected = updated;
      } else {
        for (const r of matches) rows.splice(rows.indexOf(r), 1);
      }
      return send(res, 200, affected);
    });
    return;
  }
  return send(res, 405, { code: 'mock_405', message: 'method not supported' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
    return res.end();
  }


  // —— 简易 LLM 网关（/chat/completions，确定性备课回答，供本地联调）——
  if (url.pathname === '/chat/completions' || url.pathname === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const model = payload.model || 'mock-model';
      const rawPayload = JSON.stringify(payload.messages || payload);
      const cardMode = rawPayload.includes('板书卡生成 3—6') || rawPayload.includes('只(?:重新)?生成(?:本)?卡');
      if (cardMode) {
        const answer = {
          lesson: { title: '《我爱这土地》', coreQuestion: '怎样教《我爱这土地》？' },
          answer: {
            summary: '三卡围绕“意象群—象征—深沉的爱”的主线：先板书文本抓手，再按可观察任务推进朗读、比较与小结。',
            evidenceRefs: ['E1']
          },
          threeCardSuggestions: {
            board: [
              { text: '鸟 → 土地 → 河流 → 风 → 黎明', evidenceRefs: ['E1'] },
              { text: '意象群 → 象征 → 深沉的爱', evidenceRefs: ['E1'] },
              { text: '嘶哑歌唱 → 至死不渝', evidenceRefs: ['E1'] },
              { text: '删改比较 → 直抒胸臆效果', evidenceRefs: ['E1'] },
              { text: '为什么我的眼里常含泪水', evidenceRefs: ['E1'] }
            ],
            question: [
              { text: '主问：朗读第一节，圈画“鸟、土地、河流、风、黎明”五种意象。｜追问：这些意象共同寄托了诗人怎样的情感？｜预期学生回应：鸟的嘶哑歌唱与土地的风雨形成对照，表现出诗人对土地深沉的爱。', evidenceRefs: ['E1'] },
              { text: '主问：第二节“为什么我的眼里常含泪水”放在最后，有什么作用？｜追问：删去第二节再朗读，情感变化在哪里？｜预期学生回应：直接抒发对土地的爱，结尾让情感更有冲击力。', evidenceRefs: ['E1'] },
              { text: '主问：比较“连羽毛也腐烂在土地里”与“歌唱”，你发现什么？｜追问：诗人为什么要这样写？｜预期学生回应：用生命守护土地，表达至死不渝的感情。', evidenceRefs: ['E1'] },
              { text: '主问：诗歌第一节与第二节情感有什么不同？｜追问：两节之间靠哪一句衔接？｜预期学生回应：第一节以描写为主，第二节转为直接抒情，“我的眼里常含泪水”承上启下。', evidenceRefs: ['E1'] }
            ],
            assessment: [
              { text: '任务：从第一节找出三种以上意象并说明其象征。｜可观察表现：学生能说出鸟、土地、河流、风、黎明并给出原文依据。｜判断标准：能结合原词句说明两层含义为达成；只列名称需要支架。', evidenceRefs: ['E1'] },
              { text: '任务：朗读第二节，用一句话说出感情变化。｜可观察表现：学生朗读重音、停顿与情感变化可听可辨。｜判断标准：能抓住“常含泪水—爱得深沉”为达成。', evidenceRefs: ['E1'] },
              { text: '任务：比较删改前后的朗读效果，说出原因。｜可观察表现：学生说出直抒胸臆与含蓄表达的不同。｜判断标准：能引用诗句佐证为达成。', evidenceRefs: ['E1'] }
            ]
          }
        };
        return send(res, 200, {
          id: 'mock-completion-cards', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 60, completion_tokens: 320, total_tokens: 380 }
        });
      }
      const answer = {
        answer: {
          summary: '围绕《我爱这土地》，先让学生抓住“鸟—土地—河流—风—黎明”的意象群，再通过删改比较体会第二节直接抒情的作用；本课建议两课时，第一课时品意象，第二课时悟情感并在朗读中落实。',
          objectives: ['学生能够梳理诗歌意象并说明其象征指向', '学生能够通过朗读体会诗人深沉的情感', '学生能够说明第二节为何不能删'],
          keyPoints: ['意象群的象征意义', '反语与直抒胸臆的对照', '朗读节奏与重音处理'],
          lessonPlan: [
            { title: '导入与初读', detail: '齐读全诗，圈出意象' },
            { title: '品读意象群', detail: '逐组讨论象征指向并板书' },
            { title: '删改比较', detail: '去掉第二节再比读，说出表达效果' },
            { title: '情感收束', detail: '结合背景理解“深沉的爱”，齐读收束' }
          ],
          questionChain: [
            { question: '诗中“土地”让你想到什么？', purpose: '建立意象与情感的直接联系', expected: '家园、祖国、人民', followUp: '还有哪些意象与它呼应？' },
            { question: '第二节为什么不能删？', purpose: '体会直抒胸臆的表达效果', expected: '删去后情感失去落脚点', followUp: '删改后的朗读差别在哪里？' }
          ],
          assessment: ['能结合两处意象说明象征', '朗读能体现情感起伏', '能说出第二节的作用']
        }
      };
      return send(res, 200, {
        id: 'mock-completion-1',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 300, total_tokens: 350 }
      });
    });
    return;
  }

  if (url.pathname.startsWith('/rest/v1/')) return handleRest(req, res, url.pathname, url.searchParams);

  if (url.pathname === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type') || '';
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { email, password } = JSON.parse(body || '{}');
      const user = users.get(String(email || '').toLowerCase());
      if (grant !== 'refresh_token' && (!user || user.password !== password)) {
        return send(res, 400, { error_code: 'invalid_credentials', error_description: 'mock: invalid credentials' });
      }
      if (!user) return send(res, 400, { error_code: 'refresh_token_not_found', error_description: 'mock: refresh not found' });
      return send(res, 200, { access_token: fakeToken(user), token_type: 'bearer', expires_in: 604800, refresh_token: 'mock-refresh', user: { id: user.id, email: user.email } });
    });
    return;
  }
  if (url.pathname === '/auth/v1/signup') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { email, password } = JSON.parse(body || '{}');
      const key = String(email || '').toLowerCase();
      if (users.has(key)) return send(res, 400, { error_code: 'user_already_exists', error_description: 'mock: user exists' });
      const user = { id: uuid(), email: key, password };
      users.set(key, user);
      return send(res, 200, { id: user.id, email: user.email, access_token: fakeToken(user), token_type: 'bearer', user: { id: user.id, email: user.email } });
    });
    return;
  }
  if (url.pathname === '/auth/v1/user') {
    const actor = parseUserFromToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!actor) return send(res, 401, { error_code: 'invalid_token' });
    if (![...users.values()].some(u => u.id === actor.id)) return send(res, 401, { error_code: 'invalid_token' });
    return send(res, 200, { id: actor.id, email: actor.email, role: 'authenticated', aud: 'authenticated' });
  }
  if (url.pathname === '/auth/v1/resend' || url.pathname === '/auth/v1/logout') {
    return send(res, 200, {});
  }
  return send(res, 404, { error_code: 'mock_404', message: `mock: No handler for ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-supabase listening on http://127.0.0.1:${PORT}`);
  console.log(`tables: ${Object.keys(tables).join(', ')}`);
});

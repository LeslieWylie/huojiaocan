import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai';
import { runPiRetrievalAgent } from './pi-retrieval-agent.js';

function runtimeWithResponses(responses) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return {
    faux,
    runtime: {
      configured: true,
      model: faux.getModel(),
      timeoutMs: 2_000,
      streamFn: models.streamSimple.bind(models)
    }
  };
}

const startingEvidence = [{
  documentId: 'textbook',
  documentTitle: '学生教材',
  documentType: 'textbook',
  pdfPage: 56,
  sectionPath: ['第三单元', '岳阳楼记'],
  text: '庆历四年春，滕子京谪守巴陵郡。'
}];

test('Pi retrieval agent executes a bounded PageIndex tool loop', async () => {
  const { runtime, faux } = runtimeWithResponses([
    fauxAssistantMessage(
      fauxToolCall('search_teaching_material', { query: '岳阳楼记 教学重点' }),
      { stopReason: 'toolUse' }
    ),
    fauxAssistantMessage(fauxText('READY'))
  ]);
  const calls = [];
  const result = await runPiRetrievalAgent({
    question: '如何处理本课重点？',
    scope: ['textbook', 'teacher-guide'],
    evidence: startingEvidence,
    lessonIdentity: { title: '《岳阳楼记》' },
    retrieveMore: async query => {
      calls.push(query);
      return [{
        documentId: 'teacher-guide',
        documentTitle: '教师教学用书',
        documentType: 'teacher_guide',
        pdfPage: 224,
        sectionPath: ['第三单元', '岳阳楼记'],
        text: '在理解课文大意的基础上，熟读成诵。'
      }];
    },
    runtime
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /岳阳楼记.*教师用书/u);
  assert.equal(calls[1], '岳阳楼记 教学重点');
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.trace.map(item => item.action), ['search', 'search', 'answer']);
  assert.equal(result.trace[0].initiatedBy, 'grounding_policy');
  assert.equal(faux.state.callCount, 1);
});

test('Pi retrieval agent stops without PageIndex when current evidence is enough', async () => {
  const { runtime, faux } = runtimeWithResponses([
    fauxAssistantMessage(fauxText('READY'))
  ]);
  let calls = 0;
  const result = await runPiRetrievalAgent({
    question: '课文第三段写了什么？',
    evidence: startingEvidence,
    retrieveMore: async () => { calls += 1; return []; },
    runtime
  });

  assert.equal(calls, 0);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.trace.map(item => item.action), ['answer']);
  assert.equal(faux.state.callCount, 1);
});

test('Pi retrieval tool cannot exceed two searches', async () => {
  const { runtime } = runtimeWithResponses([
    fauxAssistantMessage(fauxToolCall('search_teaching_material', { query: '岳阳楼记 结构' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('search_teaching_material', { query: '岳阳楼记 忧乐情怀' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('search_teaching_material', { query: '岳阳楼记 背景' }), { stopReason: 'toolUse' })
  ]);
  let calls = 0;
  const result = await runPiRetrievalAgent({
    question: '怎样备课？',
    evidence: startingEvidence,
    retrieveMore: async () => {
      calls += 1;
      return [{ documentId: 'teacher-guide', pdfPage: 220 + calls, text: `页面 ${calls}` }];
    },
    runtime
  });

  assert.equal(calls, 2);
  assert.equal(result.trace.filter(item => item.action === 'search').length, 2);
});

test('production Pi adapter keeps the gateway request server-side and tool-scoped', async t => {
  const originalFetch = global.fetch;
  const requests = [];
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const headers = new Headers(options.headers);
    requests.push({ url: String(url), body, authorization: headers.get('authorization') });
    const firstTurn = !body.messages.some(message => message.role === 'tool');
    const deltas = firstTurn
      ? [
          { id: 'chatcmpl-pi', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-search', type: 'function', function: { name: 'search_teaching_material', arguments: '{"query":"岳阳楼记 教学重点"}' } }] }, finish_reason: null }] },
          { id: 'chatcmpl-pi', model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
        ]
      : [
          { id: 'chatcmpl-pi', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'READY' }, finish_reason: null }] },
          { id: 'chatcmpl-pi', model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
        ];
    return new Response(`${deltas.map(item => `data: ${JSON.stringify(item)}\n\n`).join('')}data: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  const result = await runPiRetrievalAgent({
    question: '怎样确定教学重点？',
    scope: ['textbook', 'teacher-guide'],
    evidence: startingEvidence,
    lessonIdentity: { title: '《岳阳楼记》' },
    retrieveMore: async () => [{ documentId: 'teacher-guide', documentTitle: '教师教学用书', documentType: 'teacher_guide', pdfPage: 224, text: '教学重点' }],
    env: {
      LLM_GATEWAY_BASE_URL: 'https://gateway.test',
      LLM_GATEWAY_API_KEY: 'server-only-test-key',
      LLM_GATEWAY_MODEL: 'test-model'
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://gateway.test/v1/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer server-only-test-key');
  assert.equal(requests[0].body.stream, true);
  assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
  assert.deepEqual(requests[0].body.tools.map(tool => tool.function.name), ['search_teaching_material']);
  assert.equal(result.evidence.at(-1).pdfPage, 224);
});

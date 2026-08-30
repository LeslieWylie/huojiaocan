import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDraftCards, regenerateDraftCard } from './card-generation.js';

const evidence = [
  {
    documentId: 'textbook',
    documentTitle: '学生教材',
    documentType: 'textbook',
    pdfPage: 56,
    printedPage: '50',
    sectionPath: ['第一单元', '我爱这土地'],
    text: '这是用于课堂判断的教材片段。',
    quote: '这是用于课堂判断的教材片段。',
    textSource: 'native',
    qualityStatus: 'normal',
    viewer: { pdfUrl: '/materials/textbook.pdf#page=56', page: 56 }
  },
  {
    documentId: 'teacher-guide',
    documentTitle: '教师教学用书',
    documentType: 'teacher_guide',
    pdfPage: 53,
    printedPage: '41',
    sectionPath: ['第一单元', '我爱这土地', '教学建议'],
    text: '这是用于课堂组织的教师用书片段。',
    quote: '这是用于课堂组织的教师用书片段。',
    textSource: 'native',
    qualityStatus: 'normal',
    viewer: { pdfUrl: '/materials/teacher-guide.pdf#page=53', page: 53 }
  }
];

function draftFixture() {
  const draft = {
    id: 'draft-1',
    version: 7,
    title: '怎样备课《我爱这土地》',
    question: '怎样备课《我爱这土地》？',
    scope: ['textbook', 'teacher-guide'],
    lesson_context: { periods: 1, classLevel: '普通', teachingGoal: '理解文本', teachingMode: '探究' },
    answer: {
      lesson: { title: '《我爱这土地》', coreQuestion: '意象群如何通向献身之情？' },
      summary: '从意象发现走向情感归纳。',
      lessonPlan: [{ title: '圈画意象' }],
      questionChain: [{ question: '意象如何组织？' }],
      assessment: ['能引用原文说明判断']
    },
    citations: evidence.map((item, index) => ({ ...item, id: `E${index + 1}` })),
    cards: [
      { id: 'board-1', type: 'board', title: '板书卡', status: 'draft', items: [{ id: 'board-item-1', text: '旧内容', citationIds: ['E1'] }] },
      { id: 'question-1', type: 'question', title: '提问卡', status: 'draft', items: [{ id: 'question-item-1', text: '保留的提问', citationIds: ['E1'] }] },
      { id: 'assessment-1', type: 'assessment', title: '评价卡', status: 'draft', items: [] }
    ]
  };
  draft.answer.planApproval = {
    status: 'confirmed', hasUnconfirmedChanges: false,
    confirmedVersion: 6, confirmedAt: '2026-08-26T08:00:00.000Z', confirmedBy: 'teacher-1',
    confirmedSnapshot: {
      plan: { ...draft.answer, confirmedTeachingChoices: { decisions: [{ id: 'D1', question: '朗读怎样进入分析？', choice: '随析随读', approach: '分析后立即朗读验证', acceptedTradeoff: '整体感受较碎' }] } },
      conditions: { title: draft.title, question: draft.question, scope: draft.scope, lessonContext: draft.lesson_context },
      citations: draft.citations
    }
  };
  delete draft.answer.planApproval.confirmedSnapshot.plan.planApproval;
  return draft;
}

test('regenerateDraftCard calls the model and replaces only the requested card', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: 'deepseek-v4-flash',
          choices: [{
            message: {
              content: JSON.stringify({
                understanding: '围绕意象组织课堂主线。',
                answer: { summary: '从意象发现走向情感归纳。', evidenceRefs: ['E1', 'E2'] },
                threeCardSuggestions: {
                  board: [
                    { text: '意象群 → 苦难图景', evidenceRefs: ['E1'] },
                    { text: '反复“这” → 情感聚焦', evidenceRefs: ['E1'] },
                    { text: '土地 → 献身之情', evidenceRefs: ['E2'] }
                  ],
                  question: ['提问内容不应覆盖板书卡'],
                  assessment: ['能够结合原文说明判断']
                }
              })
            }
          }]
        };
      }
    };
  };

  try {
    const draft = draftFixture();
    const result = await regenerateDraftCard({
      draft,
      card: draft.cards[0],
      focus: '强化问题链',
      deepseek: { apiKey: 'test-key', model: 'deepseek-v4-flash' }
    });

    assert.deepEqual(result.cards[0].items.map(item => item.text), ['意象群 → 苦难图景', '反复“这” → 情感聚焦', '土地 → 献身之情']);
    assert.equal(result.cards[1].items[0].text, '保留的提问');
    // Regeneration uses the teacher guide first because it is the primary
    // source for classroom organization; the original textbook citation is
    // still retained in the draft citation set.
    assert.deepEqual(result.cards[0].items[0].citationIds, ['citation-2']);
    assert.deepEqual(result.citations.map(item => item.id), ['citation-1', 'citation-2']);
    assert.equal(result.cards[0].sourceConfirmedVersion, 6);
    assert.equal(result.cards[0].sourceConfirmedAt, '2026-08-26T08:00:00.000Z');
    assert.equal(requestBody.model, 'deepseek-v4-flash');
    assert.equal(requestBody.response_format.type, 'json_object');
    assert.match(requestBody.messages.map(item => item.content).join('\n'), /随析随读/u);
    assert.match(requestBody.messages.map(item => item.content).join('\n'), /分析后立即朗读验证/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('regenerateDraftCard blocks locked cards before retrieval', async () => {
  let retrieved = false;
  const draft = draftFixture();
  const locked = { ...draft.cards[0], status: 'locked' };
  await assert.rejects(
    () => regenerateDraftCard({
      provider: { retrieve: async () => { retrieved = true; return null; } },
      draft,
      card: locked,
      deepseek: { apiKey: 'test-key', model: 'deepseek-v4-flash' }
    }),
    error => error.code === 'card_locked' && error.status === 409
  );
  assert.equal(retrieved, false);
});

test('regenerateDraftCard refuses to run without a valid confirmation snapshot', async () => {
  const draft = draftFixture();
  delete draft.answer.planApproval;
  await assert.rejects(
    () => regenerateDraftCard({
      draft,
      card: draft.cards[0],
      deepseek: { apiKey: 'test-key', model: 'deepseek-v4-flash' }
    }),
    error => error.code === 'plan_confirmation_required' && error.status === 409
  );
});

test('regenerateDraftCard gives every card its teaching role and cleans model-controlled metadata', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const contentByType = {
    board: [
      { text: '换成两课时；板书卡：风雨意象 → 民族苦难；教师补写情感变化；PDF 第 56 页 https://bad.example/a [E1]', evidenceRefs: ['E1'] },
      { text: '鸟的歌唱 → 献身', relation: '这段说明只用于生成板书结构，不能被拼接进黑板落笔内容', evidenceRefs: ['E1'] },
      { text: '土地 → 祖国深情', evidenceRefs: ['E2'] }
    ],
    question: [
      { mainQuestion: '圈画“风雨”意象', followUp: '若删去这一意象，情感有什么变化？', expectedStudentResponse: '意象指向民族苦难；文档ID: teacher-guide E1', evidenceRefs: ['E2'] },
      { text: '主问：朗读“嘶哑”｜追问：为什么不用“清脆”？｜预期学生回应：声音状态对应苦难处境', evidenceRefs: ['E1'] },
      { text: '主问：比较四组意象｜追问：它们共同指向什么？｜预期学生回应：由个体歌唱走向民族情感', evidenceRefs: ['E1', 'E2'] }
    ],
    assessment: [
      { task: '圈画并比较两个意象', observablePerformance: '能说出情感变化', judgmentCriteria: '引用两个词句并说明关系；第53页', evidenceRefs: ['E1', 'E2'] },
      { text: '任务：朗读“嘶哑”一句｜可观察表现：重音和停连体现情感｜判断标准：能说明朗读处理与词义关系', evidenceRefs: ['E1'] },
      { text: '任务：用一句话归纳诗歌主旨｜可观察表现：包含土地意象和献身情感｜判断标准：结论有原词支撑且关系清楚', evidenceRefs: ['E2'] }
    ]
  };
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const prompt = request.messages.map(message => String(message.content)).join('\n');
    const type = prompt.includes('请只重新生成板书卡') ? 'board' : prompt.includes('请只重新生成提问卡') ? 'question' : 'assessment';
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: JSON.stringify({
            answer: { summary: '依据教师用书组织课堂。', evidenceRefs: ['E1', 'E2'] },
            threeCardSuggestions: { [type]: contentByType[type] }
          }) } }]
        };
      }
    };
  };

  try {
    const draft = draftFixture();
    const results = [];
    for (const card of draft.cards) {
      results.push(await regenerateDraftCard({
        draft,
        card,
        focus: '换成两课时后保留当前篇目',
        deepseek: { apiKey: 'test-key', model: 'deepseek-v4-flash' }
      }));
    }

    const promptText = requests.map(request => request.messages.map(message => message.content).join('\n')).join('\n');
    assert.match(promptText, /先读教师用书确定本课教学重点、课堂顺序、问题链、作业和评价/);
    assert.match(promptText, /回到学生教材锁定原文、助学任务/);
    assert.match(promptText, /文本抓手 → 结构或情感关系 → 课堂生成结论/);
    assert.match(promptText, /主问：……｜追问：……｜预期学生回应：……/);
    assert.match(promptText, /任务：……｜可观察表现：……｜判断标准：……/);
    assert.match(promptText, /不得生成或转写页码、PDF页、文档ID、URL、E编号/);

    assert.equal(results[0].cards[0].items[0].text, '风雨意象 → 民族苦难');
    assert.equal(results[0].cards[0].items[1].text, '鸟的歌唱 → 献身');
    assert.equal(results[1].cards[1].items[0].text, '主问：圈画“风雨”意象｜追问：若删去这一意象，情感有什么变化？｜预期学生回应：意象指向民族苦难');
    assert.equal(results[2].cards[2].items[0].text, '任务：圈画并比较两个意象｜可观察表现：能说出情感变化｜判断标准：引用两个词句并说明关系');
    for (const result of results) {
      const text = result.cards.flatMap(card => card.items).map(item => item.text).join('\n');
      assert.doesNotMatch(text, /换成两课时|第\s*\d+页|https?:\/\/|文档ID|\bE\d+\b/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateDraftCards generates all unlocked types from the confirmation and preserves a locked card exactly', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    const values = {
      board: [
        { text: '意象群 → 苦难图景', evidenceRefs: ['E1'] },
        { text: '鸟的歌唱 → 献身', evidenceRefs: ['E1'] },
        { text: '土地 → 祖国深情', evidenceRefs: ['E2'] }
      ],
      question: [
        { text: '主问：意象有何关联｜追问：词语如何印证？｜预期学生回应：引用关键词', evidenceRefs: ['E1'] },
        { text: '主问：朗读“嘶哑”｜追问：声音为何如此？｜预期学生回应：联系苦难语境', evidenceRefs: ['E1'] },
        { text: '主问：末句表达什么｜追问：泪为何与土地相连？｜预期学生回应：由个人感受升华为祖国深情', evidenceRefs: ['E2'] }
      ],
      assessment: [
        { text: '任务：说明意象关系｜可观察表现：引用两处词句｜判断标准：关系清楚', evidenceRefs: ['E1'] },
        { text: '任务：完成一次朗读｜可观察表现：重音体现情感｜判断标准：处理与词义一致', evidenceRefs: ['E1'] },
        { text: '任务：归纳诗歌主旨｜可观察表现：写出土地与祖国关系｜判断标准：结论有原文支撑', evidenceRefs: ['E2'] }
      ]
    };
    return { ok: true, status: 200, async json() { return { model: 'deepseek-v4-flash', choices: [{ message: { content: JSON.stringify({ answer: { summary: '依据确认方案生成。', evidenceRefs: ['E1'] }, threeCardSuggestions: values }) } }] }; } };
  };
  try {
    const draft = draftFixture();
    const locked = { ...draft.cards[1], status: 'locked', items: [{ id: 'teacher-item', text: '教师定稿', citationIds: ['E2'] }] };
    draft.cards[1] = locked;
    const result = await generateDraftCards({ draft, deepseek: { apiKey: 'test-key', model: 'deepseek-v4-flash' } });
    assert.deepEqual(result.cards.find(card => card.id === locked.id), locked);
    assert.equal(result.generations.length, 2);
    assert.equal(calls, 2, 'all unlocked cards share one draft + review loop');
    for (const card of result.cards.filter(card => card.status !== 'locked')) {
      assert.equal(card.sourceConfirmedVersion, 6);
      assert.equal(card.sourceConfirmedAt, '2026-08-26T08:00:00.000Z');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

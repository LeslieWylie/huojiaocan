import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureLessonPeriodCoverage, generateGroundedAnswer } from './grounded-answer.js';

const evidence = [
  {
    documentId: 'textbook', documentTitle: '学生教材', documentType: 'textbook', pdfPage: 14,
    printedPage: '8', sectionPath: ['第一单元', '我爱这土地'], text: '教材原文片段', quote: '教材原文片段',
    textSource: 'native', qualityStatus: 'normal', nodeId: 'node-textbook', title: '我爱这土地',
    viewer: { pdfUrl: '/materials/textbook.pdf#page=14', page: 14 }
  },
  {
    documentId: 'teacher-guide', documentTitle: '教师用书', documentType: 'teacher_guide', pdfPage: 56,
    printedPage: '49', sectionPath: ['第一单元', '我爱这土地', '教学建议'], text: '教师用书片段', quote: '教师用书片段',
    textSource: 'native', qualityStatus: 'normal', nodeId: 'node-guide', title: '教学建议',
    viewer: { pdfUrl: '/materials/guide.pdf#page=56', page: 56 }
  }
];

test('multi-period answers cover every requested period even when the model repeats period one', () => {
  const source = {
    lessonPlan: [
      { period: 1, title: '疏通文意' },
      { period: 1, title: '比较悲喜两景' },
      { period: 1, title: '聚焦古仁人与先忧后乐' }
    ]
  };
  const repaired = ensureLessonPeriodCoverage(source, { periods: 2 });
  assert.deepEqual(repaired.lessonPlan.map(item => item.period), [1, 1, 2]);
  assert.deepEqual(repaired.lessonPlan.map(item => item.title), source.lessonPlan.map(item => item.title));
});

test('complete model period allocation is preserved', () => {
  const source = { lessonPlan: [{ period: 1, title: '第一课时' }, { period: 2, title: '第二课时' }] };
  assert.equal(ensureLessonPeriodCoverage(source, { periods: 2 }), source);
});

test('grounded gateway prose cannot replace trusted citation identity', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({
    model: 'test-model',
    choices: [{ message: { content: JSON.stringify({
      understanding: '理解',
      textbookBasis: '教材依据',
      teacherGuideBasis: '教参依据',
      teachingExplanation: '解释',
      threeCardSuggestions: { board: ['板书'], question: ['问题'], assessment: ['评价'] },
      citations: [{ documentId: 'attacker', pdfPage: 999, pdfUrl: 'https://attacker.invalid' }]
    }) } }]
  }), { status: 200 });

  const result = await generateGroundedAnswer({
    question: '如何教学？',
    scope: ['textbook', 'teacher-guide'],
    evidence,
    env: {
      LLM_GATEWAY_BASE_URL: 'https://gateway.test',
      LLM_GATEWAY_API_KEY: 'test-secret',
      LLM_GATEWAY_MODEL: 'test-model',
      LLM_ANSWER_MODE: 'gateway'
    }
  });

  assert.equal(result.generation, 'grounded-gateway');
  const textbookSection = result.sections.find(item => item.title === '学生教材依据');
  const guideSection = result.sections.find(item => item.title === '教师用书依据');
  assert.equal(textbookSection.citations[0].documentId, 'textbook');
  assert.equal(textbookSection.citations[0].pdfPage, 14);
  assert.equal(guideSection.citations[0].documentId, 'teacher-guide');
  assert.equal(result.citations[0].documentId, 'teacher-guide');
  assert.equal(result.answer.summary, '解释');
  assert.equal(result.cardSuggestions.board[0], '板书');
  assert.equal(result.route.pageRanges[0].from, 56);
  assert.doesNotMatch(JSON.stringify(result), /attacker|999/);
});

test('follow-up instruction cannot replace the fixed lesson identity', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({
    model: 'test-model',
    choices: [{ message: { content: JSON.stringify({
      lesson: { title: '换成两课时设计', coreQuestion: '换成两课时设计' },
      understanding: '按两课时重新安排活动。',
      answer: { summary: '第一课时疏通文本，第二课时讨论写景与情怀。' },
      threeCardSuggestions: { board: ['景物描写 → 迁客悲喜 → 先忧后乐'], question: ['回到第3、4段，比较两种景象'], assessment: ['学生能够引用原文说明情景关系'] }
    }) } }]
  }), { status: 200 });

  const result = await generateGroundedAnswer({
    question: '怎样备课《岳阳楼记》？',
    lessonIdentity: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景转入先忧后乐的价值判断？' },
    followUpInstruction: '请保持当前篇目与核心问题，改为两课时设计。',
    scope: ['textbook', 'teacher-guide'],
    evidence,
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });

  assert.equal(result.answer.lesson.title, '《岳阳楼记》');
  assert.equal(result.answer.lesson.coreQuestion, '作者如何由写景转入先忧后乐的价值判断？');
  assert.match(result.answer.summary, /第一课时/u);
});

test('prompt keeps three material roles distinct and asks for a complete evidence workflow', async t => {
  const originalFetch = global.fetch;
  const requestBodies = [];
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: JSON.stringify({
        lesson: { title: '《我爱这土地》', coreQuestion: '诗人如何表达对土地的深情？' },
        answer: {
          summary: '先读原文，再依据教师用书组织朗读与探究。',
          objectives: ['能够借助意象说明诗歌情感', '能够引用原文完成朗读说明'],
          keyPoints: ['重点：意象与情感的关系'],
          lessonPlan: [
            { title: '诵读入境', durationMinutes: 8, studentTask: '圈画意象', expectedEvidence: '读出感情基调', evidenceRefs: ['E1'] },
            { title: '比较意象', durationMinutes: 18, studentTask: '比较词语', expectedEvidence: '说明意象关系', evidenceRefs: ['E1'] },
            { title: '评价收束', durationMinutes: 10, studentTask: '完成出口表达', expectedEvidence: '引用原文说明结论', evidenceRefs: ['E1'] }
          ],
          assessment: ['能够引用原文说明意象与情感的关系'],
          questionChain: [{ question: '回到诗歌中的关键意象', observation: '比较意象的色彩和动作', expectedResponse: '学生能引用具体词语', followUp: '这些词语怎样推进情感？', evidenceRefs: ['E1'] }]
        }
      }) } }]
    }), { status: 200 });
  };

  const result = await generateGroundedAnswer({
    question: '怎样备课《我爱这土地》？',
    scope: ['textbook', 'teacher-guide'],
    evidence,
    history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `普通对话 ${index + 1}` })),
    teacherReflectionContext: '上一课由教师记录：学生能找到意象，但不能说明意象之间的关系。',
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });

  const requestBody = requestBodies[0];
  const systemPrompt = requestBody.messages.find(item => item.role === 'system').content;
  const userPayload = JSON.parse(requestBody.messages.at(-1).content);
  assert.match(systemPrompt, /三源材料使用规则/u);
  assert.match(systemPrompt, /学习任务群.*待教师确认/u);
  assert.match(systemPrompt, /教师如何操作、学生需要回到哪一处文本/u);
  assert.match(userPayload.teacherReflectionContext, /不能说明意象之间的关系/u);
  assert.equal(requestBody.messages.some(item => item.content === '普通对话 1'), false);
  assert.deepEqual(userPayload.workflow.slice(0, 4), ['定位篇目与相关页段', '按需读取课程标准，确认学段要求、任务群与学业质量原文', '核对教师用书，理解编写意图与可供取舍的教学建议', '回到学生教材核对原文证据']);
  assert.equal(result.answer.sourceLayers.curriculumStandard.available, false);
  assert.match(result.answer.questionChain[0].purpose, /观察：比较意象的色彩和动作；预期回答/u);
  assert.equal(requestBodies.length, 3);
  assert.equal(result.generationRounds, 3);
  assert.match(requestBodies[1].messages[0].content, /教材依据与课堂可用性审校员/u);
  assert.match(requestBodies[2].messages[0].content, /最终修订员/u);
});

test('curriculum-standard evidence stays a separate source layer with trusted page identity', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({
    model: 'test-model',
    choices: [{ message: { content: JSON.stringify({
      lesson: { title: '《我爱这土地》', coreQuestion: '诗人如何表达对土地的深情？' },
      answer: { summary: '以第四学段阅读要求为上位依据，再核对教材与教参。', evidenceRefs: ['E1', 'E2', 'E3'] }
    }) } }]
  }), { status: 200 });
  const standard = {
    documentId: 'curriculum-standard', documentTitle: '义务教育语文课程标准（2022年版）', documentType: 'curriculum_standard', pdfPage: 21,
    printedPage: '14', sectionPath: ['课程目标', '第四学段'], text: '阅读与鉴赏的学段要求', quote: '阅读与鉴赏的学段要求',
    viewer: { pdfUrl: '/materials/curriculum-standard.pdf#page=21', page: 21 }
  };
  const result = await generateGroundedAnswer({
    question: '怎样备课《我爱这土地》？',
    scope: ['curriculum-standard', 'textbook', 'teacher-guide'],
    evidence: [standard, ...evidence],
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });
  assert.equal(result.answer.sourceLayers.curriculumStandard.available, true);
  const standardRef = result.answer.sourceLayers.curriculumStandard.citationIds[0];
  const citation = result.citations.find(item => item.id === standardRef);
  assert.equal(citation.documentId, 'curriculum-standard');
  assert.equal(citation.pdfPage, 21);
  assert.match(result.answer.sourceLayers.curriculumStandard.summary, /阅读与鉴赏/u);
});

test('unknown model evidence references are removed instead of looking verified', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({
    model: 'test-model',
    choices: [{ message: { content: JSON.stringify({
      answer: {
        summary: '依据教材组织课堂。',
        evidenceRefs: ['E99'],
        lessonPlan: [{ title: '核对原文', content: '回到课文核对关键语句。', evidenceRefs: ['E99'] }],
        questionChain: [{ question: '关键语句表达了什么？', evidenceRefs: ['E1', 'E99'] }]
      },
      threeCardSuggestions: { board: [{ text: '板书关系', evidenceRefs: ['E99'] }] }
    }) } }] 
  }), { status: 200 });

  const result = await generateGroundedAnswer({
    question: '怎样备课《我爱这土地》？',
    scope: ['textbook', 'teacher-guide'],
    evidence,
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });

  assert.deepEqual(result.answer.evidenceRefs, []);
  assert.ok(result.answer.lessonPlan.length >= 3);
  assert.ok(result.answer.lessonPlan.every(step => step.evidenceRefs.every(ref => ['E1', 'E2'].includes(ref))));
  assert.equal(result.answer.lessonPlan.some(step => step.evidenceRefs.includes('E99')), false);
  assert.deepEqual(result.answer.questionChain[0].evidenceRefs, ['E1']);
  assert.deepEqual(result.cardSuggestionItems.board[0].citationIds, []);
});

test('ReAct retrieval can expand an empty first hit before producing an answer', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  let retrievedQuery = '';
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? { action: 'search', query: '我爱这土地 教师用书 教学重点', reason: '当前页面没有教师用书处理。' }
      : { answer: { reply: '教师用书把朗读、意象比较和情感归纳安排为递进步骤。', summary: '先按教师用书的递进处理组织课堂。', evidenceRefs: ['E1'] } };
    return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  };
  const guidePage = { ...evidence[1], pdfPage: 58, viewer: { pdfUrl: '/materials/guide.pdf#page=58', page: 58 } };
  const result = await generateGroundedAnswer({
    question: '怎样安排《我爱这土地》的朗读教学？',
    lessonIdentity: { title: '《我爱这土地》', coreQuestion: '诗歌如何逐层推进情感？' },
    scope: ['textbook', 'teacher-guide'],
    evidence: [],
    retrieveMore: async query => { retrievedQuery = query; return [guidePage]; },
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });

  assert.equal(calls, 4);
  assert.equal(retrievedQuery, '我爱这土地 教师用书 教学重点');
  assert.equal(result.evidenceSufficient, true);
  assert.equal(result.reactTrace[0].action, 'search');
  assert.equal(result.citations[0].pdfPage, 58);
  assert.equal(result.generationRounds, 2);
});

test('second generation round reviews the draft while catalogue evidence repairs a conversational title', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  t.after(() => { global.fetch = originalFetch; });
  const yueyangEvidence = [{ ...evidence[1], title: '教学建议', sectionPath: ['第四单元', '11 岳阳楼记', '教学建议'], text: '围绕写景、抒情与议论的关系组织教学。' }];
  global.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? { lesson: { title: '我岳阳楼记', coreQuestion: '如何理解先忧后乐？' }, answer: { summary: '初稿。' } }
      : { lesson: { title: '《岳阳楼记》', coreQuestion: '如何理解先忧后乐？' }, answer: { summary: '先核对写景与抒情的转折，再进入先忧后乐的价值判断。', evidenceRefs: ['E1'] } };
    return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  };
  const result = await generateGroundedAnswer({
    question: '我岳阳楼记',
    lessonIdentity: { title: '我岳阳楼记', coreQuestion: '如何理解先忧后乐？' },
    scope: ['teacher-guide'], evidence: yueyangEvidence,
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });
  assert.equal(calls, 2);
  assert.equal(result.answer.lesson.title, '《岳阳楼记》');
  assert.equal(result.generationRounds, 2);
  assert.match(result.answer.summary, /价值判断/u);
});

test('two-period plan enters a bounded third revision when order and time are not teachable', async t => {
  const originalFetch = global.fetch;
  const requests = [];
  t.after(() => { global.fetch = originalFetch; });
  const badPlan = [
    { period: 1, title: '导入：回顾文体', durationMinutes: 5, content: '回顾文体。' },
    { period: 1, title: '品味语言，体悟情感', durationMinutes: 18, content: '品味对偶。' },
    { period: 1, title: '课堂小结', durationMinutes: 5, content: '完成小结。' },
    { period: 2, title: '诵读课文，疏通文意', durationMinutes: 18, content: '正音并疏通文意。' },
    { period: 2, title: '探究主旨', durationMinutes: 18, content: '理解先忧后乐。' }
  ];
  const fixedPlan = [
    { period: 1, title: '导入与诵读', durationMinutes: 10, content: '回顾文体并诵读正音。' },
    { period: 1, title: '疏通文意', durationMinutes: 20, content: '借助注释疏通文意。' },
    { period: 1, title: '阶段检测', durationMinutes: 10, content: '用关键句检查理解。' },
    { period: 2, title: '品味语言', durationMinutes: 18, content: '比较两组写景语句。' },
    { period: 2, title: '探究主旨', durationMinutes: 16, content: '由迁客骚人进入古仁人。' },
    { period: 2, title: '评价与作业', durationMinutes: 8, content: '完成出口任务。' }
  ];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    requests.push(JSON.parse(options.body));
    const lessonPlan = calls < 3 ? badPlan : fixedPlan;
    return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify({
      lesson: { title: calls === 1 ? '换成两课时' : '《岳阳楼记》', coreQuestion: '如何理解先忧后乐？' },
      answer: {
        summary: '依据教师用书组织两课时教学。',
        objectives: ['能够疏通文意并把握结构', '能够说明先忧后乐的价值判断'],
        keyPoints: ['重点：由写景进入价值判断'],
        lessonPlan,
        assessment: ['能够引用关键句说明古仁人之心'],
        evidenceRefs: ['E1']
      }
    }) } }] }), { status: 200 });
  };
  const result = await generateGroundedAnswer({
    question: '把《岳阳楼记》换成两课时',
    lessonIdentity: { title: '《岳阳楼记》', coreQuestion: '如何理解先忧后乐？' },
    lessonContext: { periods: 2 }, scope: ['teacher-guide'], evidence: [{ ...evidence[1], sectionPath: ['第四单元', '岳阳楼记', '教学建议'] }],
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });
  assert.equal(calls, 3);
  assert.equal(result.generationRounds, 3);
  assert.equal(result.answer.lesson.title, '《岳阳楼记》');
  assert.deepEqual(result.teachingPlanIssues, []);
  assert.equal(result.answer.lessonPlan[0].period, 1);
  assert.equal(result.answer.lessonPlan[0].durationMinutes, 10);
  assert.equal(result.answer.lessonPlan[0].duration, '10 分钟');
  const thirdPayload = JSON.parse(requests[2].messages.at(-1).content);
  assert.match(thirdPayload.task, /第三轮定向修订/u);
  assert.ok(thirdPayload.teachingIssues.some(item => /教学顺序倒置/u.test(item)));
  assert.ok(thirdPayload.teachingIssues.some(item => /第1课时的主要任务约28分钟/u.test(item)));
});

test('a real lesson-planning request cannot finish with an empty Cards draft', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  t.after(() => { global.fetch = originalFetch; });
  const complete = {
    lesson: { title: '《沁园春·雪》', coreQuestion: '景、情、志怎样逐层展开？' },
    answer: {
      reply: '以诵读、意象比较和语言品味推进课堂。',
      summary: '由景入情，由情见志。',
      objectives: ['能够借助领字梳理上阕画面', '能够结合关键词说明下阕的价值判断'],
      keyPoints: ['重点：说明景、情、志的推进关系'],
      lessonPlan: [
        { period: 1, title: '诵读入境', durationMinutes: 8, content: '教师示范并组织诵读。', studentTask: '圈画领字并读出节奏。', expectedEvidence: '能够读出“望”和“惜”的转折。', evidenceRefs: ['E1'] },
        { period: 1, title: '比较意象', durationMinutes: 18, content: '追问意象怎样组成画面。', studentTask: '比较两组意象。', expectedEvidence: '能够说明画面与胸襟的关系。', evidenceRefs: ['E1'] },
        { period: 1, title: '评价收束', durationMinutes: 10, content: '回扣风流人物。', studentTask: '用原词完成出口表达。', expectedEvidence: '能够引用关键词说明景情志关系。', evidenceRefs: ['E1'] }
      ],
      questionChain: [
        { question: '“望”字统领了哪些画面？', purpose: '梳理上阕意象。', evidenceRefs: ['E1'] },
        { question: '“惜”字怎样转入历史评价？', purpose: '理解下阕转折。', evidenceRefs: ['E1'] }
      ],
      assessment: ['能够引用至少两个关键词说明景、情、志的推进关系。'],
      evidenceRefs: ['E1']
    }
  };
  global.fetch = async () => {
    calls += 1;
    const value = calls < 3
      ? { lesson: { title: '1 沁园春·雪', coreQuestion: '景、情、志怎样逐层展开？' }, answer: { reply: '组织一课时教学。', summary: '由景入情，由情见志。', objectives: [], keyPoints: [], lessonPlan: [], assessment: [], evidenceRefs: ['E1'] } }
      : complete;
    return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
  };
  const result = await generateGroundedAnswer({
    question: '请设计《沁园春·雪》一课时教学，给出课堂流程和评价观察点。',
    lessonIdentity: { title: '1 沁园春·雪', coreQuestion: '景、情、志怎样逐层展开？' },
    lessonContext: { periods: 1 },
    scope: ['textbook'],
    evidence: [{ ...evidence[0], title: '1 沁园春·雪', sectionPath: ['第一单元', '1 沁园春·雪'] }],
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });
  assert.equal(calls, 3);
  assert.equal(result.answer.lesson.title, '《沁园春·雪》');
  assert.equal(result.answer.objectives.length, 2);
  assert.equal(result.answer.lessonPlan.length, 3);
  assert.equal(result.answer.questionChain.length, 2);
  assert.equal(result.answer.assessment.length, 1);
  assert.deepEqual(result.teachingPlanIssues, []);
});

test('grounded reply is deterministically repaired when every model round omits plan fields', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => {
    calls += 1;
    const value = {
      lesson: { title: '《沁园春·雪》', coreQuestion: '景、情、志怎样逐层展开？' },
      answer: {
        reply: '课堂流程建议为：诵读入境，圈画领字→比较意象，形成画面→品味关键词，理解志向→完成出口表达，回扣景情志关系。',
        summary: '由景入情，由情见志。',
        objectives: [], keyPoints: [], lessonPlan: [], assessment: [], evidenceRefs: ['E1']
      }
    };
    return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
  };
  const result = await generateGroundedAnswer({
    question: '请设计《沁园春·雪》一课时教学，给出课堂流程和评价观察点。',
    lessonIdentity: { title: '1 沁园春·雪', coreQuestion: '景、情、志怎样逐层展开？' },
    lessonContext: { periods: 1 }, scope: ['textbook'],
    evidence: [{ ...evidence[0], documentType: 'textbook', title: '1 沁园春·雪', sectionPath: ['第一单元', '1 沁园春·雪'] }],
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-secret', LLM_GATEWAY_MODEL: 'test-model', LLM_ANSWER_MODE: 'gateway' }
  });
  assert.equal(calls, 3);
  assert.equal(result.answer.objectives.length, 2);
  assert.equal(result.answer.lessonPlan.length, 4);
  assert.equal(result.answer.questionChain.length, 3);
  assert.equal(result.answer.assessment.length, 1);
  assert.equal(result.answer.planCompletion.mode, 'grounded-structure-repair');
  assert.ok(result.answer.lessonPlan.every(step => step.evidenceRefs.includes('E1')));
});

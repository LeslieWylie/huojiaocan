import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { assertLockedCardsUnchanged, hasTeachingPlanAnswerChanged, normalizeLessonReflection, repairDraftForClassroom } from '../api/drafts.js';
import { regenerateDraftCard } from '../serverless/card-generation.js';
import { buildAskContext, buildConversationHistory } from './conversation-context.js';
import {
  conversationStorageKey,
  readConversationSnapshot,
  saveConversationSnapshot
} from './conversation-recovery.js';
import { buildPdfPageUrl, buildReaderHref, pairedDocumentId, pairedFocusQuery, pairedLessonQuery } from './reader-target.js';
import { mergeEvidenceShelf, normalizeShelfItem } from './evidence-shelf.js';
import { checklistProgress, deriveWorkflowChecklist } from './workflow-checklist.js';
import { buildDualSourceTeachingCard } from '../shared/dual-source-teaching-card.js';
import { buildTeachingBrief } from '../shared/teaching-brief.js';
import { buildTeachingEvidenceChain } from '../shared/teaching-evidence-chain.js';
import { buildPeriodPlan, updatePeriodActivity } from '../shared/period-planner.js';
import { buildPreClassPulse, mergePreClassPulse, preClassPulseClassroomCue } from '../shared/preclass-pulse.js';
import { buildClassroomWorksheet, buildClassroomWorksheetHtml } from '../shared/classroom-worksheet.js';
import { buildCurriculumAlignment, curriculumSearchQueries, inferCurriculumTaskGroup } from '../shared/curriculum-alignment.js';

import { appSource } from './test-app-source.js';
const stylesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
const viteSource = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.js'), 'utf8');
const indexApiSource = fs.readFileSync(path.resolve(process.cwd(), 'api/index.js'), 'utf8');
const classroomAdaptationSource = fs.readFileSync(path.resolve(process.cwd(), 'shared/classroom-adaptation.js'), 'utf8');
const boardWritingPlanSource = fs.readFileSync(path.resolve(process.cwd(), 'shared/board-writing-plan.js'), 'utf8');

test('3.1 adds a teacher-confirmed curriculum-standard alignment flow', () => {
  const report = buildCurriculumAlignment({
    lessonTitle: '《岳阳楼记》',
    resultGroups: {
      stage: [{ documentId: 'curriculum-standard', documentType: 'curriculum_standard', pdfPage: 21, title: '第四学段（7—9年级）', text: '阅读与鉴赏' }],
      taskGroup: [{ documentId: 'curriculum-standard', documentType: 'curriculum_standard', pdfPage: 33, title: '文学阅读与创意表达', text: '学习任务群' }],
      quality: [{ documentId: 'curriculum-standard', documentType: 'curriculum_standard', pdfPage: 44, title: '学业质量描述', text: '真实语言运用情境' }]
    }
  });
  assert.equal(report.status, 'review');
  assert.equal(report.sections[1].status, 'candidate');
  assert.equal(report.sections[1].purpose, '教师根据课标任务群作出教学判断');
  assert.match(appSource, /function CurriculumAlignmentPage\(/u);
  assert.match(appSource, /本课采用哪一种学习任务/u);
  assert.match(stylesSource, /\.alignment-flow/u);
  assert.match(viteSource, /alignment: page\('\.\/alignment\/index\.html'\)/u);
});

test('curriculum alignment uses the teacher-guide genre instead of matching a generic standard page', () => {
  assert.equal(inferCurriculumTaskGroup('本文是议论性文章，要识别作者观点、立场与反讽'), '思辨性阅读与表达');
  const query = curriculumSearchQueries({
    lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信',
    guideContext: '本文是一篇阐述观点的议论性文章，要把握作者立场。'
  });
  assert.equal(query.taskGroup, '思辨性阅读与表达');
  assert.match(query.searches.find(([key]) => key === 'quality')[1], /阅读简单议论性文章/u);
  assert.match(appSource, /与本课判断直接相关的原文/u);
  const report = buildCurriculumAlignment({
    lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信',
    resultGroups: {
      taskGroupHint: '思辨性阅读与表达',
      stage: [],
      taskGroup: [
        { documentId: 'curriculum-standard', pdfPage: 36, title: '思辨性阅读与表达', text: '本学习任务群旨在梳理观点与材料。' },
        { documentId: 'curriculum-standard', pdfPage: 38, title: '思辨性阅读与表达', text: '识别文本隐含的情感、观点、立场，表达要观点鲜明、证据充分。' }
      ],
      quality: [
        { documentId: 'curriculum-standard', pdfPage: 44, title: '学业质量', text: '学业质量内涵。' },
        { documentId: 'curriculum-standard', pdfPage: 49, title: '第四学段', text: '阅读简单议论性文章，能区分观点与材料。' }
      ]
    }
  });
  assert.equal(report.sections.find(item => item.id === 'task-group').source.pdfPage, 38);
  assert.equal(report.sections.find(item => item.id === 'quality').source.pdfPage, 49);
});

test('3.0 produces a grounded two-page classroom worksheet without leaking teacher guidance', () => {
  const worksheet = buildClassroomWorksheet({
    title: '《岳阳楼记》',
    coreQuestion: '景、情、理怎样逐层推进？',
    cards: [
      { type: 'question', items: [
        { text: '“衔远山，吞长江”怎样写出洞庭湖气象？', citationIds: ['T1', 'G1'] },
        { text: '阴晴两景为什么形成对照？', citationIds: ['T2', 'G1'] }
      ] },
      { type: 'assessment', items: [{ text: '引用原文说明“不以物喜”的意义', citationIds: ['T2', 'G1'] }] }
    ],
    citations: [
      { id: 'T1', documentId: 'textbook', documentType: 'textbook', documentTitle: '学生教材', pdfPage: 48 },
      { id: 'T2', documentId: 'textbook', documentType: 'textbook', documentTitle: '学生教材', pdfPage: 49 },
      { id: 'G1', documentId: 'teacher-guide', documentType: 'teacher_guide', documentTitle: '教师教学用书', pdfPage: 224 }
    ]
  });
  const pack = buildClassroomWorksheetHtml(worksheet);
  const studentPage = pack.html.match(/<section class="page student-page">([\s\S]*?)<section class="page teacher-page">/u)?.[1] || '';

  assert.equal(worksheet.status, 'ready');
  assert.equal(pack.pageCount, 2);
  assert.doesNotMatch(studentPage, /教师教学用书|PDF 第 224 页/u);
  assert.match(appSource, /function ClassroomWorksheetPage\(/u);
  assert.match(appSource, /生成双页课堂任务单/u);
  assert.match(stylesSource, /\.worksheet-paper/u);
  assert.match(viteSource, /worksheet: page\('\.\/worksheet\/index\.html'\)/u);
});

test('1.6 classroom co-creation keeps live notes lightweight and teacher-confirmed', () => {
  assert.match(appSource, /开始上课并记录/u);
  assert.match(appSource, /学生已经说出/u);
  assert.match(appSource, /还需要追问/u);
  assert.match(appSource, /本步未展开/u);
  assert.match(appSource, /学生关键词（最多 3 个）/u);
  assert.match(appSource, /结束并整理复盘/u);
  assert.match(appSource, /现场标记已经整理成复盘初稿/u);
  assert.doesNotMatch(appSource, /studentName|classroomAudio|classroomVideo/u);
  assert.match(stylesSource, /\.classroom-record-strip/u);
  assert.match(stylesSource, /\.classroom-session:fullscreen/u);
  assert.match(appSource, /const current = dirty \? await save\(cards\) : draft/u);
  assert.match(appSource, /version: current\.version/u);
});

test('classroom reflection does not invalidate the teacher-confirmed plan', () => {
  const current = {
    summary: '围绕文本证据组织课堂',
    objectives: ['梳理文章结构'],
    planApproval: { status: 'confirmed' }
  };
  assert.equal(hasTeachingPlanAnswerChanged(current, {
    ...current,
    teachingFeedback: { unfinishedQuestions: '学生对关键句理解不充分' }
  }), false);
  assert.equal(hasTeachingPlanAnswerChanged(current, {
    ...current,
    summary: '改成只讲背景知识'
  }), true);
});

test('legacy classroom feedback is normalized into the lesson reflection contract', () => {
  assert.deepEqual(normalizeLessonReflection({
    classResponse: '能找出关键词', unfinishedQuestions: '不能说明作用', timeManagement: '结尾仓促',
    usedCards: ['提问卡', '提问卡'], nextStep: '拆成两个递进问题'
  }), {
    version: 1,
    observedLearning: '能找出关键词', unresolvedLearning: '不能说明作用', pacingNotes: '结尾仓促',
    cardUsage: ['提问卡'], nextLessonAdjustment: '拆成两个递进问题', teacherNote: ''
  });
});

test('1.4 exposes a separate post-class reflection and feedback-based re-preparation flow', () => {
  assert.match(appSource, /function ReflectionPage\(/u);
  assert.match(appSource, /\/api\/drafts\/.*\/feedback/u);
  assert.match(appSource, /基于本课创建复备版本/u);
  assert.match(appSource, /useFeedback: true/u);
  assert.match(appSource, /draftId: existingDraft\?\.id \|\| draftId/u);
  assert.doesNotMatch(appSource, /teacherReflectionContext:/u);
  assert.match(indexApiSource, /ownedDraftTeachingContext/u);
  assert.match(appSource, /上一课记录已带入/u);
  assert.match(stylesSource, /\.reflection-advice-layout/u);
  assert.match(viteSource, /reflection: page\('\.\/reflection\/index\.html'\)/u);
});

test('unit relay remains the backbone instead of bulk-generating a unit plan', () => {
  assert.match(appSource, /从教材问题到真实学情/u);
  assert.match(appSource, /用本课学情继续备/u);
  assert.match(appSource, /\/continue-next/u);
  assert.match(appSource, /unitRefFromUrl/u);
  assert.match(appSource, /返回单元轨道/u);
  assert.doesNotMatch(appSource, /一键生成整个单元/u);
  assert.match(stylesSource, /\.unit-track-list/u);
});

test('1.7 turns the grounded question card into a rehearsal path used in class', () => {
  assert.match(appSource, /function RehearsalPage\(/u);
  assert.match(appSource, /学生答到了/u);
  assert.match(appSource, /学生答偏了/u);
  assert.match(appSource, /课堂沉默/u);
  assert.match(appSource, /classroom-rehearsal-cue/u);
  assert.match(viteSource, /rehearsal: page\('\.\/rehearsal\/index\.html'\)/u);
});

test('1.8 returns aggregate homework learning to the next preparation without student profiles', () => {
  assert.match(appSource, /function LearningEvidencePage\(/u);
  assert.match(appSource, /只记录班级聚合数据/u);
  assert.match(appSource, /完整达成/u);
  assert.match(appSource, /部分达成/u);
  assert.match(appSource, /尚未达成/u);
  assert.match(appSource, /下一次备课只会带入班级汇总和教师判断/u);
  assert.doesNotMatch(appSource, /studentName|studentId|rawStudentWork/u);
  assert.match(stylesSource, /\.learning-workbench/u);
  assert.match(stylesSource, /\.prior-learning-banner/u);
  assert.match(viteSource, /learning: page\('\.\/learning\/index\.html'\)/u);
});

test('1.9 turns an initial plan into explicit teacher-owned classroom tradeoffs', () => {
  assert.match(appSource, /function DeliberationPage\(/u);
  assert.match(appSource, /比较备课取舍/u);
  assert.match(appSource, /课堂怎样做/u);
  assert.match(appSource, /需要接受什么/u);
  assert.match(appSource, /推荐项不会自动选中/u);
  assert.match(appSource, /本课备课取舍已确认/u);
  assert.match(appSource, /beforeunload/u);
  assert.match(stylesSource, /\.deliberation-workbench/u);
  assert.match(stylesSource, /grid-template-columns:270px minmax\(0,1fr\)/u);
  assert.match(viteSource, /deliberation: page\('\.\/deliberation\/index\.html'\)/u);
});

test('2.0 turns classroom pace into a grounded next action instead of a new dashboard', () => {
  assert.match(appSource, /课堂应变/u);
  assert.match(appSource, /节奏正常/u);
  assert.match(appSource, /时间不足/u);
  assert.match(appSource, /学生卡住/u);
  assert.match(appSource, /提前完成/u);
  assert.match(appSource, /classroomAdaptationAdvice/u);
  assert.match(appSource, /paceSignal/u);
  assert.match(stylesSource, /\.classroom-adaptation/u);
  assert.doesNotMatch(classroomAdaptationSource, /pdfPage|documentId|viewer/u);
});

test('2.9 turns a grounded question card into a privacy-safe pre-class starting point', () => {
  const draft = {
    answer: { planApproval: { status: 'confirmed', hasUnconfirmedChanges: false } },
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '衔远山，吞长江' }],
    cards: [{ id: 'Q', type: 'question', items: [{ id: 'Q1', text: '两个动词怎样写出洞庭湖气象？', citationIds: ['E1'] }] }]
  };
  const generated = buildPreClassPulse(draft);
  draft.answer.preClassPulse = mergePreClassPulse(generated, {
    ...generated, presentCount: 40, respondedCount: 38, secureCount: 8, partialCount: 16, notYetCount: 14, teacherDecision: 'adopt'
  }, { confirm: true });
  assert.equal(preClassPulseClassroomCue(draft).level, 'scaffold');
  assert.match(appSource, /function PreClassPulsePage\(/u);
  assert.match(appSource, /只保存班级聚合结果/u);
  assert.match(appSource, /确认并带入课堂/u);
  assert.match(appSource, /classroom-pulse-cue/u);
  assert.match(stylesSource, /\.pulse-workbench/u);
  assert.match(viteSource, /pulse: page\('\.\/pulse\/index\.html'\)/u);
  assert.doesNotMatch(appSource, /studentName|studentId|rawStudentWork/u);
});

test('2.1 exports the confirmed classroom as a self-contained offline pack', () => {
  assert.match(appSource, /buildOfflineClassroomPack/u);
  assert.match(appSource, /下载离线课堂包/u);
  assert.match(appSource, /text\/html;charset=utf-8/u);
  assert.match(appSource, /导出不会改动账号中的课堂记录/u);
  assert.match(stylesSource, /\.offline-pack-button/u);
});

test('2.2 pairs student textbook and teacher guide on verified original pages', () => {
  assert.equal(pairedDocumentId('textbook'), 'teacher-guide');
  assert.equal(pairedDocumentId('teacher-guide'), 'textbook');
  assert.equal(pairedLessonQuery({ explicitTitle: '《岳阳楼记》' }), '《岳阳楼记》');
  assert.match(appSource, /双源对照/u);
  assert.match(appSource, /scope: \[counterpartId\], limit: 8/u);
  assert.match(appSource, /系统只负责定位，不把两份材料混写成新的结论/u);
  assert.match(stylesSource, /\.paired-reading-workbench/u);
  assert.doesNotMatch(appSource, /pairedPageMap|岳阳楼记\s*:\s*\d+/u);
});

test('2.3 turns the SVG board into a timed chalk-writing rehearsal', () => {
  assert.match(appSource, /板书落笔排练/u);
  assert.match(appSource, /showWriteOrder=\{writingRehearsal\}/u);
  assert.match(appSource, /落笔提示/u);
  assert.match(stylesSource, /\.board-writing-steps/u);
  assert.match(boardWritingPlanSource, /MAX_ITEM_CHARS = 16/u);
  assert.match(boardWritingPlanSource, /完整问题口头提出/u);
  assert.doesNotMatch(boardWritingPlanSource, /fetch\(|apiKey|documentId/u);
});

test('2.4 tracks a textbook sentence into the paired teacher-guide page', () => {
  assert.equal(pairedFocusQuery({ lessonTitle: '《岳阳楼记》', focus: '不以物喜，不以己悲' }), '《岳阳楼记》 不以物喜，不以己悲');
  assert.match(appSource, /句段追踪/u);
  assert.match(appSource, /body: \{ query: pairedSearchQuery, scope: \[counterpartId\], limit: 8 \}/u);
  assert.match(appSource, /nextParams\.set\('focus', next\)/u);
  assert.match(stylesSource, /\.paired-focus-panel/u);
  assert.doesNotMatch(appSource, /focusPageMap|sentencePageMap/u);
});

test('2.5 turns one tracked sentence into a portable two-source teaching card', () => {
  const card = buildDualSourceTeachingCard({
    lessonTitle: '《岳阳楼记》', focus: '政治情怀',
    sources: [
      { documentId: 'textbook', pdfPage: 56, text: '先天下之忧而忧，后天下之乐而乐。' },
      { documentId: 'teacher-guide', pdfPage: 229, text: '结合改革实践理解政治情怀。' }
    ]
  });
  assert.equal(card.textbook.pdfPage, 56);
  assert.equal(card.teacherGuide.pdfPage, 229);
  assert.match(appSource, /双源讲解卡/u);
  assert.match(appSource, /复制讲解卡/u);
  assert.match(stylesSource, /\.dual-source-teaching-card/u);
  assert.doesNotMatch(card.markdown, /apiKey|documentId|https?:\/\//u);
});

test('2.6 turns the confirmed plan into a grounded teaching briefing', () => {
  const brief = buildTeachingBrief({
    title: '岳阳楼记',
    coreQuestion: '古仁人之心为什么能超越个人悲喜？',
    answer: { summary: '比较两种情感与古仁人之心。', lessonPlan: [{ title: '回到原文' }] },
    cards: [{ type: 'assessment', items: [{ text: '能引用原文完成解释。' }] }],
    citations: [{ documentId: 'textbook', pdfPage: 56 }, { documentId: 'teacher-guide', pdfPage: 224 }]
  });
  assert.equal(brief.sourceCoverage, 'balanced');
  assert.equal(brief.sections.length, 4);
  assert.match(appSource, /教研说课简报/u);
  assert.match(stylesSource, /\.teaching-brief-stage/u);
});

test('2.7 exposes the page-to-question-to-learning evidence chain', () => {
  const chain = buildTeachingEvidenceChain({
    title: '岳阳楼记',
    citations: [{ id: 'p56', documentId: 'textbook', pdfPage: 56 }],
    cards: [
      { type: 'question', items: [{ text: '古仁人之心有什么不同？', citationIds: ['p56'] }] },
      { type: 'assessment', items: [{ text: '能引用原文说明区别。', citationIds: ['p56'] }] }
    ]
  });
  assert.equal(chain.completePaths, 1);
  assert.equal(chain.linkedPercent, 100);
  assert.match(appSource, /教学证据链/u);
  assert.match(stylesSource, /\.evidence-chain-flow/u);
});

test('2.9 allocates lesson activities across periods and exposes classroom readiness', () => {
  const plan = buildPeriodPlan({ periods: 2, lessonPlan: ['朗读写景段', '比较两种情感', '追问古仁人之心', '收束先忧后乐'] });
  const moved = updatePeriodActivity(plan, plan.activities[0].id, { period: 2, minutes: 18 });
  assert.equal(moved.periods, 2);
  assert.equal(moved.activities[0].period, 2);
  assert.equal(moved.activities[0].title, '朗读写景段');
  assert.match(appSource, /课时编排/u);
  assert.match(appSource, /课堂主线可能偏少/u);
  assert.match(appSource, /按学习前置关系整理/u);
  assert.match(stylesSource, /\.period-planner-columns/u);
});

test('教材质量检查的单份报告不会被长识别文本撑出页面', () => {
  assert.match(appSource, /教材质量检查/u);
  assert.match(stylesSource, /\.compare-grid\{grid-template-columns:minmax\(0,1fr\);min-width:0\}/u);
  assert.match(stylesSource, /\.provider-result blockquote\{overflow-wrap:anywhere;white-space:pre-wrap\}/u);
});

function installMemoryStorage() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  });
  return {
    values,
    restore() {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  };
}

function answerTurn(index) {
  return {
    role: 'user',
    question: `第${index}轮问题`,
    response: {
      understanding: `理解第${index}轮`,
      answer: {
        reply: `第${index}轮有依据的回答`,
        keyPoints: [`要点${index}`]
      },
      citations: [{ documentId: 'teacher-guide', pdfPage: 50 + index }]
    }
  };
}

const evidence = [
  {
    documentId: 'teacher-guide',
    documentTitle: '教师教学用书',
    documentType: 'teacher_guide',
    pdfPage: 53,
    printedPage: '41',
    sectionPath: ['第一单元', '我爱这土地', '教学建议'],
    text: '教师用书要求从意象关系进入情感主旨。',
    quote: '从意象关系进入情感主旨。',
    viewer: { pdfUrl: '/materials/teacher-guide.pdf#page=53', page: 53 }
  },
  {
    documentId: 'textbook',
    documentTitle: '学生教材',
    documentType: 'textbook',
    pdfPage: 14,
    printedPage: '12',
    sectionPath: ['第一单元', '我爱这土地'],
    text: '课文以鸟、土地等意象表达深沉情感。',
    quote: '我也应该用嘶哑的喉咙歌唱。',
    viewer: { pdfUrl: '/materials/textbook.pdf#page=14', page: 14 }
  }
];

function threeCardDraft() {
  const citations = evidence.map((item, index) => ({ ...item, id: `E${index + 1}` }));
  const plan = {
    lesson: { title: '《我爱这土地》', coreQuestion: '意象群如何通向献身之情？' },
    summary: '从意象关系走向献身之情。',
    lessonPlan: [{ title: '圈画意象' }],
    questionChain: [{ question: '意象群如何通向献身之情？' }],
    assessment: ['能引用原文说明判断']
  };
  const draft = {
    id: 'draft-major',
    version: 7,
    title: '《我爱这土地》',
    question: '怎样备课《我爱这土地》？',
    scope: ['textbook', 'teacher-guide'],
    lesson_context: { periods: 2, classLevel: '普通', teachingGoal: '理解文本', teachingMode: '探究' },
    answer: { ...plan },
    citations,
    cards: [
      { id: 'board-1', type: 'board', title: '板书卡', status: 'draft', items: [{ id: 'b-old', text: '旧板书', citationIds: [] }] },
      { id: 'question-1', type: 'question', title: '提问卡', status: 'draft', items: [{ id: 'q-old', text: '旧提问', citationIds: [] }] },
      { id: 'assessment-1', type: 'assessment', title: '评价卡', status: 'draft', items: [{ id: 'a-old', text: '旧评价', citationIds: [] }] }
    ]
  };
  draft.answer.planApproval = {
    status: 'confirmed', hasUnconfirmedChanges: false,
    confirmedVersion: 6, confirmedAt: '2026-08-26T08:00:00.000Z', confirmedBy: 'teacher-1',
    confirmedSnapshot: {
      plan,
      conditions: { title: draft.title, question: draft.question, scope: draft.scope, lessonContext: draft.lesson_context },
      citations
    }
  };
  return draft;
}

test('大版本入口提供教师引导视频，并移除驾驶舱式教师文案', () => {
  assert.match(appSource, /function GuidancePage\(\)/u);
  assert.match(appSource, /活教参备课引导\.mp4/u);
  assert.match(appSource, /选定篇目/u);
  assert.match(viteSource, /guide: page\('\.\/guide\/index\.html'\)/u);
  assert.match(stylesSource, /\.guidance-video-panel/u);
  assert.doesNotMatch(appSource, /项目驾驶舱|驾驶舱/u);
});

test('连续问答的篇目、条件、回答和上下文可在刷新后恢复', () => {
  const storage = installMemoryStorage();
  try {
    const messages = [answerTurn(1), answerTurn(2)];
    const conversationHistory = buildConversationHistory(messages, [
      { role: 'user', content: '那第二节怎样衔接？' }
    ]);
    const snapshot = {
      draftId: 'draft-refresh',
      question: '那第二节怎样衔接？',
      planQuestion: '怎样备课《我爱这土地》？',
      scope: 'both',
      lessonContext: { periods: 2, classLevel: '普通' },
      lessonRef: { documentId: 'teacher-guide', title: '《我爱这土地》', pageRange: [51, 57] },
      messages,
      conversationHistory,
      next: '/ask/?draftId=draft-refresh'
    };

    assert.equal(saveConversationSnapshot(snapshot, 'teacher-1'), true);
    const restored = readConversationSnapshot('teacher-1');

    assert.equal(restored.draftId, snapshot.draftId);
    assert.equal(restored.planQuestion, snapshot.planQuestion);
    assert.deepEqual(restored.lessonContext, snapshot.lessonContext);
    assert.deepEqual(restored.lessonRef, snapshot.lessonRef);
    assert.deepEqual(restored.messages, messages);
    assert.deepEqual(restored.conversationHistory, conversationHistory);
    assert.equal(restored.next, snapshot.next);
    assert.match(restored.conversationHistory.at(-2).content, /第2轮有依据的回答/u);
    assert.equal(restored.conversationHistory.at(-1).content, '那第二节怎样衔接？');
  } finally {
    storage.restore();
  }
});

test('依据夹升级为草稿级持久化，并支持整场备课记录导出', () => {
  assert.match(appSource, /answer: \{ \.\.\.\(response\.answer \|\| \{\}\), \.\.\.\(sameLesson.*?sourceCoverage: response\.sourceCoverage \|\| response\.answer\?\.sourceCoverage/u);
  assert.match(appSource, /conversationHistory: nextHistory, conversationTurns: nextConversationTurns, evidenceShelf/u);
  assert.match(appSource, /draft\.answer\?\.evidenceShelf/u);
  assert.match(appSource, /const exportConversation = \(\) =>/u);
  assert.match(appSource, /导出记录/u);
  assert.match(appSource, /备课记录（\{recentDrafts\.length \+ visibleLocalSessions\.length\}）/u);
  assert.match(appSource, /data\.drafts\.slice\(0, 50\)/u);
  assert.match(appSource, /回答已经生成，但暂时没有保存到账号/u);
  assert.match(appSource, /const recoveredMessages = \[\.\.\.messages, pendingTurn\]/u);
});

test('依据夹拒绝无效物理页，并按文档和页码去重', () => {
  assert.equal(normalizeShelfItem({ documentId: 'textbook', pdfPage: 0 }), null);
  assert.equal(normalizeShelfItem({ documentId: 'textbook', pdfPage: -1 }), null);
  assert.equal(normalizeShelfItem({ documentId: 'textbook', pdfPage: 1 })?.pdfPage, 1);
  const merged = mergeEvidenceShelf([
    { documentId: 'textbook', pdfPage: 1, text: '旧片段' }
  ], [
    { documentId: 'textbook', pdfPage: 1, text: '重复片段' },
    { documentId: 'teacher-guide', pdfPage: 2, text: '教师用书依据' }
  ]);
  assert.deepEqual(merged.map(item => `${item.documentId}:${item.pdfPage}`), ['textbook:1', 'teacher-guide:2']);
});

test('教材搜索结果兼容服务端下划线字段并保留物理页定位契约', () => {
  assert.match(appSource, /searchResultDocumentId\(r\)/u);
  assert.match(appSource, /searchResultPage\(r\)/u);
  assert.match(appSource, /result\.document_id/u);
  assert.match(appSource, /result\.pdf_page/u);
});

test('另起一场备课不会重新打开上一条本地会话', () => {
  assert.match(appSource, /const isNewConversation = params\.get\('new'\) === '1'/u);
  assert.match(appSource, /const authRecovery = useMemo\(\(\) => isNewConversation \? null/u);
  assert.match(appSource, /const requestedDraftId = isNewConversation \? ''/u);
  assert.match(appSource, /url\.search = '\?new=1'/u);
});

test('匿名快照可交接到登录用户的独立槽位', () => {
  const storage = installMemoryStorage();
  try {
    assert.equal(saveConversationSnapshot({
      draftId: 'anonymous-draft',
      planQuestion: '怎样备课《岳阳楼记》？',
      messages: [answerTurn(1)]
    }), true);

    const handoff = readConversationSnapshot('user-after-login');
    assert.equal(handoff.draftId, 'anonymous-draft');
    assert.equal(saveConversationSnapshot(handoff, 'user-after-login'), true);
    assert.equal(storage.values.has(conversationStorageKey('user-after-login')), true);
    assert.equal(readConversationSnapshot('user-after-login').draftId, 'anonymous-draft');
    assert.equal(storage.values.has(conversationStorageKey()), false, '交接完成后不应留下可被下一账号读取的匿名副本');
  } finally {
    storage.restore();
  }
});

test('会话快照最多保留最近 12 轮完整问答', () => {
  const storage = installMemoryStorage();
  try {
    const messages = Array.from({ length: 15 }, (_, index) => answerTurn(index));
    assert.equal(saveConversationSnapshot({ messages }), true);

    const restored = readConversationSnapshot();
    assert.equal(restored.messages.length, 12);
    assert.equal(restored.messages[0].question, '第3轮问题');
    assert.equal(restored.messages.at(-1).question, '第14轮问题');
    assert.equal(restored.messages.every(turn => turn.question && turn.response), true);
  } finally {
    storage.restore();
  }
});

test('追问操作不改写 lesson 标题，也不留在板书主题或分支中', () => {
  const context = buildAskContext({
    text: '请保持当前篇目与核心问题，改为两课时安排。',
    identityQuestion: '怎样备课《岳阳楼记》？',
    lessonRef: { title: '《岳阳楼记》' },
    requestOptions: { isAction: true, prompt: '请保持当前篇目与核心问题，改为两课时安排。' }
  });

  assert.equal(context.currentQuestion, '怎样备课《岳阳楼记》？');
  assert.equal(context.identityTitle, '《岳阳楼记》');
  assert.equal(context.retrievalQuery, '怎样备课《岳阳楼记》？');

  const repaired = repairDraftForClassroom({
    title: '改为两课时安排',
    question: '怎样备课《岳阳楼记》？',
    answer: { lesson: { title: '改为两课时安排', coreQuestion: '换成两课时设计' } },
    cards: [{
      id: 'board-legacy',
      type: 'board',
      status: 'draft',
      items: [{ id: 'b1', text: '迁客骚人的悲喜 → 先忧后乐', citationIds: ['E1'] }],
      boardPlan: { coreQuestion: '换成两课时设计', branches: [{ title: '生成板书', nodes: [] }] }
    }]
  }).draft;

  assert.doesNotMatch(repaired.answer.lesson.coreQuestion, /(换成|改为).*课时/u);
  assert.doesNotMatch(repaired.cards[0].boardPlan.coreQuestion, /(换成|改为).*课时/u);
  assert.equal(repaired.cards[0].boardPlan.branches.every(branch => !/(生成|换成|改为)/u.test(branch.title)), true);
  assert.equal(repaired.title, '《岳阳楼记》');
  assert.equal(repaired.answer.lesson.title, '《岳阳楼记》');
});

test('三卡生成保持固定结构与引用，锁定后禁止重生成、修改或删除', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        model: 'deterministic-test-model',
        choices: [{ message: { content: JSON.stringify({
          lesson: { title: '请改成两课时', coreQuestion: '生成三卡' },
          understanding: '固定篇目后生成可执行的三卡。',
          answer: { summary: '从意象关系走向献身之情。', evidenceRefs: ['E1', 'E2'] },
          threeCardSuggestions: {
            board: [
              { text: '意象群→土地苦难→献身之情', evidenceRefs: ['E1', 'E2'] },
              { text: '嘶哑歌唱→苦难担当', evidenceRefs: ['E2'] },
              { text: '土地→祖国深情', evidenceRefs: ['E1', 'E2'] }
            ],
            question: [
              { text: '主问：圈画意象与修饰语｜追问：这些意象共同指向什么？｜预期学生回应：土地的苦难与诗人的献身', evidenceRefs: ['E1', 'E2'] },
              { text: '主问：朗读“嘶哑”｜追问：为什么不是“清脆”？｜预期学生回应：声音状态对应民族苦难', evidenceRefs: ['E2'] },
              { text: '主问：末句为什么写泪｜追问：它怎样回扣土地？｜预期学生回应：由个人感受升华为祖国深情', evidenceRefs: ['E1', 'E2'] }
            ],
            assessment: [
              { text: '任务：用两处词句说明情感｜可观察表现：学生能够圈画并解释｜判断标准：词句与情感关系对应', evidenceRefs: ['E2'] },
              { text: '任务：完成一次朗读｜可观察表现：重音与停连体现情感｜判断标准：朗读处理有词义依据', evidenceRefs: ['E2'] },
              { text: '任务：归纳意象关系｜可观察表现：说清苦难与献身的联系｜判断标准：结论同时引用教材和教师用书', evidenceRefs: ['E1', 'E2'] }
            ]
          }
        }) } }]
      };
    }
  });

  try {
    const draft = threeCardDraft();
    const generatedByType = new Map();
    for (const card of draft.cards) {
      const result = await regenerateDraftCard({
        draft,
        card,
        focus: '保持当前篇目，只细化本卡',
        deepseek: { apiKey: 'test-only', model: 'deterministic-test-model' }
      });
      generatedByType.set(card.type, result.cards.find(item => item.type === card.type));
      assert.deepEqual(result.cards.map(item => item.type), ['board', 'question', 'assessment']);
      assert.equal(result.cards.filter(item => item.id !== card.id).every(item => item.items[0].text.startsWith('旧')), true);
    }

    assert.deepEqual([...generatedByType.keys()], ['board', 'question', 'assessment']);
    for (const card of generatedByType.values()) {
      assert.equal(card.status, 'draft');
      assert.equal(card.items.length, 3);
      assert.equal(typeof card.items[0].text, 'string');
      assert.equal(typeof card.items[0].sourceType, 'string');
      assert.equal(Array.isArray(card.items[0].citationIds), true);
      assert.equal(card.items[0].citationIds.length > 0, true);
    }
    assert.equal(generatedByType.get('board').items[0].sourceType, 'combined');
    assert.equal(generatedByType.get('assessment').items[0].sourceType, 'textbook');

    const locked = { ...draft.cards[0], status: 'locked' };
    let retrievedAfterLock = false;
    await assert.rejects(
      () => regenerateDraftCard({
        provider: { async retrieve() { retrievedAfterLock = true; return { evidenceSufficient: true, results: evidence }; } },
        draft: { ...draft, cards: [locked, ...draft.cards.slice(1)] },
        card: locked,
        deepseek: { apiKey: 'test-only', model: 'deterministic-test-model' }
      }),
      error => error.code === 'card_locked' && error.status === 409
    );
    assert.equal(retrievedAfterLock, false);
    assert.equal(assertLockedCardsUnchanged([locked], [{ ...locked }]), true);
    assert.throws(
      () => assertLockedCardsUnchanged([locked], [{ ...locked, items: [{ id: 'b-old', text: '篡改内容' }] }]),
      error => error.code === 'card_locked' && error.status === 409
    );
    assert.throws(
      () => assertLockedCardsUnchanged([locked], []),
      error => error.code === 'card_locked' && error.status === 409
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('追问搜索保留篇目语义，引用链接保留文档、物理页和返回位置', () => {
  const context = buildAskContext({
    text: '教师用书建议对应学生教材哪一段？',
    identityQuestion: '怎样备课《我爱这土地》？',
    lessonRef: { title: '《我爱这土地》' }
  });
  assert.equal(context.retrievalQuery, '《我爱这土地》 教师用书建议对应学生教材哪一段？');

  const href = buildReaderHref({
    documentId: 'teacher-guide',
    page: 53,
    nodeId: 'lesson-3',
    lessonTitle: '《我爱这土地》',
    scope: 'both',
    returnTo: '/ask/?draftId=draft-major&turn=2'
  });
  const target = new URL(href, 'https://local.test');
  assert.equal(target.pathname, '/document/');
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    doc: 'teacher-guide',
    page: '53',
    node: 'lesson-3',
    lesson: '《我爱这土地》',
    scope: 'both',
    return: '/ask/?draftId=draft-major&turn=2'
  });
  assert.equal(
    buildPdfPageUrl('/materials/teacher-guide.pdf#page=1&view=FitH', 53),
    '/materials/teacher-guide.pdf#page=53&view=FitH'
  );
});

test('旧草稿的 snake_case 条件、content 卡片和自定义字段仍可读', () => {
  const legacyLockedCard = {
    id: 'legacy-question',
    type: 'question',
    title: '旧提问卡',
    status: 'locked',
    content: ['为什么说眼前的岳阳楼不只是一处风景？']
  };
  const oldDraft = {
    id: 'legacy-draft',
    title: '怎么备课岳阳楼记',
    question: '怎样备课《岳阳楼记》？',
    lesson_context: { periods: 2, classLevel: '基础', customLegacyFlag: true },
    answer: { summary: '先理清写景与议论的关系。' },
    citations: [
      { documentType: 'teacher_guide', documentId: 'teacher-guide', pdfPage: 224 },
      { documentType: 'textbook', documentId: 'textbook', pdfPage: 56 }
    ],
    cards: [
      { id: 'legacy-board', type: 'board', title: '旧板书卡', status: 'draft', content: ['写景', '抒情', '议论'] },
      legacyLockedCard
    ],
    extension_payload: { preserved: true }
  };

  const result = repairDraftForClassroom(oldDraft);
  assert.equal(result.changed, true);
  assert.equal(result.draft.title, '《岳阳楼记》');
  assert.deepEqual(result.draft.lesson_context, oldDraft.lesson_context);
  assert.deepEqual(result.draft.extension_payload, oldDraft.extension_payload);
  assert.deepEqual(result.draft.cards[0].content, oldDraft.cards[0].content);
  assert.equal(
    Array.isArray(result.draft.cards[0].items),
    true,
    '旧 content 卡片需要转成当前编辑器可读的 items 结构'
  );
  assert.deepEqual(
    result.draft.cards[0].items.map(item => item.text),
    oldDraft.cards[0].content,
    '旧 content 卡片需要转成当前编辑器可读的 items 结构'
  );
  assert.deepEqual(result.draft.cards[1], legacyLockedCard);

  const checklist = deriveWorkflowChecklist({ draft: result.draft });
  assert.deepEqual(checklist.map(item => item.done), [true, false, true, true, true, true]);
  assert.deepEqual(checklistProgress(checklist), { done: 5, total: 6, complete: false });
});

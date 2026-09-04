import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAskContext, buildConversationHistory, resolveTeachingFocus } from './conversation-context.js';

test('a typed follow-up is sent as the current question while lesson identity stays stable', () => {
  const result = buildAskContext({
    text: '第二段的情感转折怎样引导学生发现？',
    identityQuestion: '《我爱这土地》第二节为什么不能删？',
    lessonRef: { title: '《我爱这土地》' }
  });
  assert.equal(result.currentQuestion, '第二段的情感转折怎样引导学生发现？');
  assert.equal(result.canonicalQuestion, '《我爱这土地》第二节为什么不能删？');
  assert.equal(result.nextIdentityQuestion, '《我爱这土地》第二节为什么不能删？');
  assert.equal(result.retrievalQuery, '《我爱这土地》 第二段的情感转折怎样引导学生发现？');
  assert.equal(result.followUpInstruction, '第二段的情感转折怎样引导学生发现？');
});

test('an operation changes the plan but not the question or retrieval identity', () => {
  const result = buildAskContext({
    text: '请调整为两课时。',
    identityQuestion: '《岳阳楼记》怎样安排两课时教学？',
    lessonRef: { title: '《岳阳楼记》' },
    requestOptions: { isAction: true, prompt: '请调整为两课时。' }
  });
  assert.equal(result.actionOnly, true);
  assert.equal(result.currentQuestion, '《岳阳楼记》怎样安排两课时教学？');
  assert.equal(result.canonicalQuestion, '《岳阳楼记》怎样安排两课时教学？');
  assert.equal(result.identityTitle, '《岳阳楼记》');
  assert.equal(result.retrievalQuery, '《岳阳楼记》怎样安排两课时教学？');
  assert.equal(result.followUpInstruction, '请调整为两课时。');
});

test('follow-up questions and later operations never replace the established lesson identity', () => {
  const followUp = buildAskContext({
    text: '那结尾两句怎样追问？',
    identityQuestion: '怎样备课《我爱这土地》？',
    lessonRef: { title: '《我爱这土地》' }
  });
  const operation = buildAskContext({
    text: '把刚才的追问改成小组讨论。',
    identityQuestion: followUp.nextIdentityQuestion,
    lessonRef: { title: followUp.identityTitle },
    requestOptions: { isAction: true, prompt: '把刚才的追问改成小组讨论。' }
  });

  assert.equal(followUp.identityTitle, '《我爱这土地》');
  assert.equal(followUp.nextIdentityQuestion, '怎样备课《我爱这土地》？');
  assert.equal(followUp.retrievalQuery, '《我爱这土地》 那结尾两句怎样追问？');
  assert.equal(operation.identityTitle, '《我爱这土地》');
  assert.equal(operation.canonicalQuestion, '怎样备课《我爱这土地》？');
  assert.equal(operation.nextIdentityQuestion, '怎样备课《我爱这土地》？');
  assert.equal(operation.retrievalQuery, '怎样备课《我爱这土地》？');
  assert.equal(operation.followUpInstruction, '把刚才的追问改成小组讨论。');
});

test('a deictic first question is anchored to the selected lesson without rewriting the visible prompt', () => {
  const result = buildAskContext({
    text: '这篇文章怎么备课',
    lessonRef: { title: '《就英法联军远征中国致巴特勒上尉的信》' }
  });
  assert.equal(result.currentQuestion, '这篇文章怎么备课');
  assert.equal(result.identityTitle, '《就英法联军远征中国致巴特勒上尉的信》');
  assert.equal(result.retrievalQuery, '《就英法联军远征中国致巴特勒上尉的信》 这篇文章怎么备课');
  assert.match(result.teachingFocus, /教学重点、课堂主线与学生学习任务/u);
  assert.doesNotMatch(result.stableCoreQuestion, /怎么备课/u);
});

test('resolveTeachingFocus leaves a specific textual question intact', () => {
  const result = resolveTeachingFocus('雨果怎样用反语表达立场？', '《就英法联军远征中国致巴特勒上尉的信》');
  assert.equal(result.deictic, false);
  assert.equal(result.coreQuestion, '雨果怎样用反语表达立场？');
  assert.match(result.retrievalQuery, /^《就英法联军远征中国致巴特勒上尉的信》/u);
});

test('conversation history can append recovery text without changing completed turns', () => {
  const history = buildConversationHistory([
    {
      question: '怎样备课《我爱这土地》？',
      response: {
        understanding: '需要围绕教师用书的教学处理组织课堂。',
        answer: { reply: '先读教师用书，再回到学生教材核对原文。', keyPoints: ['朗读入境'] }
      }
    }
  ], [{ role: 'user', content: '那朗读时先抓哪几个词？' }]);
  assert.equal(history[0].role, 'user');
  assert.match(history[1].content, /先读教师用书/u);
  assert.equal(history.at(-1).content, '那朗读时先抓哪几个词？');
});

test('the live request history contains completed turns only', () => {
  const history = buildConversationHistory([
    {
      question: '怎样备课《我爱这土地》？',
      response: { answer: { reply: '先从土地意象进入。' } }
    }
  ]);
  assert.deepEqual(history.map(item => item.role), ['user', 'assistant']);
  assert.doesNotMatch(history.at(-1).content, /换成两课时/u);
});

test('conversation history keeps exactly the five most recent complete grounded turns', () => {
  const messages = Array.from({ length: 7 }, (_, index) => ({
    question: `第${index + 1}轮问题`,
    response: {
      answer: {
        reply: `第${index + 1}轮回答${index === 6 ? '。'.repeat(2000) : ''}`
      }
    }
  }));

  const history = buildConversationHistory(messages);

  assert.equal(history.length, 10);
  assert.deepEqual(history.filter(item => item.role === 'user').map(item => item.content), [
    '第3轮问题',
    '第4轮问题',
    '第5轮问题',
    '第6轮问题',
    '第7轮问题'
  ]);
  assert.equal(history[0].role, 'user');
  assert.equal(history.at(-1).role, 'assistant');
  assert.match(history.at(-1).content, /^本轮回答：第7轮回答/u);
  assert.equal(history.at(-1).content.length, 1800);
});

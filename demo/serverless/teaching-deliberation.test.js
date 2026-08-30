import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTeachingDeliberation } from './teaching-deliberation.js';

const draft = {
  version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？', lesson_context: { periods: 2 },
  answer: { lesson: { title: '《岳阳楼记》', coreQuestion: '景、情、理怎样推进？' }, summary: '由写景进入价值判断', lessonPlan: [{ title: '比较阴晴两景', content: '先读再比较' }] },
  citations: [{ id: 'citation-1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '若夫淫雨霏霏' }, { id: 'citation-2', documentId: 'teacher-guide', documentType: 'teacher_guide', pdfPage: 224, quote: '比较两种览物之情' }]
};

test('generation keeps model prose but rebinds evidence to server citation ids', async () => {
  const generated = await generateTeachingDeliberation({ draft, complete: async () => JSON.stringify({ decisions: [
    { question: '第一课时收在哪里？', whyItMatters: '影响第二课时起点', recommendedOption: 'A', options: [{ id: 'A', label: '收在写景', approach: '完成阴晴两景比较', tradeoff: '价值讨论后置', evidenceRefs: ['E1', 'evil'] }, { id: 'B', label: '推进景情', approach: '完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E2'] }] },
    { question: '朗读放在哪一层？', whyItMatters: '影响文本体验', recommendedOption: 'B', options: [{ id: 'A', label: '先读后析', approach: '先形成整体感受', tradeoff: '细读起步较慢', evidenceRefs: ['E1'] }, { id: 'B', label: '随析随读', approach: '分析后立即朗读验证', tradeoff: '整体感受较碎', evidenceRefs: ['E2'] }] }
  ] }) });
  assert.equal(generated.decisions.length, 2);
  assert.equal(generated.sourceDraftVersion, 8);
  assert.equal(generated.promptVersion, 1);
  assert.deepEqual(generated.decisions[0].options[0].evidenceRefs, ['citation-1']);
  assert.equal(JSON.stringify(generated).includes('evil'), false);
  assert.equal(generated.decisions[1].recommendedOptionId, 'option-B');
});

test('generation fails closed on malformed or shallow model output', async () => {
  await assert.rejects(() => generateTeachingDeliberation({ draft, complete: async () => '{bad json' }), /deliberation_invalid_response/u);
  await assert.rejects(() => generateTeachingDeliberation({ draft, complete: async () => JSON.stringify({ decisions: [] }) }), /deliberation_invalid_response/u);
});

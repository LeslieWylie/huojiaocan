import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentPromptContext,
  classifyTeachingTurn,
  createSafeAgentRun,
  createTeachingTurnContract,
  groundingQueryFor,
  inspectEvidenceCoverage
} from './teaching-agent-contract.js';

test('teaching turn keeps revision instructions separate from lesson identity', () => {
  const contract = createTeachingTurnContract({
    question: '请换成两课时，并增加朗读支架',
    scope: ['textbook', 'teacher-guide'],
    history: [{ role: 'user', content: '怎样备课？' }],
    lessonIdentity: { title: '《岳阳楼记》', coreQuestion: '作者怎样由览物之情走向忧乐观？' },
    followUpInstruction: '只调整课时与朗读支架',
    operation: { type: 'change_periods', periods: 2 }
  });

  assert.equal(contract.intent, 'plan_revision');
  assert.equal(contract.lessonTitle, '《岳阳楼记》');
  assert.equal(contract.followUpInstruction, '只调整课时与朗读支架');
  assert.deepEqual(contract.requiredSourceTypes, ['teacher_guide', 'textbook']);
});

test('planning turns require every in-scope teaching source before drafting', () => {
  const contract = createTeachingTurnContract({
    question: '这篇课文怎么备课？',
    scope: ['curriculum-standard', 'teacher-guide', 'textbook'],
    lessonIdentity: { title: '《我爱这土地》' }
  });
  const coverage = inspectEvidenceCoverage(contract, [
    { documentType: 'textbook' },
    { documentType: 'teacher-guide' }
  ]);

  assert.equal(classifyTeachingTurn({ question: '这篇课文怎么备课？' }), 'lesson_planning');
  assert.deepEqual(coverage.missing, ['curriculum_standard']);
  assert.equal(coverage.sufficient, false);
  assert.match(groundingQueryFor(contract, '怎样设计课堂？', coverage.missing[0]), /我爱这土地.*课程标准/u);
});

test('agent prompt context exposes boundaries without exposing hidden reasoning', () => {
  const contract = createTeachingTurnContract({
    question: '如何确定教学重点？',
    scope: ['teacher-guide', 'textbook'],
    lessonIdentity: { title: '《岳阳楼记》' }
  });
  const coverage = inspectEvidenceCoverage(contract, [{ documentType: 'teacher_guide' }, { documentType: 'textbook' }]);
  const prompt = buildAgentPromptContext(contract, coverage);
  const run = createSafeAgentRun({
    contract,
    evidence: [{ documentType: 'teacher_guide' }, { documentType: 'textbook' }],
    retrievalTrace: [{ action: 'search' }],
    generationTrace: [{ status: 'completed' }, { status: 'completed' }]
  });

  assert.equal(prompt.fixedLesson.title, '《岳阳楼记》');
  assert.equal(run.status, 'ready_for_teacher_review');
  assert.deepEqual(run.events.map(item => item.stage), ['grounding', 'draft', 'evidence_review', 'teacher_confirmation']);
  assert.doesNotMatch(JSON.stringify(run), /chain.of.thought|思维过程|PageIndex|API/u);
});

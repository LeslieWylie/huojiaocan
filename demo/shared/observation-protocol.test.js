import assert from 'node:assert/strict';
import test from 'node:test';
import { buildObservationProtocol, observationProtocolMarkdown } from './observation-protocol.js';

function confirmedComparison() {
  return {
    status: 'confirmed', sourceKey: 'slc1:verified', lessonTitle: '《岳阳楼记》',
    left: { learning: { focus: ['说明景—情—志之间的关系'] } }, right: { learning: { focus: ['用原文解释价值判断'] } },
    synthesis: { decision: 'needs_more', transferableFinding: '先建立景与情的关系，再进入价值判断。', contextBoundary: '适用于已经完成文意疏通的班级。', nextExperiment: '保持核心问题不变，只调整关系图出现的时机。' }, confirmedAt: '2026-08-27T08:00:00Z'
  };
}

test('builds a printable observation protocol from a teacher-confirmed research proposition', () => {
  const protocol = buildObservationProtocol(confirmedComparison(), { citations: [{ documentId: 'textbook', pdfPage: 56, printedPage: '54' }] }, { citations: [{ documentId: 'teacher-guide', pdfPage: 224 }] });
  assert.equal(protocol.lessonTitle, '《岳阳楼记》');
  assert.equal(protocol.indicators.length, 3);
  assert.equal(protocol.timeWindows.length, 4);
  assert.deepEqual(protocol.references.map(item => `${item.documentId}:${item.pdfPage}`), ['textbook:56', 'teacher-guide:224']);
  assert.match(protocol.privacyNotice, /不填写学生姓名/u);
});

test('refuses to turn an unconfirmed comparison into an observation authority', () => {
  const comparison = confirmedComparison(); comparison.status = 'draft';
  assert.throws(() => buildObservationProtocol(comparison), error => error.code === 'observation_protocol_requires_confirmed_comparison');
});

test('markdown export keeps the classroom record blank and includes verification pages', () => {
  const protocol = buildObservationProtocol(confirmedComparison(), { citations: [{ documentId: 'textbook', pdfPage: 56 }] }, {});
  const markdown = observationProtocolMarkdown(protocol);
  assert.match(markdown, /\| 时间段 \| 课堂事件 \| 学生表现 \| 教师动作 \| 教材原文依据 \|/u);
  assert.match(markdown, /textbook · PDF 第 56 页/u);
  assert.doesNotMatch(markdown, /学生姓名[:：]/u);
});

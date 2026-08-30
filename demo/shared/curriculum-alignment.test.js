import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCurriculumAlignment, normalizeCurriculumCitation } from './curriculum-alignment.js';

const standard = (page, title, excerpt) => ({
  id: `S${page}`,
  documentId: 'curriculum-standard',
  documentType: 'curriculum_standard',
  documentTitle: '义务教育语文课程标准（2022年版）',
  pdfPage: page,
  printedPage: String(page - 7),
  title,
  text: excerpt
});

const groups = {
  stage: [standard(21, '第四学段（7—9年级）', '阅读与鉴赏的学段要求')],
  taskGroup: [standard(33, '文学阅读与创意表达', '发展审美感知和表达能力')],
  quality: [standard(44, '学业质量描述', '学生在真实语言运用情境中的表现')]
};

test('keeps only curriculum-standard sources with a physical PDF page', () => {
  assert.equal(normalizeCurriculumCitation({ documentId: 'teacher-guide', pdfPage: 224 }), null);
  assert.equal(normalizeCurriculumCitation({ documentId: 'curriculum-standard' }), null);
  assert.equal(normalizeCurriculumCitation(groups.stage[0]).pdfPage, 21);
});

test('builds direct stage and quality evidence but keeps lesson-to-task-group mapping as a candidate', () => {
  const report = buildCurriculumAlignment({ lessonTitle: '《岳阳楼记》', resultGroups: groups });
  assert.equal(report.status, 'review');
  assert.equal(report.sections[0].status, 'direct');
  assert.equal(report.sections[1].status, 'candidate');
  assert.equal(report.sections[2].status, 'direct');
  assert.match(report.sections[1].note, /不是课标原话/u);
  assert.deepEqual(report.sections.map(item => item.source.pdfPage), [21, 33, 44]);
});

test('records an explicit teacher decision without pretending it came from the standard', () => {
  const report = buildCurriculumAlignment({ lessonTitle: '《岳阳楼记》', resultGroups: groups, confirmedTaskGroup: '文学阅读与创意表达' });
  assert.equal(report.status, 'confirmed');
  assert.equal(report.sections[1].status, 'confirmed');
  assert.match(report.sections[1].note, /来自教师决定/u);
});

test('never upgrades teacher-guide material into curriculum-standard evidence', () => {
  const report = buildCurriculumAlignment({
    lessonTitle: '《岳阳楼记》',
    resultGroups: { stage: [{ documentId: 'teacher-guide', pdfPage: 224, text: '教学建议' }] }
  });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.sourceCount, 0);
  assert.deepEqual(report.missing, ['stage', 'task-group', 'quality']);
});


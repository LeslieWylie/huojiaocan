import { normalizeSameLessonComparison } from './same-lesson-comparison.js';

const PUBLIC_DOCUMENTS = new Set(['textbook', 'teacher-guide', 'curriculum-standard']);

function text(value, max = 600) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function documentId(value) {
  const id = text(value, 80).toLowerCase().replace(/_/gu, '-');
  if (['student-textbook', 'student-book'].includes(id)) return 'textbook';
  if (['teacher-guidebook', 'guide'].includes(id)) return 'teacher-guide';
  if (['curriculum', 'standard', 'course-standard'].includes(id)) return 'curriculum-standard';
  return id;
}

function referencesFrom(drafts) {
  const seen = new Set();
  const items = [];
  for (const draft of drafts) {
    for (const citation of Array.isArray(draft?.citations) ? draft.citations : []) {
      const id = documentId(citation?.documentId || citation?.document_id || citation?.documentType);
      const pdfPage = Math.floor(Number(citation?.pdfPage ?? citation?.pdf_page));
      const key = `${id}:${pdfPage}`;
      if (!PUBLIC_DOCUMENTS.has(id) || !Number.isInteger(pdfPage) || pdfPage < 1 || seen.has(key)) continue;
      seen.add(key);
      items.push({ documentId: id, pdfPage, printedPage: text(citation?.printedPage || citation?.printed_page, 40), title: text(citation?.title || citation?.sectionTitle, 160) });
    }
  }
  return items.slice(0, 6);
}

function indicator(id, title, watchFor, source) {
  return { id, title: text(title, 100), watchFor: text(watchFor, 420), source: text(source, 80) };
}

export function buildObservationProtocol(comparisonValue, leftDraft = {}, rightDraft = {}) {
  const comparison = normalizeSameLessonComparison(comparisonValue);
  if (comparison.status !== 'confirmed') {
    throw Object.assign(new Error('observation_protocol_requires_confirmed_comparison'), { code: 'observation_protocol_requires_confirmed_comparison', status: 409 });
  }
  const focus = [...new Set([
    ...(comparison.left?.learning?.focus || []),
    ...(comparison.right?.learning?.focus || [])
  ].map(item => text(item, 280)).filter(Boolean))];
  const indicators = [
    indicator('original-evidence', '原文依据', '学生是否主动回到教材原文，并指出支撑自己判断的具体词句。', '学生教材'),
    indicator('learning-expression', '学习表现', focus[0] || '学生能否用完整语言说明文本发现、关键依据和自己的判断之间的关系。', '两次课堂记录'),
    indicator('independent-transfer', '独立完成', comparison.synthesis.nextExperiment || '学生能否在减少教师提示后，独立完成同一核心学习任务。', '下一次验证')
  ];
  return {
    version: 1,
    sourceKey: `op1:${comparison.sourceKey}`,
    lessonTitle: comparison.lessonTitle,
    researchQuestion: comparison.synthesis.transferableFinding,
    contextBoundary: comparison.synthesis.contextBoundary,
    keepConstant: '保持篇目、核心问题、教材范围和学习表现观察口径不变。',
    changeVariable: comparison.synthesis.nextExperiment,
    indicators,
    timeWindows: [
      { id: 'opening', label: '导入与任务建立', time: '0—10 分钟' },
      { id: 'evidence', label: '原文发现与依据形成', time: '10—25 分钟' },
      { id: 'reasoning', label: '关系建构与表达', time: '25—40 分钟' },
      { id: 'closing', label: '独立完成与课堂收束', time: '40 分钟—结束' }
    ],
    references: referencesFrom([leftDraft, rightDraft]),
    privacyNotice: '只记录课堂事件和班级层面的学习表现，不填写学生姓名、学号、座位号或逐人分数。',
    generatedAt: new Date().toISOString()
  };
}

export function observationProtocolMarkdown(value = {}) {
  const indicators = Array.isArray(value.indicators) ? value.indicators : [];
  const windows = Array.isArray(value.timeWindows) ? value.timeWindows : [];
  const references = Array.isArray(value.references) ? value.references : [];
  return [
    `# ${text(value.lessonTitle, 180)}｜听评课观察单`,
    '',
    '## 本次教研命题',
    text(value.researchQuestion),
    '',
    `- **保持不变：** ${text(value.keepConstant)}`,
    `- **本次只改变：** ${text(value.changeVariable)}`,
    `- **适用边界：** ${text(value.contextBoundary)}`,
    '',
    '## 观察指标',
    ...indicators.map((item, index) => `${index + 1}. **${text(item.title, 100)}**：${text(item.watchFor)}`),
    '',
    '## 课堂观察记录',
    '| 时间段 | 课堂事件 | 学生表现 | 教师动作 | 教材原文依据 |',
    '|---|---|---|---|---|',
    ...windows.map(item => `| ${text(item.time)} ${text(item.label)} |  |  |  |  |`),
    '',
    '## 课后判断',
    '- 哪一条观察支持当前命题：',
    '- 哪一条观察与预期不一致：',
    '- 下一次只保留或改变什么：',
    '',
    '## 核验页面',
    ...(references.length ? references.map(item => `- ${item.documentId} · PDF 第 ${item.pdfPage} 页${item.printedPage ? ` · 印刷页 ${item.printedPage}` : ''}`) : ['- 本次观察单没有绑定可核验页面，请回到原方案补充教材依据。']),
    '',
    `> ${text(value.privacyNotice)}`
  ].join('\n');
}

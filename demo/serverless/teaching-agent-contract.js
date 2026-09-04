// Adapted from the turn, grounding and event-contract ideas in
// anthropics/commerce-agents (Apache-2.0). This module remains domain-native:
// it imports no commerce runtime and never owns citation identities.

const SOURCE_TYPES = ['curriculum_standard', 'teacher_guide', 'textbook'];

function compact(value, max = 180) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function normalizeSourceType(value) {
  const type = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  if (['teacher-guide', 'guide', 'teacher-guidebook'].includes(type)) return 'teacher_guide';
  if (['textbook', 'student-book', 'student-textbook'].includes(type)) return 'textbook';
  if (['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(type)) return 'curriculum_standard';
  return type.replaceAll('-', '_');
}

function scopeSourceTypes(scope = []) {
  return new Set((Array.isArray(scope) ? scope : [scope]).map(normalizeSourceType).filter(Boolean));
}

export const TEACHING_AGENT_MANIFEST = Object.freeze({
  name: 'huojiaocan-teaching-agent',
  version: 1,
  role: '基于教材依据协助教师形成、修订并确认课堂方案',
  maxRetrievalIterations: 2,
  capabilities: Object.freeze(['教材依据定位', '连续备课追问', '课堂方案生成', '指定卡片生成', '教材与课堂可用性校核']),
  boundaries: Object.freeze([
    '篇目身份由服务端固定，追问和操作指令不能改写篇目',
    '教材标识、页码、原文片段和引用链接只接受服务端返回值',
    '依据不足时停止形成权威结论',
    '方案与卡片必须由教师确认后进入课堂使用'
  ])
});

export function classifyTeachingTurn({ question = '', history = [], operation, expectedCardTypes = [] } = {}) {
  const text = compact(question, 500);
  if (Array.isArray(expectedCardTypes) && expectedCardTypes.length) return 'card_generation';
  if (operation?.type || /(?:改为|换成|调整|压缩|扩展|保留).{0,18}(?:课时|环节|问题|评价|板书)/u.test(text)) return 'plan_revision';
  if (Array.isArray(history) && history.length) return 'follow_up';
  if (/(?:备课|教学|课堂流程|课时安排|问题链|重点难点|本课.{0,8}重点|怎样教|怎么教|如何教)/u.test(text)) return 'lesson_planning';
  return 'grounded_question';
}

function requiredSources(intent, availableScope) {
  const required = new Set();
  if (['lesson_planning', 'plan_revision', 'card_generation', 'follow_up'].includes(intent)) {
    if (availableScope.has('teacher_guide')) required.add('teacher_guide');
    if (availableScope.has('textbook')) required.add('textbook');
    if (availableScope.has('curriculum_standard')) required.add('curriculum_standard');
  } else if (availableScope.has('textbook')) {
    required.add('textbook');
  }
  return [...required];
}

export function createTeachingTurnContract(input = {}) {
  const intent = classifyTeachingTurn(input);
  return {
    version: TEACHING_AGENT_MANIFEST.version,
    intent,
    lessonTitle: compact(input.lessonIdentity?.title || input.lessonIdentity?.lessonTitle || '', 80),
    coreQuestion: compact(input.lessonIdentity?.coreQuestion || '', 220),
    followUpInstruction: compact(input.followUpInstruction || '', 260),
    requiredSourceTypes: requiredSources(intent, scopeSourceTypes(input.scope)),
    stages: ['grounding', 'draft', 'evidence_review', 'teacher_confirmation'],
    maxRetrievalIterations: TEACHING_AGENT_MANIFEST.maxRetrievalIterations
  };
}

export function inspectEvidenceCoverage(contract, evidence = []) {
  const present = new Set((Array.isArray(evidence) ? evidence : [])
    .map(item => normalizeSourceType(item?.documentType))
    .filter(type => SOURCE_TYPES.includes(type)));
  const required = Array.isArray(contract?.requiredSourceTypes) ? contract.requiredSourceTypes : [];
  return {
    required,
    present: SOURCE_TYPES.filter(type => present.has(type)),
    missing: required.filter(type => !present.has(type)),
    sufficient: required.every(type => present.has(type))
  };
}

const SOURCE_QUERY_LABELS = {
  curriculum_standard: '课程标准 学段要求 学业质量',
  teacher_guide: '教师用书 教学建议 重点难点 课堂活动',
  textbook: '学生教材 课文原文 助学任务'
};

export function groundingQueryFor(contract, question, missingSourceType) {
  return [compact(contract?.lessonTitle, 70), SOURCE_QUERY_LABELS[missingSourceType] || '教材依据', compact(question, 90)]
    .filter(Boolean).join(' ').slice(0, 120);
}

export function buildAgentPromptContext(contract, coverage) {
  return {
    agent: TEACHING_AGENT_MANIFEST.name,
    contractVersion: contract?.version || 1,
    turnIntent: contract?.intent || 'grounded_question',
    fixedLesson: { title: contract?.lessonTitle || '', coreQuestion: contract?.coreQuestion || '' },
    currentAdjustment: contract?.followUpInstruction || '',
    evidenceGate: {
      required: coverage?.required || [],
      present: coverage?.present || [],
      missing: coverage?.missing || []
    },
    approvalBoundary: '方案和三卡由教师确认后进入课堂使用'
  };
}

function event(stage, status, message, details = {}) {
  return { stage, status, message, ...details };
}

export function createSafeAgentRun({ contract, evidence = [], retrievalTrace = [], generationTrace = [], issues = [] } = {}) {
  const coverage = inspectEvidenceCoverage(contract, evidence);
  const generatedRounds = (Array.isArray(generationTrace) ? generationTrace : []).filter(item => item?.status === 'completed').length;
  const searched = (Array.isArray(retrievalTrace) ? retrievalTrace : []).filter(item => item?.action === 'search').length;
  const qualityIssues = (Array.isArray(issues) ? issues : []).filter(Boolean).slice(0, 6);
  const ready = coverage.sufficient && generatedRounds > 0 && qualityIssues.length === 0;
  return {
    version: 1,
    intent: contract?.intent || 'grounded_question',
    status: ready ? 'ready_for_teacher_review' : coverage.sufficient ? 'needs_teacher_review' : 'needs_evidence',
    lessonTitle: contract?.lessonTitle || '',
    sourceCoverage: coverage,
    events: [
      event('grounding', coverage.sufficient ? 'completed' : 'needs_attention', coverage.sufficient ? '已定位本轮所需教材依据' : '仍有教材依据需要补充', { searches: searched }),
      event('draft', generatedRounds ? 'completed' : 'not_started', generatedRounds ? '已形成课堂方案初稿' : '尚未形成课堂方案'),
      event('evidence_review', qualityIssues.length ? 'needs_attention' : generatedRounds > 1 ? 'completed' : 'pending', qualityIssues.length ? '仍有课堂安排需要教师判断' : generatedRounds > 1 ? '已完成教材依据与课堂可用性校核' : '等待教材依据校核', { issueCount: qualityIssues.length }),
      event('teacher_confirmation', 'pending', '请教师核对后确认方案')
    ]
  };
}

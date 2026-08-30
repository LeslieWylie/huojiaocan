function norm(value) { return String(value || '').trim().toLowerCase().replaceAll('_', '-'); }

export function sourceRole(value = {}) {
  const raw = norm(value.documentType || value.sourceType || value.type || value.documentId);
  if (raw.includes('课程标准') || raw.includes('课程方案') || raw.includes('义务教育课程') || raw.includes('curriculum') || raw.includes('standard') || raw.includes('课标')) return 'curriculumStandard';
  if (raw.includes('teacher-guide') || raw.includes('teacher-guidebook') || raw === 'guide') return 'teacherGuide';
  if (raw.includes('textbook') || raw.includes('student-book')) return 'textbook';
  return 'other';
}

export function deriveSourceCoverage(citations = []) {
  const items = Array.isArray(citations) ? citations : [];
  const coverage = { textbook: false, teacherGuide: false, curriculumStandard: false };
  items.forEach(item => { const role = sourceRole(item); if (role in coverage) coverage[role] = true; });
  const missing = [];
  if (!coverage.textbook) missing.push('学生教材');
  if (!coverage.teacherGuide) missing.push('教师用书');
  if (!coverage.curriculumStandard) missing.push('课程标准材料');
  return {
    ...coverage,
    missing,
    label: missing.length ? `已覆盖 ${3 - missing.length}/3 类材料` : '三类材料均已覆盖',
    complete: missing.length === 0
  };
}

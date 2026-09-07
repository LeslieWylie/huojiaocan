// Safe execution facts, never model-authored success or free-form error text.
export function requiresSourceRead(question = '', instruction = '') {
  const text = [question, instruction].join(' ');
  if (/[“「][^”」]+[”」].{0,30}(?:谁|描写对象|比较|含义)/u.test(text)) return true;
  return /原文|原句|引文|主语|纠错|引用.{0,8}(?:正确|准确|错误)|(?:这句|这句话).{0,8}(?:谁|意思|对不对)|段落比较/u.test(text);
}
export function hasSourceRead(evidence = []) {
  return evidence.some(item => item?.readMode === 'full_page' && String(item.text || '').trim()
    && item.documentId && Number.isSafeInteger(Number(item.pdfPage)) && Number(item.pdfPage) > 0
    && item.qualityStatus !== 'failed');
}
export function retrievalExecution({ evidence = [], required = false, coverage, stopReason, counts = {} } = {}) {
  const originalRead = hasSourceRead(evidence);
  const usable = evidence.length > 0 && (!required || originalRead);
  const complete = usable && coverage?.sufficient !== false && !stopReason;
  return {
    status: complete ? 'completed' : usable ? 'partial' : 'needs_evidence',
    stopReason: stopReason || (complete ? 'evidence_ready' : 'insufficient_evidence'),
    sourceReadRequired: required, sourceReadCompleted: originalRead,
    counts: { searches: counts.searches || 0, reads: counts.reads || 0, modelTurns: counts.modelTurns || 0 }
  };
}
export function reviewExecution(trace = [], issues = []) {
  const reviews = trace.slice(1);
  const final = reviews.at(-1);
  const complete = final?.status === 'completed' && !issues.length;
  return {
    status: complete ? 'completed' : 'partial',
    stopReason: complete ? 'checks_completed' : issues.length ? 'review_required'
      : final?.status === 'skipped_deadline' ? 'timeout'
      : final?.status?.startsWith('fallback_') ? 'model_error' : 'review_incomplete',
    counts: { roundsAttempted: trace.filter(item => item.status !== 'skipped_deadline').length,
      roundsCompleted: trace.filter(item => item.status === 'completed').length }
  };
}

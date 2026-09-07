const STAGES = [
  ['grounding', '查找教材依据'],
  ['draft', '整理本轮回答'],
  ['evidence_review', '核对课堂安排'],
  ['teacher_confirmation', '教师确认']
];
const STATUS = { completed: '已完成', needs_attention: '需核对', pending: '待确认', not_started: '未完成' };

// Display only explicit server events. Missing telemetry is not a completed action.
export function agentPresentation(response = {}) {
  const events = Array.isArray(response.agentRun?.events) ? response.agentRun.events : [];
  const steps = STAGES.flatMap(([stage, label]) => {
    const event = events.find(item => item?.stage === stage);
    if (!event || !STATUS[event.status]) return [];
    return [{ stage, label, status: event.status, statusLabel: stage === 'evidence_review' && event.status === 'pending' ? '未完成' : STATUS[event.status] }];
  });
  const execution = response.agentRun?.execution;
  const attention = steps.some(step => step.status === 'needs_attention')
    || Boolean(execution?.review && execution.review.status !== 'completed')
    || Boolean(execution?.retrieval && execution.retrieval.status !== 'completed');
  const incompleteReview = execution?.review && execution.review.status !== 'completed';
  return {
    steps, attention,
    notices: [execution?.retrieval && ({
      timeout: '教材查阅达到本轮时间上限，已取得的材料仍保留。',
      budget_exhausted: '本轮教材查阅次数已用完，未继续扩大搜索。',
      tool_error: '部分教材暂时未能读取，已取得的材料仍保留。',
      model_error: '补充查阅未完成，请核对已有教材依据。',
      access_denied: '部分材料或连接当前不可用，请检查所选材料和连接。',
      insufficient_evidence: '尚缺少支撑当前问题的教材依据。'
    })[execution.retrieval.stopReason]].filter(Boolean),
    title: attention ? '回答已返回，部分内容需要核对' : '回答已返回，请结合教材确认',
    detail: incompleteReview ? '本轮回答已保留，但审校未完成。请核对教材依据与课堂安排后再采用。' : attention ? '请先查看下方缺少的教材依据或课堂安排提示，再决定是否采用。'
      : '先阅读本轮建议；需要调整时直接追问，确认后再进入课堂设计。'
  };
}

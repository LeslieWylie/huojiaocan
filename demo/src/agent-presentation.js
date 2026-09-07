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
    return [{ stage, label, status: event.status, statusLabel: STATUS[event.status] }];
  });
  const attention = steps.some(step => step.status === 'needs_attention');
  return {
    steps, attention,
    title: attention ? '回答已返回，部分内容需要核对' : '回答已返回，请结合教材确认',
    detail: attention ? '请先查看下方缺少的教材依据或课堂安排提示，再决定是否采用。'
      : '先阅读本轮建议；需要调整时直接追问，确认后再进入课堂设计。'
  };
}

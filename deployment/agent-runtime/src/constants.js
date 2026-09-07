export const REQUEST_STATUSES = [
  'queued',
  'retrieving',
  'composing',
  'checking',
  'ready_to_save',
  'saved',
  'needs_evidence',
  'needs_input',
  'interrupted',
  'failed',
  'cancelled'
];

export const TERMINAL_REQUEST_STATUSES = new Set([
  'saved', 'needs_evidence', 'needs_input', 'interrupted', 'failed', 'cancelled'
]);

export const RUNNING_REQUEST_STATUSES = new Set(['retrieving', 'composing', 'checking']);

export const DEFAULT_RUNTIME_LIMITS = Object.freeze({
  leaseTtlMs: 90_000,
  heartbeatMs: 20_000,
  maxAttempts: 3,
  deadlineMs: 120_000,
  eventPageSize: 200
});

export const PUBLIC_PHASE_COPY = Object.freeze({
  queued: '已加入队列',
  retrieving: '正在核对教材依据',
  composing: '正在整理课堂方案',
  checking: '正在检查引用和结构',
  ready_to_save: '方案已生成，等待保存',
  saved: '方案已保存',
  needs_evidence: '还需要补充教材依据',
  needs_input: '需要教师补充信息',
  interrupted: '执行已中断，可重新提交',
  failed: '本轮处理失败',
  cancelled: '已取消'
});

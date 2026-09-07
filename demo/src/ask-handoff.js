// Login restores state; only an explicitly submitted, unanswered action may resume.
export function resolveAskHandoff({ recovery, urlQuestion = '', isClassAdaptation = false, localConversation, canResumeLocal = false, hasMessages = false }) {
  const explicitQuestion = isClassAdaptation ? '' : urlQuestion;
  if (recovery) {
    return {
      composerText: typeof recovery.question === 'string' ? recovery.question : '',
      autoSubmit: !isClassAdaptation && recovery.resumeSubmittedQuestion && !recovery.accountSaveFailed
        ? recovery.pendingAction || recovery.question || '' : ''
    };
  }
  return {
    composerText: canResumeLocal && typeof localConversation?.composerText === 'string'
      ? localConversation.composerText
      : explicitQuestion || (hasMessages ? '' : canResumeLocal ? localConversation?.question || '' : ''),
    autoSubmit: explicitQuestion
  };
}

export function submissionHandoff(text, action, answered = false) {
  return {
    question: answered ? '' : text,
    resumeSubmittedQuestion: !answered,
    pendingAction: !answered && action && typeof action === 'object' ? action : null,
    accountSaveFailed: answered
  };
}

export const LOCAL_SAVE_FAILURE = '本机保存失败，刷新或关闭页面可能丢失未保存的文字和回答。请先复制文字或导出记录，再尝试继续。';
export const ACCOUNT_SAVE_FAILURE = '回答已经生成，但暂时没有保存到账号。请先导出记录；不要重复提问，以免重新生成回答。';

// Both stores retain at most 12 turns. Equal lengths do not imply equal
// freshness: the account's last turn can precede the browser's unsaved tail.
export function recoveredTurnsAreAhead(recovered = [], saved = []) {
  if (!recovered.length) return false;
  if (!saved.length) return true;
  const key = turn => JSON.stringify([turn.question, turn.response?.answer, turn.response?.citations]);
  const savedTail = key(saved.at(-1));
  if (key(recovered.at(-1)) === savedTail) return false;
  return recovered.slice(0, -1).some(turn => key(turn) === savedTail)
    || recovered.length > saved.length;
}

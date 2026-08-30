export const TEACHING_TASK_PHASES = Object.freeze({
  CONTINUE_PREPARATION: 'continue_preparation',
  CONFIRM_PLAN: 'confirm_plan',
  GENERATE_CARDS: 'generate_cards',
  ENTER_CLASSROOM: 'enter_classroom',
  CONFIRM_REFLECTION: 'confirm_reflection',
  PROCESS_HOMEWORK_RETURN: 'process_homework_return',
  CONTINUE_NEXT_LESSON: 'continue_next_lesson',
  COMPLETED: 'completed'
});

const PRIORITY = Object.freeze({
  CONFIRM_REFLECTION: 10,
  ACTIVE_CLASSROOM: 20,
  CARRYOVER: 30,
  HOMEWORK_RETURN: 40,
  CONFIRM_PLAN: 50,
  GENERATE_CARDS: 60,
  ENTER_CLASSROOM: 65,
  CONTINUE_PREPARATION: 70,
  CONTINUE_NEXT_LESSON: 80,
  COMPLETED: 100
});

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function idOf(value) {
  return String(value?.id ?? value?.draftId ?? '').trim();
}

function answerOf(draft, asset) {
  return {
    ...object(asset?.content?.answer),
    ...object(draft?.answer)
  };
}

function cardsOf(draft, asset) {
  if (Array.isArray(draft?.cards)) return draft.cards;
  if (Array.isArray(asset?.content?.cards)) return asset.content.cards;
  return [];
}

function confirmedPlan(answer, cards, asset) {
  const approval = answer.planApproval ?? answer.teacherFinalization ?? answer.planConfirmation;
  if (approval === true) return true;
  if (approval && typeof approval === 'object') {
    return approval.hasUnconfirmedChanges !== true && (
      approval.status === 'confirmed'
      || Boolean(approval.confirmedAt || approval.confirmed_at)
    );
  }
  if (asset?.teacherConfirmed === true) return true;
  // Before planApproval existed, persisted classroom cards were the only
  // durable signal that a draft had crossed the teacher-confirmation gate.
  return approval == null && cards.length > 0;
}

function hasApprovalContract(answer) {
  return answer.planApproval != null
    || answer.teacherFinalization != null
    || answer.planConfirmation != null;
}

function hasReflection(answer, asset) {
  if (asset?.hasReflection === true) return true;
  const reflection = object(answer.lessonReflection || answer.teachingFeedback);
  return [
    reflection.observedLearning ?? reflection.classResponse,
    reflection.unresolvedLearning ?? reflection.unfinishedQuestions,
    reflection.pacingNotes ?? reflection.timeManagement,
    reflection.nextLessonAdjustment ?? reflection.nextStep,
    reflection.cardUsage ?? reflection.usedCards
  ].some(value => Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0);
}

function activeCarryover(answer) {
  const carryover = object(answer.previousLessonCarryover);
  return list(carryover.items).some(item => item?.status !== 'done');
}

function classroomStatus(answer, asset) {
  return String(answer.classroomRun?.status || asset?.classroomStatus || 'idle');
}

function homeworkState(answer) {
  const pack = object(answer.layeredHomework);
  const review = object(answer.homeworkReview);
  return {
    hasPack: Boolean(pack.sourceKey || list(pack.tasks).length || pack.status),
    packConfirmed: pack.status === 'confirmed',
    hasReview: Boolean(review.sourceKey || review.taskId || review.responseCount || review.status),
    reviewConfirmed: review.status === 'confirmed'
  };
}

function href(path, draftId, suffix = '') {
  return `${path}?draftId=${encodeURIComponent(draftId)}${suffix}`;
}

function task(phase, priority, title, description, hrefValue, actionLabel, draftId) {
  return { phase, priority, title, description, href: hrefValue, actionLabel, draftId };
}

function nextTask(draft, asset, successorIds) {
  const draftId = idOf(draft) || idOf(asset);
  const answer = answerOf(draft, asset);
  const cards = cardsOf(draft, asset);
  const classroom = classroomStatus(answer, asset);
  const reflected = hasReflection(answer, asset);
  const homework = homeworkState(answer);
  const hasSuccessor = successorIds.has(draftId);
  const lessonTitle = String(draft?.title || asset?.title || draft?.question || '这节课').trim();

  if (classroom === 'pending_review') {
    return task(TEACHING_TASK_PHASES.CONFIRM_REFLECTION, PRIORITY.CONFIRM_REFLECTION, '确认复盘', `${lessonTitle}的课堂记录已结束，需由教师核对并保存课后复盘。`, href('/reflection/', draftId), '确认课后复盘', draftId);
  }

  if (classroom === 'in_progress') {
    return task(TEACHING_TASK_PHASES.ENTER_CLASSROOM, PRIORITY.ACTIVE_CLASSROOM, '进入课堂', `${lessonTitle}正在进行，继续记录课堂阶段、关键词和真实课堂时刻。`, href('/cards/', draftId, '&classroom=1'), '继续本节课堂', draftId);
  }

  if (activeCarryover(answer)) {
    return task(TEACHING_TASK_PHASES.CONTINUE_PREPARATION, PRIORITY.CARRYOVER, '继续备课', `${lessonTitle}仍有上一课明确留下的接力事项，先在本课逐项处理。`, href('/ask/', draftId), '处理接力事项', draftId);
  }

  if (classroom === 'confirmed' && !reflected) {
    return task(TEACHING_TASK_PHASES.CONFIRM_REFLECTION, PRIORITY.CONFIRM_REFLECTION, '确认复盘', `${lessonTitle}已有确认的课堂记录，但还没有形成课后复盘。`, href('/reflection/', draftId), '补充课后复盘', draftId);
  }

  if (reflected || classroom === 'confirmed') {
    if ((homework.hasPack || homework.hasReview) && !homework.reviewConfirmed) {
      const actionLabel = homework.packConfirmed ? '处理作业回流' : '完成作业并回流';
      const target = homework.packConfirmed ? '/marking/' : '/homework/';
      return task(TEACHING_TASK_PHASES.PROCESS_HOMEWORK_RETURN, PRIORITY.HOMEWORK_RETURN, '处理作业回流', `${lessonTitle}已完成课堂复盘，继续把分层作业的班级结果整理为教师确认的判断。`, href(target, draftId), actionLabel, draftId);
    }
    if (hasSuccessor || answer.unitContinuity?.nextLessonTitle === '' || asset?.status === 'completed') {
      return task(TEACHING_TASK_PHASES.COMPLETED, PRIORITY.COMPLETED, '已完成', `${lessonTitle}的备课、课堂与课后承接已经闭合。`, href('/cards/', draftId), '查看本课记录', draftId);
    }
    return task(TEACHING_TASK_PHASES.CONTINUE_NEXT_LESSON, PRIORITY.CONTINUE_NEXT_LESSON, '继续下一课', `${lessonTitle}已形成课后结论，可以把已确认的学情带入下一课。`, href('/reflection/', draftId), '继续下一课', draftId);
  }

  const approved = confirmedPlan(answer, cards, asset);
  if (!approved && hasApprovalContract(answer)) {
    return task(TEACHING_TASK_PHASES.CONFIRM_PLAN, PRIORITY.CONFIRM_PLAN, '确认方案', `${lessonTitle}已有待教师确认的方案或修改，确认后才能生成课堂卡。`, href('/cards/', draftId), '确认教学方案', draftId);
  }

  if (approved && cards.length === 0 && asset?.cardsGenerated !== true) {
    return task(TEACHING_TASK_PHASES.GENERATE_CARDS, PRIORITY.GENERATE_CARDS, '生成三卡', `${lessonTitle}的教学方案已确认，下一步生成板书卡、提问卡和评价卡。`, href('/cards/', draftId), '生成一课三卡', draftId);
  }

  if (cards.length > 0 || asset?.cardsGenerated === true) {
    const locked = cards.some(card => card?.status === 'locked') || Number(asset?.lockedCardsCount || 0) > 0;
    return task(TEACHING_TASK_PHASES.ENTER_CLASSROOM, PRIORITY.ENTER_CLASSROOM, '进入课堂', locked ? `${lessonTitle}已有教师锁定的课堂卡，可以直接进入课堂使用。` : `${lessonTitle}已有一课三卡，核对后进入课堂使用。`, href('/cards/', draftId, '&classroom=1'), '进入课堂', draftId);
  }

  return task(TEACHING_TASK_PHASES.CONTINUE_PREPARATION, PRIORITY.CONTINUE_PREPARATION, '继续备课', `${lessonTitle}仍在备课阶段，继续核对材料并完善教学方案。`, href('/ask/', draftId), '继续备课', draftId);
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function safeUpdatedAt(value) {
  return timestamp(value) === Number.NEGATIVE_INFINITY ? null : String(value);
}

/**
 * Derive one next-step task per draft. Lower priority numbers are more
 * blocking; tasks with the same priority are ordered by most recent update.
 */
export function deriveTeachingTasks(draftsOrInput = [], optionalAssets = []) {
  const input = Array.isArray(draftsOrInput) ? null : object(draftsOrInput);
  const drafts = list(input ? input.drafts : draftsOrInput);
  const assets = list(input ? input.assets : optionalAssets);
  const assetByDraftId = new Map(assets.map(asset => [idOf(asset), asset]).filter(([id]) => id));
  const draftById = new Map(drafts.map(draft => [idOf(draft), draft]).filter(([id]) => id));
  const sources = [
    ...drafts.filter(draft => idOf(draft)).map(draft => ({ draft, asset: assetByDraftId.get(idOf(draft)) })),
    ...assets.filter(asset => idOf(asset) && !draftById.has(idOf(asset))).map(asset => ({ draft: null, asset }))
  ];
  const successorIds = new Set(drafts.map(draft => String(draft?.answer?.unitContinuity?.sourceDraftId || '').trim()).filter(Boolean));

  return sources.map((source, index) => {
    const derived = nextTask(source.draft, source.asset, successorIds);
    const updatedAt = source.draft?.updated_at || source.draft?.updatedAt || source.asset?.updatedAt || source.asset?.updated_at || null;
    const lessonTitle = String(source.draft?.title || source.asset?.title || source.draft?.question || '当前方案').trim();
    return { derived, updatedAt, lessonTitle, index };
  }).sort((left, right) => left.derived.priority - right.derived.priority
    || timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || left.index - right.index
  ).map(item => ({ ...item.derived, lessonTitle: item.lessonTitle, updatedAt: safeUpdatedAt(item.updatedAt) }));
}

export const deriveTeachingTaskFlow = deriveTeachingTasks;
export default deriveTeachingTasks;

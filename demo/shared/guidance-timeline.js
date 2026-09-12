// Published v2 media only. Replace this table together with the recorded video;
// future shot plans with unknown timings must never be imported here.
export const GUIDANCE_CHAPTERS = [
  { start: 0, end: 10, title: '选定篇目', action: '打开教材库', href: '/library/', cue: '在目录中找到课文，打开对应教材页。', caption: '先从教材目录选定课文，确认篇目和原始页码。' },
  { start: 10, end: 20, title: '核对课程标准', action: '打开课标对齐', href: '/alignment/', cue: '先核对篇目相关的课标原页；已有方案时可保存教师选择。', caption: '核对课程标准，再判断哪些学段要求适用于这一课。' },
  { start: 20, end: 30, title: '读教师用书', action: '查看教师用书', href: '/library/?doc=teacher-guide', cue: '查找教学目标、重点难点和活动建议。', caption: '读教师用书，找出教学目标、重点难点和活动建议。' },
  { start: 30, end: 40, title: '回到学生教材', action: '核对课文原页', href: '/library/?doc=textbook', cue: '核对原文、页码和学生需要完成的任务。', caption: '回到学生教材，核对原文、页码与学习任务。' },
  { start: 40, end: 50, title: '连续追问', action: '进入备课问答', href: '/ask/', cue: '在同一方案中追问，修改后保存。', caption: '在同一课里连续追问，调整条件后重新整理方案。' },
  { start: 50, end: 60, title: '生成课堂材料', action: '打开一课三卡', href: '/cards/', cue: '确认方案后生成三卡，编辑并保存。', caption: '先核对方案，教师确认后再生成、编辑和保存课堂材料。' }
];

export const GUIDANCE_DURATION = GUIDANCE_CHAPTERS.at(-1).end;

export function guidanceChapterAtTime(seconds) {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return GUIDANCE_CHAPTERS.reduce((active, item, index) => time >= item.start ? index : active, 0);
}

export function formatGuidanceTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function vttTime(seconds) {
  const total = Math.round(seconds * 1000);
  return `${String(Math.floor(total / 3600000)).padStart(2, '0')}:${String(Math.floor(total / 60000) % 60).padStart(2, '0')}:${String(Math.floor(total / 1000) % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

export function guidanceVtt() {
  let previousEnd = 0;
  for (const chapter of GUIDANCE_CHAPTERS) {
    if (!Number.isFinite(chapter.start) || !Number.isFinite(chapter.end)
        || chapter.start !== previousEnd || chapter.end <= chapter.start || !chapter.caption) {
      throw new Error('Guidance timings must cover the published video without gaps or overlaps');
    }
    previousEnd = chapter.end;
  }
  return 'WEBVTT\n\n' + GUIDANCE_CHAPTERS.map((item, index) =>
    `${index + 1}\n${vttTime(item.start)} --> ${vttTime(item.end)}\n${item.caption}\n`).join('\n');
}

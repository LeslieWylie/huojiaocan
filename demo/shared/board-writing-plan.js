const MAX_ITEM_CHARS = 16;
const MAX_TOTAL_CHARS = 84;

function text(value, limit = 120) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

export function chalkCharacterCount(value) {
  return Array.from(text(value).replace(/[\s，。！？、；：,.!?;:（）()《》“”‘’—→←↔·_\-]/gu, '')).length;
}

function secondsFor(value, fixed = 0) {
  return Math.max(0, Math.round(chalkCharacterCount(value) * 1.35 + fixed));
}

export function buildBoardWritingPlan({ title = '', coreQuestion = '', items = [], blankZones = [] } = {}) {
  const safeTitle = text(title, 32) || '本课课题';
  const safeQuestion = text(coreQuestion, 80) || '本课核心问题';
  const safeItems = (Array.isArray(items) ? items : [])
    .map((item, index) => ({ id: String(item?.id || `board-item-${index + 1}`), text: text(item?.text, 80), index }))
    .filter(item => item.text)
    .slice(0, 9);
  const safeBlanks = (Array.isArray(blankZones) ? blankZones : [])
    .map(item => text(item?.label || item?.title || item, 24))
    .filter(Boolean)
    .slice(0, 3);

  const titleChars = chalkCharacterCount(safeTitle);
  const questionChars = chalkCharacterCount(safeQuestion);
  const itemChars = safeItems.map(item => chalkCharacterCount(item.text));
  // 核心问题超过 24 字时，课堂上建议口头完整提出，只在黑板上写“核心问题：____”。
  const writtenQuestion = questionChars > 24 ? '核心问题：________' : safeQuestion;
  const writtenItems = safeItems.map((item, index) => ({ ...item, order: index + 1, chars: itemChars[index] }));
  const totalChars = titleChars + chalkCharacterCount(writtenQuestion) + itemChars.reduce((sum, value) => sum + value, 0) + 18;
  const estimatedSeconds = secondsFor(safeTitle, 4)
    + secondsFor(writtenQuestion, 4)
    + itemChars.reduce((sum, value) => sum + Math.round(value * 1.35 + 2), 0)
    + 20;
  const issues = [];
  if (safeItems.length < 3) issues.push('板书主线不足 3 条，课堂上可能难以形成清晰结构。');
  if (safeItems.length > 6) issues.push('板书要点超过 6 条，建议删去解释句，只保留结构词。');
  const longItems = writtenItems.filter(item => item.chars > MAX_ITEM_CHARS);
  if (longItems.length) issues.push(`有 ${longItems.length} 条内容超过 16 个可写字符，建议改成关键词或短语。`);
  if (totalChars > MAX_TOTAL_CHARS) issues.push('整块板书文字偏多，投影好看但黑板书写会占用过多课堂时间。');
  if (questionChars > 24) issues.push('核心问题较长：完整问题口头提出，黑板只保留问题框和关键词。');

  const steps = [
    {
      stage: 1,
      when: '学生进入课题时',
      write: [safeTitle, writtenQuestion],
      leave: '问题框右侧先留空，等待学生说出第一个关键词。',
      seconds: secondsFor(safeTitle, 4) + secondsFor(writtenQuestion, 4)
    },
    {
      stage: 2,
      when: '学生形成三条理解路径后',
      write: ['文本结构', '语言依据', '情感主旨'],
      leave: '三个分支下方不要提前写答案。',
      seconds: 18
    },
    {
      stage: 3,
      when: '学生找到原文依据后',
      write: writtenItems.map(item => `${item.order}. ${item.text}`),
      leave: '只写学生已经说出的关键词；解释留在口头交流中。',
      seconds: writtenItems.reduce((sum, item) => sum + Math.round(item.chars * 1.35 + 2), 0)
    },
    {
      stage: 4,
      when: '全班完成比较与归纳后',
      write: [writtenItems.at(-1)?.text ? `归纳：${writtenItems.at(-1).text}` : '归纳：________'],
      leave: '结论先画框，等学生表述完整后再落笔。',
      seconds: writtenItems.at(-1) ? secondsFor(writtenItems.at(-1).text, 6) : 6
    },
    {
      stage: 5,
      when: '课堂收束前',
      write: safeBlanks.length ? safeBlanks : ['学生关键词：________', '仍需追问：________'],
      leave: '保留学生生成内容，不用教师预设答案填满。',
      seconds: 12
    }
  ];

  return {
    version: 1,
    status: issues.length ? 'review' : 'ready',
    totalChars,
    estimatedSeconds,
    estimatedMinutes: Math.max(1, Math.ceil(estimatedSeconds / 60)),
    itemCount: safeItems.length,
    longItemCount: longItems.length,
    issues,
    steps,
    itemOrder: writtenItems.map(({ id, index, order }) => ({ id, index, order }))
  };
}

export default buildBoardWritingPlan;

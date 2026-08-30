const OPERATION_WORDS = /(?:怎么|如何|怎样).{0,4}(?:备课|讲|设计)|(?:换成|改为|调整为|拆成|拆分为).{0,10}课时|生成.{0,8}(?:板书|三卡|方案)|展开.{0,8}(?:依据|教师用书)|继续追问/u;
const GENERIC_TITLES = new Set(['教学建议', '教材分析', '教学目标', '课文研读', '教学设计', '单元说明', '目录', '当前篇目', '课堂板书']);

function compact(value, limit = 120) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function unquote(value) {
  return compact(value).replace(/^《|》$/gu, '').trim();
}

function catalogName(value) {
  const name = unquote(value)
    .replace(/^\s*(?:第\s*)?\d+[\.、\s]*/u, '')
    .replace(/^(?:课文|篇目)[：:]\s*/u, '')
    .trim();
  if (!name || name.length < 2 || name.length > 32 || GENERIC_TITLES.has(name) || OPERATION_WORDS.test(name)) return '';
  return name;
}

function quotedTitle(value) {
  const match = compact(value, 300).match(/《([^》]{2,32})》/u);
  return match?.[1] ? `《${match[1].trim()}》` : '';
}

function citationNames(citations = []) {
  const names = [];
  for (const citation of Array.isArray(citations) ? citations : []) {
    const path = Array.isArray(citation?.sectionPath) ? citation.sectionPath : [];
    for (const value of [...path].reverse()) {
      const name = catalogName(value);
      if (name) names.push(name);
    }
    const title = catalogName(citation?.title);
    if (title) names.push(title);
  }
  return [...new Set(names)];
}

function safePlain(value) {
  const title = compact(value);
  if (!title || title.length > 32 || OPERATION_WORDS.test(title)) return '';
  return title;
}

/** Resolve the lesson from server-owned catalogue identity before free prose. */
export function resolveLessonIdentity({ lessonRef, title, answerTitle, question, citations } = {}) {
  const refName = catalogName(lessonRef?.title);
  if (refName) return { title: `《${refName}》`, source: 'lesson_ref' };

  for (const value of [answerTitle, title, question]) {
    const quoted = quotedTitle(value);
    if (quoted) return { title: quoted, source: 'quoted' };
  }

  const candidates = citationNames(citations);
  const prose = [answerTitle, title, question].map(unquote).filter(Boolean);
  for (const candidate of candidates) {
    if (prose.some(value => value === candidate || value.endsWith(candidate))) {
      return { title: `《${candidate}》`, source: 'citation' };
    }
  }

  if (candidates.length === 1 && prose.every(value => !safePlain(value) || OPERATION_WORDS.test(value))) {
    return { title: `《${candidates[0]}》`, source: 'citation' };
  }

  for (const value of [answerTitle, title, question]) {
    const plain = safePlain(value);
    if (plain) return { title: plain, source: 'fallback' };
  }
  return { title: '当前篇目', source: 'fallback' };
}

export function lessonTitleForDraft(draft = {}) {
  return resolveLessonIdentity({
    lessonRef: draft?.lesson_context?.lessonRef || draft?.lessonContext?.lessonRef,
    title: draft?.title || draft?.lessonTitle,
    answerTitle: draft?.answer?.lesson?.title,
    question: draft?.question,
    citations: draft?.citations
  }).title;
}

export default resolveLessonIdentity;

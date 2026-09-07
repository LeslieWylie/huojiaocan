/** Deterministic checks complement the model review; they do not prove a claim true. */
export function answerConsistencyIssues(value, lessonContext = {}, references = []) {
  const answer = value?.answer || value || {};
  const periods = Math.max(1, Math.min(4, Number(lessonContext.periods) || 1));
  const issues = [];
  const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const position = String(answer.lessonPosition || answer.position || '');
  for (const match of position.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*课时/gu)) {
    if ((Number(match[1]) || digits[match[1]]) > periods) {
      issues.push(`当前仅${periods}课时，但课时定位出现${match[0]}；同步核对摘要、课堂环节和三卡，不要只修改回复。`);
    }
  }
  if ((Array.isArray(answer.lessonPlan) ? answer.lessonPlan : []).some(item => Number(item?.period) > periods)) {
    issues.push(`课堂环节超出当前${periods}课时，请保持篇目不变，重新核对课时分配。`);
  }
  const refs = new Set(references.map(item => item.ref));
  for (const check of (Array.isArray(value?.sourceChecks) ? value.sourceChecks : []).slice(0, 12)) {
    if (['contradicted', 'insufficient', 'unresolved'].includes(check?.status)) {
      issues.push('仍有关键判断未被材料支持；删除或改成待确认表述，并同步修订问题理解、摘要、流程和三卡。');
    }
    if (check?.status === 'verified' && (!Array.isArray(check.evidenceRefs) || !check.evidenceRefs.length || check.evidenceRefs.some(ref => !refs.has(ref)))) {
      issues.push('关键判断的核对记录缺少有效教材依据，请回到本轮材料核对。');
    }
  }
  // A task demanding verbatim textbook wording cannot grade a paraphrase as
  // an original sentence. Check only explicitly requested quotations against
  // the available student-textbook excerpts; absence is a review warning,
  // never proof that the complete document lacks the phrase.
  const normalizeQuote = text => String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const textbookPages = references.filter(item => ['textbook', 'student-textbook'].includes(item.documentType)).map(item => normalizeQuote(item.excerpt));
  const cards = value?.threeCardSuggestions || value?.cardSuggestions || {};
  for (const item of (Array.isArray(cards.assessment) ? cards.assessment : [])) {
    if (!/原句|原文摘录|摘抄/u.test(String(item?.task || ''))) continue;
    const response = String(item?.observablePerformance || '');
    for (const match of response.matchAll(/[“「]([^”」]{5,120})[”」]/gu)) {
      const quote = normalizeQuote(match[1]);
      if (quote.length < 5 || !textbookPages.length || textbookPages.some(page => page.includes(quote))) continue;
      issues.push(`评价任务要求原句，但预期回应中的“${match[1]}”未在当前学生教材片段中匹配；请回原页核对，换成真实摘句，或把任务和标准同步改为概括表述，不要冒充原文。`);
    }
  }
  return [...new Set(issues)];
}

export const SOURCE_REVIEW_RULE = '针对当前问题逐条核对关键引文的说话者或描写对象、所属段落、前后转折与比较关系。历史回答可能有错，不得当作教材依据。要求学生摘录原句时，预期回应必须能在学生教材逐字找到；概括、删改或反向推演得到的语句必须标明是概括，不能作为原句评分。教师纠错后，必须同步修改 understanding、reply、summary、lessonPosition、课堂环节和三卡，不能只在开头说已纠正。课时以当前 lessonContext 为准，不沿用历史课时。教师用书的第几课时只作参考，不等于本次方案的课时编号。只有班级水平时，不得断言学生已经掌握或尚未掌握某项能力；学情设想须标注待教师确认。输出 sourceChecks 只记录可核验结论及其 E 编号，不输出思维过程；无法确认则删除断言或明确待确认。';

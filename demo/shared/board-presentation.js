// Display-only normalization: never rebuild a teacher's plan or its citation bindings.
export function normalizeBoardCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).map(card => {
    if (Array.isArray(card?.items) || !Array.isArray(card?.content)) return card;
    return { ...card, items: card.content.map((item, index) => typeof item === 'string'
      ? { id: `${card.id || card.type || 'card'}-legacy-${index}`, text: item, citationIds: [] }
      : item) };
  });
}

const text = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';

export function resolveBoardQuestion(...candidates) {
  return candidates.map(value => text(value).replace(/^核心问题[:：]?/u, '').trim()).find(value => value
    && !/学生读完后能理解什么、说明什么|读完.+你能说清什么|学生读完后要带走什么|^本课核心问题$|^核心问题待补充$/u.test(value)
    && !/(?:怎么|如何|怎样)备课|(?:换成|改为|调整为|拆成|拆分为).{0,8}课时|生成.{0,8}(?:板书|三卡|方案)|重新生成/u.test(value)) || '核心问题待补充';
}

// Recognize only the exact old makeBoardPlan round-robin shape, not arbitrary
// plans that happen to use these headings. It carries no semantic evidence.
function isLegacyRoundRobin(plan, items) {
  const titles = ['文本结构', '语言证据', '情感主旨'];
  return plan?.version === 1 && plan.branches?.length === 3 && plan.branches.every((branch, index) => {
    const expected = items.filter((_, position) => position % 3 === index);
    return branch?.id === `branch-${index + 1}` && branch.title === titles[index]
      && Array.isArray(branch.nodes) && branch.nodes.length === expected.length
      && branch.nodes.every((node, position) => node.id === expected[position].id);
  });
}

export function buildBoardPresentation({ items = [], boardPlan = null, coreQuestion = '' } = {}) {
  const cleanItems = (Array.isArray(items) ? items : []).filter(item => text(item?.text)).slice(0, 9)
    .map((item, index) => ({ ...item, writeOrder: index + 1 }));
  const assigned = new Set();
  const groups = [];
  const planBranches = !isLegacyRoundRobin(boardPlan, cleanItems) && Array.isArray(boardPlan?.branches) ? boardPlan.branches : [];
  for (const branch of planBranches) {
    if (!text(branch?.title) || !Array.isArray(branch.nodes)) continue;
    const members = [];
    for (const node of branch.nodes) {
      // IDs are authoritative; a unique exact-text match supports older plans
      // without IDs. Never use array position or a citation as item identity.
      const matches = cleanItems.filter(item => node?.id != null ? String(item.id) === String(node.id) : text(item.text) === text(node?.text));
      const item = matches.length === 1 ? matches[0] : null;
      if (!item || assigned.has(item)) continue;
      assigned.add(item); members.push(item);
    }
    if (members.length) groups.push({ title: text(branch.title), items: members });
  }
  for (const item of cleanItems) {
    if (assigned.has(item)) continue;
    const category = text(item.category) || text(item.group);
    if (!category) continue;
    let group = groups.find(group => group.title === category);
    if (!group) { group = { title: category, items: [] }; groups.push(group); }
    group.items.push(item); assigned.add(item);
  }
  const remaining = cleanItems.filter(item => !assigned.has(item));
  if (remaining.length) groups.push({ title: '', items: remaining });
  // Up to three 320-wide leaves per column; extra semantic groups wrap rather
  // than being renamed or crammed into a fixed three-category diagram.
  const columns = groups.flatMap(group => {
    const chunks = [];
    for (let i = 0; i < group.items.length; i += 3) {
      const members = group.items.slice(i, i + 3);
      chunks.push({ title: group.title ? `${group.title}${i ? '（续）' : ''}` : `落笔 ${members.map(item => item.writeOrder).join('、')}`, items: members });
    }
    return chunks;
  });
  const branches = columns.map((branch, index) => ({ ...branch, id: `display-${index}`, x: [260, 700, 1140][index % 3], y: 330 + Math.floor(index / 3) * 390, color: ['gold', 'mint', 'lavender'][index % 3] }));
  const extraHeight = Math.max(0, Math.ceil(branches.length / 3) - 1) * 390;
  return {
    items: cleanItems, branches, extraHeight,
    coreQuestion: resolveBoardQuestion(boardPlan?.coreQuestion, coreQuestion),
    // A conclusion must be explicit. Last-item position is not evidence.
    conclusion: text(boardPlan?.conclusion?.text) || text(boardPlan?.conclusion)
  };
}

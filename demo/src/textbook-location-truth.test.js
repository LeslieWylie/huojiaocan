/**
 * 教材定位真值测试：索引元数据必须和它自己解析出来的教材正文一致。
 *
 * 判据全部来自仓库内已有的解析文本，不引用任何外部资料：
 *   1. 教师用书自己的「目录」页（物理 13—15 页）逐条写明每一课的印刷页码；
 *   2. 每一课的起始页正文都以「N 篇名 …… 教学重点」开头。
 * 因此「这一页属于哪一课、印刷页是几」可以直接读出来，再和
 * teacher-guide-tree.json / teacher-guide-pages.json 记录的
 * title / nodeId / printedPage / startPage 对照。
 *
 * 回归对象：线上教材库曾把物理 64 页显示成《你是人间的四月天》，
 * 而该页正文属于《乡愁》。真实边界是 62 起《乡愁》、72 起《你是人间的四月天》、
 * 81 起《我看》，对应印刷页 46 / 56 / 65。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LocalFullTextIndexProvider } from '../serverless/index-provider.js';

const readIndex = name => JSON.parse(readFileSync(new URL(`../data/index/${name}`, import.meta.url), 'utf8'));

const guidePages = readIndex('teacher-guide-pages.json');
const guideTree = readIndex('teacher-guide-tree.json');
const textbookPages = readIndex('textbook-pages.json');
const provider = new LocalFullTextIndexProvider();

const guidePage = number => guidePages.find(page => page.pageNumber === number) || null;
const compact = value => String(value || '').replace(/[\s·．.、，,（）()《》—\-*]/gu, '');

const XIANGCHOU = 'teacher-guide-u1-n6';
const SIYUETIAN = 'teacher-guide-u1-n7';
const WOKAN = 'teacher-guide-u1-n8';
const BATELE = 'teacher-guide-u5-n4';

/**
 * 四个人工复核过的锚点：物理页 → 篇目 / 印刷页。
 * 它们分别覆盖「课中页」（64）与三处课头页（72 / 81 / 429），
 * 横跨第一单元与第五单元，用来钉住偏移量在全书范围内都成立。
 */
const ANCHORS = [
  { physicalPage: 64, printedPage: '48', title: '4 乡愁', nodeId: XIANGCHOU, isLessonHead: false },
  { physicalPage: 72, printedPage: '56', title: '5 你是人间的四月天', nodeId: SIYUETIAN, isLessonHead: true },
  { physicalPage: 81, printedPage: '65', title: '6 我看', nodeId: WOKAN, isLessonHead: true },
  { physicalPage: 429, printedPage: '413', title: '21 就英法联军远征中国致巴特勒上尉的信', nodeId: BATELE, isLessonHead: true }
];

/**
 * 一课的起始页 = 正文前 160 个有效字符内出现「教学重点」，
 * 且「教学重点」之前出现完整课题（含课序号）的那一页。
 */
function opensLesson(page, lessonTitle) {
  const body = compact(page?.text);
  const at = body.indexOf('教学重点');
  if (at < 0 || at > 160) return false;
  return body.slice(0, at).includes(compact(lessonTitle));
}

/** 从教师用书自己的目录页读出「篇目 → 印刷页」。 */
function tocEntries() {
  const entries = [];
  for (const page of guidePages) {
    if (page.title !== '目录') continue;
    for (const line of String(page.text || '').split('\n')) {
      const matched = line.match(/^\s*(\S.*?)\s*·{3,}\s*(\d{1,3})\s*$/u);
      if (matched) entries.push({ label: matched[1], printedPage: Number(matched[2]) });
    }
  }
  return entries;
}

function lessonNodes(nodes, output = []) {
  for (const node of nodes || []) {
    if (/^\d+\s/u.test(node.title || '')) output.push(node);
    lessonNodes(node.children || [], output);
  }
  return output;
}

function nodeById(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const child = nodeById(node.children || [], id);
    if (child) return child;
  }
  return null;
}

test('教师用书物理 64 页属于《乡愁》，印刷页 48', async () => {
  const record = guidePage(64);
  assert.ok(compact(record.text).includes('乡愁'), '该页正文谈的是《乡愁》');

  const { page } = await provider.getPage('teacher-guide', 64);
  assert.equal(page.printedPage, '48');
  assert.equal(page.title, '4 乡愁');
  assert.equal(page.nodeId, XIANGCHOU);
  assert.deepEqual(page.sectionPath, ['第一单元 · 诗歌活动探究', '4 乡愁']);
});

test('教师用书物理 72 页是《你是人间的四月天》课头，印刷页 56', async () => {
  assert.ok(opensLesson(guidePage(72), '5 你是人间的四月天'), '物理 72 页是《你是人间的四月天》的教学重点起始页');

  const { page } = await provider.getPage('teacher-guide', 72);
  assert.equal(page.printedPage, '56');
  assert.equal(page.title, '5 你是人间的四月天');
  assert.equal(page.nodeId, SIYUETIAN);
});

test('教师用书物理 81 页是《我看》课头，印刷页 65', async () => {
  assert.ok(opensLesson(guidePage(81), '6 我看'), '物理 81 页是《我看》的教学重点起始页');

  const { page } = await provider.getPage('teacher-guide', 81);
  assert.equal(page.printedPage, '65');
  assert.equal(page.title, '6 我看');
  assert.equal(page.nodeId, WOKAN);
});

test('教师用书物理 429 页是《就英法联军远征中国致巴特勒上尉的信》课头，印刷页 413', async () => {
  assert.ok(
    opensLesson(guidePage(429), '21 就英法联军远征中国致巴特勒上尉的信'),
    '物理 429 页是《就英法联军远征中国致巴特勒上尉的信》的教学重点起始页'
  );

  const { page } = await provider.getPage('teacher-guide', 429);
  assert.equal(page.printedPage, '413');
  assert.equal(page.title, '21 就英法联军远征中国致巴特勒上尉的信');
  assert.equal(page.nodeId, BATELE);
  assert.deepEqual(page.sectionPath, ['第五单元 · 议论文', '21 就英法联军远征中国致巴特勒上尉的信']);
});

test('四个人工复核锚点的物理页、印刷页、篇目、节点四项同时成立', async () => {
  const drift = [];
  for (const anchor of ANCHORS) {
    const { page } = await provider.getPage('teacher-guide', anchor.physicalPage);
    const actual = { printedPage: page.printedPage, title: page.title, nodeId: page.nodeId };
    const wanted = { printedPage: anchor.printedPage, title: anchor.title, nodeId: anchor.nodeId };
    for (const key of Object.keys(wanted)) {
      if (String(actual[key]) !== String(wanted[key])) {
        drift.push(`物理 ${anchor.physicalPage} 页的 ${key}：实际 ${actual[key]}，应为 ${wanted[key]}`);
      }
    }
    if (anchor.isLessonHead && !opensLesson(guidePage(anchor.physicalPage), anchor.title)) {
      drift.push(`物理 ${anchor.physicalPage} 页应当是《${anchor.title}》的课头页，但正文里读不到该课的教学重点起始段`);
    }
  }
  assert.deepEqual(drift, [], `${drift.length} 处锚点与教师用书正文不符`);
});

test('教师用书课文节点恰好是 1—27 课，编号连续且起始物理页严格递增', () => {
  const lessons = lessonNodes(guideTree);
  const numbers = lessons.map(node => Number(String(node.title).match(/^(\d+)\s/u)?.[1]));
  assert.deepEqual(
    numbers,
    Array.from({ length: 27 }, (_, index) => index + 1),
    `课文编号应当是连续的 1—27，实际读到 ${JSON.stringify(numbers)}`
  );

  const regressions = [];
  for (let i = 1; i < lessons.length; i += 1) {
    if (lessons[i].startPage <= lessons[i - 1].startPage) {
      regressions.push(`${lessons[i - 1].title}(${lessons[i - 1].startPage}) → ${lessons[i].title}(${lessons[i].startPage})`);
    }
  }
  assert.deepEqual(regressions, [], '相邻两课的起始物理页出现回退或重合');
});

test('教师用书 1—27 课的起始物理页都落在自己的课头，且印刷页与该页记录一致', async () => {
  const lessons = lessonNodes(guideTree);
  assert.equal(lessons.length, 27, `应当读到全部 27 课，实际 ${lessons.length} 课`);

  const drift = [];
  for (const node of lessons) {
    if (!opensLesson(guidePage(node.startPage), node.title)) {
      drift.push(`《${node.title}》：目录起始页 ${node.startPage}，但该页正文不是本课课头`);
      continue;
    }
    const { page } = await provider.getPage('teacher-guide', node.startPage);
    if (page.title !== node.title) {
      drift.push(`《${node.title}》：物理 ${node.startPage} 页被服务端标成《${page.title}》`);
    }
    if (page.nodeId !== node.id) {
      drift.push(`《${node.title}》：物理 ${node.startPage} 页的 nodeId 是 ${page.nodeId}，目录记的是 ${node.id}`);
    }
    const record = guidePage(node.startPage);
    if (String(page.printedPage) !== String(record?.printedPage)) {
      drift.push(`《${node.title}》：服务端印刷页 ${page.printedPage}，索引记录 ${record?.printedPage}`);
    }
  }
  assert.deepEqual(drift, [], `${drift.length} 处课头定位与教师用书正文不符`);
});

test('第一单元三首诗的目录边界与正文课头一致，物理 64 页不能落进《四月天》', async () => {
  const { tree } = await provider.getTree('teacher-guide');
  const xiangchou = nodeById(tree, XIANGCHOU);
  const siyuetian = nodeById(tree, SIYUETIAN);
  const wokan = nodeById(tree, WOKAN);

  assert.equal(xiangchou?.title, '4 乡愁');
  assert.equal(siyuetian?.title, '5 你是人间的四月天');
  assert.equal(wokan?.title, '6 我看');

  assert.equal(xiangchou.startPage, 62, '《乡愁》起于物理 62 页');
  assert.equal(siyuetian.startPage, 72, '《你是人间的四月天》起于物理 72 页');
  assert.equal(wokan.startPage, 81, '《我看》起于物理 81 页');

  // 相邻篇目不能重叠，也不能留下无人认领的物理页。
  assert.equal(xiangchou.endPage, siyuetian.startPage - 1);
  assert.equal(siyuetian.endPage, wokan.startPage - 1);

  assert.ok(64 >= xiangchou.startPage && 64 <= xiangchou.endPage, '物理 64 页属于《乡愁》');
  assert.ok(!(64 >= siyuetian.startPage && 64 <= siyuetian.endPage), '物理 64 页不属于《四月天》');
});

test('教师用书每一课的目录起始页都落在自己的教学重点课头页', () => {
  const lessons = lessonNodes(guideTree);
  assert.ok(lessons.length >= 27, `应当读到全部课文节点，实际 ${lessons.length} 个`);
  const drift = [];
  for (const node of lessons) {
    const openings = guidePages.filter(page => opensLesson(page, node.title)).map(page => page.pageNumber);
    assert.equal(openings.length, 1, `《${node.title}》的课头页应当唯一，实际命中 ${JSON.stringify(openings)}`);
    if (openings[0] !== node.startPage) drift.push(`${node.title}：目录 ${node.startPage} → 正文 ${openings[0]}`);
  }
  assert.deepEqual(drift, [], `${drift.length}/${lessons.length} 课的目录起始页与正文课头不符`);
});

test('教师用书每一课起始页的印刷页码等于该书目录页登记的印刷页码', () => {
  const entries = tocEntries();
  assert.ok(entries.length >= 40, `应当从目录页读到足够条目，实际 ${entries.length} 条`);
  const drift = [];
  let matched = 0;
  for (const node of lessonNodes(guideTree)) {
    const wanted = compact(node.title);
    const entry = entries.find(item => compact(item.label) === wanted);
    if (!entry) continue;
    matched += 1;
    const startRecord = guidePage(node.startPage);
    if (String(startRecord?.printedPage) !== String(entry.printedPage)) {
      drift.push(`${node.title}：物理 ${node.startPage} 页记录印刷页 ${startRecord?.printedPage}，目录写的是 ${entry.printedPage}`);
    }
  }
  assert.ok(matched >= 20, `应当匹配到足够多的课文目录条目，实际 ${matched} 条`);
  assert.deepEqual(drift, [], `${drift.length}/${matched} 课的印刷页码与该书目录不符`);
});

test('两份教材的印刷页码在正文区间内逐页递增，没有跳段', () => {
  for (const [name, pages] of [['教师教学用书', guidePages], ['学生教材', textbookPages]]) {
    const body = pages
      .filter(page => page.printedPage !== null && page.printedPage !== undefined && page.title !== '目录' && page.title !== '编写说明' && page.title !== '目录与版权页')
      .sort((a, b) => a.pageNumber - b.pageNumber);
    assert.ok(body.length > 100, `${name} 的正文页数量异常：${body.length}`);
    const breaks = [];
    for (let i = 1; i < body.length; i += 1) {
      const previous = body[i - 1];
      const current = body[i];
      if (current.pageNumber !== previous.pageNumber + 1) continue;
      if (Number(current.printedPage) !== Number(previous.printedPage) + 1) {
        breaks.push(`${name} 物理 ${previous.pageNumber}→${current.pageNumber}：印刷 ${previous.printedPage}→${current.printedPage}`);
      }
    }
    assert.deepEqual(breaks, [], `${name} 的印刷页码出现跳段`);
  }
});

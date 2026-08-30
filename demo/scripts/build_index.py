#!/usr/bin/env python3
"""Build the demo's local full-text index from the three authoritative PDFs.
The competition notice is intentionally excluded: it is an internal acceptance standard,
not product knowledge and never participates in user search or Q&A.
"""
from __future__ import annotations
import json, re
from pathlib import Path
try:
    from pypdf import PdfReader
except ImportError:  # local prototype environments often only ship PyPDF2
    from PyPDF2 import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'index'
OUT.mkdir(parents=True, exist_ok=True)

DOCS = [
    dict(id='textbook', kind='学生教材', title='义务教育教科书 语文 九年级上册', shortTitle='九年级语文上册',
         file=ROOT/'public/materials/九年级语文上册-学生教材.pdf', pdfUrl='/materials/九年级语文上册-学生教材.pdf', printedOffset=6),
    dict(id='teacher-guide', kind='教师教学用书', title='义务教育教科书教师教学用书 语文 九年级上册', shortTitle='九上教师教学用书',
         file=ROOT/'public/materials/九年级语文上册-教师教学用书.pdf', pdfUrl='/materials/九年级语文上册-教师教学用书.pdf', printedOffset=16),
    dict(id='curriculum-standard', kind='课程标准', title='义务教育语文课程标准（2022年版）', shortTitle='2022年版语文课程标准',
         file=ROOT/'public/materials/义务教育语文课程标准2022.pdf', pdfUrl='/materials/义务教育语文课程标准2022.pdf', printedOffset=7,
         ocrTextFile=ROOT.parent/'tmp/pdfs/义务教育语文课程标准2022_ocr.txt'),
]

# Printed page numbers from the books' own tables of contents.
TEXTBOOK = [
 ('第一单元 · 活动探究',1,[('活动任务单',1),('1 沁园春·雪',3),('2 周总理，你在哪里',5),('3 我爱这土地',8),('4 乡愁',9),('5 你是人间的四月天',10),('6 我看',12),('任务二 诗歌朗诵',14),('任务三 尝试创作',18)]),
 ('第二单元 · 议论性文章',21,[('7 培养德智体美劳全面发展的社会主义建设者和接班人',22),('8 中国人失掉自信力了吗',30),('9 谈骨气',33),('10 创造宣言',36),('阅读综合实践',41),('写作 观点要明确',43),('专题学习活动 君子自强不息',46)]),
 ('第三单元 · 古诗文',49,[('11 岳阳楼记',50),('12 醉翁亭记',53),('13 湖心亭看雪',56),('14 诗词三首',58),('阅读综合实践',61),('写作 议论要言之有据',62),('课外古诗词诵读',65)]),
 ('第四单元 · 小说',67,[('15 故乡',68),('16 我的叔叔于勒',78),('17 孤独之旅',85),('18 蒲柳人家（节选）',93),('阅读综合实践',103),('写作 学写小小说',105),('整本书阅读 《简·爱》',108)]),
 ('第五单元 · 议论文',111,[('19 想和做',112),('20 怀疑与学问',115),('21 就英法联军远征中国致巴特勒上尉的信',118),('22 精神的三间小屋',122),('阅读综合实践',126),('写作 论证要合理',127),('专题学习活动 我们的数字时代',130)]),
 ('第六单元 · 古代文学',135,[('23 曹刿论战',136),('24 邹忌讽齐王纳谏',139),('25 陈涉世家',142),('26 出师表',146),('27 诗词曲五首',150),('阅读综合实践',154),('写作 学会深入思考',155),('整本书阅读 《唐诗三百首》',158),('课外古诗词诵读',159)]),
]
TEACHER = [
 ('第一单元 · 诗歌活动探究',1,[('单元说明',1),('活动任务单',4),('1 沁园春·雪',11),('2 周总理，你在哪里',22),('3 我爱这土地',35),('4 乡愁',46),('5 你是人间的四月天',56),('6 我看',65),('任务二 诗歌朗诵',75),('任务三 尝试创作',82),('单元教学设计',92)]),
 ('第二单元 · 议论性文章',100,[('单元说明',100),('7 培养德智体美劳全面发展的社会主义建设者和接班人',106),('8 中国人失掉自信力了吗',134),('9 谈骨气',152),('10 创造宣言',164),('阅读综合实践',179),('单元教学设计',183),('写作 观点要明确',189),('专题学习活动 君子自强不息',195)]),
 ('第三单元 · 古诗文',203,[('单元说明',203),('11 岳阳楼记',208),('12 醉翁亭记',222),('13 湖心亭看雪',232),('14 诗词三首',243),('阅读综合实践',257),('单元教学设计',262),('写作 议论要言之有据',266)]),
 ('第四单元 · 小说',271,[('单元说明',271),('15 故乡',278),('16 我的叔叔于勒',301),('17 孤独之旅',317),('18 蒲柳人家（节选）',330),('阅读综合实践',347),('单元教学设计',350),('写作 学写小小说',356),('整本书阅读 《简·爱》',361)]),
 ('第五单元 · 议论文',372,[('单元说明',372),('19 想和做',380),('20 怀疑与学问',397),('21 就英法联军远征中国致巴特勒上尉的信',413),('22 精神的三间小屋',429),('阅读综合实践',441),('单元教学设计',448),('写作 论证要合理',458),('专题学习活动 我们的数字时代',465)]),
 ('第六单元 · 古代文学',478,[('单元说明',478),('23 曹刿论战',484),('24 邹忌讽齐王纳谏',493),('25 陈涉世家',504),('26 出师表',518),('27 诗词曲五首',535),('阅读综合实践',564),('单元教学设计',572),('写作 学会深入思考',575),('整本书阅读 《唐诗三百首》',586)]),
]

# Printed page numbers from the official 2022 curriculum standard.  The PDF is
# image-based; page text comes from the checked OCR file while the original PDF
# remains the verification source.  Only headings visible in the document are
# represented here.
CURRICULUM = [
 ('课程性质',1,[('课程性质',1)]),
 ('课程理念',2,[('课程理念',2)]),
 ('课程目标',4,[('核心素养内涵',4),('总目标',6),('学段要求',7),('第四学段（7—9年级）',14)]),
 ('课程内容',18,[('主题与载体形式',18),('语言文字积累与梳理',20),('实用性阅读与交流',23),('文学阅读与创意表达',26),('思辨性阅读与表达',29),('整本书阅读',32),('跨学科学习',34)]),
 ('学业质量',37,[('学业质量内涵',37),('学业质量描述',37),('第四学段（7—9年级）',42)]),
 ('课程实施',44,[('教学建议',44),('评价建议',46),('教材编写建议',52),('课程资源开发与利用',53),('教学研究与教师培训',55)]),
 ('附录',58,[('附录1 优秀诗文背诵推荐篇目',58),('附录2 关于课内外读物的建议',64),('附录3 关于语法修辞知识的说明',65),('附录4 识字、写字教学基本字表',66),('附录5 义务教育语文课程常用字表',70)]),
]

def clean(text: str) -> str:
    text = text.replace('\u3000',' ').replace('\xa0',' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def ocr_pages(path: Path):
    """Read the existing page-marked OCR without guessing page boundaries."""
    if not path:
        return {}
    source = path.read_text(encoding='utf-8', errors='replace')
    parts = re.split(r'===FILE:/tmp/ywcs/p-(\d+)\.jpg===\n?', source)
    return {int(parts[i]): clean(parts[i + 1]) for i in range(1, len(parts) - 1, 2)}

def infer_front_matter_title(doc, idx, text):
    """Infer front-matter labels from the page itself, not only page ranges.

    The teacher guide has several pages of ``编写说明`` before the first unit.
    Treating every page before the first unit as ``目录与版权页`` made physical
    page 5 look like a directory page even though its printed page is 3.
    """
    normalized = re.sub(r'\s+', '', text or '')
    if doc['id'] == 'teacher-guide' and 3 <= idx <= 11:
        return '编写说明'
    if doc['id'] == 'teacher-guide' and 13 <= idx <= 16:
        return '目录'
    if '编写说明' in normalized:
        return '编写说明'
    if '目录' in normalized and idx <= doc['printedOffset'] + 4:
        return '目录'
    if idx <= doc['printedOffset']:
        return '目录与版权页'
    return doc['shortTitle']

def infer_printed_page(doc, idx, text=''):
    """Keep printed-page labels separate from physical PDF pages.

    The teacher guide has two front-matter sequences: 编写说明 (physical
    pages 3–11) and 目录 (physical pages 13–16). The first teaching unit
    starts at physical page 17 and continues with the same printed sequence.

    Where possible, extract the printed page number from the PDF header/footer
    text rather than relying on a fixed offset.  For the teacher-guide, the
    printed page number appears in the header on both even and odd pages:
      - Even pages: text starts with "\\d+ │ 义务教育教科书..."
      - Odd pages:  text contains "│ .+? │ \\d+" (right header)
    The fallback uses the document's printedOffset.
    """
    # Try to extract printed page number from the PDF header text
    if doc['id'] == 'teacher-guide' and text:
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            # Even pages: "46 │ 义务教育教科书..."
            m = re.match(r'^(\d+)\s*│\s*义务教育教科书', line)
            if m:
                return m.group(1)
            # Odd pages: "│ 第一单元 第四课 │ 47"
            m = re.search(r'│\s*.+?\s*│\s*(\d+)$', line)
            if m:
                return m.group(1)
            break  # Only check the first line

    if doc['id'] == 'teacher-guide':
        if 3 <= idx <= 11:
            return str(idx - 2)
        if 13 <= idx <= 16:
            return str(idx - 12)
        if idx >= 17:
            return str(idx - 16)
        return None
    printed = idx - doc['printedOffset']
    return str(printed) if printed > 0 else None

def tree_for(doc, units, total_pages):
    offset = doc['printedOffset']
    roots=[]
    flat=[]
    for ui,(utitle,ustart,children) in enumerate(units):
        next_unit_printed = units[ui+1][1] if ui+1<len(units) else total_pages-offset+1
        unode={'id':f"{doc['id']}-u{ui+1}",'documentId':doc['id'],'title':utitle,'level':1,
               'startPage':ustart+offset,'endPage':min(total_pages,next_unit_printed+offset-1),'children':[]}
        for ci,(title,start) in enumerate(children):
            next_start = children[ci+1][1] if ci+1<len(children) else next_unit_printed
            node={'id':f"{doc['id']}-u{ui+1}-n{ci+1}",'documentId':doc['id'],'title':title,'level':2,
                  'startPage':start+offset,'endPage':min(total_pages,next_start+offset-1),'children':[]}
            unode['children'].append(node); flat.append(node)
        roots.append(unode); flat.append(unode)
    return roots,flat

all_pages=[]; manifest=[]; all_trees={}
for doc in DOCS:
    reader=PdfReader(str(doc['file']))
    units={'textbook':TEXTBOOK,'teacher-guide':TEACHER,'curriculum-standard':CURRICULUM}[doc['id']]
    tree,flat=tree_for(doc,units,len(reader.pages))
    all_trees[doc['id']]=tree
    starts={n['startPage']:n for n in flat if n['level']==2}
    current=None
    pages=[]
    extracted_ocr=ocr_pages(doc.get('ocrTextFile')) if doc.get('ocrTextFile') else {}
    for idx,page in enumerate(reader.pages,1):
        if idx in starts: current=starts[idx]
        text=extracted_ocr.get(idx) or clean(page.extract_text() or '')
        printed=infer_printed_page(doc, idx, text)
        record={'id':f"{doc['id']}-p{idx}",'documentId':doc['id'],'pageNumber':idx,
                'printedPage':printed,'title':current['title'] if current else infer_front_matter_title(doc, idx, text),
                'nodeId':current['id'] if current else None,'text':text,'charCount':len(text),
                'pdfUrl':f"{doc['pdfUrl']}#page={idx}"}
        pages.append(record); all_pages.append(record)
    d={k:v for k,v in doc.items() if k not in ('file','printedOffset','ocrTextFile')}
    d.update(pageCount=len(pages),charCount=sum(p['charCount'] for p in pages),indexedPages=sum(bool(p['text']) for p in pages),status='ready',tree=tree)
    manifest.append(d)
    (OUT/f"{doc['id']}-pages.json").write_text(json.dumps(pages,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (OUT/f"{doc['id']}-tree.json").write_text(json.dumps(tree,ensure_ascii=False,indent=2),encoding='utf-8')

(OUT/'manifest.json').write_text(json.dumps({'version':1,'provider':'local-fulltext','documents':manifest},ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'pages.json').write_text(json.dumps(all_pages,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'documents':[(d['id'],d['pageCount'],d['charCount']) for d in manifest], 'pages':len(all_pages), 'output':str(OUT)},ensure_ascii=False,indent=2))

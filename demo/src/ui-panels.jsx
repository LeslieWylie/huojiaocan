// ui-panels：共享面板与资产状态组件（AssetCoverage/PlanQualitySummary/SharedPlanList 等）
import { CheckCircle2, CircleAlert } from 'lucide-react';

export function sourceCoverageLabel(coverage) {
  if (!coverage) return '本轮回答尚未标记材料覆盖情况';
  return coverage.complete ? '学生教材、教师用书与课程标准均已覆盖' : (coverage.label || `已覆盖 ${3 - (coverage.missing || []).length}/3 类材料`);
}
export function AssetCoverage({ coverage }) {
  const rows = [['textbook', '学生教材', '锁定课文原文、任务和页码'], ['teacherGuide', '教师用书', '参考教学目标、重点难点与活动处理'], ['curriculumStandard', '课程标准', '补充课程目标与评价依据']];
  return <div className="asset-coverage"><header><div><span>材料覆盖</span><b>{sourceCoverageLabel(coverage)}</b></div><small>没有导入的材料不会被虚构为已引用</small></header><div className="asset-coverage-grid">{rows.map(([key, title, note]) => <div className={coverage?.[key] ? 'covered' : 'missing'} key={key}><span>{coverage?.[key] ? <CheckCircle2/> : <CircleAlert/>}</span><div><b>{title}</b><small>{coverage?.[key] ? '本方案已有可核验页面' : `尚未覆盖 · ${note}`}</small></div></div>)}</div></div>;
}
export function PlanQualitySummary({ quality }) {
  const errors = quality?.issues?.filter(item => item.severity === 'error').length || 0;
  const warnings = quality?.issues?.filter(item => item.severity === 'warning').length || 0;
  const ready = quality?.status === 'ready';
  return <div className={`plan-quality-summary ${ready ? 'ready' : 'review'}`}>
    <div><span>方案检查</span><b>{ready ? '已具备课堂使用基础' : '还需要补充或核对'}</b></div>
    <strong>{quality?.score ?? 0}<small>分</small></strong>
    <p>{ready ? '三张卡、课堂流程与教材依据已形成闭环。锁定前仍建议回看关键页面。' : `还有 ${errors} 项必补内容${warnings ? `，${warnings} 项建议核对` : ''}。完善后再锁定，课堂使用会更稳妥。`}</p>
  </div>;
}
export function assetWorkflowBadge(asset = {}) {
  if (asset.classroomStatus === 'in_progress') return { label: '课堂进行中', tone: 'gold' };
  if (asset.classroomStatus === 'pending_review') return { label: '待确认复盘', tone: 'purple' };
  if (asset.lessonStudyStale) return { label: '研究记录待更新', tone: 'orange' };
  if (asset.lessonStudyStatus === 'confirmed') return { label: '教学判断已确认', tone: 'green' };
  if (asset.lessonStudyStatus === 'draft') return { label: '一课一研待确认', tone: 'purple' };
  if (asset.learningEvidenceStale) return { label: '作业回流待更新', tone: 'orange' };
  if (asset.learningEvidenceStatus === 'confirmed') return { label: '作业学情已确认', tone: 'gold' };
  if (asset.learningEvidenceStatus === 'draft') return { label: '作业回流进行中', tone: 'orange' };
  if (asset.status === 'published') return { label: '已归档', tone: 'green' };
  if (asset.hasUnconfirmedChanges) return { label: '有待确认修改', tone: 'orange' };
  if (asset.rehearsalStatus === 'confirmed') return { label: '问题链已预演', tone: 'gold' };
  if (asset.rehearsalStatus === 'draft') return { label: '预演进行中', tone: 'orange' };
  if (asset.cardsGenerated) return { label: '三卡已生成', tone: 'green' };
  if (asset.teacherConfirmed) return { label: '教师已定稿', tone: 'green' };
  return { label: '方案草稿', tone: 'orange' };
}
export function assetPrimaryAction(asset = {}) {
  const id = encodeURIComponent(asset.draftId || '');
  if (asset.classroomStatus === 'in_progress') return { href: `/cards/?draftId=${id}&classroom=1`, label: '继续本节课堂' };
  if (asset.classroomStatus === 'pending_review') return { href: `/reflection/?draftId=${id}`, label: '确认课后复盘' };
  if (asset.lessonStudyStale) return { href: `/study/?draftId=${id}`, label: '更新一课一研' };
  if (asset.lessonStudyStatus === 'draft') return { href: `/study/?draftId=${id}`, label: '形成教学判断' };
  if (asset.lessonStudyStatus === 'confirmed') return { href: `/study/?draftId=${id}`, label: '查看一课一研' };
  if (asset.learningEvidenceStale) return { href: `/learning/?draftId=${id}`, label: '更新作业回流' };
  if (asset.learningEvidenceStatus === 'draft') return { href: `/learning/?draftId=${id}`, label: '继续作业回流' };
  if (asset.learningEvidenceStatus === 'confirmed' || asset.hasReflection) return { href: `/study/?draftId=${id}`, label: '整理一课一研' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'confirmed' && !asset.rehearsalStale) return { href: `/cards/?draftId=${id}&classroom=1`, label: '打开本节课堂' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStale) return { href: `/rehearsal/?draftId=${id}`, label: '更新问题链预演' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'draft') return { href: `/rehearsal/?draftId=${id}`, label: '继续问题链预演' };
  if (!asset.hasReflection && asset.cardsGenerated && asset.rehearsalStatus === 'none') return { href: `/rehearsal/?draftId=${id}`, label: '课前预演问题链' };
  return { href: `/cards/?draftId=${id}`, label: asset.status === 'published' ? '打开方案' : asset.teacherConfirmed && asset.cardsGenerated ? '检查方案' : '继续定稿' };
}
export function sharedItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return item.teacherAction || item.studentTask || item.content || item.title || item.question || item.text || '';
}
export function SharedPlanList({ title, items }) {
  const values = (Array.isArray(items) ? items : []).filter(sharedItemText);
  if (!values.length) return null;
  return <section className="share-plan-section"><h3>{title}</h3><ol>{values.map((item, index) => <li key={`${title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{sharedItemText(item)}</b>{typeof item === 'object' && item.studentTask && item.studentTask !== sharedItemText(item) && <p>学生任务：{item.studentTask}</p>}{typeof item === 'object' && item.expectedEvidence && <small>可观察表现：{item.expectedEvidence}</small>}{typeof item === 'object' && item.duration && <em>{item.duration}</em>}</div></li>)}</ol></section>;
}

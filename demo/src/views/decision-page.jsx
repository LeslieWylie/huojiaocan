// 教学决策示例页（从 App.jsx 迁出）
import { ArrowRight, Sparkles, Target } from 'lucide-react';
import { Badge, SectionHead } from '../ui-kit.jsx';

export function Decision() {
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Sparkles/> 教学决策</Badge><h1>不是“生成一份教案”，<br/>而是把依据组织成可执行判断</h1><p>目标、活动、评价和引用保持对应；系统综合与教师最终判断明确分层。</p></div></section><section className="panel"><SectionHead icon={Target} eyebrow="示范课题" title="《我爱这土地》：从意象群到献身之情"/><div className="decision-grid"><article><Badge tone="orange">教材依据</Badge><h3>鸟、土地、河流、风与黎明</h3><p>从修饰语和意象关系进入诗歌情感。</p><a href="/document/?doc=textbook&page=14&return=%2Fdecision%2F">核验教材 第14页 <ArrowRight/></a></article><article><Badge tone="blue">教师用书依据</Badge><h3>两节结构不可割裂</h3><p>第一节借形象抒情，第二节直抒胸臆并收束全诗。</p><a href="/document/?doc=teacher-guide&page=53&return=%2Fdecision%2F">核验教师用书 第53页 <ArrowRight/></a></article><article><Badge tone="purple">课堂转化</Badge><h3>删改比较 + 朗读验证</h3><p>先删除第二节比较表达效果，再用朗读说明判断依据。</p><a href="/ask/?q=%E6%80%8E%E6%A0%B7%E5%A4%87%E8%AF%BE%E3%80%8A%E6%88%91%E7%88%B1%E8%BF%99%E5%9C%9F%E5%9C%B0%E3%80%8B%EF%BC%9F">围绕示例开始备课 <ArrowRight/></a></article></div></section></div>;
}

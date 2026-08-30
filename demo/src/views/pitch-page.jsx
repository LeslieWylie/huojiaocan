// 使用示例页（从 App.jsx 迁出）
import { Play } from 'lucide-react';
import { Badge } from '../ui-kit.jsx';

export function Pitch() {
  return <div className="view-stack"><section className="hero compact-hero"><div><Badge tone="green"><Play/> 使用示例</Badge><h1>不是普通问答机器人，<br/>而是基于原始教材依据的教学工作台</h1><p>教材全解析、教材目录路由、依据优先问答与课堂逐步展开构成完整流程。</p></div><div className="hero-actions"><a className="primary" href="/ask/?q=《我爱这土地》第二节为什么不能删？"><Play/>进入现场问题</a></div></section></div>;
}

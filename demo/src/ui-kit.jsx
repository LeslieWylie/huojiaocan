// ui-kit：从 App.jsx 抽出的纯展示原子组件（无状态、纯 props）。
import { BookOpen } from 'lucide-react';

export function Logo() {
  return <div className="logo"><span className="logo-mark"><BookOpen size={21}/></span><span><b>活教参</b><small>从教材依据到课堂行动</small></span></div>;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ icon: Icon, label, value, note, tone = '' }) {
  return <article className={`stat-card ${tone}`}><div className="stat-icon"><Icon/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

export function SectionHead({ icon: Icon, eyebrow, title, note, action }) {
  return <div className="section-head"><div className="section-title"><span className="section-icon"><Icon/></span><div><small>{eyebrow}</small><h2>{title}</h2>{note && <p>{note}</p>}</div></div>{action}</div>;
}

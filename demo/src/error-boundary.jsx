// 页面级错误边界：懒加载/渲染异常时给出可恢复提示，而非白屏。
import { Component } from 'react';

export class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') console.error('[活教参] 页面渲染异常:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="panel page-error-boundary" role="alert">
          <CircleAlertIcon />
          <h2>这一页暂时打不开</h2>
          <p>可能是加载出了波动。可以刷新重试；已保存的方案、材料与课堂记录都不会受影响。</p>
          <div className="page-error-actions">
            <button type="button" className="primary" onClick={() => window.location.reload()}>刷新重试</button>
            <button type="button" onClick={() => { try { window.history.back(); } catch {} }}>返回上一页</button>
          </div>
          {typeof this.state.error?.message === 'string' && <small className="page-error-detail">{this.state.error.message.slice(0, 120)}</small>}
        </section>
      );
    }
    return this.props.children;
  }
}

function CircleAlertIcon() {
  return <svg className="page-error-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}

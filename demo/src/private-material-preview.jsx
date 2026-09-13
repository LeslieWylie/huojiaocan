import { lazy, Suspense, useEffect, useState } from 'react';
import { rootRequest, useAuthSession } from './app-core.js';
const PdfPagePreview = lazy(() => import('./pdf-page-preview.jsx'));

export function isPrivateMaterial(documentId) {
  return !['textbook', 'teacher-guide', 'curriculum-standard'].includes(documentId);
}

// A keyed child drops the old document/account URL immediately, including in-flight replies.
export default function PrivateMaterialPreview({ documentId, pageNumber, title }) {
  const session = useAuthSession();
  const owner = session?.user?.id || '';
  return <OriginalPreview key={`${owner}:${documentId}`} documentId={documentId} owner={owner} pageNumber={pageNumber} title={title}/>;
}
function OriginalPreview({ documentId, owner, pageNumber, title }) {
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSource(null); setError(''); setRenderError(false);
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      setError('original_timeout');
      controller.abort();
    }, 20000);
    if (owner) rootRequest(`/api/materials?documentId=${encodeURIComponent(documentId)}`, { signal: controller.signal })
      .then(data => {
        clearTimeout(timeout);
        if (!active) return;
        if (data.documentId !== documentId || !data.url) throw new Error('original_unavailable');
        setSource(data);
      }).catch(e => { clearTimeout(timeout); if (active) setError(e.code || e.message || 'original_unavailable'); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [documentId, owner, attempt]);
  const retry = () => { setSource(null); setError(''); setRenderError(false); setAttempt(n => n + 1); };
  if (!owner) return <div className="index-empty"><b>请登录后查看自己的原始材料</b><a href={`/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>登录</a></div>;
  if (error || renderError) return <div className="index-empty" role="alert"><b>{renderError ? '原始 PDF 绘制失败' : error === 'original_timeout' ? '读取原始 PDF 地址超时' : error === 'original_not_found' ? '未找到该材料的原始 PDF' : error === 'material_not_found' ? '该材料不存在或不属于当前账号' : '原始 PDF 地址暂时无法读取'}</b><p>{renderError ? '可以重新获取原件地址并加载，不会修改材料。' : '重试只读取原件，不会重新导入或检查材料。'}</p><button type="button" onClick={retry}>重新读取原件</button></div>;
  if (!source) return <div className="index-empty" role="status"><b>正在读取原始 PDF 地址…</b></div>;
  return <Suspense fallback={<p role="status">正在准备原始 PDF…</p>}><PdfPagePreview key={attempt} timeoutMs={30000} url={source.url} pageNumber={pageNumber} title={title} onError={() => setRenderError(true)}/><button type="button" onClick={retry}>重新读取原件</button></Suspense>;
}

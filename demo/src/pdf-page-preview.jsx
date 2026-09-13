import { useEffect, useRef, useState } from 'react';

// Keep the loaded document for page navigation; never substitute parsed text for the original page.
export default function PdfPagePreview({ url, pageNumber, title, onError, timeoutMs = 0 }) {
  const canvas = useRef(null);
  const [document, setDocument] = useState(null);
  const [ready, setReady] = useState(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    let active = true;
    let task;
    const timeout = timeoutMs ? setTimeout(() => { if (active) { errorHandler.current?.(); task?.destroy().catch(() => {}); } }, timeoutMs) : null;
    setDocument(null); setReady(false);
    import('pdfjs-dist').then(pdfjs => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      task = pdfjs.getDocument(url);
      return task.promise.then(pdf => { clearTimeout(timeout); if (active) setDocument({ url, pdf }); });
    }).catch(() => { clearTimeout(timeout); if (active) errorHandler.current?.(); });
    return () => { active = false; clearTimeout(timeout); task?.destroy().catch(() => {}); };
  }, [url, timeoutMs]);
  useEffect(() => {
    let active = true;
    let render;
    setReady(false);
    if (!document || document.url !== url) return;
    const timeout = timeoutMs ? setTimeout(() => { if (active) { errorHandler.current?.(); render?.cancel(); } }, timeoutMs) : null;
    document.pdf.getPage(Number(pageNumber)).then(page => {
      if (!active || !canvas.current) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      render = page.render({ canvasContext: target.getContext('2d'), viewport });
      return render.promise.then(() => { clearTimeout(timeout); if (active) setReady(true); });
    }).catch(error => { clearTimeout(timeout); if (active && error?.name !== 'RenderingCancelledException') errorHandler.current?.(); });
    return () => { active = false; clearTimeout(timeout); render?.cancel(); };
  }, [document, url, pageNumber, timeoutMs]);
  return <div className="pdf-page-preview" aria-busy={!ready}>
    {!ready && <p role="status">正在绘制教材第 {pageNumber} 页…</p>}
    <canvas ref={canvas} role="img" aria-label={title} style={{ visibility: ready ? 'visible' : 'hidden' }}/>
    <a href={`${url.split('#')[0]}#page=${pageNumber}`} target="_blank" rel="noreferrer">打开原始 PDF（可选择文字与缩放）</a>
  </div>;
}

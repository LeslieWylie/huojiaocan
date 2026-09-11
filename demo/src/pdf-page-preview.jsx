import { useEffect, useRef, useState } from 'react';

// Keep the loaded document for page navigation; never substitute parsed text for the original page.
export default function PdfPagePreview({ url, pageNumber, title, onError }) {
  const canvas = useRef(null);
  const [document, setDocument] = useState(null);
  const [ready, setReady] = useState(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    let active = true;
    let task;
    setDocument(null); setReady(false);
    import('pdfjs-dist').then(pdfjs => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      task = pdfjs.getDocument(url);
      return task.promise.then(pdf => { if (active) setDocument({ url, pdf }); });
    }).catch(() => { if (active) errorHandler.current?.(); });
    return () => { active = false; task?.destroy().catch(() => {}); };
  }, [url]);
  useEffect(() => {
    let active = true;
    let render;
    setReady(false);
    if (!document || document.url !== url) return;
    document.pdf.getPage(Number(pageNumber)).then(page => {
      if (!active || !canvas.current) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      render = page.render({ canvasContext: target.getContext('2d'), viewport });
      return render.promise.then(() => { if (active) setReady(true); });
    }).catch(error => { if (active && error?.name !== 'RenderingCancelledException') errorHandler.current?.(); });
    return () => { active = false; render?.cancel(); };
  }, [document, url, pageNumber]);
  return <div className="pdf-page-preview" aria-busy={!ready}>
    {!ready && <p role="status">正在绘制教材第 {pageNumber} 页…</p>}
    <canvas ref={canvas} role="img" aria-label={title} style={{ visibility: ready ? 'visible' : 'hidden' }}/>
    <a href={`${url.split('#')[0]}#page=${pageNumber}`} target="_blank" rel="noreferrer">打开原始 PDF（可选择文字与缩放）</a>
  </div>;
}

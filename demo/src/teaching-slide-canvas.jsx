import { useMemo, useState } from 'react';
import { EditableSlideCanvasWithUI } from '@openmaic/editor/ui';
import { applyEditorTransaction, createEditorHistory, redoEditorTransaction, undoEditorTransaction } from '@openmaic/editor/core';
import { SlideCanvas } from '@openmaic/renderer';
import { slideToPng } from '@openmaic/renderer/snapshot';
import { Redo2, Undo2 } from 'lucide-react';
import { teachingSlideDeckV2Html } from '../shared/teaching-slides-v2.js';
import '@openmaic/renderer/fonts.css';
import 'katex/dist/katex.min.css';

function createElementId() {
  return `teacher-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function createReplaceSlideTransaction(before, after) {
  const operations = [];
  const oldIds = before?.canvas?.elements?.map(item => item.id) || [];
  if (oldIds.length) operations.push({ type: 'element.deleteMany', elementIds: oldIds });
  for (const element of after?.canvas?.elements || []) operations.push({ type: 'element.add', element });
  const { id: _id, elements: _elements, animations: _animations, ...patch } = after.canvas;
  operations.push({ type: 'slide.update', patch });
  return { origin: 'system', history: 'record', operations };
}

export default function TeachingSlideCanvas({ slide, readOnly = false, onChange }) {
  const [selection, setSelection] = useState({ elementIds: [] });
  const [history, setHistory] = useState(() => createEditorHistory(slide.content));
  const host = useMemo(() => ({
    locale: 'zh-CN',
    createElementId,
    translate: (_key, _params, fallback) => fallback
  }), []);

  if (readOnly) return <div className="openmaic-slide-surface readonly"><SlideCanvas slide={slide.content.canvas} /></div>;

  const apply = transaction => {
    setHistory(current => {
      const next = applyEditorTransaction(current, transaction);
      onChange?.(next.present);
      return next;
    });
  };
  const navigate = direction => {
    setHistory(current => {
      const next = direction === 'undo' ? undoEditorTransaction(current) : redoEditorTransaction(current);
      if (next !== current) onChange?.(next.present);
      return next;
    });
  };

  return <div className="openmaic-slide-editor">
    <div className="openmaic-history" aria-label="画布编辑历史">
      <button type="button" onClick={() => navigate('undo')} disabled={!history.past.length} title="撤销"><Undo2/>撤销</button>
      <button type="button" onClick={() => navigate('redo')} disabled={!history.future.length} title="重做"><Redo2/>重做</button>
      <small>双击文字直接编辑；可拖动、缩放或插入文字、表格、线条和公式。</small>
    </div>
    <div className="openmaic-slide-surface">
      <EditableSlideCanvasWithUI
        slide={history.present.canvas}
        documentSlide={history.present.canvas}
        host={host}
        selection={selection}
        onSelectionChange={setSelection}
        onTransaction={apply}
        insertItems={['text', 'table', 'line', 'latex']}
        insertToolbarPlacement="top"
        elementIdPrefix="teaching-slide-element-"
        snapping
      />
    </div>
  </div>;
}

// Mirrors OpenMAIC's SlideThumbnail boundary: thumbnails use the same official
// renderer as the stage, rather than a separate text-only approximation.
export function TeachingSlideThumbnail({ slide }) {
  return <div className="openmaic-thumbnail-canvas" aria-hidden="true">
    <SlideCanvas
      slide={slide.content.canvas}
      chrome={false}
      elementIdPrefix={`teaching-slide-thumbnail-${slide.id}-`}
    />
  </div>;
}

export async function downloadTeachingSlidesProjector(deck) {
  const images = [];
  for (const slide of deck.slides) images.push(await slideToPng(slide.content.canvas, { width: 1280, pixelRatio: 1, format: 'dataUrl', backgroundColor: '#173d34' }));
  const url = URL.createObjectURL(new Blob([teachingSlideDeckV2Html(deck, images)], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(deck.lessonTitle || '课堂').replace(/[《》]/gu, '')}-课堂投屏稿.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

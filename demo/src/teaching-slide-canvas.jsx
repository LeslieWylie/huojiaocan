import { useMemo, useRef, useState } from 'react';
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

const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_OUTPUT_BYTES = 700 * 1024;

function dataUrlBytes(value) {
  const payload = String(value || '').split(',', 2)[1] || '';
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}

function loadLocalImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image_decode_failed')); };
    image.src = objectUrl;
  });
}

async function prepareTeachingSlideImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('image_type_invalid');
  if (file.size > MAX_IMAGE_INPUT_BYTES) throw new Error('image_input_too_large');
  const image = await loadLocalImage(file);
  let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  let quality = 0.86;
  let src = '';
  let width = 0;
  let height = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    width = Math.max(1, Math.round(image.naturalWidth * scale));
    height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    src = canvas.toDataURL('image/webp', quality);
    if (dataUrlBytes(src) <= MAX_IMAGE_OUTPUT_BYTES) return { src, ext: 'webp', width, height };
    if (quality > 0.62) quality -= 0.08;
    else scale *= 0.8;
  }
  throw new Error('image_output_too_large');
}

function TeachingImagePicker({ request, onError }) {
  const inputRef = useRef(null);
  const [working, setWorking] = useState(false);
  const pick = async file => {
    if (!file || working) return;
    setWorking(true); onError('');
    try { request.onPick(await prepareTeachingSlideImage(file)); }
    catch (error) {
      onError(error?.message === 'image_type_invalid' ? '请选择 PNG、JPG 或 WebP 图片。' : error?.message === 'image_input_too_large' ? '原图不能超过 12 MB。' : '这张图片无法处理，请换一张后重试。');
    } finally { setWorking(false); }
  };
  return <div className="teaching-image-picker">
    <button type="button" onClick={() => inputRef.current?.click()} disabled={working}>{working ? '正在压缩图片…' : '选择本地图片'}</button>
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void pick(event.target.files?.[0])}/>
    <small>支持 PNG、JPG、WebP；自动压缩后随课件保存，可离线投屏。</small>
  </div>;
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
  const [assetError, setAssetError] = useState('');
  const host = useMemo(() => ({
    locale: 'zh-CN',
    createElementId,
    translate: (_key, _params, fallback) => fallback,
    renderAssetPicker: request => <TeachingImagePicker request={request} onError={setAssetError}/>,
    onError: error => setAssetError(error?.message || '图片无法插入，请重试。')
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
      <small>双击文字直接编辑；可拖动、缩放或插入文字、图片、表格、线条和公式。</small>
    </div>
    {assetError && <div className="openmaic-asset-error" role="alert">{assetError}</div>}
    <div className="openmaic-slide-surface">
      <EditableSlideCanvasWithUI
        slide={history.present.canvas}
        documentSlide={history.present.canvas}
        host={host}
        selection={selection}
        onSelectionChange={setSelection}
        onTransaction={apply}
        insertItems={['text', 'image', 'table', 'line', 'latex']}
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

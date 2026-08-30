// app-core：从 App.jsx 抽出的纯工具函数与常量（无 JSX、无 React 状态）。
// 目标：App.jsx 只保留壳与路由，按页面的视图迁到 views/ 后从这里导入。
import { buildPdfPageUrl, buildReaderHref } from './reader-target.js';
import { errorCopy } from './copy.js';
import { accessToken, ensureSession, refreshSession, sessionExpired } from './auth.js';

export const API = '/api/index';

export const DOC_LABELS = { textbook: '学生教材', 'teacher-guide': '教师教学用书', 'curriculum-standard': '课程标准' };

export function queryParams() { return new URLSearchParams(location.search); }

export function canonicalDocumentId(value) {
  const raw = String(value || '').trim();
  const id = raw.toLowerCase();
  if (id === 'teacher_guide' || id === 'guide') return 'teacher-guide';
  if (['curriculum_standard', 'curriculum', 'standard', 'course-standard'].includes(id)) return 'curriculum-standard';
  return raw;
}

export function pdfPageUrl(value, page) { return buildPdfPageUrl(value, page); }

export function terminalJob(status) {
  return ['ready', 'partial', 'failed', 'completed', 'succeeded', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function statusLabel(status) {
  return ({ queued: '等待处理', pending: '等待处理', running: '正在处理', processing: '正在处理', ready: '已准备好，可搜索', partial: '已准备好，少量页面待核对', failed: '处理失败', succeeded: '已完成', completed: '已完成', not_run: '尚未检查', unknown: '尚未检查' })[String(status || '').toLowerCase()] || '尚未检查';
}

export function pageText(page, source) {
  if (!page) return '';
  if (source === 'native') return page.nativeText || page.native_text || '';
  if (source === 'ocr') return page.ocrText || page.ocr_text || '';
  return page.retrievalText || page.retrieval_text || page.text || '';
}

export function pageTitle(page) {
  return page?.pageTitle || page?.page_title || page?.title || '正在读取页面';
}

export function routeId() { return document.body.dataset.route || 'dashboard'; }

export function currentPageReturn() { return `${location.pathname}${location.search}${location.hash}`; }

export function docName(id) { return DOC_LABELS[canonicalDocumentId(id)] || id || '教材'; }

export function citationPage(c) {
  const value = Number(c?.pdfPage ?? c?.pageNumber ?? c?.page ?? 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function citationText(c) { return c?.text || c?.quote || c?.snippet || ''; }

export function safeDownloadStem(value, fallback = '课堂设计') {
  const text = String(value || '').replace(/[《》]/gu, '').replace(/[\\/:*?"<>|]/gu, '-').replace(/\s+/gu, ' ').trim();
  return (text || fallback).slice(0, 48);
}

export function citationLink(c, returnTo = '') {
  const page = citationPage(c);
  if (!page || !c?.documentId) return '';
  return buildReaderHref({
    documentId: canonicalDocumentId(c.documentId),
    page,
    nodeId: c.nodeId || c.node_id,
    lessonTitle: c.lessonTitle || c.lesson_title || c.title,
    returnTo,
    scope: c.scope
  });
}

export function requestCode(error) { return String(error?.code || error?.message || '').trim(); }

export function isIndexRecoveryCode(code) {
  return ['pageindex_unavailable', 'pageindex_timeout', 'pageindex_rate_limited', 'pageindex_invalid_response', 'pageindex_request_failed', 'index_provider_error'].includes(code);
}

export function askErrorMessage(error) { return errorCopy(error); }

// ---- HTTP 请求层（原在 App.jsx） ----
export async function fetchJson(url, options = {}) {
  const original = { ...options };
  const isFormData = typeof FormData !== 'undefined' && original.body instanceof FormData;
  const isBinaryBody = typeof Blob !== 'undefined' && original.body instanceof Blob
    || typeof ArrayBuffer !== 'undefined' && (original.body instanceof ArrayBuffer || ArrayBuffer.isView(original.body));
  const body = original.body && !isFormData && !isBinaryBody && typeof original.body !== 'string' ? JSON.stringify(original.body) : original.body;
  const baseHeaders = { ...(isFormData || isBinaryBody ? {} : { 'Content-Type': 'application/json' }), ...(original.headers || {}) };
  let token = accessToken();
  if (token && sessionExpired()) {
    await ensureSession();
    token = accessToken();
  }
  const send = currentToken => {
    const headers = { ...baseHeaders };
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    return fetch(url, { ...original, headers, body });
  };
  let response = await send(token);
  if (response.status === 401 && token) {
    const refreshed = await refreshSession();
    if (refreshed?.access_token) response = await send(refreshed.access_token);
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.detail || payload.message || `request_failed_${response.status}`);
    error.code = payload.error || payload.code || (response.status === 401 ? 'auth_invalid' : '');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function request(path, options = {}) { return fetchJson(`${API}${path}`, options); }
export async function rootRequest(path, options = {}) { return fetchJson(path, options); }

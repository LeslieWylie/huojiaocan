import crypto from 'node:crypto';
import { confirmedDraftContext } from './draft-revisions.js';

const PUBLIC_DOCUMENTS = new Set(['textbook', 'teacher-guide', 'curriculum-standard']);

function text(value, max = 1200) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function list(value, max = 10) {
  return (Array.isArray(value) ? value : []).slice(0, max).map(item => {
    if (typeof item === 'string') return text(item, 900);
    if (!item || typeof item !== 'object') return '';
    return {
      title: text(item.title || item.name, 120),
      content: text(item.content || item.description || item.activity || item.text, 900),
      teacherAction: text(item.teacherAction, 700),
      studentTask: text(item.studentTask, 700),
      expectedEvidence: text(item.expectedEvidence, 700),
      duration: text(item.duration, 60)
    };
  }).filter(item => typeof item === 'string' ? item : Object.values(item).some(Boolean));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
  return value;
}

export function createShareToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function validShareToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{32}$/u.test(token)) {
    throw Object.assign(new Error('share_token_invalid'), { code: 'share_token_invalid', status: 400 });
  }
  return token;
}

export function shareTokenHash(value) {
  return crypto.createHash('sha256').update(validShareToken(value)).digest('hex');
}

export function snapshotDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function publicCitations(source = []) {
  const used = new Map();
  const citations = [];
  for (const item of Array.isArray(source) ? source : []) {
    const documentId = text(item?.documentId || item?.document_id, 120).replaceAll('_', '-');
    const pdfPage = Number(item?.pdfPage ?? item?.pageNumber ?? item?.page);
    if (!PUBLIC_DOCUMENTS.has(documentId) || !Number.isInteger(pdfPage) || pdfPage < 1) continue;
    const originalId = text(item?.id || item?.citationId, 120);
    const id = `S${citations.length + 1}`;
    citations.push({
      id,
      documentId,
      documentType: documentId,
      pdfPage,
      printedPage: text(item?.printedPage || item?.printed_page, 40),
      title: text(item?.title || (Array.isArray(item?.sectionPath) ? item.sectionPath.at(-1) : ''), 180)
    });
    if (originalId) used.set(originalId, id);
  }
  return { citations, used };
}

function publicCards(cards, citationIds) {
  return (Array.isArray(cards) ? cards : []).slice(0, 3).map((card, cardIndex) => ({
    id: `card-${cardIndex + 1}`,
    type: ['board', 'question', 'assessment'].includes(card?.type) ? card.type : 'teaching',
    title: text(card?.title, 120) || ['板书卡', '提问卡', '评价卡'][cardIndex] || '课堂卡',
    subtitle: text(card?.subtitle, 260),
    locked: card?.status === 'locked',
    items: (Array.isArray(card?.items) ? card.items : Array.isArray(card?.content) ? card.content : []).slice(0, 10).map((item, index) => {
      const value = typeof item === 'string' ? { text: item } : item || {};
      return {
        id: `item-${index + 1}`,
        text: text(value.text || value.content, 1200),
        sourceType: text(value.sourceType, 80),
        citationIds: [...new Set((Array.isArray(value.citationIds) ? value.citationIds : []).map(id => citationIds.get(String(id))).filter(Boolean))].slice(0, 3)
      };
    }).filter(item => item.text)
  })).filter(card => card.items.length);
}

/**
 * Build an immutable, deliberately narrow teaching-research snapshot.
 * It never includes account identity, conversation history, private document
 * text, PDF URLs, model settings, keys, classroom observations or revisions.
 */
export function buildTeachingShareSnapshot(draft = {}, { now = new Date().toISOString() } = {}) {
  const confirmation = confirmedDraftContext(draft);
  const approval = draft.answer?.planApproval || {};
  if (approval.status !== 'confirmed' || approval.hasUnconfirmedChanges === true) {
    throw Object.assign(new Error('plan_confirmation_required'), { code: 'plan_confirmation_required', status: 409 });
  }
  const plan = confirmation.snapshot.plan || {};
  const conditions = confirmation.snapshot.conditions || {};
  const { citations, used } = publicCitations(confirmation.snapshot.citations);
  if (!citations.length) throw Object.assign(new Error('share_public_evidence_required'), { code: 'share_public_evidence_required', status: 422 });
  const cards = publicCards(draft.cards, used);
  if (!cards.length) throw Object.assign(new Error('share_cards_required'), { code: 'share_cards_required', status: 422 });
  const snapshot = {
    version: 1,
    title: text(conditions.title || plan.lesson?.title || draft.title, 180) || '未命名备课',
    question: text(conditions.question || draft.question, 600),
    lesson: {
      title: text(plan.lesson?.title || conditions.title || draft.title, 180),
      coreQuestion: text(plan.lesson?.coreQuestion || conditions.question || draft.question, 600)
    },
    lessonContext: {
      periods: Math.max(1, Math.min(8, Number(conditions.lessonContext?.periods) || 1)),
      className: text(conditions.lessonContext?.className, 80),
      classLevel: text(conditions.lessonContext?.classLevel, 120),
      teachingGoal: text(conditions.lessonContext?.teachingGoal, 240),
      teachingMode: text(conditions.lessonContext?.teachingMode, 120)
    },
    plan: {
      summary: text(plan.summary, 1800),
      objectives: list(plan.objectives, 8),
      keyPoints: list(plan.keyPoints, 8),
      lessonPlan: list(plan.lessonPlan, 10),
      questionChain: list(plan.questionChain, 10),
      homework: list(plan.homework, 8),
      assessment: list(plan.assessment, 8)
    },
    cards,
    citations,
    sourceCoverage: {
      textbook: citations.some(item => item.documentId === 'textbook'),
      teacherGuide: citations.some(item => item.documentId === 'teacher-guide'),
      curriculumStandard: citations.some(item => item.documentId === 'curriculum-standard')
    },
    confirmedAt: confirmation.confirmedAt || null,
    publishedAt: now,
    notice: '这是教师发布的只读备课快照。教材页码可用于核对，具体课堂使用仍需教师审核。'
  };
  return { ...snapshot, digest: snapshotDigest(snapshot) };
}

export function publicShareRecord(row = {}) {
  return {
    id: row.id,
    draftId: row.draft_id,
    title: row.snapshot?.title || '未命名备课',
    status: row.revoked_at ? 'revoked' : new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'active',
    version: Number(row.version || 1),
    snapshotDigest: row.snapshot_digest,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at
  };
}

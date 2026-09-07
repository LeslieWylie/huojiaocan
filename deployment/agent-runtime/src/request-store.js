import { randomUUID } from 'node:crypto';
import { splitSqlStatements } from '@openmaic/storage';
import { createAgentSessionStore } from './database.js';
import { REQUEST_STATUSES, RUNNING_REQUEST_STATUSES } from './constants.js';

export const TEACHING_AGENT_REQUEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS teaching_agent_requests (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL,
  client_request_id   TEXT NOT NULL,
  session_id          TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  message_seq         INTEGER NOT NULL,
  draft_id            TEXT NOT NULL,
  draft_version       INTEGER NOT NULL,
  connection_id       TEXT NOT NULL,
  question            TEXT NOT NULL,
  input_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  material_snapshot   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'queued',
  result              JSONB,
  error_code          TEXT,
  model_call_count    INTEGER NOT NULL DEFAULT 0,
  lease_attempt       INTEGER,
  result_ready_at     TIMESTAMPTZ,
  saved_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teaching_agent_requests_owner_client_unique UNIQUE (owner_id, client_request_id),
  CONSTRAINT teaching_agent_requests_draft_version_positive CHECK (draft_version > 0),
  CONSTRAINT teaching_agent_requests_model_calls_nonnegative CHECK (model_call_count >= 0),
  CONSTRAINT teaching_agent_requests_status_known CHECK (status IN
    ('queued','retrieving','composing','checking','ready_to_save','saved',
     'needs_evidence','needs_input','interrupted','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS teaching_agent_requests_session_queue_idx
  ON teaching_agent_requests (session_id, message_seq)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS teaching_agent_requests_owner_updated_idx
  ON teaching_agent_requests (owner_id, updated_at DESC);
`;

export async function ensureTeachingAgentRequestSchema(queryable) {
  for (const statement of splitSqlStatements(TEACHING_AGENT_REQUEST_SCHEMA)) {
    await queryable.query(statement);
  }
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    clientRequestId: row.client_request_id,
    sessionId: row.session_id,
    messageSeq: Number(row.message_seq),
    draftId: row.draft_id,
    draftVersion: Number(row.draft_version),
    connectionId: row.connection_id,
    question: row.question,
    inputSnapshot: jsonValue(row.input_snapshot, {}),
    materialSnapshot: jsonValue(row.material_snapshot, []),
    status: row.status,
    result: jsonValue(row.result, null),
    errorCode: row.error_code || null,
    modelCallCount: Number(row.model_call_count || 0),
    leaseAttempt: row.lease_attempt === null ? null : Number(row.lease_attempt),
    resultReadyAt: row.result_ready_at || null,
    savedAt: row.saved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class TeachingRequestExistsError extends Error {
  constructor(ownerId, clientRequestId) {
    super('teaching_request_exists');
    this.name = 'TeachingRequestExistsError';
    this.ownerId = ownerId;
    this.clientRequestId = clientRequestId;
  }
}

export class TeachingRequestStore {
  constructor(queryable, withTransaction) {
    this.queryable = queryable;
    this.withTransaction = withTransaction;
  }

  async getByClientRequest(ownerId, clientRequestId) {
    const result = await this.queryable.query(
      'SELECT * FROM teaching_agent_requests WHERE owner_id = $1 AND client_request_id = $2',
      [ownerId, clientRequestId]
    );
    return mapRequest(result.rows[0]);
  }

  async getOwned(id, ownerId) {
    const result = await this.queryable.query(
      'SELECT * FROM teaching_agent_requests WHERE id = $1 AND owner_id = $2',
      [id, ownerId]
    );
    return mapRequest(result.rows[0]);
  }

  async listForSession(sessionId, ownerId) {
    const result = await this.queryable.query(
      'SELECT * FROM teaching_agent_requests WHERE session_id = $1 AND owner_id = $2 ORDER BY message_seq',
      [sessionId, ownerId]
    );
    return result.rows.map(mapRequest);
  }

  async claimQueued(sessionId, attempt) {
    return this.withTransaction(async tx => {
      const selected = await tx.query(
        `SELECT id FROM teaching_agent_requests
         WHERE session_id = $1 AND status = 'queued'
         ORDER BY message_seq LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [sessionId]
      );
      if (!selected.rows[0]) return null;
      const updated = await tx.query(
        `UPDATE teaching_agent_requests
         SET status = 'retrieving', lease_attempt = $2, error_code = NULL, updated_at = now()
         WHERE id = $1 AND status = 'queued' RETURNING *`,
        [selected.rows[0].id, attempt]
      );
      return mapRequest(updated.rows[0]);
    });
  }

  async findRecoverable(sessionId) {
    const result = await this.queryable.query(
      `SELECT * FROM teaching_agent_requests
       WHERE session_id = $1 AND status IN ('retrieving','composing','checking','ready_to_save')
       ORDER BY message_seq LIMIT 1`,
      [sessionId]
    );
    return mapRequest(result.rows[0]);
  }

  async setPhase(id, status, { expected, attempt, errorCode = null } = {}) {
    if (!REQUEST_STATUSES.includes(status)) throw new Error('invalid_request_status');
    const expectedList = Array.isArray(expected) ? expected : expected ? [expected] : [];
    const params = [id, status, errorCode];
    const expectedSql = expectedList.length ? ` AND status = ANY($${params.push(expectedList)}::text[])` : '';
    const attemptSql = attempt === undefined ? '' : ` AND lease_attempt = $${params.push(attempt)}`;
    const result = await this.queryable.query(
      `UPDATE teaching_agent_requests SET status = $2, error_code = $3, updated_at = now()
       WHERE id = $1${expectedSql}${attemptSql} RETURNING *`,
      params
    );
    return mapRequest(result.rows[0]);
  }

  async markModelStarted(id, attempt) {
    const result = await this.queryable.query(
      `UPDATE teaching_agent_requests
       SET status = 'composing', model_call_count = model_call_count + 1, updated_at = now()
       WHERE id = $1 AND status = 'retrieving' AND lease_attempt = $2 RETURNING *`,
      [id, attempt]
    );
    return mapRequest(result.rows[0]);
  }

  async markResultReady(id, attempt, result) {
    const updated = await this.queryable.query(
      `UPDATE teaching_agent_requests
       SET status = 'ready_to_save', result = $3::jsonb, result_ready_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('composing','checking') AND lease_attempt = $2 RETURNING *`,
      [id, attempt, JSON.stringify(result)]
    );
    return mapRequest(updated.rows[0]);
  }

  async markSaved(id) {
    const updated = await this.queryable.query(
      `UPDATE teaching_agent_requests
       SET status = 'saved', saved_at = now(), error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'ready_to_save' RETURNING *`,
      [id]
    );
    return mapRequest(updated.rows[0]);
  }

  async markInterrupted(id) {
    const updated = await this.queryable.query(
      `UPDATE teaching_agent_requests
       SET status = 'interrupted', error_code = 'execution_result_unknown', updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`,
      [id, [...RUNNING_REQUEST_STATUSES]]
    );
    return mapRequest(updated.rows[0]);
  }

  async hasQueued(sessionId) {
    const result = await this.queryable.query(
      `SELECT EXISTS(SELECT 1 FROM teaching_agent_requests WHERE session_id = $1 AND status = 'queued') AS queued`,
      [sessionId]
    );
    return result.rows[0]?.queued === true;
  }

  async cancelOpenRequests(sessionId, ownerId) {
    const result = await this.queryable.query(
      `UPDATE teaching_agent_requests
       SET status = 'cancelled', error_code = NULL, updated_at = now()
       WHERE session_id = $1 AND owner_id = $2
         AND status IN ('queued','retrieving','composing','checking','ready_to_save')
       RETURNING *`,
      [sessionId, ownerId]
    );
    return result.rows.map(mapRequest);
  }
}

export async function postIdempotentTeachingRequest({
  queryable,
  withTransaction,
  ownerId,
  sessionId,
  input
}) {
  const clientRequestId = String(input.clientRequestId || '').trim();
  if (!clientRequestId) throw Object.assign(new Error('client_request_id_required'), { status: 400 });
  const requestStore = new TeachingRequestStore(queryable, withTransaction);
  const store = createAgentSessionStore(queryable, {
    withTransaction,
    createId: () => clientRequestId,
    onUserMessagePosted: async (tx, event) => {
      const inserted = await tx.query(
        `INSERT INTO teaching_agent_requests
          (id, owner_id, client_request_id, session_id, message_seq, draft_id, draft_version,
           connection_id, question, input_snapshot, material_snapshot, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,'queued')
         ON CONFLICT (owner_id, client_request_id) DO NOTHING RETURNING id`,
        [
          randomUUID(), ownerId, clientRequestId, sessionId, event.seq,
          input.draftId, input.draftVersion, input.connectionId, input.question,
          JSON.stringify(input.inputSnapshot || {}), JSON.stringify(input.materialSnapshot || [])
        ]
      );
      if (!inserted.rows[0]) throw new TeachingRequestExistsError(ownerId, clientRequestId);
    }
  });
  let reused = false;
  try {
    await store.postUserMessage(sessionId, { text: input.question }, { expectedOwnerId: ownerId });
  } catch (error) {
    if (!(error instanceof TeachingRequestExistsError)) throw error;
    reused = true;
  }
  return { request: await requestStore.getByClientRequest(ownerId, clientRequestId), reused };
}

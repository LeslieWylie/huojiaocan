-- Generated from @openmaic/storage@0.29.0. Do not edit by hand.
-- Regenerate with: npm run migration:generate

CREATE TABLE IF NOT EXISTS agent_sessions (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL,
  prompt              TEXT NOT NULL,
  title               TEXT,
  title_state         TEXT NOT NULL DEFAULT 'manual',
  stage_id            TEXT NOT NULL,
  active_stage_id     TEXT,
  skill_id            TEXT,
  origin              TEXT,
  existing_course     BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'queued',
  attempt             INTEGER NOT NULL DEFAULT 0,
  delivered_user_message_seq INTEGER NOT NULL DEFAULT 0,
  lease_worker_id     TEXT,
  lease_worker_pid    INTEGER,
  lease_heartbeat_at  BIGINT,
  cancel_requested_at BIGINT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT agent_sessions_attempt_nonnegative CHECK (attempt >= 0),
  CONSTRAINT agent_sessions_title_state_known
    CHECK (title_state IN ('pending','automatic','manual')),
  CONSTRAINT agent_sessions_status_known
    CHECK (status IN ('queued','running','succeeded','failed','cancelled'))
);

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS delivered_user_message_seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS title_state TEXT NOT NULL DEFAULT 'manual';

DO $agent_session_title_state_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_sessions'::regclass
      AND conname = 'agent_sessions_title_state_known'
  ) THEN
    LOCK TABLE agent_sessions IN ACCESS EXCLUSIVE MODE;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'agent_sessions'::regclass
        AND conname = 'agent_sessions_title_state_known'
    ) THEN
      ALTER TABLE agent_sessions
        ADD CONSTRAINT agent_sessions_title_state_known
        CHECK (title_state IN ('pending','automatic','manual'))
        NOT VALID;
    END IF;
  END IF;
END
$agent_session_title_state_constraint$;

DO $agent_session_title_state_validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_sessions'::regclass
      AND conname = 'agent_sessions_title_state_known'
      AND NOT convalidated
  ) THEN
    ALTER TABLE agent_sessions
      VALIDATE CONSTRAINT agent_sessions_title_state_known;
  END IF;
END
$agent_session_title_state_validation$;

CREATE INDEX IF NOT EXISTS agent_sessions_status_live_idx
  ON agent_sessions (status, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_sessions_owner_live_idx
  ON agent_sessions (owner_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_session_events (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  ts         BIGINT NOT NULL,
  attempt    INTEGER NOT NULL,
  type       TEXT NOT NULL,
  data       JSONB,
  PRIMARY KEY (session_id, seq),
  CONSTRAINT agent_session_events_seq_positive CHECK (seq > 0)
);

CREATE TABLE IF NOT EXISTS agent_session_entries (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  entry_id   TEXT NOT NULL,
  parent_id  TEXT,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  attempt    INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq),
  CONSTRAINT agent_session_entries_entry_id_unique UNIQUE (session_id, entry_id),
  CONSTRAINT agent_session_entries_parent_fk
    FOREIGN KEY (session_id, parent_id)
    REFERENCES agent_session_entries (session_id, entry_id)
);

CREATE INDEX IF NOT EXISTS agent_session_entries_type_idx
  ON agent_session_entries (session_id, type, seq);

CREATE TABLE IF NOT EXISTS agent_owner_session_event_counters (
  owner_id TEXT PRIMARY KEY,
  n        BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT agent_owner_session_event_counters_nonnegative CHECK (n >= 0)
);

CREATE TABLE IF NOT EXISTS agent_owner_session_events (
  owner_id   TEXT NOT NULL,
  id         BIGINT NOT NULL,
  ts         BIGINT NOT NULL,
  session_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  status     TEXT,
  attempt    INTEGER,
  data       JSONB NOT NULL,
  PRIMARY KEY (owner_id, id),
  CONSTRAINT agent_owner_session_events_type_known_v2 CHECK (type IN
    ('session_created','session_status','session_deleted',
     'session_active_stage','session_cancel_requested','session_title')),
  CONSTRAINT agent_owner_session_events_status_known CHECK (status IS NULL OR status IN
    ('queued','running','succeeded','failed','cancelled')),
  CONSTRAINT agent_owner_session_events_attempt_nonnegative
    CHECK (attempt IS NULL OR attempt >= 0)
);

DO $agent_session_owner_event_type_constraint$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_owner_session_events'::regclass
      AND conname = 'agent_owner_session_events_type_known'::name
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_owner_session_events'::regclass
      AND conname = 'agent_owner_session_events_type_known_v2'
  ) THEN
    LOCK TABLE agent_owner_session_events IN ACCESS EXCLUSIVE MODE;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'agent_owner_session_events'::regclass
        AND conname = 'agent_owner_session_events_type_known_v2'
    ) THEN
      ALTER TABLE agent_owner_session_events
        ADD CONSTRAINT agent_owner_session_events_type_known_v2 CHECK (type IN
          ('session_created','session_status','session_deleted',
           'session_active_stage','session_cancel_requested','session_title'))
        NOT VALID;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'agent_owner_session_events'::regclass
        AND conname = 'agent_owner_session_events_type_known'::name
    ) THEN
      ALTER TABLE agent_owner_session_events
        DROP CONSTRAINT agent_owner_session_events_type_known;
    END IF;
  END IF;
END
$agent_session_owner_event_type_constraint$;

-- Installing the superset above is a catalog-only operation while the short
-- ACCESS EXCLUSIVE lock is held. Validate separately so PostgreSQL scans an
-- existing projection table under VALIDATE CONSTRAINT's weaker lock instead.
-- Once validated, later initializers avoid taking that table lock altogether.
DO $agent_session_owner_event_type_validation$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'agent_owner_session_events'::regclass
      AND conname = 'agent_owner_session_events_type_known_v2'
      AND NOT convalidated
  ) THEN
    ALTER TABLE agent_owner_session_events
      VALIDATE CONSTRAINT agent_owner_session_events_type_known_v2;
  END IF;
END
$agent_session_owner_event_type_validation$;

CREATE TABLE IF NOT EXISTS agent_session_urls (
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, url),
  CONSTRAINT agent_session_urls_source_known CHECK (source IN ('user','web_search'))
);

CREATE INDEX IF NOT EXISTS agent_session_urls_session_created_idx
  ON agent_session_urls (session_id, created_at);

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

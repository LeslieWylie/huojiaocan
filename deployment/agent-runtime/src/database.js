import pg from 'pg';
import { PgAgentSessionStore } from '@openmaic/storage/agent-session/pg';

const { Pool } = pg;

export function createTransactionHook(pool) {
  return async body => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
}

export function createAgentSessionStore(pool, options = {}) {
  return new PgAgentSessionStore(pool, {
    ...options,
    withTransaction: options.withTransaction || createTransactionHook(pool)
  });
}

export function createHyperdrivePool(env) {
  const connectionString = env?.HYPERDRIVE?.connectionString;
  if (!connectionString) throw Object.assign(new Error('hyperdrive_not_configured'), { code: 'hyperdrive_not_configured' });
  return new Pool({
    connectionString,
    // Hyperdrive owns the long-lived origin pool. Keep this request-scoped
    // client pool small, but allow enough time for Hyperdrive's documented
    // 15-second cold origin connection window.
    max: 5,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true
  });
}

const { getPool } = require('../db');

async function countUsers() {
  const db = getPool();
  if (!db) return 0;
  const result = await db.query('SELECT COUNT(*)::int AS count FROM users');
  return result.rows[0].count;
}

async function loadUsers() {
  const db = getPool();
  if (!db) return null;
  const result = await db.query('SELECT id, payload FROM users ORDER BY id');
  return result.rows.map(row => ({ ...(row.payload || {}), id: Number(row.id) }));
}

async function saveUsers(users) {
  const db = getPool();
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const user of users) {
      const id = Number(user.id);
      if (!Number.isFinite(id)) continue;
      await client.query(`
        INSERT INTO users (id, payload, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `, [id, JSON.stringify({ ...user, id })]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadSessions() {
  const db = getPool();
  if (!db) return [];
  const result = await db.query(`
    SELECT token, user_id, payload, created_at, last_seen_at
    FROM app_sessions
    WHERE expires_at IS NULL OR expires_at > NOW()
  `);
  return result.rows.map(row => ({
    token: row.token,
    userId: Number(row.user_id),
    ...row.payload,
    createdAt: new Date(row.created_at).getTime(),
    lastSeenAt: new Date(row.last_seen_at).getTime()
  }));
}

async function saveSession(token, session, expiresAt = null) {
  const db = getPool();
  if (!db) return;
  await db.query(`
    INSERT INTO app_sessions (token, user_id, payload, created_at, last_seen_at, expires_at)
    VALUES ($1, $2, $3::jsonb, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6)
    ON CONFLICT (token) DO UPDATE SET
      payload = EXCLUDED.payload,
      last_seen_at = EXCLUDED.last_seen_at,
      expires_at = EXCLUDED.expires_at
  `, [token, Number(session.userId), JSON.stringify(session), session.loginTimestamp, session.lastSeenAt, expiresAt]);
}

async function deleteSession(token) {
  const db = getPool();
  if (!db) return;
  await db.query('DELETE FROM app_sessions WHERE token = $1', [token]);
}

async function loadOAuthState() {
  const db = getPool();
  if (!db) return null;
  const result = await db.query('SELECT payload FROM oauth_tokens WHERE token_key = $1', ['meta']);
  return result.rows[0]?.payload || null;
}

async function saveOAuthState(payload) {
  const db = getPool();
  if (!db) return;
  await db.query(`
    INSERT INTO oauth_tokens (token_key, payload, updated_at)
    VALUES ('meta', $1::jsonb, NOW())
    ON CONFLICT (token_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
  `, [JSON.stringify(payload)]);
}

async function recordWebhookEvent(eventKey, payload) {
  const db = getPool();
  if (!db || !eventKey) return;
  await db.query(`
    INSERT INTO webhook_events (event_key, payload)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (event_key) DO NOTHING
  `, [eventKey, JSON.stringify(payload || {})]);
}

module.exports = {
  countUsers,
  loadUsers,
  saveUsers,
  loadSessions,
  saveSession,
  deleteSession,
  loadOAuthState,
  saveOAuthState,
  recordWebhookEvent
};

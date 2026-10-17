const { getPool } = require('../db');

function normalizeConversation(row) {
  const conversation = row.payload || {};
  conversation.id = Number(row.id);
  conversation.messages = Array.isArray(row.messages) ? row.messages : [];
  return conversation;
}

async function countConversations() {
  const db = getPool();
  if (!db) return 0;
  const result = await db.query('SELECT COUNT(*)::int AS count FROM conversations WHERE deleted_at IS NULL');
  return result.rows[0].count;
}

async function loadConversations() {
  const db = getPool();
  if (!db) return null;
  const result = await db.query(`
    SELECT
      c.id,
      c.payload,
      COALESCE(
        json_agg(m.payload ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL),
        '[]'::json
      ) AS messages
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.deleted_at IS NULL
    GROUP BY c.id, c.payload, c.updated_at
    ORDER BY c.updated_at DESC, c.id DESC
  `);
  return result.rows.map(normalizeConversation);
}

async function saveConversations(conversations) {
  const db = getPool();
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const conversation of conversations) {
      const id = Number(conversation.id);
      if (!Number.isFinite(id)) continue;
      const payload = { ...conversation, messages: undefined };
      delete payload.messages;
      await client.query(`
        INSERT INTO conversations (id, payload, deleted_at, updated_at)
        VALUES ($1, $2::jsonb, NULL, NOW())
        ON CONFLICT (id) DO UPDATE
        SET payload = EXCLUDED.payload, deleted_at = NULL, updated_at = NOW()
      `, [id, JSON.stringify(payload)]);
      await client.query('DELETE FROM messages WHERE conversation_id = $1', [id]);
      for (const message of Array.isArray(conversation.messages) ? conversation.messages : []) {
        await client.query(
          'INSERT INTO messages (conversation_id, payload) VALUES ($1, $2::jsonb)',
          [id, JSON.stringify(message)]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteConversation(id, deletedBy = null) {
  const db = getPool();
  if (!db) return false;
  const result = await db.query(`
    UPDATE conversations
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `, [Number(id)]);
  if (!result.rowCount) return false;
  await db.query(
    'INSERT INTO conversation_events (conversation_id, event_type, payload) VALUES ($1, $2, $3::jsonb)',
    [Number(id), 'conversation_deleted', JSON.stringify({ deletedBy })]
  );
  return true;
}

module.exports = { countConversations, loadConversations, saveConversations, deleteConversation };

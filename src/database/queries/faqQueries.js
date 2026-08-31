import { pool } from '../pool.js';

/**
 * Create a new dynamic embed record.
 * @param {object} param0
 * @param {string} param0.id
 * @param {string} param0.channelId
 * @param {string} param0.messageId
 * @param {string} param0.title
 * @param {string} [param0.description]
 * @param {string} [param0.color]
 * @param {Array} [param0.fields]
 */
export async function createDynamicEmbed({ id, channelId, messageId, title, description = '', color = 'PRIMARY', fields = [] }) {
  const { rows } = await pool.query(
    `INSERT INTO dynamic_embeds (id, channel_id, message_id, title, description, color, fields, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [id, channelId, messageId, title, description, color, JSON.stringify(fields)]
  );
  return rows[0];
}

/**
 * Get a dynamic embed by ID.
 * @param {string} id
 */
export async function getDynamicEmbedById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM dynamic_embeds WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/**
 * Get all dynamic embeds.
 */
export async function getAllDynamicEmbeds() {
  const { rows } = await pool.query(
    'SELECT * FROM dynamic_embeds ORDER BY created_at DESC'
  );
  return rows;
}

/**
 * Update the header (title, description, color) of a dynamic embed.
 * @param {string} id
 * @param {object} param1
 */
export async function updateDynamicEmbedHeader(id, { title, description, color }) {
  const { rows } = await pool.query(
    `UPDATE dynamic_embeds
     SET title = COALESCE($2, title),
         description = COALESCE($3, description),
         color = COALESCE($4, color),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, title, description, color]
  );
  return rows[0] || null;
}

/**
 * Update the fields JSON array of a dynamic embed.
 * @param {string} id
 * @param {Array} fields
 */
export async function updateDynamicEmbedFields(id, fields) {
  const { rows } = await pool.query(
    `UPDATE dynamic_embeds
     SET fields = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(fields)]
  );
  return rows[0] || null;
}

/**
 * Delete a dynamic embed record from DB.
 * @param {string} id
 */
export async function deleteDynamicEmbed(id) {
  await pool.query('DELETE FROM dynamic_embeds WHERE id = $1', [id]);
}

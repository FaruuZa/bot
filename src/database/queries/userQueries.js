import { pool } from '../pool.js';

export async function upsertUser(discordId, username, client = pool) {
  const sql = `
    INSERT INTO users (discord_id, username, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (discord_id) 
    DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()
    RETURNING *;
  `;
  const res = await client.query(sql, [discordId, username]);
  return res.rows[0];
}

export async function getUserByDiscordId(discordId, client = pool) {
  const sql = `SELECT * FROM users WHERE discord_id = $1;`;
  const res = await client.query(sql, [discordId]);
  return res.rows[0] || null;
}

export async function getUserById(id, client = pool) {
  const sql = `SELECT * FROM users WHERE id = $1;`;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

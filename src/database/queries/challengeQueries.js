import { pool } from '../pool.js';

/**
 * Buat challenge baru
 */
export async function createChallenge({ title, description }, client = pool) {
  const sql = `
    INSERT INTO challenges (title, description, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [title.trim(), description?.trim() || null]);
  return res.rows[0];
}

/**
 * Ambil semua challenge
 */
export async function getAllChallenges(client = pool) {
  const sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM teams t WHERE t.challenge_id = c.id AND t.status = 'ACTIVE') as team_count
    FROM challenges c
    ORDER BY c.title ASC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

/**
 * Ambil challenge berdasarkan ID
 */
export async function getChallengeById(id, client = pool) {
  const sql = `
    SELECT * FROM challenges WHERE id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Update challenge
 */
export async function updateChallenge(id, { title, description }, client = pool) {
  const sql = `
    UPDATE challenges
    SET title = $2, description = $3, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [id, title.trim(), description?.trim() || null]);
  return res.rows[0] || null;
}

/**
 * Hapus challenge
 */
export async function deleteChallenge(id, client = pool) {
  const sql = `
    DELETE FROM challenges WHERE id = $1 RETURNING *;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

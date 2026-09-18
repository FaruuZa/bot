import { pool } from '../pool.js';

/**
 * Buat entri rekrutmen baru
 */
export async function createRecruitment({ teamId, channelId, messageId, slotsNeeded, description }, client = pool) {
  const sql = `
    INSERT INTO team_recruitments (team_id, channel_id, message_id, slots_needed, description, status, created_at)
    VALUES ($1, $2, $3, $4, $5, 'OPEN', NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, channelId, messageId, slotsNeeded, description || null]);
  return res.rows[0];
}

/**
 * Ambil rekrutmen yang sedang buka untuk sebuah tim
 */
export async function getOpenRecruitmentByTeam(teamId, client = pool) {
  const sql = `
    SELECT * FROM team_recruitments
    WHERE team_id = $1 AND status = 'OPEN'
    ORDER BY created_at DESC
    LIMIT 1;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows[0] || null;
}

/**
 * Ambil rekrutmen berdasarkan message ID Discord
 */
export async function getRecruitmentByMessageId(messageId, client = pool) {
  const sql = `
    SELECT r.*, t.name as team_name, t.leader_id, t.role_id, t.text_channel_id,
           t.nsac_link, t.challenge_id,
           u.discord_id as leader_discord_id,
           c.title as challenge_title
    FROM team_recruitments r
    JOIN teams t ON r.team_id = t.id
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE r.message_id = $1;
  `;
  const res = await client.query(sql, [messageId]);
  return res.rows[0] || null;
}

/**
 * Ambil rekrutmen berdasarkan ID
 */
export async function getRecruitmentById(id, client = pool) {
  const sql = `
    SELECT r.*, t.name as team_name, t.leader_id, t.role_id, t.text_channel_id,
           t.nsac_link, t.challenge_id,
           u.discord_id as leader_discord_id,
           c.title as challenge_title
    FROM team_recruitments r
    JOIN teams t ON r.team_id = t.id
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE r.id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Tutup rekrutmen (ubah status jadi CLOSED)
 */
export async function closeRecruitment(id, client = pool) {
  const sql = `
    UPDATE team_recruitments
    SET status = 'CLOSED', closed_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Tutup semua rekrutmen aktif milik sebuah tim
 */
export async function closeAllRecruitmentsByTeam(teamId, client = pool) {
  const sql = `
    UPDATE team_recruitments
    SET status = 'CLOSED', closed_at = NOW()
    WHERE team_id = $1 AND status = 'OPEN'
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

/**
 * Kurangi 1 slot kebutuhan rekrutmen. Jika slot menjadi 0, ubah status jadi CLOSED.
 */
export async function decrementRecruitmentSlot(id, client = pool) {
  const sql = `
    UPDATE team_recruitments
    SET slots_needed = GREATEST(0, slots_needed - 1),
        status = CASE WHEN slots_needed - 1 <= 0 THEN 'CLOSED' ELSE status END,
        closed_at = CASE WHEN slots_needed - 1 <= 0 THEN NOW() ELSE closed_at END
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

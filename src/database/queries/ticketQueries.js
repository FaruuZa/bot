import { pool } from '../pool.js';
import { TICKET_STATUS } from '../../config/constants.js';

export async function createTicket({ discordChannelId, createdBy, type }, client = pool) {
  const sql = `
    INSERT INTO tickets (discord_channel_id, created_by, type, status, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [
    discordChannelId,
    createdBy,
    type,
    TICKET_STATUS.OPEN
  ]);
  return res.rows[0];
}

export async function getTicketByChannelId(discordChannelId, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as creator_discord_id, u.username as creator_username
    FROM tickets t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.discord_channel_id = $1;
  `;
  const res = await client.query(sql, [discordChannelId]);
  return res.rows[0] || null;
}

export async function getActiveUserTicket(userId, type, client = pool) {
  const sql = `
    SELECT * FROM tickets
    WHERE created_by = $1 AND type = $2 AND status = 'OPEN';
  `;
  const res = await client.query(sql, [userId, type]);
  return res.rows[0] || null;
}

export async function closeTicket(discordChannelId, client = pool) {
  const sql = `
    UPDATE tickets
    SET status = 'CLOSED', closed_at = NOW()
    WHERE discord_channel_id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [discordChannelId]);
  return res.rows[0] || null;
}

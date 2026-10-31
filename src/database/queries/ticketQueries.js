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

export async function getPendingReminderTickets(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as creator_discord_id, u.username as creator_username
    FROM tickets t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.type = 'TEAM_REGISTRATION'
      AND t.status = 'OPEN'
      AND (
        (COALESCE(t.reminder_count, 0) = 0 AND t.created_at <= NOW() - INTERVAL '24 hours')
        OR
        (t.reminder_count = 1 AND COALESCE(t.last_reminded_at, t.created_at) <= NOW() - INTERVAL '24 hours')
      )
    ORDER BY t.created_at ASC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function updateTicketReminder(discordChannelId, reminderCount, client = pool) {
  const sql = `
    UPDATE tickets
    SET reminder_count = $2, last_reminded_at = NOW()
    WHERE discord_channel_id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [discordChannelId, reminderCount]);
  return res.rows[0] || null;
}

export async function getOpenSupportTickets(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as creator_discord_id, u.username as creator_username
    FROM tickets t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.type = 'SUPPORT'
      AND t.status = 'OPEN'
    ORDER BY t.created_at ASC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function resetTicketReminder(discordChannelId, client = pool) {
  const sql = `
    UPDATE tickets
    SET reminder_count = 0, last_reminded_at = NULL
    WHERE discord_channel_id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [discordChannelId]);
  return res.rows[0] || null;
}

export async function getTicketById(id, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as creator_discord_id, u.username as creator_username
    FROM tickets t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

export async function getTickets({ status, type, limit = 50, offset = 0 } = {}, client = pool) {
  const params = [];
  const conditions = [];

  if (status && ['OPEN', 'CLOSED'].includes(String(status).toUpperCase())) {
    params.push(String(status).toUpperCase());
    conditions.push(`t.status = $${params.length}`);
  }

  if (type && ['TEAM_REGISTRATION', 'SUPPORT'].includes(String(type).toUpperCase())) {
    params.push(String(type).toUpperCase());
    conditions.push(`t.type = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200), Math.max(parseInt(offset, 10) || 0, 0));

  const sql = `
    SELECT t.*, u.discord_id as creator_discord_id, u.username as creator_username
    FROM tickets t
    LEFT JOIN users u ON t.created_by = u.id
    ${whereClause}
    ORDER BY CASE WHEN t.status = 'OPEN' THEN 0 ELSE 1 END, t.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;

  const res = await client.query(sql, params);
  return res.rows;
}

export async function countOpenTickets(client = pool) {
  const sql = `SELECT COUNT(*) as count FROM tickets WHERE status = 'OPEN';`;
  const res = await client.query(sql);
  return parseInt(res.rows[0]?.count || '0', 10);
}



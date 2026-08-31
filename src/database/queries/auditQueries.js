import { pool } from '../pool.js';

export async function createAuditLog({ action, actorId = null, targetUserId = null, teamId = null, metadata = {} }, client = pool) {
  const sql = `
    INSERT INTO audit_logs (action, actor_id, target_user_id, team_id, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [
    action,
    actorId,
    targetUserId,
    teamId,
    JSON.stringify(metadata)
  ]);
  return res.rows[0];
}

export async function getRecentAuditLogs(limit = 50, client = pool) {
  const sql = `
    SELECT al.*, 
           u_act.discord_id as actor_discord_id, u_act.username as actor_username,
           u_tgt.discord_id as target_discord_id, u_tgt.username as target_username,
           t.name as team_name
    FROM audit_logs al
    LEFT JOIN users u_act ON al.actor_id = u_act.id
    LEFT JOIN users u_tgt ON al.target_user_id = u_tgt.id
    LEFT JOIN teams t ON al.team_id = t.id
    ORDER BY al.created_at DESC
    LIMIT $1;
  `;
  const res = await client.query(sql, [limit]);
  return res.rows;
}

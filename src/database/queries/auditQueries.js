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

export async function getAuditLogs({ limit = 50, offset = 0, action = null, teamId = null, q = null } = {}, client = pool) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (action && action.trim()) {
    conditions.push(`al.action = $${paramIdx++}`);
    params.push(action.trim());
  }

  if (teamId) {
    conditions.push(`al.team_id = $${paramIdx++}`);
    params.push(parseInt(teamId, 10));
  }

  if (q && q.trim()) {
    conditions.push(`(al.metadata::text ILIKE $${paramIdx} OR t.name ILIKE $${paramIdx} OR u_act.username ILIKE $${paramIdx} OR u_tgt.username ILIKE $${paramIdx})`);
    params.push(`%${q.trim()}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*) as count
    FROM audit_logs al
    LEFT JOIN users u_act ON al.actor_id = u_act.id
    LEFT JOIN users u_tgt ON al.target_user_id = u_tgt.id
    LEFT JOIN teams t ON al.team_id = t.id
    ${whereClause};
  `;

  const logsSql = `
    SELECT al.*, 
           u_act.discord_id as actor_discord_id, u_act.username as actor_username,
           u_tgt.discord_id as target_discord_id, u_tgt.username as target_username,
           t.name as team_name
    FROM audit_logs al
    LEFT JOIN users u_act ON al.actor_id = u_act.id
    LEFT JOIN users u_tgt ON al.target_user_id = u_tgt.id
    LEFT JOIN teams t ON al.team_id = t.id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++};
  `;

  const countRes = await client.query(countSql, params);
  const total = parseInt(countRes.rows[0]?.count || 0, 10);

  const logsRes = await client.query(logsSql, [...params, limit, offset]);
  return { logs: logsRes.rows, total };
}

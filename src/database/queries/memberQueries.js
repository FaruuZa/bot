import { pool } from '../pool.js';
import { MEMBER_ROLE, MEMBER_STATUS } from '../../config/constants.js';

export async function addTeamMember({ teamId, userId, role = MEMBER_ROLE.MEMBER, status = MEMBER_STATUS.ACTIVE }, client = pool) {
  const sql = `
    INSERT INTO team_members (team_id, user_id, role, status, joined_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id) WHERE status = 'ACTIVE'
    DO UPDATE SET team_id = EXCLUDED.team_id, role = EXCLUDED.role, joined_at = NOW(), removed_at = NULL
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, userId, role, status]);
  return res.rows[0];
}

export async function getTeamMembers(teamId, client = pool) {
  const sql = `
    SELECT tm.*, u.discord_id, u.username
    FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = $1
    ORDER BY CASE WHEN tm.role = 'LEADER' THEN 0 ELSE 1 END, tm.joined_at ASC;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

export async function getActiveTeamMembers(teamId, client = pool) {
  const sql = `
    SELECT tm.*, u.discord_id, u.username
    FROM team_members tm
    JOIN users u ON tm.user_id = u.id
    WHERE tm.team_id = $1 AND tm.status = 'ACTIVE'
    ORDER BY CASE WHEN tm.role = 'LEADER' THEN 0 ELSE 1 END, tm.joined_at ASC;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

export async function getUserActiveTeam(userId, client = pool) {
  const sql = `
    SELECT t.*, tm.role as user_team_role, tm.status as member_status, u.discord_id as leader_discord_id
    FROM team_members tm
    JOIN teams t ON tm.team_id = t.id
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE tm.user_id = $1 AND tm.status = 'ACTIVE' AND t.status IN ('PENDING', 'ACTIVE');
  `;
  const res = await client.query(sql, [userId]);
  return res.rows[0] || null;
}

export async function getUserActiveTeamByDiscordId(discordId, client = pool) {
  const sql = `
    SELECT t.*, tm.role as user_team_role, tm.status as member_status, u.discord_id as user_discord_id, u.username as user_username
    FROM users u
    JOIN team_members tm ON u.id = tm.user_id
    JOIN teams t ON tm.team_id = t.id
    WHERE u.discord_id = $1 AND tm.status = 'ACTIVE' AND t.status IN ('PENDING', 'ACTIVE');
  `;
  const res = await client.query(sql, [discordId]);
  return res.rows[0] || null;
}

export async function updateMemberRole(teamId, userId, role, client = pool) {
  const sql = `
    UPDATE team_members
    SET role = $3
    WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE'
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, userId, role]);
  return res.rows[0] || null;
}

export async function updateMemberStatus(teamId, userId, status, client = pool) {
  const sql = `
    UPDATE team_members
    SET status = $3, removed_at = CASE WHEN $3 = 'REMOVED' THEN NOW() ELSE NULL END
    WHERE team_id = $1 AND user_id = $2
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, userId, status]);
  return res.rows[0] || null;
}

export async function removeTeamMember(teamId, userId, client = pool) {
  return updateMemberStatus(teamId, userId, MEMBER_STATUS.REMOVED, client);
}

export async function countActiveTeamMembers(teamId, client = pool) {
  const sql = `
    SELECT COUNT(*)::int as count
    FROM team_members
    WHERE team_id = $1 AND status = 'ACTIVE';
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows[0]?.count || 0;
}

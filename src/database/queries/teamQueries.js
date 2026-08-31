import { pool } from '../pool.js';
import { TEAM_STATUS } from '../../config/constants.js';

export async function createTeam({ name, leaderId, status = TEAM_STATUS.PENDING }, client = pool) {
  const sql = `
    INSERT INTO teams (name, leader_id, status, created_at, updated_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [name.trim(), leaderId, status]);
  return res.rows[0];
}

export async function updateTeamDiscordResources(teamId, { roleId, categoryId, textChannelId, voiceChannelId }, client = pool) {
  const sql = `
    UPDATE teams
    SET role_id = COALESCE($2, role_id),
        category_id = COALESCE($3, category_id),
        text_channel_id = COALESCE($4, text_channel_id),
        voice_channel_id = COALESCE($5, voice_channel_id),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, roleId, categoryId, textChannelId, voiceChannelId]);
  return res.rows[0] || null;
}

export async function getTeamById(id, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE t.id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

export async function getTeamByName(name, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE LOWER(t.name) = LOWER($1) AND t.status IN ('PENDING', 'ACTIVE', 'ARCHIVED');
  `;
  const res = await client.query(sql, [name.trim()]);
  return res.rows[0] || null;
}

export async function getTeamByRoleId(roleId, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE t.role_id = $1;
  `;
  const res = await client.query(sql, [roleId]);
  return res.rows[0] || null;
}

export async function getTeamByChannelId(channelId, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE t.text_channel_id = $1 OR t.voice_channel_id = $1 OR t.category_id = $1;
  `;
  const res = await client.query(sql, [channelId]);
  return res.rows[0] || null;
}

export async function updateTeamStatus(teamId, status, client = pool) {
  const sql = `
    UPDATE teams
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, status]);
  return res.rows[0] || null;
}

export async function updateTeamName(teamId, newName, client = pool) {
  const sql = `
    UPDATE teams
    SET name = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, newName.trim()]);
  return res.rows[0] || null;
}

export async function updateTeamLeader(teamId, newLeaderId, client = pool) {
  const sql = `
    UPDATE teams
    SET leader_id = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, newLeaderId]);
  return res.rows[0] || null;
}

export async function getAllActiveTeams(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    WHERE t.status = 'ACTIVE'
    ORDER BY t.created_at ASC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function getAllTeams(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    ORDER BY t.created_at DESC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

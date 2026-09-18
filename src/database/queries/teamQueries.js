import { pool } from '../pool.js';
import { TEAM_STATUS } from '../../config/constants.js';

export async function createTeam({ name, leaderId, status = TEAM_STATUS.PENDING, nsacLink = null, challengeId = null }, client = pool) {
  const sql = `
    INSERT INTO teams (name, leader_id, status, nsac_link, challenge_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [name.trim(), leaderId, status, nsacLink || null, challengeId || null]);
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
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
           c.title as challenge_title, c.description as challenge_description
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE t.id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

export async function getTeamByName(name, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
           c.title as challenge_title, c.description as challenge_description
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE LOWER(t.name) = LOWER($1) AND t.status IN ('PENDING', 'ACTIVE', 'ARCHIVED')
    ORDER BY 
      CASE t.status
        WHEN 'ACTIVE' THEN 1
        WHEN 'PENDING' THEN 2
        WHEN 'ARCHIVED' THEN 3
        ELSE 4
      END,
      t.created_at DESC
    LIMIT 1;
  `;
  const res = await client.query(sql, [name.trim()]);
  return res.rows[0] || null;
}

export async function getTeamByRoleId(roleId, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
           c.title as challenge_title, c.description as challenge_description
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE t.role_id = $1;
  `;
  const res = await client.query(sql, [roleId]);
  return res.rows[0] || null;
}

export async function getTeamByChannelId(channelId, client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
           c.title as challenge_title, c.description as challenge_description
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
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

export async function updateTeamChallenge(teamId, challengeId, client = pool) {
  const sql = `
    UPDATE teams
    SET challenge_id = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, challengeId || null]);
  return res.rows[0] || null;
}

export async function updateTeamNsacLink(teamId, nsacLink, client = pool) {
  const sql = `
    UPDATE teams
    SET nsac_link = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId, nsacLink?.trim() || null]);
  return res.rows[0] || null;
}

export async function getAllActiveTeams(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count,
      c.title as challenge_title
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    WHERE t.status = 'ACTIVE'
    ORDER BY t.created_at ASC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function getAllTeams(client = pool) {
  const sql = `
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count,
      c.title as challenge_title
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    LEFT JOIN challenges c ON t.challenge_id = c.id
    ORDER BY t.created_at DESC;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function purgeDisbandedTeams(client = pool) {
  const sql = `
    DELETE FROM teams
    WHERE status = 'DISBANDED'
    RETURNING id, name;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function purgeTeamById(teamId, client = pool) {
  const sql = `
    DELETE FROM teams
    WHERE id = $1
    RETURNING id, name;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows[0] || null;
}


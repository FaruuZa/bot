import { pool } from '../pool.js';
import { INVITATION_STATUS } from '../../config/constants.js';

export async function createInvitation({ teamId, invitedUserId, invitedBy, expiresAt }, client = pool) {
  const sql = `
    INSERT INTO invitations (team_id, invited_user_id, invited_by, status, expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [
    teamId,
    invitedUserId,
    invitedBy,
    INVITATION_STATUS.PENDING,
    expiresAt
  ]);
  return res.rows[0];
}

export async function getInvitationById(id, client = pool) {
  const sql = `
    SELECT i.*, 
           t.name as team_name, t.status as team_status,
           u_inv.discord_id as invited_discord_id, u_inv.username as invited_username,
           u_by.discord_id as inviter_discord_id, u_by.username as inviter_username
    FROM invitations i
    JOIN teams t ON i.team_id = t.id
    JOIN users u_inv ON i.invited_user_id = u_inv.id
    LEFT JOIN users u_by ON i.invited_by = u_by.id
    WHERE i.id = $1;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

export async function getPendingInvitationForUser(teamId, userId, client = pool) {
  const sql = `
    SELECT * FROM invitations
    WHERE team_id = $1 AND invited_user_id = $2 AND status = 'PENDING' AND expires_at > NOW();
  `;
  const res = await client.query(sql, [teamId, userId]);
  return res.rows[0] || null;
}

export async function getPendingInvitationsForTeam(teamId, client = pool) {
  const sql = `
    SELECT i.*, u.discord_id, u.username
    FROM invitations i
    JOIN users u ON i.invited_user_id = u.id
    WHERE i.team_id = $1 AND i.status = 'PENDING';
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

export async function getAllInvitationsForTeam(teamId, client = pool) {
  const sql = `
    SELECT i.*, u.discord_id, u.username
    FROM invitations i
    JOIN users u ON i.invited_user_id = u.id
    WHERE i.team_id = $1
    ORDER BY i.created_at ASC;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

export async function updateInvitationStatus(id, status, client = pool) {
  const sql = `
    UPDATE invitations
    SET status = $2, responded_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [id, status]);
  return res.rows[0] || null;
}

export async function markExpiredInvitations(client = pool) {
  const sql = `
    UPDATE invitations
    SET status = 'EXPIRED', responded_at = NOW()
    WHERE status = 'PENDING' AND expires_at <= NOW()
    RETURNING *;
  `;
  const res = await client.query(sql);
  return res.rows;
}

export async function cancelPendingInvitationsForTeam(teamId, client = pool) {
  const sql = `
    UPDATE invitations
    SET status = 'DECLINED', responded_at = NOW()
    WHERE team_id = $1 AND status = 'PENDING'
    RETURNING *;
  `;
  const res = await client.query(sql, [teamId]);
  return res.rows;
}

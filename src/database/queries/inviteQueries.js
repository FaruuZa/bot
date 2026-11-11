import { pool } from '../pool.js';
import { logger } from '../../utils/logger.js';

/**
 * Save or update a dynamic invite role mapping.
 * @param {object} params
 * @param {string} params.inviteCode
 * @param {string} [params.roleId]
 * @param {string[]} [params.roleIds]
 * @param {string} [params.channelId]
 * @param {string} [params.label]
 * @param {string} [params.createdBy]
 * @returns {Promise<object>}
 */
export async function saveInviteRole({ inviteCode, roleId = null, roleIds = [], channelId = null, label = null, createdBy = null }) {
  const primaryRoleId = roleId || (roleIds.length > 0 ? roleIds[0] : null);
  const normalizedRoleIds = roleIds.length > 0 ? roleIds : (primaryRoleId ? [primaryRoleId] : []);

  const query = `
    INSERT INTO invite_roles (invite_code, role_id, role_ids, channel_id, label, created_by)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6)
    ON CONFLICT (invite_code)
    DO UPDATE SET
      role_id = EXCLUDED.role_id,
      role_ids = EXCLUDED.role_ids,
      channel_id = COALESCE(EXCLUDED.channel_id, invite_roles.channel_id),
      label = COALESCE(EXCLUDED.label, invite_roles.label),
      created_by = COALESCE(EXCLUDED.created_by, invite_roles.created_by)
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query, [
      inviteCode,
      primaryRoleId,
      JSON.stringify(normalizedRoleIds),
      channelId,
      label,
      createdBy
    ]);
    return rows[0];
  } catch (error) {
    logger.error(`[inviteQueries.saveInviteRole] Failed: ${error.message}`);
    throw error;
  }
}


/**
 * Get all active invite roles sorted by created_at DESC.
 * @returns {Promise<Array<object>>}
 */
export async function getAllInviteRoles() {
  const query = `
    SELECT *
    FROM invite_roles
    ORDER BY created_at DESC;
  `;
  try {
    const { rows } = await pool.query(query);
    return rows;
  } catch (error) {
    logger.error(`[inviteQueries.getAllInviteRoles] Failed: ${error.message}`);
    return [];
  }
}

/**
 * Get invite role configuration by invite code.
 * Case-insensitive lookup.
 * @param {string} inviteCode
 * @returns {Promise<object|null>}
 */
export async function getInviteRoleByCode(inviteCode) {
  if (!inviteCode) return null;
  const query = `
    SELECT *
    FROM invite_roles
    WHERE LOWER(invite_code) = LOWER($1)
    LIMIT 1;
  `;
  try {
    const { rows } = await pool.query(query, [inviteCode.trim()]);
    return rows[0] || null;
  } catch (error) {
    logger.error(`[inviteQueries.getInviteRoleByCode] Failed: ${error.message}`);
    return null;
  }
}

/**
 * Delete an invite role mapping by code.
 * @param {string} inviteCode
 * @returns {Promise<boolean>}
 */
export async function deleteInviteRole(inviteCode) {
  if (!inviteCode) return false;
  const query = `
    DELETE FROM invite_roles
    WHERE LOWER(invite_code) = LOWER($1);
  `;
  try {
    const result = await pool.query(query, [inviteCode.trim()]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error(`[inviteQueries.deleteInviteRole] Failed: ${error.message}`);
    throw error;
  }
}


/**
 * Record a member join event via invite code.
 * @param {object} params
 * @param {string} params.discordId
 * @param {string} params.username
 * @param {string} params.inviteCode
 * @param {string} [params.inviterId]
 * @param {string} [params.inviterTag]
 * @param {string} [params.roleNames]
 * @returns {Promise<object>}
 */
export async function recordMemberInviteJoin({ discordId, username, inviteCode, inviterId = null, inviterTag = null, roleNames = null }) {
  const query = `
    INSERT INTO member_invites (discord_id, username, invite_code, inviter_id, inviter_tag, role_names, joined_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *;
  `;
  try {
    const { rows } = await pool.query(query, [
      discordId,
      username,
      inviteCode,
      inviterId,
      inviterTag,
      roleNames
    ]);
    return rows[0];
  } catch (error) {
    logger.error(`[inviteQueries.recordMemberInviteJoin] Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get recent member joins tracked by invites.
 * @param {number} [limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentInviteJoins(limit = 50) {
  const query = `
    SELECT mi.*, ir.label as invite_label
    FROM member_invites mi
    LEFT JOIN invite_roles ir ON LOWER(mi.invite_code) = LOWER(ir.invite_code)
    ORDER BY mi.joined_at DESC
    LIMIT $1;
  `;
  try {
    const { rows } = await pool.query(query, [limit]);
    return rows;
  } catch (error) {
    logger.error(`[inviteQueries.getRecentInviteJoins] Failed: ${error.message}`);
    return [];
  }
}

/**
 * Get leaderboard of top inviters from tracked joins.
 * @param {number} [limit=10]
 * @returns {Promise<Array<object>>}
 */
export async function getTopInviters(limit = 10) {
  const query = `
    SELECT 
      COALESCE(inviter_id, 'unknown') as inviter_id,
      COALESCE(inviter_tag, 'Unknown') as inviter_tag,
      COUNT(*) as total_joins
    FROM member_invites
    WHERE inviter_id IS NOT NULL
    GROUP BY inviter_id, inviter_tag
    ORDER BY total_joins DESC
    LIMIT $1;
  `;
  try {
    const { rows } = await pool.query(query, [limit]);
    return rows;
  } catch (error) {
    logger.error(`[inviteQueries.getTopInviters] Failed: ${error.message}`);
    return [];
  }
}

/**
 * Get aggregated invite tracker stats.
 * @returns {Promise<{ totalJoins: number, uniqueMembers: number }>}
 */
export async function getInviteTrackerStats() {
  const query = `
    SELECT 
      COUNT(*) as total_joins,
      COUNT(DISTINCT discord_id) as unique_members
    FROM member_invites;
  `;
  try {
    const { rows } = await pool.query(query);
    return {
      totalJoins: parseInt(rows[0]?.total_joins || 0, 10),
      uniqueMembers: parseInt(rows[0]?.unique_members || 0, 10)
    };
  } catch (error) {
    logger.error(`[inviteQueries.getInviteTrackerStats] Failed: ${error.message}`);
    return { totalJoins: 0, uniqueMembers: 0 };
  }
}

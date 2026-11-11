import { GuildConfigService } from './guildConfigService.js';
import { saveInviteRole, deleteInviteRole, getAllInviteRoles, getInviteRoleByCode } from '../database/queries/inviteQueries.js';
import { logger } from '../utils/logger.js';

export class InviteService {
  /**
   * Cache structure: Map<guildId, Map<inviteCode, usesCount>>
   * @type {Map<string, Map<string, number>>}
   */
  static invitesCache = new Map();

  /**
   * Initialize invite cache on bot startup.
   * @param {import('discord.js').Client} client 
   */
  static async initInvitesCache(client) {
    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const invites = await guild.invites.fetch().catch(() => null);
        if (!invites) continue;

        const codeUsesMap = new Map();
        for (const [code, inv] of invites) {
          codeUsesMap.set(code, inv.uses || 0);
        }
        this.invitesCache.set(guildId, codeUsesMap);
        logger.info(`[InviteService] Cached ${codeUsesMap.size} invite(s) for guild "${guild.name}" (${guildId}).`);
      } catch (err) {
        logger.warn(`[InviteService] Could not cache invites for guild "${guild.name}": ${err.message}`);
      }
    }
  }

  /**
   * Update cache for a specific guild.
   * @param {import('discord.js').Guild} guild 
   */
  static async updateGuildCache(guild) {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (!invites) return;

      const codeUsesMap = new Map();
      for (const [code, inv] of invites) {
        codeUsesMap.set(code, inv.uses || 0);
      }
      this.invitesCache.set(guild.id, codeUsesMap);
    } catch (err) {
      logger.warn(`[InviteService] Error updating invite cache for guild "${guild.name}": ${err.message}`);
    }
  }

  /**
   * Find which invite was used when a new member joins.
   * @param {import('discord.js').GuildMember} member 
   * @returns {Promise<import('discord.js').Invite|null>}
   */
  static async findUsedInvite(member) {
    const guild = member.guild;
    const cachedInvites = this.invitesCache.get(guild.id);

    try {
      const currentInvites = await guild.invites.fetch().catch(() => null);
      if (!currentInvites) return null;

      let usedInvite = null;

      if (cachedInvites) {
        for (const [code, inv] of currentInvites) {
          const cachedUses = cachedInvites.get(code) || 0;
          if (inv.uses > cachedUses) {
            usedInvite = inv;
            break;
          }
        }
      }

      // Update cache with current invites
      const newCache = new Map();
      for (const [code, inv] of currentInvites) {
        newCache.set(code, inv.uses || 0);
      }
      this.invitesCache.set(guild.id, newCache);

      return usedInvite;
    } catch (err) {
      logger.error(`[InviteService] Failed to find used invite for ${member.user.tag}: ${err.message}`);
      return null;
    }
  }

  /**
   * Create a dynamic invite link tied to one or more roles.
   * @param {import('discord.js').Guild} guild 
   * @param {string|string[]} roleIdsInput 
   * @param {import('discord.js').GuildChannel} [channel] 
   * @param {string} [createdBy] 
   * @param {object} [options]
   */
  static async createDynamicInvite(guild, roleIdsInput, channel = null, createdBy = null, options = {}) {
    const targetChannel = channel || guild.systemChannel || guild.rulesChannel || guild.channels.cache.find(c => c.isTextBased());
    if (!targetChannel) {
      throw new Error('Tidak ditemukan text channel yang dapat diakses untuk membuat link invite.');
    }

    const roleIds = Array.isArray(roleIdsInput) ? roleIdsInput : [roleIdsInput];
    const roleNames = roleIds.map((id) => guild.roles.cache.get(id)?.name || 'Role').filter(Boolean);
    const label = roleNames.join(' + ');

    const invite = await targetChannel.createInvite({
      maxAge: options.maxAge ?? 0, // 0 = permanent
      maxUses: options.maxUses ?? 0, // 0 = unlimited
      unique: true,
      reason: `Auto-Role Invite for ${label} created by staff (${createdBy || 'Dashboard'})`
    });

    // Save to database
    await saveInviteRole({
      inviteCode: invite.code,
      roleId: roleIds[0],
      roleIds,
      channelId: targetChannel.id,
      label,
      createdBy
    });

    // If participant role is included, keep backward compatibility in guild_config
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    if (participantRoleId && roleIds.includes(participantRoleId)) {
      await GuildConfigService.set('PARTICIPANT_INVITE_CODE', invite.code);
    }

    // Update cache
    await this.updateGuildCache(guild);

    logger.info(`[InviteService] Created dynamic invite ${invite.url} (Code: ${invite.code}) -> Roles: ${label} (${roleIds.join(', ')})`);
    return { invite, roleNames, label };
  }


  /**
   * Delete a dynamic invite link from database and Discord.
   * @param {import('discord.js').Guild} guild 
   * @param {string} inviteCode 
   */
  static async deleteDynamicInvite(guild, inviteCode) {
    if (!inviteCode) return false;

    // 1. Delete from DB
    await deleteInviteRole(inviteCode);

    // 2. Delete from Discord if it exists
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      const discordInvite = invites?.get(inviteCode);
      if (discordInvite) {
        await discordInvite.delete('Deleted by staff via Admin Dashboard').catch(() => {});
      }
    } catch (err) {
      logger.warn(`[InviteService] Could not delete invite ${inviteCode} from Discord: ${err.message}`);
    }

    // 3. Clear from config if it was the legacy participant invite
    const currentParticipantCode = GuildConfigService.get('PARTICIPANT_INVITE_CODE');
    if (currentParticipantCode && currentParticipantCode.toLowerCase() === inviteCode.toLowerCase()) {
      await GuildConfigService.set('PARTICIPANT_INVITE_CODE', '');
    }

    // 4. Update cache
    await this.updateGuildCache(guild);
    logger.info(`[InviteService] Deleted dynamic invite code: ${inviteCode}`);
    return true;
  }

  /**
   * Create or update a participant invite link (convenience wrapper).
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').GuildChannel} [channel] 
   * @param {object} [options]
   */
  static async createParticipantInvite(guild, channel = null, options = {}) {
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    if (!participantRoleId) {
      throw new Error('Role Participant belum diatur! Harap atur Participant Role terlebih dahulu di panel konfigurasi role.');
    }
    const { invite } = await this.createDynamicInvite(guild, participantRoleId, channel, 'Dashboard', options);
    return invite;
  }

  /**
   * Get all server invites combined with database dynamic role mappings and stats.
   * @param {import('discord.js').Guild} guild 
   * @returns {Promise<Array<object>>}
   */
  static async getAllGuildInvitesWithStats(guild) {
    if (!guild) return [];

    let discordInvites = new Map();
    try {
      const fetched = await guild.invites.fetch().catch(() => null);
      if (fetched) discordInvites = fetched;
    } catch (err) {
      logger.warn(`[InviteService] Error fetching invites for guild "${guild.name}": ${err.message}`);
    }

    const dbInvites = await getAllInviteRoles();
    const dbInviteMap = new Map();
    for (const d of dbInvites) {
      dbInviteMap.set(d.invite_code.toLowerCase(), d);
    }

    const legacyParticipantCode = (GuildConfigService.get('PARTICIPANT_INVITE_CODE') || '').toLowerCase();
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');

    const result = [];
    const seenCodes = new Set();

    // 1. Process active Discord invites
    for (const [code, inv] of discordInvites) {
      seenCodes.add(code.toLowerCase());
      const dbMapping = dbInviteMap.get(code.toLowerCase());

      const rawRoleIds = dbMapping?.role_ids && Array.isArray(dbMapping.role_ids) && dbMapping.role_ids.length > 0
        ? [...dbMapping.role_ids]
        : (dbMapping?.role_id ? [dbMapping.role_id] : []);

      if (legacyParticipantCode && code.toLowerCase() === legacyParticipantCode && participantRoleId && !rawRoleIds.includes(participantRoleId)) {
        rawRoleIds.push(participantRoleId);
      }

      const roles = rawRoleIds.map((rId) => {
        const role = guild.roles.cache.get(rId);
        return {
          id: rId,
          name: role?.name || rId,
          color: role?.hexColor || '#99aab5'
        };
      });

      result.push({
        code: inv.code,
        url: inv.url,
        channel: inv.channel ? { id: inv.channel.id, name: inv.channel.name } : null,
        inviter: inv.inviter ? {
          id: inv.inviter.id,
          username: inv.inviter.username,
          tag: inv.inviter.tag || inv.inviter.username,
          avatar: inv.inviter.displayAvatarURL ? inv.inviter.displayAvatarURL() : null
        } : null,
        uses: inv.uses || 0,
        maxUses: inv.maxUses || 0,
        maxAge: inv.maxAge || 0,
        expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
        createdAt: inv.createdAt ? inv.createdAt.toISOString() : null,
        isDynamic: roles.length > 0 || !!dbMapping,
        roles,
        label: dbMapping?.label || (roles.length > 0 ? roles.map(r => r.name).join(' + ') : null),
        createdBy: dbMapping?.created_by || (inv.inviter ? inv.inviter.username : 'Unknown'),
        isExpired: inv.expiresAt ? inv.expiresAt.getTime() <= Date.now() : false
      });
    }

    // 2. Include any DB invites that may have expired or were deleted from Discord
    for (const d of dbInvites) {
      if (!seenCodes.has(d.invite_code.toLowerCase())) {
        const rawRoleIds = d.role_ids && Array.isArray(d.role_ids) && d.role_ids.length > 0
          ? d.role_ids
          : (d.role_id ? [d.role_id] : []);

        const roles = rawRoleIds.map((rId) => {
          const role = guild.roles.cache.get(rId);
          return {
            id: rId,
            name: role?.name || rId,
            color: role?.hexColor || '#99aab5'
          };
        });

        const ch = d.channel_id ? guild.channels.cache.get(d.channel_id) : null;

        result.push({
          code: d.invite_code,
          url: `https://discord.gg/${d.invite_code}`,
          channel: ch ? { id: ch.id, name: ch.name } : (d.channel_id ? { id: d.channel_id, name: 'unknown' } : null),
          inviter: null,
          uses: 0,
          maxUses: 0,
          maxAge: 0,
          expiresAt: null,
          createdAt: d.created_at ? new Date(d.created_at).toISOString() : null,
          isDynamic: true,
          roles,
          label: d.label || (roles.length > 0 ? roles.map(r => r.name).join(' + ') : 'Auto-Role'),
          createdBy: d.created_by || 'Staff',
          isExpired: true
        });
      }
    }

    result.sort((a, b) => (b.uses || 0) - (a.uses || 0));
    return result;
  }
}


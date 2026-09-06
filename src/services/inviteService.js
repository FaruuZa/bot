import { GuildConfigService } from './guildConfigService.js';
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
   * Create or update a participant invite link for a guild and persist in guild_config.
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').GuildChannel} [channel] 
   * @param {object} [options]
   */
  static async createParticipantInvite(guild, channel = null, options = {}) {
    const targetChannel = channel || guild.systemChannel || guild.rulesChannel || guild.channels.cache.find(c => c.isTextBased());
    if (!targetChannel) {
      throw new Error('No accessible text channel found to generate invite link.');
    }

    const invite = await targetChannel.createInvite({
      maxAge: options.maxAge ?? 0, // 0 = permanent
      maxUses: options.maxUses ?? 0, // 0 = unlimited
      unique: true,
      reason: 'Auto-Role Participant Invite Link created by Staff/Dashboard'
    });

    // Persist code in config
    await GuildConfigService.set('PARTICIPANT_INVITE_CODE', invite.code);

    // Update cache
    await this.updateGuildCache(guild);

    logger.info(`[InviteService] Created new participant invite ${invite.url} (Code: ${invite.code})`);
    return invite;
  }
}

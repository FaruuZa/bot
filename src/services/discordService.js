import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sanitizeChannelName } from '../utils/validators.js';

export class DiscordService {
  /**
   * Provision all Discord resources for a team:
   * 1. Team Role
   * 2. Category Channel
   * 3. Text Channel
   * 4. Voice Channel
   * 
   * Includes automatic cleanup/rollback if any step fails.
   * 
   * @param {import('discord.js').Guild} guild 
   * @param {string} teamName 
   * @returns {Promise<{ roleId: string, categoryId: string, textChannelId: string, voiceChannelId: string }>}
   */
  static async provisionTeamResources(guild, teamName) {
    const created = {
      role: null,
      category: null,
      textChannel: null,
      voiceChannel: null
    };

    const cleanSlug = sanitizeChannelName(teamName);

    try {
      logger.info(`[Discord Provisioning] Starting resource creation for team: "${teamName}"`);

      // 1. Create Team Role
      created.role = await guild.roles.create({
        name: teamName,
        color: 0x3498DB,
        mentionable: true,
        reason: `Hackathon Team Role for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Role: ${created.role.name} (${created.role.id})`);

      // Position team role below bot/staff if possible
      if (env.STAFF_ROLE_ID) {
        const staffRole = guild.roles.cache.get(env.STAFF_ROLE_ID);
        if (staffRole && created.role.position >= staffRole.position) {
          await created.role.setPosition(Math.max(1, staffRole.position - 1)).catch(() => {});
        }
      }

      // Build permission overwrites for Category
      const botMemberId = guild.members.me?.id ?? guild.client.user.id;
      if (!guild.members.me) {
        logger.warn(`[Discord Provisioning] guild.members.me is null for guild "${guild.name}", using client.user.id as fallback.`);
      }

      const permissionOverwrites = [
        // @everyone: Deny view & connect
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        },
        // Team Role: Allow view, chat, connect, speak
        {
          id: created.role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.UseVAD
          ]
        },
        // Bot itself: Full access
        {
          id: botMemberId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.Connect
          ]
        }
      ];

      // Staff Role Permissions
      if (env.STAFF_ROLE_ID) {
        permissionOverwrites.push({
          id: env.STAFF_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers
          ]
        });
      }

      // Admin Role Permissions
      if (env.ADMINISTRATOR_ROLE_ID) {
        permissionOverwrites.push({
          id: env.ADMINISTRATOR_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
          ]
        });
      }

      // 2. Create Category Channel
      created.category = await guild.channels.create({
        name: `📁 ${teamName.toUpperCase()}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites,
        reason: `Hackathon Team Category for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Category: ${created.category.name} (${created.category.id})`);

      // 3. Create Text Channel inside Category
      created.textChannel = await guild.channels.create({
        name: `💬・${cleanSlug}`,
        type: ChannelType.GuildText,
        parent: created.category.id,
        topic: `Private Text Channel for Team ${teamName}`,
        reason: `Hackathon Team Text Channel for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Text Channel: ${created.textChannel.name} (${created.textChannel.id})`);

      // 4. Create Voice Channel inside Category
      created.voiceChannel = await guild.channels.create({
        name: `🔊・${cleanSlug}`,
        type: ChannelType.GuildVoice,
        parent: created.category.id,
        reason: `Hackathon Team Voice Channel for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Voice Channel: ${created.voiceChannel.name} (${created.voiceChannel.id})`);

      return {
        roleId: created.role.id,
        categoryId: created.category.id,
        textChannelId: created.textChannel.id,
        voiceChannelId: created.voiceChannel.id
      };
    } catch (error) {
      logger.error(`[Discord Provisioning Failed] Error creating resources for "${teamName}": ${error.message}`);
      // Rollback and cleanup created resources
      await this.rollbackProvisioning(created);
      throw error;
    }
  }

  /**
   * Cleanup any resources that were created prior to failure
   */
  static async rollbackProvisioning(created) {
    logger.warn('[Discord Rollback] Cleaning up partially created resources...');
    if (created.voiceChannel) {
      await created.voiceChannel.delete('Rollback failed team provisioning').catch(() => {});
    }
    if (created.textChannel) {
      await created.textChannel.delete('Rollback failed team provisioning').catch(() => {});
    }
    if (created.category) {
      await created.category.delete('Rollback failed team provisioning').catch(() => {});
    }
    if (created.role) {
      await created.role.delete('Rollback failed team provisioning').catch(() => {});
    }
    logger.info('[Discord Rollback] Cleanup finished.');
  }

  /**
   * Assign Participant & Team role, remove Unregistered role
   * @param {import('discord.js').Guild} guild 
   * @param {string} discordId 
   * @param {string} teamRoleId 
   */
  static async assignTeamMembershipRoles(guild, discordId, teamRoleId) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        logger.warn(`[DiscordService] Member ${discordId} not found in guild to assign roles.`);
        return;
      }

      const rolesToAdd = [];
      if (teamRoleId && !member.roles.cache.has(teamRoleId)) rolesToAdd.push(teamRoleId);
      if (env.PARTICIPANT_ROLE_ID && !member.roles.cache.has(env.PARTICIPANT_ROLE_ID)) {
        rolesToAdd.push(env.PARTICIPANT_ROLE_ID);
      }

      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd, 'Assigned Hackathon Team & Participant roles');
      }

      if (env.UNREGISTERED_ROLE_ID && member.roles.cache.has(env.UNREGISTERED_ROLE_ID)) {
        await member.roles.remove(env.UNREGISTERED_ROLE_ID, 'Removed Unregistered role on team join');
      }
    } catch (error) {
      logger.error(`[DiscordService] Failed to update roles for member ${discordId}: ${error.message}`);
    }
  }

  /**
   * Remove team role from a member, and reset Participant / restore Unregistered if needed
   * @param {import('discord.js').Guild} guild 
   * @param {string} discordId 
   * @param {string} teamRoleId 
   * @param {boolean} [restoreUnregistered=true]
   */
  static async removeTeamMembershipRoles(guild, discordId, teamRoleId, restoreUnregistered = true) {
    try {
      const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
      if (!member) {
        logger.warn(`[DiscordService] Member ${discordId} not found in guild to remove team roles.`);
        return;
      }

      // 1. Remove Team Role if present
      if (teamRoleId && member.roles.cache.has(teamRoleId)) {
        await member.roles.remove(teamRoleId, 'Removed Hackathon Team role').catch(() => {});
      }

      // 2. Remove Participant role & Restore Unregistered role
      if (restoreUnregistered) {
        if (env.PARTICIPANT_ROLE_ID && member.roles.cache.has(env.PARTICIPANT_ROLE_ID)) {
          await member.roles.remove(env.PARTICIPANT_ROLE_ID, 'Removed Participant role on team delete/remove').catch(() => {});
        }
        if (env.UNREGISTERED_ROLE_ID && !member.roles.cache.has(env.UNREGISTERED_ROLE_ID)) {
          await member.roles.add(env.UNREGISTERED_ROLE_ID, 'Restored Unregistered role on team delete/remove').catch(() => {});
        }
      }
      logger.info(`[DiscordService] Successfully restored @Unregistered and removed @Participant for ${member.user.tag}`);
    } catch (error) {
      logger.error(`[DiscordService] Failed to remove team roles for member ${discordId}: ${error.message}`);
    }
  }

  /**
   * Rename Discord resources for a team
   */
  static async renameTeamResources(guild, { roleId, categoryId, textChannelId, voiceChannelId, newName }) {
    const cleanSlug = sanitizeChannelName(newName);

    if (roleId) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (role) await role.setName(newName, `Team renamed to ${newName}`).catch(() => {});
    }
    if (categoryId) {
      const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (category) await category.setName(`📁 ${newName.toUpperCase()}`, `Team renamed to ${newName}`).catch(() => {});
    }
    if (textChannelId) {
      const textChannel = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (textChannel) await textChannel.setName(`💬・${cleanSlug}`, `Team renamed to ${newName}`).catch(() => {});
    }
    if (voiceChannelId) {
      const voiceChannel = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (voiceChannel) await voiceChannel.setName(`🔊・${cleanSlug}`, `Team renamed to ${newName}`).catch(() => {});
    }
  }

  /**
   * Archive team channels by locking them to read-only
   */
  static async archiveTeamChannels(guild, { roleId, categoryId, textChannelId, voiceChannelId }) {
    if (roleId && categoryId) {
      const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (category) {
        await category.permissionOverwrites.edit(roleId, {
          SendMessages: false,
          AddReactions: false,
          Connect: false,
          Speak: false
        }).catch(() => {});
      }
    }

    if (roleId && textChannelId) {
      const text = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (text) {
        await text.permissionOverwrites.edit(roleId, {
          SendMessages: false,
          AddReactions: false
        }).catch(() => {});
      }
    }

    if (voiceChannelId) {
      const voice = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (voice && roleId) {
        await voice.permissionOverwrites.edit(roleId, {
          Connect: false,
          Speak: false
        }).catch(() => {});
      }
    }
  }

  /**
   * Delete team Discord resources
   */
  static async deleteTeamResources(guild, { roleId, categoryId, textChannelId, voiceChannelId }) {
    if (voiceChannelId) {
      const ch = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (ch) await ch.delete('Team deleted').catch(() => {});
    }
    if (textChannelId) {
      const ch = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (ch) await ch.delete('Team deleted').catch(() => {});
    }
    if (categoryId) {
      const ch = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (ch) await ch.delete('Team deleted').catch(() => {});
    }
    if (roleId) {
      const r = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (r) await r.delete('Team deleted').catch(() => {});
    }
  }
}

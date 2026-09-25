import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { logger } from '../utils/logger.js';
import { sanitizeChannelName, deduplicateOverwrites } from '../utils/validators.js';

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
    const staffRoleId = GuildConfigService.get('STAFF_ROLE_ID');
    const adminRoleId = GuildConfigService.get('ADMINISTRATOR_ROLE_ID');

    try {
      logger.info(`[Discord Provisioning] Starting resource creation for team: "${teamName}"`);

      // 1. Create Team Role
      created.role = await guild.roles.create({
        name: teamName,
        colors: { primaryColor: 0x3498DB },
        mentionable: true,
        reason: `Hackathon Team Role for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Role: ${created.role.name} (${created.role.id})`);

      // Position team role below bot/staff if possible
      if (staffRoleId) {
        const staffRole = guild.roles.cache.get(staffRoleId);
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
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.UseVAD
          ]
        }
      ];

      // Staff Role Permissions
      if (staffRoleId) {
        permissionOverwrites.push({
          id: staffRoleId,
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
      if (adminRoleId) {
        permissionOverwrites.push({
          id: adminRoleId,
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
        permissionOverwrites: deduplicateOverwrites(permissionOverwrites),
        reason: `Hackathon Team Category for ${teamName}`
      });
      logger.info(`[Discord Provisioning] Created Category: ${created.category.name} (${created.category.id})`);

      // 3 & 4. Create Text and Voice Channels inside Category in parallel
      const [textChannel, voiceChannel] = await Promise.all([
        guild.channels.create({
          name: `💬・${cleanSlug}`,
          type: ChannelType.GuildText,
          parent: created.category.id,
          topic: `Private Text Channel for Team ${teamName}`,
          reason: `Hackathon Team Text Channel for ${teamName}`
        }),
        guild.channels.create({
          name: `🔊・${cleanSlug}`,
          type: ChannelType.GuildVoice,
          parent: created.category.id,
          reason: `Hackathon Team Voice Channel for ${teamName}`
        })
      ]);

      created.textChannel = textChannel;
      created.voiceChannel = voiceChannel;
      logger.info(`[Discord Provisioning] Created Text: #${textChannel.name} (${textChannel.id}) & Voice: #${voiceChannel.name} (${voiceChannel.id})`);

      return {
        roleId: created.role.id,
        categoryId: created.category.id,
        textChannelId: created.textChannel.id,
        voiceChannelId: created.voiceChannel.id,
        textChannel: created.textChannel
      };
    } catch (error) {
      logger.error(`[Discord Provisioning Failed] Error creating resources for "${teamName}": ${error.message}`);
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
      const member = guild.members.cache.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        logger.warn(`[DiscordService] Member ${discordId} not found in guild to assign roles.`);
        return;
      }

      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
      const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');

      // Add team role + ensure @Participant identity role
      const rolesToAdd = [];
      if (teamRoleId && !member.roles.cache.has(teamRoleId)) rolesToAdd.push(teamRoleId);
      if (participantRoleId && !member.roles.cache.has(participantRoleId)) {
        rolesToAdd.push(participantRoleId);
      }

      if (rolesToAdd.length > 0) {
        await member.roles.add(rolesToAdd, 'Assigned Hackathon Team & Participant roles');
      }

      // Remove @No-Team status role (they now have a team)
      if (noTeamRoleId && member.roles.cache.has(noTeamRoleId)) {
        await member.roles.remove(noTeamRoleId, 'Removed No-Team role on team join');
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
  static async removeTeamMembershipRoles(guild, discordId, teamRoleId, restoreNoTeam = true) {
    try {
      const member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
      if (!member) {
        logger.warn(`[DiscordService] Member ${discordId} not found in guild to remove team roles.`);
        return;
      }

      const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');
      const fallbackRoleId = noTeamRoleId || GuildConfigService.get('UNREGISTERED_ROLE_ID');

      // 1. Remove Team Role only (keep @Participant — it's an identity, not status)
      if (teamRoleId && member.roles.cache.has(teamRoleId)) {
        await member.roles.remove(teamRoleId, 'Removed Hackathon Team role').catch(() => {});
      }

      // 2. Restore @No-Team status role (or fallback to @Unregistered if NO_TEAM_ROLE_ID not configured)
      if (restoreNoTeam && fallbackRoleId && !member.roles.cache.has(fallbackRoleId)) {
        await member.roles.add(fallbackRoleId, 'Restored status role on team leave/delete').catch(() => {});
      }

      logger.info(`[DiscordService] Restored status role for ${member.user.tag}`);
    } catch (error) {
      logger.error(`[DiscordService] Failed to remove team roles for member ${discordId}: ${error.message}`);
    }
  }

  /**
   * Rename Discord resources for a team
   */
  static async renameTeamResources(guild, { roleId, categoryId, textChannelId, voiceChannelId, newName }) {
    const cleanSlug = sanitizeChannelName(newName);
    const tasks = [];

    if (roleId) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (role) tasks.push(role.setName(newName, `Team renamed to ${newName}`).catch(() => {}));
    }
    if (categoryId) {
      const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (category) tasks.push(category.setName(`📁 ${newName.toUpperCase()}`, `Team renamed to ${newName}`).catch(() => {}));
    }
    if (textChannelId) {
      const textChannel = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (textChannel) tasks.push(textChannel.setName(`💬・${cleanSlug}`, `Team renamed to ${newName}`).catch(() => {}));
    }
    if (voiceChannelId) {
      const voiceChannel = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (voiceChannel) tasks.push(voiceChannel.setName(`🔊・${cleanSlug}`, `Team renamed to ${newName}`).catch(() => {}));
    }

    await Promise.all(tasks);
  }

  /**
   * Archive team channels by locking them to read-only
   */
  static async archiveTeamChannels(guild, { roleId, categoryId, textChannelId, voiceChannelId }) {
    const tasks = [];

    if (roleId && categoryId) {
      const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (category) {
        tasks.push(category.permissionOverwrites.edit(roleId, {
          SendMessages: false,
          AddReactions: false,
          Connect: false,
          Speak: false
        }).catch(() => {}));
      }
    }

    if (roleId && textChannelId) {
      const text = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (text) {
        tasks.push(text.permissionOverwrites.edit(roleId, {
          SendMessages: false,
          AddReactions: false
        }).catch(() => {}));
      }
    }

    if (voiceChannelId && roleId) {
      const voice = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (voice) {
        tasks.push(voice.permissionOverwrites.edit(roleId, {
          Connect: false,
          Speak: false
        }).catch(() => {}));
      }
    }

    await Promise.all(tasks);
  }

  /**
   * Delete team Discord resources
   */
  static async deleteTeamResources(guild, { roleId, categoryId, textChannelId, voiceChannelId }) {
    // Delete text & voice channels in parallel first
    const channelTasks = [];
    if (voiceChannelId) {
      const ch = guild.channels.cache.get(voiceChannelId) || await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (ch) channelTasks.push(ch.delete('Team deleted').catch(() => {}));
    }
    if (textChannelId) {
      const ch = guild.channels.cache.get(textChannelId) || await guild.channels.fetch(textChannelId).catch(() => null);
      if (ch) channelTasks.push(ch.delete('Team deleted').catch(() => {}));
    }
    await Promise.all(channelTasks);

    // Delete category and role in parallel
    const parentTasks = [];
    if (categoryId) {
      const ch = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
      if (ch) parentTasks.push(ch.delete('Team deleted').catch(() => {}));
    }
    if (roleId) {
      const r = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (r) parentTasks.push(r.delete('Team deleted').catch(() => {}));
    }
    await Promise.all(parentTasks);
  }
}

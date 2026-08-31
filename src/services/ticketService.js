import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { env } from '../config/env.js';
import { AUDIT_ACTIONS, CUSTOM_IDS, TICKET_STATUS, TICKET_TYPE } from '../config/constants.js';
import { createTicket, getTicketByChannelId, getActiveUserTicket, closeTicket } from '../database/queries/ticketQueries.js';
import { upsertUser } from '../database/queries/userQueries.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { registrationTicketEmbed, supportTicketEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { sanitizeChannelName } from '../utils/validators.js';
import { AuditService } from './auditService.js';
import { logger } from '../utils/logger.js';

export class TicketService {
  /**
   * Create a Team Registration Ticket channel
   */
  static async createTeamRegistrationTicket(interaction) {
    // 1. Acknowledge immediately to prevent Discord timeout (Error 10062)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { user, guild } = interaction;

    try {
      // 2. Check anti-double-team
      const activeTeam = await getUserActiveTeamByDiscordId(user.id);
      if (activeTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Already Registered', `❌ You are already registered in team **${activeTeam.name}**!`)]
        });
      }

      // 3. Ensure user in DB
      const dbUser = await upsertUser(user.id, user.tag || user.username);

      // 4. Check for existing open registration ticket
      const existingTicket = await getActiveUserTicket(dbUser.id, TICKET_TYPE.TEAM_REGISTRATION);
      if (existingTicket) {
        return await interaction.editReply({
          embeds: [errorEmbed('Ticket Exists', `You already have an open registration ticket: <#${existingTicket.discord_channel_id}>`)]
        });
      }

      const channelName = `🎫・reg-${sanitizeChannelName(user.username)}`;

      // Overwrite permissions
      const permissionOverwrites = [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles
          ]
        }
      ];

      if (env.STAFF_ROLE_ID) {
        permissionOverwrites.push({
          id: env.STAFF_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }

      if (env.ADMINISTRATOR_ROLE_ID) {
        permissionOverwrites.push({
          id: env.ADMINISTRATOR_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: env.REGISTRATION_CATEGORY_ID || undefined,
        permissionOverwrites,
        topic: `Team registration ticket for ${user.tag} (${user.id})`
      });

      // Save to database
      await createTicket({
        discordChannelId: channel.id,
        createdBy: dbUser.id,
        type: TICKET_TYPE.TEAM_REGISTRATION
      });

      // Send initial ticket message with buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_OPEN_REG_MODAL)
          .setLabel('Register Team')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

      await channel.send({
        content: `<@${user.id}>`,
        embeds: [registrationTicketEmbed(user)],
        components: [row]
      });

      await AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.TICKET_CREATED,
        title: 'Registration Ticket Created',
        actorId: dbUser.id,
        actorTag: user.tag,
        details: `Ticket channel <#${channel.id}> created.`
      });

      return await interaction.editReply({
        content: `✅ Your registration ticket has been created: <#${channel.id}>`
      });
    } catch (error) {
      logger.error(`[TicketService] Failed to create registration ticket: ${error.message}`);
      return await interaction.editReply({
        content: `❌ Failed to create ticket: ${error.message}`
      });
    }
  }

  /**
   * Create a Support Ticket channel
   */
  static async createSupportTicket(interaction) {
    // 1. Acknowledge immediately
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { user, guild } = interaction;

    try {
      const dbUser = await upsertUser(user.id, user.tag || user.username);

      const existingTicket = await getActiveUserTicket(dbUser.id, TICKET_TYPE.SUPPORT);
      if (existingTicket) {
        return await interaction.editReply({
          embeds: [errorEmbed('Ticket Exists', `You already have an open support ticket: <#${existingTicket.discord_channel_id}>`)]
        });
      }

      const channelName = `🎫・support-${sanitizeChannelName(user.username)}`;

      const permissionOverwrites = [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ];

      if (env.STAFF_ROLE_ID) {
        permissionOverwrites.push({
          id: env.STAFF_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      if (env.TECHNICAL_SUPPORT_ROLE_ID) {
        permissionOverwrites.push({
          id: env.TECHNICAL_SUPPORT_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      if (env.ADMINISTRATOR_ROLE_ID) {
        permissionOverwrites.push({
          id: env.ADMINISTRATOR_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: env.SUPPORT_CATEGORY_ID || undefined,
        permissionOverwrites,
        topic: `Support ticket for ${user.tag} (${user.id})`
      });

      await createTicket({
        discordChannelId: channel.id,
        createdBy: dbUser.id,
        type: TICKET_TYPE.SUPPORT
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

      await channel.send({
        content: `<@${user.id}>`,
        embeds: [supportTicketEmbed(user)],
        components: [row]
      });

      await AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.TICKET_CREATED,
        title: 'Support Ticket Created',
        actorId: dbUser.id,
        actorTag: user.tag,
        details: `Support ticket <#${channel.id}> created.`
      });

      return await interaction.editReply({
        content: `✅ Your support ticket has been created: <#${channel.id}>`
      });
    } catch (error) {
      logger.error(`[TicketService] Failed to create support ticket: ${error.message}`);
      return await interaction.editReply({
        content: `❌ Failed to create support ticket: ${error.message}`
      });
    }
  }

  /**
   * Close a ticket channel
   */
  static async handleCloseTicket(interaction) {
    const channel = interaction.channel;

    await interaction.reply({
      embeds: [successEmbed('Ticket Closed', 'This ticket has been marked as closed and will be deleted in 5 seconds.')]
    });

    await closeTicket(channel.id).catch(() => {});

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.TICKET_CLOSED,
      title: 'Ticket Closed',
      actorTag: interaction.user.tag,
      details: `Ticket channel "${channel.name}" was closed.`
    });

    setTimeout(async () => {
      await channel.delete('Ticket closed').catch(() => {});
    }, 5000);
  }
}

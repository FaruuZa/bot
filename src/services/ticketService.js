import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { AUDIT_ACTIONS, CUSTOM_IDS, TICKET_STATUS, TICKET_TYPE } from '../config/constants.js';
import { createTicket, getTicketByChannelId, getActiveUserTicket, closeTicket } from '../database/queries/ticketQueries.js';
import { upsertUser } from '../database/queries/userQueries.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { registrationTicketEmbed, supportTicketEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { sanitizeChannelName, deduplicateOverwrites } from '../utils/validators.js';
import { AuditService } from './auditService.js';
import { PermissionService } from './permissionService.js';
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
      // Check if registration is open
      const regOpen = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
      if (!regOpen) {
        return await interaction.editReply({
          embeds: [errorEmbed('Pendaftaran Ditutup', 'Pendaftaran tim saat ini sedang ditutup oleh panitia.')]
        });
      }

      // 1b. Check participant role requirement (bypass for staff/admin testing)
      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
      const isStaffOrAdmin = PermissionService.isStaff(interaction.member);
      if (participantRoleId && !isStaffOrAdmin && !interaction.member?.roles?.cache?.has(participantRoleId)) {
        return await interaction.editReply({
          embeds: [errorEmbed('Hanya untuk Peserta Resmi', 'Hanya anggota yang telah terdaftar sebagai **Peserta Resmi (Participant)** yang dapat membuat tiket pendaftaran tim.')]
        });
      }

      // 2. Check anti-double-team
      const activeTeam = await getUserActiveTeamByDiscordId(user.id);
      if (activeTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Sudah Terdaftar', `Kamu sudah terdaftar di tim **${activeTeam.name}**!`)]
        });
      }

      // 3. Ensure user in DB
      const dbUser = await upsertUser(user.id, user.tag || user.username);

      // 4. Check for existing open registration ticket
      const existingTicket = await getActiveUserTicket(dbUser.id, TICKET_TYPE.TEAM_REGISTRATION);
      if (existingTicket) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tiket Sudah Ada', `Kamu sudah memiliki tiket pendaftaran yang masih terbuka: <#${existingTicket.discord_channel_id}>`)]
        });
      }

      const channelName = `reg-${sanitizeChannelName(user.username)}`;

      const staffRoleId = GuildConfigService.get('STAFF_ROLE_ID');
      const adminRoleId = GuildConfigService.get('ADMINISTRATOR_ROLE_ID');
      const regCategoryId = GuildConfigService.get('REGISTRATION_CATEGORY_ID');

      const botMemberId = guild.members.me?.id ?? interaction.client.user.id;
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
          id: botMemberId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles
          ]
        }
      ];

      if (staffRoleId) {
        permissionOverwrites.push({
          id: staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        });
      }

      if (adminRoleId) {
        permissionOverwrites.push({
          id: adminRoleId,
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
        parent: regCategoryId || undefined,
        permissionOverwrites: deduplicateOverwrites(permissionOverwrites),
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
          .setLabel('Daftarkan Tim')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
          .setLabel('Tutup Tiket')
          .setStyle(ButtonStyle.Danger)
      );

      // Ping only the user initially (staff has access but is not spammed with pings)
      const ticketMsg = await channel.send({
        content: `<@${user.id}> **Tiket Pendaftaran Tim Baru**`,
        embeds: [registrationTicketEmbed(user)],
        components: [row]
      });

      // Reply to user immediately to minimize perceived delay
      await interaction.editReply({
        content: `Tiket pendaftaranmu telah dibuat: <#${channel.id}>`
      });

      // Non-blocking background operations (pinning & audit logging)
      ticketMsg.pin().catch(() => {});
      AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.TICKET_CREATED,
        title: 'Registration Ticket Created',
        actorId: dbUser.id,
        actorTag: user.tag,
        details: `Ticket channel <#${channel.id}> created.`
      }).catch((err) => logger.warn(`[TicketService] Background audit log error: ${err.message}`));

      return;
    } catch (error) {
      logger.error(`[TicketService] Failed to create registration ticket: ${error.message}`);
      return await interaction.editReply({
        content: `Gagal membuat tiket pendaftaran: ${error.message}`
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
          embeds: [errorEmbed('Tiket Sudah Ada', `Kamu sudah memiliki tiket bantuan yang masih terbuka: <#${existingTicket.discord_channel_id}>`)]
        });
      }

      const channelName = `support-${sanitizeChannelName(user.username)}`;
      const staffRoleId = GuildConfigService.get('STAFF_ROLE_ID');
      const techSupportRoleId = GuildConfigService.get('TECHNICAL_SUPPORT_ROLE_ID');
      const adminRoleId = GuildConfigService.get('ADMINISTRATOR_ROLE_ID');
      const supportCategoryId = GuildConfigService.get('SUPPORT_CATEGORY_ID');

      const botMemberId = guild.members.me?.id ?? interaction.client.user.id;
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
          id: botMemberId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ];

      if (staffRoleId) {
        permissionOverwrites.push({
          id: staffRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      if (techSupportRoleId) {
        permissionOverwrites.push({
          id: techSupportRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      if (adminRoleId) {
        permissionOverwrites.push({
          id: adminRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: supportCategoryId || undefined,
        permissionOverwrites: deduplicateOverwrites(permissionOverwrites),
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
          .setLabel('Tutup Tiket')
          .setStyle(ButtonStyle.Danger)
      );

      // Ping tech support & staff so they get notified instantly
      const pings = [`<@${user.id}>`];
      if (techSupportRoleId) pings.push(`<@&${techSupportRoleId}>`);
      else if (staffRoleId) pings.push(`<@&${staffRoleId}>`);

      const ticketMsg = await channel.send({
        content: pings.join(' ') + ' **Tiket Bantuan / Support Baru**',
        embeds: [supportTicketEmbed(user)],
        components: [row]
      });
      // Reply to user immediately
      await interaction.editReply({
        content: `Tiket bantuanmu telah berhasil dibuat: <#${channel.id}>`
      });

      // Background non-blocking tasks
      ticketMsg.pin().catch(() => {});
      AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.TICKET_CREATED,
        title: 'Support Ticket Created',
        actorId: dbUser.id,
        actorTag: user.tag,
        details: `Support ticket <#${channel.id}> created.`
      }).catch((err) => logger.warn(`[TicketService] Background audit log error: ${err.message}`));

      return;
    } catch (error) {
      logger.error(`[TicketService] Failed to create support ticket: ${error.message}`);
      return await interaction.editReply({
        content: `Gagal membuat tiket bantuan: ${error.message}`
      });
    }
  }

  /**
   * Close a ticket channel
   */
  static async handleCloseTicket(interaction) {
    const channel = interaction.channel;

    await interaction.reply({
      embeds: [successEmbed('Tiket Ditutup', 'Tiket ini telah ditandai selesai dan channel akan otomatis dihapus dalam 5 detik.')]
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

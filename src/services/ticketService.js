import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { AUDIT_ACTIONS, CUSTOM_IDS, EMBED_COLORS, TICKET_STATUS, TICKET_TYPE } from '../config/constants.js';
import { createTicket, getTicketByChannelId, getActiveUserTicket, closeTicket, getPendingReminderTickets, updateTicketReminder, getOpenSupportTickets, resetTicketReminder } from '../database/queries/ticketQueries.js';
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

      // 2 & 3. Check anti-double-team and ensure user in DB in parallel
      const [activeTeam, dbUser] = await Promise.all([
        getUserActiveTeamByDiscordId(user.id),
        upsertUser(user.id, user.tag || user.username)
      ]);

      if (activeTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Sudah Terdaftar', `Kamu sudah terdaftar di tim **${activeTeam.name}**!`)]
        });
      }

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
    if (!channel) return;

    try {
      const payload = {
        embeds: [successEmbed('Tiket Ditutup', 'Tiket ini telah ditandai selesai dan channel akan otomatis dihapus dalam 5 detik.')]
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    } catch {
      // Ignore if interaction failed or was already handled
    }

    await closeTicket(channel.id).catch(() => {});

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.TICKET_CLOSED,
      title: 'Ticket Closed',
      actorTag: interaction.user.tag,
      details: `Ticket channel "${channel.name}" was closed.`
    }).catch(() => {});

    setTimeout(async () => {
      await channel.delete('Ticket closed').catch(() => {});
    }, 5000);
  }

  /**
   * Start periodic background sweeper for idle team registration tickets
   * @param {import('discord.js').Client} client 
   */
  static startTicketReminderSweeper(client) {
    logger.info('[TicketService] Menjalankan background sweeper pengingat tiket (interval 30 menit).');

    // Run initial sweep after 10s delay to allow Discord client & guild cache to settle
    setTimeout(async () => {
      await TicketService.sweepPendingReminders(client).catch((err) =>
        logger.error(`[TicketService Initial Sweep Error] ${err.message}`)
      );
      await TicketService.sweepSupportTickets(client).catch((err) =>
        logger.error(`[TicketService Initial Support Sweep Error] ${err.message}`)
      );
    }, 10000);

    // Run every 30 minutes
    setInterval(async () => {
      await TicketService.sweepPendingReminders(client).catch((err) =>
        logger.error(`[TicketService Sweeper Error] ${err.message}`)
      );
      await TicketService.sweepSupportTickets(client).catch((err) =>
        logger.error(`[TicketService Support Sweeper Error] ${err.message}`)
      );
    }, 30 * 60 * 1000);
  }

  /**
   * Sweep and process idle tickets requiring reminders
   * @param {import('discord.js').Client} client 
   */
  static async sweepPendingReminders(client) {
    let pendingTickets = [];
    try {
      pendingTickets = await getPendingReminderTickets();
    } catch (err) {
      logger.error(`[TicketService] Gagal mengambil daftar tiket idle dari database: ${err.message}`);
      return;
    }

    if (!pendingTickets || pendingTickets.length === 0) return;

    for (const ticket of pendingTickets) {
      try {
        const channel = client.channels.cache.get(ticket.discord_channel_id)
          || await client.channels.fetch(ticket.discord_channel_id).catch(() => null);

        // Self-healing: jika channel sudah dihapus manual dari Discord, tandai tiket CLOSED
        if (!channel) {
          logger.info(`[TicketService] Channel tiket ${ticket.discord_channel_id} tidak ditemukan di Discord. Menandai tiket sebagai CLOSED.`);
          await closeTicket(ticket.discord_channel_id).catch(() => {});
          continue;
        }

        if (!channel.isTextBased()) continue;

        const isFinal = (ticket.reminder_count || 0) >= 1;
        const embed = isFinal
          ? new EmbedBuilder()
              .setTitle('Peringatan Terakhir: Pendaftaran Tim')
              .setColor(EMBED_COLORS.WARNING)
              .setDescription(
                `Halo <@${ticket.creator_discord_id}>, ini adalah pengingat terakhir mengenai tiket pendaftaran tim kamu yang belum diselesaikan.\n\n` +
                `Bot tidak akan mengirimkan pengingat lagi di channel ini agar tidak mengganggu kamu. Tiket ini akan tetap terbuka sehingga kamu bisa menyelesaikan pendaftaran kapan saja jika sudah siap.`
              )
              .setFooter({ text: 'NSAC Hackathon • Pengingat Terakhir (2/2)' })
              .setTimestamp()
          : new EmbedBuilder()
              .setTitle('Pengingat Pendaftaran Tim')
              .setColor(EMBED_COLORS.PRIMARY)
              .setDescription(
                `Halo <@${ticket.creator_discord_id}>, tiket pendaftaran tim kamu masih terbuka dan belum selesai.\n\n` +
                `• Jika kamu ingin memulai atau mengulang pengisian data tim, silakan klik tombol **Mulai / Isi Data Tim** di bawah.\n` +
                `• Jika kamu batal membuat tim, silakan klik tombol **Tutup Tiket** untuk menghapus channel ini.`
              )
              .setFooter({ text: 'NSAC Hackathon • Pengingat Pendaftaran (1/2)' })
              .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.BTN_OPEN_REG_MODAL)
            .setLabel('Mulai / Isi Data Tim')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
            .setLabel('Tutup Tiket')
            .setStyle(ButtonStyle.Danger)
        );

        await channel.send({
          content: `<@${ticket.creator_discord_id}>`,
          embeds: [embed],
          components: [row]
        });

        const nextCount = (ticket.reminder_count || 0) + 1;
        await updateTicketReminder(ticket.discord_channel_id, nextCount);
        logger.info(`[TicketService] Berhasil mengirim pengingat pendaftaran ke channel #${channel.name} (Pengingat ke-${nextCount}).`);
      } catch (ticketErr) {
        logger.warn(`[TicketService] Gagal memproses pengingat tiket ${ticket.discord_channel_id}: ${ticketErr.message}`);
      }
    }
  }

  /**
   * Sweep and process idle support tickets (24h reminder, 48h auto-close)
   * @param {import('discord.js').Client} client 
   */
  static async sweepSupportTickets(client) {
    let supportTickets = [];
    try {
      supportTickets = await getOpenSupportTickets();
    } catch (err) {
      logger.error(`[TicketService] Gagal mengambil daftar tiket support dari database: ${err.message}`);
      return;
    }

    if (!supportTickets || supportTickets.length === 0) return;

    const now = Date.now();
    const IDLE_REMINDER_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 jam
    const AUTO_CLOSE_THRESHOLD_MS = 24 * 60 * 60 * 1000;    // 24 jam setelah reminder (total 48 jam)

    for (const ticket of supportTickets) {
      try {
        const channel = client.channels.cache.get(ticket.discord_channel_id)
          || await client.channels.fetch(ticket.discord_channel_id).catch(() => null);

        // Self-healing jika channel support sudah dihapus manual
        if (!channel) {
          logger.info(`[TicketService] Channel tiket support ${ticket.discord_channel_id} tidak ditemukan. Menandai sebagai CLOSED.`);
          await closeTicket(ticket.discord_channel_id).catch(() => {});
          continue;
        }

        if (!channel.isTextBased()) continue;

        // Ambil pesan terakhir untuk cek kapan aktivitas terakhir terjadi
        const messages = await channel.messages.fetch({ limit: 5 }).catch(() => null);
        if (!messages || messages.size === 0) continue;

        const latestMsg = messages.first();
        const latestMsgTime = latestMsg.createdTimestamp;

        // Cek jika reminder_count === 1:
        if (ticket.reminder_count >= 1 && ticket.last_reminded_at) {
          const remindedTime = new Date(ticket.last_reminded_at).getTime();

          // Jika ada pesan baru BUKAN dari bot atau pesan user setelah bot mengirim reminder:
          // Artinya peserta/staf membalas obrolan -> BATALKAN auto-close dan RESET reminder!
          const hasUserActivityAfterReminder = messages.some(
            (m) => m.createdTimestamp > remindedTime + 2000 && m.author.id !== client.user.id
          );

          if (hasUserActivityAfterReminder) {
            logger.info(`[TicketService] Aktivitas baru terdeteksi di channel support #${channel.name}. Mereset timer pengingat.`);
            await resetTicketReminder(ticket.discord_channel_id);
            continue;
          }

          // Jika tetap TIDAK ADA aktivitas selama 24 jam sejak reminder (total 48 jam):
          if (now - remindedTime >= AUTO_CLOSE_THRESHOLD_MS) {
            logger.info(`[TicketService] Tiket support #${channel.name} tidak aktif selama 48 jam. Menutup otomatis.`);

            const autoCloseEmbed = new EmbedBuilder()
              .setTitle('Tiket Bantuan Ditutup Otomatis')
              .setColor(EMBED_COLORS.DARK)
              .setDescription(
                `Halo <@${ticket.creator_discord_id}>, tiket bantuan ini otomatis ditutup karena tidak ada aktivitas selama 48 jam.\n\n` +
                `Jika kamu masih memiliki kendala atau pertanyaan lain di kemudian hari, kamu dapat membuat tiket bantuan baru di channel bantuan.\n\n` +
                `*Channel ini akan dihapus dalam 5 detik.*`
              )
              .setTimestamp();

            await channel.send({ embeds: [autoCloseEmbed] }).catch(() => {});
            await closeTicket(ticket.discord_channel_id).catch(() => {});

            await AuditService.log(client, {
              action: AUDIT_ACTIONS.TICKET_CLOSED,
              title: 'Support Ticket Auto-Closed',
              actorTag: 'System (Inactivity)',
              details: `Support ticket channel "${channel.name}" was auto-closed after 48 hours of inactivity.`
            }).catch(() => {});

            setTimeout(async () => {
              await channel.delete('Support ticket closed due to inactivity').catch(() => {});
            }, 5000);

            continue;
          }
        } else if ((ticket.reminder_count || 0) === 0) {
          // Belum pernah diingatkan. Cek apakah sudah 24 jam sejak pesan terakhir:
          if (now - latestMsgTime >= IDLE_REMINDER_THRESHOLD_MS) {
            const reminderEmbed = new EmbedBuilder()
              .setTitle('Pengingat Tiket Bantuan')
              .setColor(EMBED_COLORS.PRIMARY)
              .setDescription(
                `Halo <@${ticket.creator_discord_id}>, apakah pertanyaan atau kendalamu sudah teratasi?\n\n` +
                `• Jika kendalamu **sudah selesai**, silakan klik tombol **Tutup Tiket** di bawah.\n` +
                `• Jika kamu **masih butuh bantuan**, **cukup ketik balasan apa saja di sini**, dan tiket akan tetap dibuka.\n\n` +
                `*Catatan: Jika tidak ada aktivitas dalam 24 jam ke depan, tiket ini akan ditutup otomatis oleh sistem.*`
              )
              .setFooter({ text: 'NSAC Hackathon • Pengingat Tiket Support' })
              .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
                .setLabel('Tutup Tiket')
                .setStyle(ButtonStyle.Danger)
            );

            await channel.send({
              content: `<@${ticket.creator_discord_id}>`,
              embeds: [reminderEmbed],
              components: [row]
            });

            await updateTicketReminder(ticket.discord_channel_id, 1);
            logger.info(`[TicketService] Mengirim pengingat inaktivitas ke channel support #${channel.name}.`);
          }
        }
      } catch (ticketErr) {
        logger.warn(`[TicketService] Gagal memproses support ticket ${ticket.discord_channel_id}: ${ticketErr.message}`);
      }
    }
  }
}


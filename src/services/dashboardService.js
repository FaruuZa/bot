import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField
} from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { InviteService } from './inviteService.js';
import { pool } from '../database/pool.js';
import { EMBED_COLORS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export class DashboardService {
  /**
   * Build the Embed and Components payload for the Admin Control Panel
   * @param {import('discord.js').Guild} guild 
   */
  static async buildDashboardPayload(guild) {
    // 1. Fetch team statistics
    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_count,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE status = 'ARCHIVED') as archived_count
      FROM teams
    `);
    const s = stats[0] || { active_count: 0, pending_count: 0, archived_count: 0 };

    // 2. Fetch configurations
    const regOpen = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
    const inviteCode = GuildConfigService.get('PARTICIPANT_INVITE_CODE');
    const selectRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('UNREGISTERED_ROLE_ID');
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');

    // 3. Build Embed
    const embed = new EmbedBuilder()
      .setTitle('🎛️ NSAC Staff & Admin Control Center')
      .setDescription(
        'Panel kendali terpusat untuk memantau server, membuka/menutup pendaftaran tim, ' +
        'mengelola link invite peserta (auto-role), dan mengatur filter role pemilihan anggota tim.'
      )
      .setColor(regOpen ? EMBED_COLORS.SUCCESS : EMBED_COLORS.DANGER)
      .addFields(
        {
          name: '📢 Status Pendaftaran Tim',
          value: regOpen ? '🟢 **BUKA (OPEN)** — Peserta dapat mendaftar tim' : '🔴 **TUTUP (CLOSED)** — Pendaftaran tim dinonaktifkan',
          inline: true
        },
        {
          name: '🎟️ Link Invite Peserta (Auto-Role)',
          value: inviteCode
            ? `[https://discord.gg/${inviteCode}](https://discord.gg/${inviteCode})\n*(Kode: \`${inviteCode}\`)*`
            : '*(Belum dibuat — klik tombol di bawah untuk generate)*',
          inline: true
        },
        {
          name: '👥 Role Dropdown Pemilihan Anggota Tim',
          value: selectRoleId
            ? `<@&${selectRoleId}>\n*(Pengguna dengan role ini yang muncul di dropdown)*`
            : '*(Belum diatur — default ke @Unregistered)*',
          inline: false
        },
        {
          name: '📊 Ringkasan Tim Hackathon',
          value: `• **Tim Aktif:** \`${s.active_count}\` tim\n• **Menunggu Verifikasi:** \`${s.pending_count}\` tim\n• **Diarsipkan:** \`${s.archived_count}\` tim`,
          inline: false
        },
        {
          name: '⚙️ Konfigurasi Role Utama',
          value: `• **Participant Role:** ${participantRoleId ? `<@&${participantRoleId}>` : '*(Belum diatur)*'}\n• **Unregistered Role:** ${unregisteredRoleId ? `<@&${unregisteredRoleId}>` : '*(Belum diatur)*'}`,
          inline: false
        }
      )
      .setFooter({ text: 'NSAC Hackathon Management Bot • Terakhir Diperbarui' })
      .setTimestamp();

    // 4. Action Row 1: Buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dashboard_toggle_reg')
        .setLabel(regOpen ? 'Tutup Pendaftaran' : 'Buka Pendaftaran')
        .setStyle(regOpen ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(regOpen ? '🔒' : '🔓'),
      new ButtonBuilder()
        .setCustomId('dashboard_gen_invite')
        .setLabel('Buat Link Invite Peserta')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎟️'),
      new ButtonBuilder()
        .setCustomId('dashboard_refresh')
        .setLabel('Refresh Panel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
    );

    // 5. Action Row 2: Role Select Menu for Team Member Filter
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('dashboard_select_member_role')
      .setPlaceholder('🎯 Pilih role yang diizinkan muncul di dropdown anggota tim...')
      .setMinValues(1)
      .setMaxValues(1);

    const selectRow = new ActionRowBuilder().addComponents(roleSelect);

    return {
      embeds: [embed],
      components: [buttonRow, selectRow]
    };
  }

  /**
   * Setup or find the admin dashboard channel and deploy/update the control panel
   * @param {import('discord.js').Guild} guild 
   * @param {import('discord.js').Client} client 
   */
  static async setupDashboard(guild, client) {
    let channelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
    let channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

    const adminRoleId = GuildConfigService.get('ADMINISTRATOR_ROLE_ID');
    const staffRoleId = GuildConfigService.get('STAFF_ROLE_ID');

    // If channel doesn't exist, create private channel
    if (!channel) {
      const permissionOverwrites = [
        {
          id: guild.id, // @everyone
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: client.user.id, // Bot
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ];

      if (adminRoleId) {
        permissionOverwrites.push({
          id: adminRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      if (staffRoleId && staffRoleId !== adminRoleId) {
        permissionOverwrites.push({
          id: staffRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      channel = await guild.channels.create({
        name: 'admin-dashboard',
        type: ChannelType.GuildText,
        topic: '🔒 Staff & Administrator Central Control Panel',
        permissionOverwrites
      });

      await GuildConfigService.set('DASHBOARD_CHANNEL_ID', channel.id);
      logger.info(`[DashboardService] Created admin dashboard channel: #${channel.name} (${channel.id})`);
    }

    // Check existing message or post new one
    const payload = await this.buildDashboardPayload(guild);
    let messageId = GuildConfigService.get('DASHBOARD_MESSAGE_ID');
    let message = null;

    if (messageId) {
      message = await channel.messages.fetch(messageId).catch(() => null);
    }

    if (message) {
      await message.edit(payload);
      logger.info(`[DashboardService] Updated existing dashboard message in #${channel.name}`);
    } else {
      message = await channel.send(payload);
      await GuildConfigService.set('DASHBOARD_MESSAGE_ID', message.id);
      logger.info(`[DashboardService] Posted new dashboard message in #${channel.name}`);
    }

    return { channel, message };
  }

  /**
   * Refresh the dashboard message in-place
   * @param {import('discord.js').Client} client 
   * @param {import('discord.js').Guild} guild 
   */
  static async refreshDashboard(client, guild) {
    const channelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
    const messageId = GuildConfigService.get('DASHBOARD_MESSAGE_ID');

    if (!channelId || !messageId) return false;

    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return false;

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) return false;

      const payload = await this.buildDashboardPayload(guild);
      await message.edit(payload);
      return true;
    } catch (err) {
      logger.warn(`[DashboardService] Failed to refresh dashboard: ${err.message}`);
      return false;
    }
  }
}

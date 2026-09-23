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
import { getAllInviteRoles } from '../database/queries/inviteQueries.js';
import { pool } from '../database/pool.js';
import { EMBED_COLORS } from '../config/constants.js';
import { CountdownService } from './countdownService.js';
import { logger } from '../utils/logger.js';

export class DashboardService {
  /**
   * Set of known panel message IDs in memory to protect them from auto-deletion
   * @type {Set<string>}
   */
  static panelMessageIds = new Set();

  /**
   * Register a message ID as a persistent dashboard panel message
   * @param {string} id 
   */
  static registerPanelMessageId(id) {
    if (id) {
      this.panelMessageIds.add(id);
    }
  }

  /**
   * Check if a message ID belongs to one of the dashboard panel messages
   * @param {string} id 
   * @returns {boolean}
   */
  static isPanelMessage(id) {
    if (!id) return false;
    if (this.panelMessageIds.has(id)) return true;

    const overviewId = GuildConfigService.get('DASHBOARD_OVERVIEW_MSG_ID') || GuildConfigService.get('DASHBOARD_MESSAGE_ID');
    const rolesId = GuildConfigService.get('DASHBOARD_ROLES_MSG_ID');
    const invitesId = GuildConfigService.get('DASHBOARD_INVITES_MSG_ID');

    if (id === overviewId || id === rolesId || id === invitesId) {
      this.panelMessageIds.add(id);
      return true;
    }
    return false;
  }

  /**
   * Build Payload for Panel 1: Overview & Team Management
   * @param {import('discord.js').Guild} guild 
   */
  static async buildOverviewPayload(guild) {
    // 1. Fetch team and challenge statistics
    const { rows: stats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_count,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE status = 'ARCHIVED') as archived_count,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND challenge_id IS NOT NULL) as with_challenge_count,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND challenge_id IS NULL) as no_challenge_count,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND nsac_link IS NOT NULL AND nsac_link != '') as with_link_count,
        (SELECT COUNT(*) FROM challenges) as challenge_count,
        (SELECT COUNT(DISTINCT user_id) FROM team_members WHERE status = 'ACTIVE') as active_members_count
      FROM teams
    `);
    const s = stats[0] || {
      active_count: 0,
      pending_count: 0,
      archived_count: 0,
      with_challenge_count: 0,
      no_challenge_count: 0,
      with_link_count: 0,
      challenge_count: 0,
      active_members_count: 0
    };

    // 2. Fetch latest guild members & roles to ensure accurate cache
    await guild.members.fetch().catch(() => {});

    const regOpen = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');

    let participantDisplay = '*(Role belum diatur — pilih di Panel 2)*';
    if (participantRoleId) {
      const role = guild.roles.cache.get(participantRoleId);
      if (role) {
        participantDisplay = `\`${role.members.size}\` orang (<@&${participantRoleId}>)`;
      } else {
        participantDisplay = `\`0\` orang *(Role ID \`${participantRoleId}\` tidak ditemukan)*`;
      }
    }

    let noTeamDisplay = '*(Role belum diatur — pilih di Panel 2)*';
    if (noTeamRoleId) {
      const role = guild.roles.cache.get(noTeamRoleId);
      if (role) {
        noTeamDisplay = `\`${role.members.size}\` orang (<@&${noTeamRoleId}>)`;
      } else {
        noTeamDisplay = `\`0\` orang *(Role ID \`${noTeamRoleId}\` tidak ditemukan)*`;
      }
    }

    const countdown = CountdownService.getCountdownInfo();

    // 3. Build Embed
    const embed = new EmbedBuilder()
      .setTitle('NSAC Admin Dashboard — Overview & Tim')
      .setDescription(
        'Panel kendali status operasional server, pembukaan pendaftaran tim, ' +
        'dan monitoring statistik tim peserta hackathon.'
      )
      .setColor(regOpen ? EMBED_COLORS.SUCCESS : EMBED_COLORS.DANGER)
      .addFields(
        {
          name: 'Status Acara & Pendaftaran',
          value:
            `• **Countdown / Fase:** ${countdown.label}\n` +
            `• **Status Registrasi:** ${regOpen ? '**BUKA (OPEN)** — Pendaftaran aktif' : '**TUTUP (CLOSED)** — Pendaftaran nonaktif'}`,
          inline: false
        },
        {
          name: 'Statistik Peserta',
          value:
            `• **Total Peserta Resmi:** ${participantDisplay}\n` +
            `• **Sudah Masuk Tim:** \`${s.active_members_count}\` orang\n` +
            `• **Belum Memiliki Tim (@No-Team):** ${noTeamDisplay}`,
          inline: false
        },
        {
          name: 'Ringkasan Tim Hackathon',
          value:
            `• **Tim Aktif:** \`${s.active_count}\` tim\n` +
            `• **Menunggu Verifikasi:** \`${s.pending_count}\` tim\n` +
            `• **Diarsipkan:** \`${s.archived_count}\` tim`,
          inline: true
        },
        {
          name: 'Challenge & Profil Web NASA',
          value:
            `• **Tantangan Terdaftar:** \`${s.challenge_count}\` challenge\n` +
            `• **Sudah Pilih Challenge:** \`${s.with_challenge_count}\` tim\n` +
            `• **Belum Pilih Challenge:** \`${s.no_challenge_count}\` tim\n` +
            `• **Tautan NSAC Terisi:** \`${s.with_link_count}\` tim`,
          inline: false
        }
      )
      .setFooter({ text: 'Panel 1/3 • Overview & Tim' })
      .setTimestamp();

    // 4. Action Row: Buttons
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dashboard_toggle_reg')
        .setLabel(regOpen ? 'Tutup Pendaftaran' : 'Buka Pendaftaran')
        .setStyle(regOpen ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('dashboard_open_team_panel')
        .setLabel('Kelola Tim')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('dashboard_refresh_all')
        .setLabel('Refresh Semua Panel')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttonRow]
    };
  }

  /**
   * Build Payload for Panel 2: System Role Configuration
   * @param {import('discord.js').Guild} guild 
   */
  static async buildRolesPayload(guild) {
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');
    const selectRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');

    const participantDisplay = participantRoleId ? `<@&${participantRoleId}>` : '*(Belum diatur)*';
    const noTeamDisplay = noTeamRoleId ? `<@&${noTeamRoleId}>` : '*(Belum diatur)*';
    const filterDisplay = selectRoleId
      ? `<@&${selectRoleId}> *(Member dengan role ini yang tampil di dropdown pendaftaran)*`
      : '*(Belum diatur — default: semua member)*';

    const embed = new EmbedBuilder()
      .setTitle('NSAC Admin Dashboard — Pengaturan Role Sistem')
      .setDescription(
        'Atur role sistem yang digunakan oleh bot untuk identitas peserta dan filter dropdown pembentukan tim. ' +
        'Pilih role melalui menu dropdown di bawah.'
      )
      .setColor(EMBED_COLORS.PRIMARY)
      .addFields(
        {
          name: 'Role Participant (Identitas Peserta)',
          value: `${participantDisplay}\n*Role permanen sebagai identitas peserta resmi hackathon.*`,
          inline: false
        },
        {
          name: 'Role No-Team (Belum Memiliki Tim)',
          value: `${noTeamDisplay}\n*Role sementara untuk peserta yang belum terdaftar di tim mana pun.*`,
          inline: false
        },
        {
          name: 'Filter Dropdown Pemilihan Anggota',
          value: `${filterDisplay}`,
          inline: false
        }
      )
      .setFooter({ text: 'Panel 2/3 • Konfigurasi Role' })
      .setTimestamp();

    const participantRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId('dashboard_roleselect_participant')
      .setPlaceholder('Set Role: Participant (Identitas Peserta)...')
      .setMinValues(1)
      .setMaxValues(1);

    const noTeamRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId('dashboard_roleselect_noteam')
      .setPlaceholder('Set Role: No-Team (Belum Punya Tim)...')
      .setMinValues(1)
      .setMaxValues(1);

    const filterRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId('dashboard_select_member_role')
      .setPlaceholder('Set Filter Dropdown Pemilihan Anggota Tim...')
      .setMinValues(1)
      .setMaxValues(1);

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(participantRoleSelect),
        new ActionRowBuilder().addComponents(noTeamRoleSelect),
        new ActionRowBuilder().addComponents(filterRoleSelect)
      ]
    };
  }

  /**
   * Build Payload for Panel 3: Dynamic Invites & Auto-Role Manager
   * @param {import('discord.js').Guild} guild 
   */
  static async buildInvitesPayload(guild) {
    const dynamicInvites = await getAllInviteRoles();
    const guildInvites = await guild.invites.fetch().catch(() => null);

    let listText = '';
    if (!dynamicInvites || dynamicInvites.length === 0) {
      listText = '*(Belum ada link invite dinamis. Klik tombol **Buat Link Baru** di bawah untuk membuatnya).*';
    } else {
      const lines = dynamicInvites.map((inv, idx) => {
        const liveInvite = guildInvites?.get(inv.invite_code);
        const uses = liveInvite ? (liveInvite.uses || 0) : 0;
        const roleIds = (inv.role_ids && Array.isArray(inv.role_ids) && inv.role_ids.length > 0)
          ? inv.role_ids
          : (inv.role_id ? [inv.role_id] : []);
        const roleMentions = roleIds.length > 0
          ? roleIds.map((id) => `<@&${id}>`).join(' + ')
          : '*(Role tidak ditemukan)*';
        const roleLabel = inv.label || 'Role';

        return `**${idx + 1}. [${roleLabel}]** ➔ ${roleMentions}\n` +
               `   • Link: [https://discord.gg/${inv.invite_code}](https://discord.gg/${inv.invite_code}) \`(Kode: ${inv.invite_code})\`\n` +
               `   • Total Digunakan: \`${uses}\` kali`;
      });
      listText = lines.join('\n\n');

    }

    const description =
      'Buat dan kelola link invite Discord dengan **Auto-Role Dinamis**.\n' +
      'Setiap orang yang bergabung menggunakan link invite tertentu akan langsung mendapatkan role yang ditentukan (misal: Peserta, Mentor, Juri, Tamu, dll).\n\n' +
      `__**Daftar Link Invite Aktif (${dynamicInvites?.length || 0})**__\n` +
      (listText.length > 3500 ? listText.substring(0, 3500) + '...\n*(dan lainnya)*' : listText);

    const embed = new EmbedBuilder()
      .setTitle('NSAC Admin Dashboard — Dynamic Invites & Auto-Role')
      .setDescription(description)
      .setColor(EMBED_COLORS.PRIMARY)
      .setFooter({ text: 'Panel 3/3 • Dynamic Invites' })
      .setTimestamp();

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dashboard_invite_create')
        .setLabel('Buat Link Baru')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dashboard_invite_delete')
        .setLabel('Hapus Link')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!dynamicInvites || dynamicInvites.length === 0),
      new ButtonBuilder()
        .setCustomId('dashboard_invite_refresh')
        .setLabel('Refresh Invite')
        .setStyle(ButtonStyle.Secondary)
    );

    return {
      embeds: [embed],
      components: [buttonRow]
    };
  }

  /**
   * Setup or find the admin dashboard channel and deploy/update all separated panels.
   * Also purges any non-panel messages to keep the channel clean.
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

    // 1. Overview Panel
    const overviewPayload = await this.buildOverviewPayload(guild);
    let overviewMsgId = GuildConfigService.get('DASHBOARD_OVERVIEW_MSG_ID') || GuildConfigService.get('DASHBOARD_MESSAGE_ID');
    let overviewMsg = overviewMsgId ? await channel.messages.fetch(overviewMsgId).catch(() => null) : null;

    if (overviewMsg) {
      await overviewMsg.edit(overviewPayload);
    } else {
      overviewMsg = await channel.send(overviewPayload);
    }
    this.registerPanelMessageId(overviewMsg.id);
    await GuildConfigService.set('DASHBOARD_OVERVIEW_MSG_ID', overviewMsg.id);
    await GuildConfigService.set('DASHBOARD_MESSAGE_ID', overviewMsg.id);

    // 2. Roles Panel
    const rolesPayload = await this.buildRolesPayload(guild);
    let rolesMsgId = GuildConfigService.get('DASHBOARD_ROLES_MSG_ID');
    let rolesMsg = rolesMsgId ? await channel.messages.fetch(rolesMsgId).catch(() => null) : null;

    if (rolesMsg) {
      await rolesMsg.edit(rolesPayload);
    } else {
      rolesMsg = await channel.send(rolesPayload);
    }
    this.registerPanelMessageId(rolesMsg.id);
    await GuildConfigService.set('DASHBOARD_ROLES_MSG_ID', rolesMsg.id);

    // 3. Invites Panel
    const invitesPayload = await this.buildInvitesPayload(guild);
    let invitesMsgId = GuildConfigService.get('DASHBOARD_INVITES_MSG_ID');
    let invitesMsg = invitesMsgId ? await channel.messages.fetch(invitesMsgId).catch(() => null) : null;

    if (invitesMsg) {
      await invitesMsg.edit(invitesPayload);
    } else {
      invitesMsg = await channel.send(invitesPayload);
    }
    this.registerPanelMessageId(invitesMsg.id);
    await GuildConfigService.set('DASHBOARD_INVITES_MSG_ID', invitesMsg.id);

    // 4. Purge any other messages in the channel to keep it strictly clean
    await this.cleanExtraneousMessages(channel, [overviewMsg.id, rolesMsg.id, invitesMsg.id]);

    logger.info(`[DashboardService] Deployed/Updated 3 dashboard panels in #${channel.name}`);
    return { channel, overviewMsg, rolesMsg, invitesMsg };
  }

  /**
   * Delete any non-panel messages in the channel.
   * @param {import('discord.js').TextChannel} channel 
   * @param {string[]} panelMessageIds 
   */
  static async cleanExtraneousMessages(channel, panelMessageIds) {
    try {
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!messages) return;

      const validIds = new Set(panelMessageIds);
      const toDelete = messages.filter((m) => {
        if (validIds.has(m.id)) return false;
        if (this.isPanelMessage(m.id)) return false;
        return true;
      });

      if (toDelete.size > 0) {
        logger.info(`[DashboardService] Purging ${toDelete.size} non-panel messages in #${channel.name}...`);
        await channel.bulkDelete(toDelete, true).catch(async () => {
          for (const [, msg] of toDelete) {
            await msg.delete().catch(() => {});
          }
        });
      }
    } catch (err) {
      logger.warn(`[DashboardService] Clean extraneous messages warning: ${err.message}`);
    }
  }

  /**
   * Refresh Panel 1: Overview
   */
  static async refreshOverviewPanel(guild) {
    const channelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
    const msgId = GuildConfigService.get('DASHBOARD_OVERVIEW_MSG_ID') || GuildConfigService.get('DASHBOARD_MESSAGE_ID');
    if (!channelId || !msgId) return false;

    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return false;
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return false;

      this.registerPanelMessageId(msg.id);
      const payload = await this.buildOverviewPayload(guild);
      await msg.edit(payload);
      return true;
    } catch (err) {
      logger.warn(`[DashboardService] Failed to refresh overview panel: ${err.message}`);
      return false;
    }
  }

  /**
   * Refresh Panel 2: Roles
   */
  static async refreshRolesPanel(guild) {
    const channelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
    const msgId = GuildConfigService.get('DASHBOARD_ROLES_MSG_ID');
    if (!channelId || !msgId) return false;

    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return false;
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return false;

      this.registerPanelMessageId(msg.id);
      const payload = await this.buildRolesPayload(guild);
      await msg.edit(payload);
      return true;
    } catch (err) {
      logger.warn(`[DashboardService] Failed to refresh roles panel: ${err.message}`);
      return false;
    }
  }

  /**
   * Refresh Panel 3: Dynamic Invites
   */
  static async refreshInvitesPanel(guild) {
    const channelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
    const msgId = GuildConfigService.get('DASHBOARD_INVITES_MSG_ID');
    if (!channelId || !msgId) return false;

    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return false;
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return false;

      this.registerPanelMessageId(msg.id);
      const payload = await this.buildInvitesPayload(guild);
      await msg.edit(payload);
      return true;
    } catch (err) {
      logger.warn(`[DashboardService] Failed to refresh invites panel: ${err.message}`);
      return false;
    }
  }

  /**
   * Refresh all 3 panels at once.
   * @param {import('discord.js').Guild} guild 
   */
  static async refreshAllPanels(guild) {
    await Promise.allSettled([
      this.refreshOverviewPanel(guild),
      this.refreshRolesPanel(guild),
      this.refreshInvitesPanel(guild)
    ]);
    return true;
  }

  /**
   * General refresh dashboard method for backward compatibility
   * @param {import('discord.js').Client} client 
   * @param {import('discord.js').Guild} guild 
   */
  static async refreshDashboard(client, guild) {
    return await this.refreshAllPanels(guild);
  }

  /**
   * Legacy buildDashboardPayload for any old calls
   * @param {import('discord.js').Guild} guild 
   */
  static async buildDashboardPayload(guild) {
    return await this.buildOverviewPayload(guild);
  }
}

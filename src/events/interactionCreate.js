import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} from 'discord.js';
import { CUSTOM_IDS, EMBED_COLORS } from '../config/constants.js';
import { env } from '../config/env.js';
import { GuildConfigService, ConfigMissingError } from '../services/guildConfigService.js';
import { TicketService } from '../services/ticketService.js';
import { InvitationService } from '../services/invitationService.js';
import { TeamService } from '../services/teamService.js';
import { PermissionService } from '../services/permissionService.js';
import { getUserActiveTeamByDiscordId, getActiveTeamMembers } from '../database/queries/memberQueries.js';
import { getTeamById } from '../database/queries/teamQueries.js';
import { getAllInviteRoles } from '../database/queries/inviteQueries.js';
import { buildTeamPanelDashboard } from '../commands/admin/teamPanel.js';
import { validateTeamName } from '../utils/validators.js';
import { errorEmbed, successEmbed, infoEmbed, warningEmbed, teamInfoEmbed } from '../utils/embeds.js';
import { DashboardService } from '../services/dashboardService.js';
import { InviteService } from '../services/inviteService.js';
import { replyAutoDismiss } from '../utils/interactionUtils.js';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';


// ============================================================
// REGISTRATION SESSION STORE
// In-memory, keyed by `member_${userId}` or `staff_${userId}`
// Value: { teamName, memberIds, channelId, messageId, expiresAt }
// TTL: 10 minutes
// ============================================================
const registrationSessions = new Map();

function setSession(key, data) {
  registrationSessions.set(key, {
    ...data,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
}

function getSession(key) {
  const session = registrationSessions.get(key);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    registrationSessions.delete(key);
    return null;
  }
  return session;
}

function deleteSession(key) {
  registrationSessions.delete(key);
}

/**
 * Build the single registration embed for member flow.
 */
function buildMemberRegEmbed({ userId, teamName, memberIds = [], step }) {
  const memberList = memberIds.length > 0
    ? memberIds.map((id) => `<@${id}>`).join(', ')
    : '*(Belum dipilih)*';

  let statusText, color;
  switch (step) {
    case 'select_members':
      statusText = '⏳ Pilih anggota tim dari dropdown di bawah.';
      color = EMBED_COLORS.INFO;
      break;
    case 'confirm':
      statusText = '✅ Semua data siap! Tekan **Konfirmasi** untuk mendaftar, atau **Pilih Ulang** untuk mengubah anggota.';
      color = EMBED_COLORS.SUCCESS;
      break;
    case 'processing':
      statusText = '⏳ Sedang memproses pendaftaran tim...';
      color = EMBED_COLORS.WARNING;
      break;
    case 'cancelled':
      statusText = '❌ Pendaftaran dibatalkan.';
      color = EMBED_COLORS.DANGER;
      break;
    default:
      statusText = '⏳ Memulai pendaftaran...';
      color = EMBED_COLORS.INFO;
  }

  return new EmbedBuilder()
    .setTitle('📝 Pendaftaran Tim Baru')
    .setColor(color)
    .addFields(
      { name: '👑 Team Leader', value: `<@${userId}>`, inline: true },
      { name: '📛 Nama Tim', value: `**${teamName}**`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '👥 Anggota', value: memberList, inline: false },
      { name: '📊 Status', value: statusText, inline: false }
    )
    .setFooter({ text: 'NSAC Hackathon • Pendaftaran Tim' })
    .setTimestamp();
}

/**
 * Build the single registration embed for staff flow.
 * First member selected = leader.
 */
function buildStaffRegEmbed({ teamName, memberIds = [], step }) {
  let leaderDisplay, otherMembers;
  if (memberIds.length > 0) {
    leaderDisplay = `<@${memberIds[0]}> *(Leader — anggota pertama)*`;
    otherMembers = memberIds.length > 1
      ? memberIds.slice(1).map((id) => `<@${id}>`).join(', ')
      : '*(Tidak ada)*';
  } else {
    leaderDisplay = '*(Orang pertama yang dipilih = Leader)*';
    otherMembers = '*(Belum dipilih)*';
  }

  let statusText, color;
  switch (step) {
    case 'select_members':
      statusText = '⏳ Pilih 1–4 anggota. **Anggota pertama otomatis menjadi Leader.**';
      color = EMBED_COLORS.INFO;
      break;
    case 'confirm':
      statusText = '✅ Semua data siap! Tim akan langsung aktif tanpa undangan. Tekan **Konfirmasi** untuk membuat.';
      color = EMBED_COLORS.SUCCESS;
      break;
    case 'processing':
      statusText = '⏳ Sedang membuat tim dan menyiapkan channel...';
      color = EMBED_COLORS.WARNING;
      break;
    case 'cancelled':
      statusText = '❌ Pembuatan tim dibatalkan.';
      color = EMBED_COLORS.DANGER;
      break;
    default:
      statusText = '⏳ Memulai...';
      color = EMBED_COLORS.INFO;
  }

  return new EmbedBuilder()
    .setTitle('➕ Buat Tim Baru (Staff)')
    .setColor(color)
    .addFields(
      { name: '📛 Nama Tim', value: `**${teamName}**`, inline: true },
      { name: '🏅 Mode', value: 'Staff Override (No Invite)', inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '👑 Leader', value: leaderDisplay, inline: false },
      { name: '👥 Anggota Lain', value: otherMembers, inline: false },
      { name: '📊 Status', value: statusText, inline: false }
    )
    .setFooter({ text: 'NSAC Hackathon • Staff Team Creation' })
    .setTimestamp();
}

/**
 * Build member select dropdown for a given eligible members list and team name.
 */
function buildMemberSelectRow({ eligibleMembers, encodedName, min, max, isStaff = false }) {
  const selectOptions = eligibleMembers.slice(0, 25).map((m) => {
    const displayName = (m.displayName || m.user.username).substring(0, 100);
    const tag = `@${m.user.username}`.substring(0, 100);
    return new StringSelectMenuOptionBuilder()
      .setLabel(displayName)
      .setDescription(tag)
      .setValue(m.id)
      .setEmoji('👤');
  });

  const actualMax = Math.min(max, selectOptions.length);
  const actualMin = Math.min(min, actualMax);

  const customId = isStaff
    ? `select_staff_reg_members_${encodedName}`
    : `select_unreg_members_${encodedName}`;

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(isStaff
      ? 'Pilih anggota (orang pertama = Leader)'
      : 'Pilih anggota tim dari daftar di bawah')
    .setMinValues(actualMin === 0 ? 0 : 1)
    .setMaxValues(actualMax)
    .addOptions(selectOptions);

  return new ActionRowBuilder().addComponents(select);
}



export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // ========================================================
    // 1. SLASH COMMANDS ROUTER
    // ========================================================
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        logger.warn(`[Interaction] No handler registered for command: /${interaction.commandName}`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error(`[Command Error /${interaction.commandName}] ${error.stack || error.message}`);

        let errorResponse;
        if (error instanceof ConfigMissingError) {
          errorResponse = {
            embeds: [
              warningEmbed(
                'Konfigurasi Belum Diatur',
                `⚠️ Fitur ini membutuhkan konfigurasi **${error.friendlyName}** (\`${error.configKey}\`), namun belum di-set.\n\n` +
                `Gunakan command \`/setup-config set key:${error.configKey}\` untuk mengaturnya.`
              )
            ],
            flags: MessageFlags.Ephemeral
          };
        } else {
          errorResponse = {
            embeds: [errorEmbed('Command Error', `An error occurred: ${error.message}`)],
            flags: MessageFlags.Ephemeral
          };
        }

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorResponse).catch(() => {});
        } else {
          await interaction.reply(errorResponse).catch(() => {});
        }
      }
      return;
    }

    // ========================================================
    // 2. BUTTON INTERACTIONS ROUTER
    // ========================================================
    if (interaction.isButton()) {
      const { customId } = interaction;

      // A. Create Registration Ticket Button
      if (customId === CUSTOM_IDS.BTN_CREATE_REG_TICKET) {
        return await TicketService.createTeamRegistrationTicket(interaction);
      }

      // B. Create Support Ticket Button
      if (customId === CUSTOM_IDS.BTN_CREATE_SUPPORT_TICKET) {
        return await TicketService.createSupportTicket(interaction);
      }

      // C. Close Ticket Button
      if (customId === CUSTOM_IDS.BTN_CLOSE_TICKET) {
        return await TicketService.handleCloseTicket(interaction);
      }

      // D. Open Team Registration Modal
      if (customId === CUSTOM_IDS.BTN_OPEN_REG_MODAL) {
        const regOpen = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
        if (!regOpen) {
          return await interaction.reply({
            embeds: [errorEmbed('Pendaftaran Ditutup', '❌ Pendaftaran tim saat ini sedang ditutup oleh panitia.')],
            flags: MessageFlags.Ephemeral
          });
        }

        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (activeTeam) {
          return await interaction.reply({
            embeds: [errorEmbed('Sudah Terdaftar', `❌ Anda sudah terdaftar atau memiliki registrasi aktif di tim **${activeTeam.name}**!`)],
            flags: MessageFlags.Ephemeral
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(CUSTOM_IDS.MODAL_REGISTER_TEAM)
          .setTitle('Team Registration');

        const teamNameInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_TEAM_NAME)
          .setLabel('Team Name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., Code Wizards, Team Alpha')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(32);

        const firstActionRow = new ActionRowBuilder().addComponents(teamNameInput);
        modal.addComponents(firstActionRow);

        return await interaction.showModal(modal);
      }

      // E. Invitation Accept Button
      if (customId.startsWith(CUSTOM_IDS.BTN_INVITE_ACCEPT)) {
        const inviteId = parseInt(customId.replace(CUSTOM_IDS.BTN_INVITE_ACCEPT, ''), 10);
        return await InvitationService.handleAccept(interaction, inviteId, TeamService);
      }

      // F. Invitation Decline Button
      if (customId.startsWith(CUSTOM_IDS.BTN_INVITE_DECLINE)) {
        const inviteId = parseInt(customId.replace(CUSTOM_IDS.BTN_INVITE_DECLINE, ''), 10);
        return await InvitationService.handleDecline(interaction, inviteId);
      }

      // G. Team Delete Confirmation
      if (customId.startsWith(CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM)) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Unauthorized', 'Only staff can confirm team deletion.')], flags: MessageFlags.Ephemeral });
        }
        const teamId = parseInt(customId.replace(CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM, ''), 10);
        
        await interaction.update({
          embeds: [infoEmbed('Menghapus Tim...', '⏳ Sedang menghapus seluruh channel, role, dan mengembalikan role @Unregistered...')],
          components: []
        });

        await TeamService.deleteTeam(teamId, interaction.guild, interaction.client, interaction.user.tag);
        
        return await interaction.editReply({
          embeds: [successEmbed('Tim Berhasil Dihapus', `✅ Tim dan seluruh channel/role telah berhasil dihapus. Seluruh mantan anggota telah dikembalikan ke role **@Unregistered** (dan role **@Participant** telah dicabut).`)],
          components: []
        });
      }

      // H. Team Delete Cancel
      if (customId.startsWith(CUSTOM_IDS.BTN_DELETE_TEAM_CANCEL)) {
        return await interaction.update({
          embeds: [infoEmbed('Dibatalkan', 'Penghapusan tim telah dibatalkan.')],
          components: []
        });
      }

      // I. Team Panel: Refresh Dashboard
      if (customId === 'team_panel_refresh') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'You do not have permission.')], flags: MessageFlags.Ephemeral });
        }
        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        return await interaction.update({ embeds: [embed], components });
      }

      // J. Team Panel: Export Summary
      if (customId === 'team_panel_export_summary') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'You do not have permission.')], flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { rows: allTeams } = await pool.query(`
          SELECT t.id, t.name, t.status, u.username as leader_name, u.discord_id as leader_discord_id,
                 ARRAY_TO_STRING(ARRAY_AGG(mu.username || ' (<@' || mu.discord_id || '>)'), ', ') as member_list
          FROM teams t
          LEFT JOIN users u ON t.leader_id = u.id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'ACTIVE'
          LEFT JOIN users mu ON tm.user_id = mu.id
          GROUP BY t.id, t.name, t.status, u.username, u.discord_id
          ORDER BY t.status, t.name
        `);

        if (allTeams.length === 0) {
          return await interaction.editReply({ embeds: [infoEmbed('Data Tim Kosong', 'Belum ada tim yang terdaftar.')] });
        }

        const lines = allTeams.map((t, idx) => {
          return `**${idx + 1}. ${t.name}** [Status: \`${t.status}\`]
` +
                 `   • Leader: <@${t.leader_discord_id}> (${t.leader_name})
` +
                 `   • Anggota: ${t.member_list || 'Belum ada anggota'}`;
        });

        const chunks = [];
        let currentChunk = '';
        for (const line of lines) {
          if ((currentChunk + '\n\n' + line).length > 3900) {
            chunks.push(currentChunk);
            currentChunk = line;
          } else {
            currentChunk = currentChunk ? currentChunk + '\n\n' + line : line;
          }
        }
        if (currentChunk) chunks.push(currentChunk);

        return await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📋 Ringkasan Lengkap Seluruh Tim Hackathon')
              .setDescription(chunks[0])
              .setColor(EMBED_COLORS.PRIMARY)
              .setFooter({ text: `Total Tim: ${allTeams.length}` })
              .setTimestamp()
          ]
        });
      }

      // K. Team Panel: Quick Action (Approve / Archive / Delete from panel)
      if (customId.startsWith('team_panel_action_approve_')) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const teamId = parseInt(customId.replace('team_panel_action_approve_', ''), 10);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await TeamService.finalizeTeamCreation(teamId, interaction.guild, interaction.client);
          return await interaction.editReply({ embeds: [successEmbed('Approved ✅', `Tim #${teamId} berhasil di-approve dan channels telah dibuat!`)] });
        } catch (err) {
          return await interaction.editReply({ embeds: [errorEmbed('Approval Failed', err.message)] });
        }
      }

      if (customId.startsWith('team_panel_action_archive_')) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const teamId = parseInt(customId.replace('team_panel_action_archive_', ''), 10);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await TeamService.archiveTeam(teamId, interaction.guild, interaction.client, interaction.user.tag);
          return await interaction.editReply({ embeds: [successEmbed('Archived 📦', `Tim #${teamId} telah diarsipkan.`)] });
        } catch (err) {
          return await interaction.editReply({ embeds: [errorEmbed('Archive Failed', err.message)] });
        }
      }

      // L. Team Panel: Staff Add Team — show modal for team name (new single-embed flow)
      if (customId === CUSTOM_IDS.BTN_STAFF_ADD_TEAM) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
          .setCustomId(CUSTOM_IDS.MODAL_STAFF_ADD_TEAM)
          .setTitle('➕ Buat Tim Baru (Staff)');

        const teamNameInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_STAFF_TEAM_NAME)
          .setLabel('Nama Tim')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Contoh: Tim Jember Alpha')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(32);

        modal.addComponents(new ActionRowBuilder().addComponents(teamNameInput));
        return await interaction.showModal(modal);
      }

      // === MEMBER Registration Flow Buttons ===

      // M. Confirm Registration (member)
      if (customId === CUSTOM_IDS.BTN_REG_CONFIRM) {
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({
            embeds: [errorEmbed('Sesi Kadaluarsa', '⏰ Sesi pendaftaran telah habis. Silakan mulai ulang dari awal.')],
            components: []
          });
        }

        await interaction.update({
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName: session.teamName, memberIds: session.memberIds, step: 'processing' })],
          components: []
        });

        try {
          const result = await TeamService.startRegistration({
            teamName: session.teamName,
            leaderMember: interaction.member,
            memberIds: session.memberIds,
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel
          });

          deleteSession(sessionKey);

          if (!result.success) {
            return await interaction.editReply({
              embeds: [errorEmbed('Pendaftaran Gagal', result.error)],
              components: []
            });
          }

          if (result.pendingInvitations) {
            const unixExpiry = Math.floor(new Date(result.expiresAt).getTime() / 1000);
            const memberMentions = session.memberIds.map((id) => `<@${id}>`).join(', ');
            return await interaction.editReply({
              embeds: [successEmbed(
                '📨 Undangan Tim Terkirim!',
                `Tim **${session.teamName}** berhasil didaftarkan!\n\n` +
                `📨 **Undangan dikirim ke:** ${memberMentions}\n` +
                `⏱️ **Batas Waktu:** <t:${unixExpiry}:R>\n\n` +
                `Setelah semua rekan menekan **Accept**, role dan channel tim akan otomatis dibuat.`
              )],
              components: []
            });
          } else {
            await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);
            return await interaction.editReply({
              embeds: [successEmbed('🎉 Tim Berhasil Dibuat!', `Tim **${session.teamName}** telah dibuat dan channel telah siap!`)],
              components: []
            });
          }
        } catch (err) {
          logger.error(`[Reg Confirm Error] ${err.message}`);
          return await interaction.editReply({
            embeds: [errorEmbed('Error', `Gagal memproses pendaftaran: ${err.message}`)],
            components: []
          });
        }
      }

      // N. Cancel Registration (member)
      if (customId === CUSTOM_IDS.BTN_REG_CANCEL) {
        deleteSession(`member_${interaction.user.id}`);
        return await interaction.update({
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName: '—', memberIds: [], step: 'cancelled' })],
          components: []
        });
      }

      // O. Reselect Members (member) — go back to dropdown state
      if (customId === CUSTOM_IDS.BTN_REG_RESELECT) {
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Silakan mulai ulang dari awal.')], components: [] });
        }

        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot || m.id === interaction.user.id) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const encodedName = encodeURIComponent(session.teamName);
        const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: minSelect, max: maxSelect });

        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return await interaction.update({
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName: session.teamName, memberIds: [], step: 'select_members' })],
          components: [selectRow, cancelRow]
        });
      }

      // P. Change Team Name (member) — show modal, store message ref in session
      if (customId === CUSTOM_IDS.BTN_REG_CHANGE_NAME) {
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey) || {};
        session.messageId = interaction.message.id;
        session.channelId = interaction.channelId;
        setSession(sessionKey, session);

        const modal = new ModalBuilder().setCustomId(CUSTOM_IDS.MODAL_REG_CHANGE_NAME).setTitle('✏️ Ubah Nama Tim');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CUSTOM_IDS.INPUT_REG_NEW_NAME)
            .setLabel('Nama Tim Baru')
            .setStyle(TextInputStyle.Short)
            .setValue(session.teamName || '')
            .setMinLength(3).setMaxLength(32).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      // === STAFF Registration Flow Buttons ===

      // Q. Confirm Staff Registration
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_CONFIRM) {
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Silakan mulai ulang.')], components: [] });
        }

        await interaction.update({
          embeds: [buildStaffRegEmbed({ teamName: session.teamName, memberIds: session.memberIds, step: 'processing' })],
          components: []
        });

        try {
          const leaderId = session.memberIds[0];
          const leaderMember = await interaction.guild.members.fetch(leaderId).catch(() => null);
          if (!leaderMember) {
            return await interaction.editReply({ embeds: [errorEmbed('Leader Tidak Ditemukan', `<@${leaderId}> tidak ditemukan di server.`)], components: [] });
          }

          const result = await TeamService.startRegistration({
            teamName: session.teamName,
            leaderMember,
            memberIds: session.memberIds.slice(1),
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: null,
            skipInvitations: true
          });

          deleteSession(sessionKey);

          if (!result.success) {
            return await interaction.editReply({ embeds: [errorEmbed('Gagal Membuat Tim', result.error)], components: [] });
          }

          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

          const memberMentions = session.memberIds.length > 0
            ? session.memberIds.map((id) => `<@${id}>`).join(', ')
            : '*(tidak ada)*';

          return await interaction.editReply({
            embeds: [successEmbed(
              '✅ Tim Berhasil Dibuat!',
              `Tim **${session.teamName}** berhasil dibuat dan channel telah disiapkan!\n\n` +
              `👑 **Leader:** <@${leaderId}>\n` +
              `👥 **Seluruh Anggota:** ${memberMentions}`
            )],
            components: []
          });
        } catch (err) {
          logger.error(`[Staff Reg Confirm] ${err.message}`);
          return await interaction.editReply({ embeds: [errorEmbed('Error', err.message)], components: [] });
        }
      }

      // R. Cancel Staff Registration
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_CANCEL) {
        deleteSession(`staff_${interaction.user.id}`);
        return await interaction.update({
          embeds: [buildStaffRegEmbed({ teamName: '—', memberIds: [], step: 'cancelled' })],
          components: []
        });
      }

      // S. Reselect Members (staff) — go back to dropdown
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_RESELECT) {
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Silakan mulai ulang.')], components: [] });
        }

        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const encodedName = encodeURIComponent(session.teamName);
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });

        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return await interaction.update({
          embeds: [buildStaffRegEmbed({ teamName: session.teamName, memberIds: [], step: 'select_members' })],
          components: [selectRow, cancelRow]
        });
      }

      // T. Change Team Name (staff)
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME) {
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey) || {};
        session.messageId = interaction.message.id;
        session.channelId = interaction.channelId;
        setSession(sessionKey, session);

        const modal = new ModalBuilder().setCustomId(CUSTOM_IDS.MODAL_STAFF_REG_CHANGE_NAME).setTitle('✏️ Ubah Nama Tim (Staff)');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CUSTOM_IDS.INPUT_STAFF_REG_NEW_NAME)
            .setLabel('Nama Tim Baru')
            .setStyle(TextInputStyle.Short)
            .setValue(session.teamName || '')
            .setMinLength(3).setMaxLength(32).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      // M. Admin Dashboard Buttons
      if (customId === 'dashboard_toggle_reg') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat mengubah status pendaftaran.')],
            flags: MessageFlags.Ephemeral
          });
        }

        const current = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
        const nextState = current ? 'false' : 'true';
        await GuildConfigService.set('REGISTRATION_OPEN', nextState);

        const payload = await DashboardService.buildOverviewPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await DashboardService.refreshOverviewPanel(interaction.guild);
        }
        return;
      }

      if (customId === 'dashboard_refresh_all' || customId === 'dashboard_refresh') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat merefresh dashboard.')],
            flags: MessageFlags.Ephemeral
          });
        }

        await DashboardService.refreshAllPanels(interaction.guild);
        const payload = await DashboardService.buildOverviewPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await interaction.reply({ content: '✅ Seluruh panel berhasil diperbarui.', flags: MessageFlags.Ephemeral });
        }
        return;
      }

      if (customId === 'dashboard_invite_refresh') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const payload = await DashboardService.buildInvitesPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await DashboardService.refreshInvitesPanel(interaction.guild);
        }
        return;
      }

      if (customId === 'dashboard_invite_create') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat membuat link invite.')], flags: MessageFlags.Ephemeral });
        }

        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('dashboard_invite_select_role')
          .setPlaceholder('Pilih role (bisa pilih lebih dari 1, misal: Participant + No-Team)...')
          .setMinValues(1)
          .setMaxValues(10);

        return await interaction.reply({
          embeds: [
            infoEmbed(
              'Buat Dynamic Auto-Role Invite Link 🎟️',
              'Silakan pilih **satu atau beberapa role** dari menu di bawah (misal: **Participant + No-Team**).\n' +
              'Bot akan membuat link invite Discord permanen baru, dan setiap member yang bergabung dengan link ini akan **otomatis diberikan seluruh role tersebut**.'
            )
          ],
          components: [new ActionRowBuilder().addComponents(roleSelect)],
          flags: MessageFlags.Ephemeral
        });
      }


      if (customId === 'dashboard_invite_delete') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }

        const dynamicInvites = await getAllInviteRoles();
        if (dynamicInvites.length === 0) {
          return await interaction.reply({
            embeds: [infoEmbed('Tidak Ada Link Invite', 'Belum ada link invite dinamis yang terdaftar untuk dihapus.')],
            flags: MessageFlags.Ephemeral
          });
        }

        const options = dynamicInvites.slice(0, 25).map((inv) => {
          const roleObj = interaction.guild.roles.cache.get(inv.role_id);
          const roleName = inv.label || (roleObj ? roleObj.name : inv.role_id);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${roleName} (${inv.invite_code})`.substring(0, 100))
            .setDescription(`Role: @${roleName} • Code: ${inv.invite_code}`.substring(0, 100))
            .setValue(inv.invite_code)
            .setEmoji('🗑️');
        });

        const deleteSelect = new StringSelectMenuBuilder()
          .setCustomId('dashboard_invite_select_delete')
          .setPlaceholder('Pilih link invite yang ingin dihapus...')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);

        return await interaction.reply({
          embeds: [
            warningEmbed(
              'Hapus Dynamic Invite Link 🗑️',
              'Pilih link invite dari dropdown di bawah untuk dihapus dari sistem bot dan server Discord.'
            )
          ],
          components: [new ActionRowBuilder().addComponents(deleteSelect)],
          flags: MessageFlags.Ephemeral
        });
      }

      // Legacy create participant invite
      if (customId === 'dashboard_gen_invite') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat membuat link invite.')],
            flags: MessageFlags.Ephemeral
          });
        }

        try {
          const invite = await InviteService.createParticipantInvite(interaction.guild);
          await DashboardService.refreshInvitesPanel(interaction.guild);

          return await interaction.reply({
            embeds: [successEmbed(
              'Link Invite Peserta Dibuat 🎟️',
              `Link invite khusus peserta berhasil dibuat:\n**${invite.url}**\n\n` +
              `• Kode: \`${invite.code}\`\n` +
              `• *Member baru yang join via link ini otomatis mendapat @Participant + @No-Team.*`
            )],
            flags: MessageFlags.Ephemeral
          });
        } catch (err) {
          return await interaction.reply({
            embeds: [errorEmbed('Gagal Membuat Invite', err.message)],
            flags: MessageFlags.Ephemeral
          });
        }
      }

      // Dashboard: Open Team Panel (ephemeral)
      if (customId === 'dashboard_open_team_panel') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        return await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
      }

      return;
    }



    // ========================================================
    // 3. MODAL SUBMISSION ROUTER
    // ========================================================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === CUSTOM_IDS.MODAL_REGISTER_TEAM) {
        const teamName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_TEAM_NAME).trim();

        const nameValidation = validateTeamName(teamName);
        if (!nameValidation.valid) {
          return await interaction.reply({
            embeds: [errorEmbed('Nama Tim Tidak Valid', nameValidation.error)],
            flags: MessageFlags.Ephemeral
          });
        }

        // Disable the "Open Modal" button on the ticket welcome message
        try {
          if (interaction.channel && interaction.channel.isTextBased()) {
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const ticketMsg = messages.find((m) => m.author.id === interaction.client.user.id && m.components.length > 0);
            if (ticketMsg) {
              const updatedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(CUSTOM_IDS.BTN_CLOSE_TICKET)
                  .setLabel('Close Ticket')
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji('🔒')
              );
              await ticketMsg.edit({ components: [updatedRow] }).catch(() => {});
            }
          }
        } catch (err) {
          logger.warn(`[Modal] Could not disable register button: ${err.message}`);
        }

        // Build eligible members list (role-filtered)
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');

        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot || m.id === interaction.user.id) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const minMembersToSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const maxMembersToSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const encodedName = encodeURIComponent(teamName);

        // If no eligible members and members required, solo team path
        if (eligibleMembers.length === 0 && minMembersToSelect > 0) {
          return await interaction.reply({
            embeds: [errorEmbed(
              'Tidak Ada Anggota Tersedia',
              `❌ Tidak ditemukan anggota yang memenuhi syarat di server untuk diundang ke tim **${teamName}**.\n\n` +
              (filterRoleId
                ? `Pastikan rekan tim Anda sudah bergabung ke server ini dan memiliki role <@&${filterRoleId}>.`
                : 'Pastikan rekan tim Anda sudah bergabung ke server Discord ini.')
            )],
            flags: MessageFlags.Ephemeral
          });
        }

        // Solo team (no members required): register directly
        if (eligibleMembers.length === 0 && minMembersToSelect === 0) {
          const result = await TeamService.startRegistration({
            teamName,
            leaderMember: interaction.member,
            memberIds: [],
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel
          });
          if (!result.success) {
            return await interaction.reply({ embeds: [errorEmbed('Gagal Registrasi', result.error)], flags: MessageFlags.Ephemeral });
          }
          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);
          return await interaction.reply({
            embeds: [successEmbed('🎉 Tim Berhasil Dibuat!', `Tim **${teamName}** telah dibuat dan channels telah siap!`)]
          });
        }

        // Show the single registration embed with member dropdown
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: minMembersToSelect, max: maxMembersToSelect });
        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        const reply = await interaction.reply({
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName, memberIds: [], step: 'select_members' })],
          components: [selectRow, buttonRow],
          fetchReply: true
        });

        // Store session
        setSession(`member_${interaction.user.id}`, {
          teamName,
          memberIds: [],
          channelId: interaction.channelId,
          messageId: reply.id
        });

        return;
      }


      // Staff Add Team Modal submit — new single-embed flow
      if (interaction.customId === CUSTOM_IDS.MODAL_STAFF_ADD_TEAM) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }

        const teamName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_STAFF_TEAM_NAME).trim();

        const nameValidation = validateTeamName(teamName);
        if (!nameValidation.valid) {
          return await interaction.reply({ embeds: [errorEmbed('Nama Tim Tidak Valid', nameValidation.error)], flags: MessageFlags.Ephemeral });
        }

        // Build eligible members list (role-filtered, staff themselves NOT excluded)
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');

        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        if (eligibleMembers.length === 0) {
          return await interaction.reply({
            embeds: [errorEmbed(
              'Tidak Ada Anggota Tersedia',
              `Tidak ditemukan anggota yang memenuhi syarat.\n` +
              (filterRoleId ? `Pastikan ada user dengan role <@&${filterRoleId}> di server.` : '')
            )],
            flags: MessageFlags.Ephemeral
          });
        }

        const encodedName = encodeURIComponent(teamName);
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        const reply = await interaction.reply({
          embeds: [buildStaffRegEmbed({ teamName, memberIds: [], step: 'select_members' })],
          components: [selectRow, buttonRow],
          flags: MessageFlags.Ephemeral,
          fetchReply: true
        });

        // Store session
        setSession(`staff_${interaction.user.id}`, {
          teamName,
          memberIds: [],
          channelId: interaction.channelId,
          messageId: reply.id
        });

        return;
      }

      // Change Team Name modal submit (member)
      if (interaction.customId === CUSTOM_IDS.MODAL_REG_CHANGE_NAME) {
        const newName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_REG_NEW_NAME).trim();
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey);

        const nameValidation = validateTeamName(newName);
        if (!nameValidation.valid) {
          return await interaction.reply({ embeds: [errorEmbed('Nama Tidak Valid', nameValidation.error)], flags: MessageFlags.Ephemeral });
        }

        if (session) {
          session.teamName = newName;
          session.memberIds = []; // Reset member selection when name changes
          setSession(sessionKey, session);

          // Rebuild dropdown with new name and update original message
          await interaction.guild.members.fetch().catch(() => {});
          const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
          const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
            if (m.user.bot || m.id === interaction.user.id) return false;
            if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
            return true;
          });

          const encodedName = encodeURIComponent(newName);
          const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
          const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
          const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: minSelect, max: maxSelect });
          const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          try {
            const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
            if (channel) {
              const msg = await channel.messages.fetch(session.messageId).catch(() => null);
              if (msg) {
                await msg.edit({
                  embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName: newName, memberIds: [], step: 'select_members' })],
                  components: [selectRow, buttonRow]
                });
              }
            }
          } catch (err) {
            logger.warn(`[Reg Change Name] Could not edit original message: ${err.message}`);
          }
        }

        return await interaction.reply({ content: `✅ Nama tim diperbarui menjadi **${newName}**.`, flags: MessageFlags.Ephemeral });
      }

      // Change Team Name modal submit (staff)
      if (interaction.customId === CUSTOM_IDS.MODAL_STAFF_REG_CHANGE_NAME) {
        const newName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_STAFF_REG_NEW_NAME).trim();
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);

        const nameValidation = validateTeamName(newName);
        if (!nameValidation.valid) {
          return await interaction.reply({ embeds: [errorEmbed('Nama Tidak Valid', nameValidation.error)], flags: MessageFlags.Ephemeral });
        }

        if (session) {
          session.teamName = newName;
          session.memberIds = [];
          setSession(sessionKey, session);

          await interaction.guild.members.fetch().catch(() => {});
          const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
          const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
            if (m.user.bot) return false;
            if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
            return true;
          });

          const encodedName = encodeURIComponent(newName);
          const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
          const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          try {
            const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
            if (channel) {
              const msg = await channel.messages.fetch(session.messageId).catch(() => null);
              if (msg) {
                await msg.edit({
                  embeds: [buildStaffRegEmbed({ teamName: newName, memberIds: [], step: 'select_members' })],
                  components: [selectRow, buttonRow]
                });
              }
            }
          } catch (err) {
            logger.warn(`[Staff Reg Change Name] Could not edit original message: ${err.message}`);
          }
        }

        return await interaction.reply({ content: `✅ Nama tim diperbarui menjadi **${newName}**.`, flags: MessageFlags.Ephemeral });
      }

      return;
    }



    // ========================================================
    // 4. SELECT MENU ROUTER
    // ========================================================
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu()) {
      // 0. Dashboard: Select Team Member Filter Role
      if (interaction.customId === 'dashboard_select_member_role') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat mengubah filter role tim.')],
            flags: MessageFlags.Ephemeral
          });
        }

        const selectedRoleId = interaction.values[0];
        await GuildConfigService.set('TEAM_MEMBER_SELECT_ROLE_ID', selectedRoleId);

        const payload = await DashboardService.buildRolesPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await DashboardService.refreshRolesPanel(interaction.guild);
        }
        return;
      }

      // Dashboard: Set Participant Role
      if (interaction.customId === 'dashboard_roleselect_participant') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const selectedRoleId = interaction.values[0];
        await GuildConfigService.set('PARTICIPANT_ROLE_ID', selectedRoleId);
        const payload = await DashboardService.buildRolesPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await DashboardService.refreshRolesPanel(interaction.guild);
        }
        return;
      }

      // Dashboard: Set No-Team Role
      if (interaction.customId === 'dashboard_roleselect_noteam') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }
        const selectedRoleId = interaction.values[0];
        await GuildConfigService.set('NO_TEAM_ROLE_ID', selectedRoleId);
        const payload = await DashboardService.buildRolesPayload(interaction.guild);
        try {
          await interaction.update(payload);
        } catch {
          await DashboardService.refreshRolesPanel(interaction.guild);
        }
        return;
      }

      // Dashboard: Dynamic Invite Role Selection (Create)
      if (interaction.customId === 'dashboard_invite_select_role') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }

        const selectedRoleIds = interaction.values;
        await interaction.deferUpdate();

        try {
          const { invite, label } = await InviteService.createDynamicInvite(
            interaction.guild,
            selectedRoleIds,
            null,
            interaction.user.tag
          );

          await DashboardService.refreshInvitesPanel(interaction.guild);

          const roleMentions = selectedRoleIds.map((id) => `<@&${id}>`).join(' + ');

          return await interaction.editReply({
            embeds: [
              successEmbed(
                'Dynamic Invite Link Berhasil Dibuat 🎟️',
                `Link invite khusus untuk role **[${label}]** (${roleMentions}) berhasil dibuat:\n\n` +
                `🔗 **${invite.url}**\n` +
                `• Kode: \`${invite.code}\`\n` +
                `• Auto-Role: ${roleMentions}\n\n` +
                `*Setiap anggota yang bergabung menggunakan link ini akan langsung mendapatkan seluruh role tersebut!*`
              )
            ],
            components: []
          });
        } catch (err) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Membuat Link Invite', err.message)],
            components: []
          });
        }
      }


      // Dashboard: Dynamic Invite Delete Selection
      if (interaction.customId === 'dashboard_invite_select_delete') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await interaction.reply({ embeds: [errorEmbed('Staff Only', 'Unauthorized')], flags: MessageFlags.Ephemeral });
        }

        const selectedCode = interaction.values[0];
        await interaction.deferUpdate();

        try {
          await InviteService.deleteDynamicInvite(interaction.guild, selectedCode);
          await DashboardService.refreshInvitesPanel(interaction.guild);

          return await interaction.editReply({
            embeds: [
              successEmbed(
                'Link Invite Berhasil Dihapus 🗑️',
                `Link invite dengan kode \`${selectedCode}\` telah dihapus dari sistem bot dan server Discord.`
              )
            ],
            components: []
          });
        } catch (err) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Menghapus Link Invite', err.message)],
            components: []
          });
        }
      }


      // A. Team Panel: Select Team Details
      if (interaction.customId === 'team_panel_select_team') {
        const teamId = parseInt(interaction.values[0], 10);
        const team = await getTeamById(teamId);

        if (!team) {
          return await interaction.reply({ embeds: [errorEmbed('Not Found', 'Tim tidak ditemukan.')], flags: MessageFlags.Ephemeral });
        }

        const members = await getActiveTeamMembers(team.id);
        const embed = teamInfoEmbed(team, members);

        const actionButtons = new ActionRowBuilder();

        if (team.status === 'PENDING') {
          actionButtons.addComponents(
            new ButtonBuilder()
              .setCustomId(`team_panel_action_approve_${team.id}`)
              .setLabel('Force Approve Tim')
              .setStyle(ButtonStyle.Success)
              .setEmoji('🟢')
          );
        }

        if (team.status === 'ACTIVE') {
          actionButtons.addComponents(
            new ButtonBuilder()
              .setCustomId(`team_panel_action_archive_${team.id}`)
              .setLabel('Arsipkan Tim')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('📦')
          );
        }

        actionButtons.addComponents(
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM}${team.id}`)
            .setLabel('Hapus Tim')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
        );

        return await interaction.reply({
          embeds: [embed],
          components: [actionButtons],
          flags: MessageFlags.Ephemeral
        });
      }

      // B. Member: Select Anggota Tim → show CONFIRMATION step (not register directly)
      if (
        interaction.customId.startsWith('select_unreg_members_') ||
        interaction.customId.startsWith('select_team_members_')
      ) {
        const rawName = interaction.customId
          .replace('select_unreg_members_', '')
          .replace('select_team_members_', '');
        const teamName = decodeURIComponent(rawName);
        const selectedMemberIds = interaction.values;
        const sessionKey = `member_${interaction.user.id}`;

        // Update session with selected members
        const session = getSession(sessionKey) || { teamName, channelId: interaction.channelId };
        session.memberIds = selectedMemberIds;
        session.messageId = interaction.message.id;
        setSession(sessionKey, session);

        // Rebuild the dropdown for the "reselect" row (same dropdown, keeps previous selection visible)
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot || m.id === interaction.user.id) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const encodedName = encodeURIComponent(teamName);
        const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: minSelect, max: maxSelect });

        // Confirmation buttons row
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary).setEmoji('↩️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return await interaction.update({
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName, memberIds: selectedMemberIds, step: 'confirm' })],
          components: [selectRow, confirmRow]
        });
      }

      // C. Staff: Select Anggota Tim → show CONFIRMATION step
      if (interaction.customId.startsWith('select_staff_reg_members_')) {
        const rawName = interaction.customId.replace('select_staff_reg_members_', '');
        const teamName = decodeURIComponent(rawName);
        const selectedMemberIds = interaction.values;
        const sessionKey = `staff_${interaction.user.id}`;

        // Update session
        const session = getSession(sessionKey) || { teamName, channelId: interaction.channelId };
        session.memberIds = selectedMemberIds;
        session.messageId = interaction.message.id;
        setSession(sessionKey, session);

        // Rebuild dropdown for reselect
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const encodedName = encodeURIComponent(teamName);
        const selectRow = buildMemberSelectRow({ eligibleMembers, encodedName, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary).setEmoji('↩️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return await interaction.update({
          embeds: [buildStaffRegEmbed({ teamName, memberIds: selectedMemberIds, step: 'confirm' })],
          components: [selectRow, confirmRow]
        });
      }

    }
  }
};

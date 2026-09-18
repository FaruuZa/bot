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
import { CUSTOM_IDS, EMBED_COLORS, AUDIT_ACTIONS } from '../config/constants.js';
import { env } from '../config/env.js';
import { GuildConfigService, ConfigMissingError } from '../services/guildConfigService.js';
import { TicketService } from '../services/ticketService.js';
import { InvitationService } from '../services/invitationService.js';
import { TeamService } from '../services/teamService.js';
import { AuditService } from '../services/auditService.js';
import { PermissionService } from '../services/permissionService.js';
import { getUserActiveTeamByDiscordId, getActiveTeamMembers, countActiveTeamMembers, getTeamMembers } from '../database/queries/memberQueries.js';
import { getTeamById, purgeDisbandedTeams } from '../database/queries/teamQueries.js';
import { getAllInviteRoles } from '../database/queries/inviteQueries.js';
import { getAllChallenges, getChallengeById } from '../database/queries/challengeQueries.js';
import { ChallengeService } from '../services/challengeService.js';
import {
  getOpenRecruitmentByTeam,
  createRecruitment,
  getRecruitmentById,
  closeRecruitment,
  closeAllRecruitmentsByTeam,
  decrementRecruitmentSlot
} from '../database/queries/recruitmentQueries.js';
import { buildTeamPanelDashboard } from '../commands/team/team.js';
import { validateTeamName } from '../utils/validators.js';
import { errorEmbed, successEmbed, infoEmbed, warningEmbed, teamInfoEmbed } from '../utils/embeds.js';
import { DashboardService } from '../services/dashboardService.js';
import { InviteService } from '../services/inviteService.js';
import { replyDismissable, replyPermanent, replyEphemeral } from '../utils/interactionUtils.js';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';


// ============================================================
// REGISTRATION SESSION STORE
// In-memory, keyed by `member_${userId}` or `staff_${userId}`
// Value: { teamName, nsacLink, challengeId, challengeTitle, memberIds, channelId, messageId, expiresAt }
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
function buildMemberRegEmbed({ userId, teamName, nsacLink, challengeTitle, memberIds = [], step }) {
  const memberList = memberIds.length > 0
    ? memberIds.map((id) => `<@${id}>`).join(', ')
    : '*(Belum dipilih)*';

  const chDisplay = challengeTitle ? `**${challengeTitle}**` : '*(Belum memilih)*';
  const linkDisplay = nsacLink ? `[Buka Link Web NSAC](${nsacLink})` : '*(Belum diisi)*';

  let statusText, color;
  switch (step) {
    case 'select_members':
      statusText = 'Pilih challenge & anggota tim dari menu dropdown di bawah.';
      color = EMBED_COLORS.INFO;
      break;
    case 'confirm':
      statusText = 'Semua data siap. Tekan **Konfirmasi** untuk mendaftar, atau **Pilih Ulang** untuk mengubah.';
      color = EMBED_COLORS.SUCCESS;
      break;
    case 'processing':
      statusText = 'Sedang memproses pendaftaran tim...';
      color = EMBED_COLORS.WARNING;
      break;
    case 'cancelled':
      statusText = 'Pendaftaran dibatalkan.';
      color = EMBED_COLORS.DANGER;
      break;
    default:
      statusText = 'Memulai pendaftaran...';
      color = EMBED_COLORS.INFO;
  }

  return new EmbedBuilder()
    .setTitle('Pendaftaran Tim Baru')
    .setColor(color)
    .addFields(
      { name: 'Team Leader', value: `<@${userId}>`, inline: true },
      { name: 'Nama Tim', value: `**${teamName}**`, inline: true },
      { name: 'Challenge', value: chDisplay, inline: true },
      { name: 'Link Tim NSAC', value: linkDisplay, inline: false },
      { name: 'Anggota', value: memberList, inline: false },
      { name: 'Status', value: statusText, inline: false }
    )
    .setFooter({ text: 'NSAC Hackathon • Pendaftaran Tim' })
    .setTimestamp();
}

/**
 * Build the single registration embed for staff flow.
 * First member selected = leader.
 */
function buildStaffRegEmbed({ teamName, nsacLink, challengeTitle, memberIds = [], step }) {
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

  const chDisplay = challengeTitle ? `**${challengeTitle}**` : '*(Belum memilih)*';
  const linkDisplay = nsacLink ? `[Buka Link Web NSAC](${nsacLink})` : '*(Belum diatur)*';

  let statusText, color;
  switch (step) {
    case 'select_members':
      statusText = 'Pilih 1–4 anggota & challenge. Anggota pertama otomatis menjadi Leader.';
      color = EMBED_COLORS.INFO;
      break;
    case 'confirm':
      statusText = 'Semua data siap. Tim akan langsung aktif tanpa undangan. Tekan **Konfirmasi** untuk membuat.';
      color = EMBED_COLORS.SUCCESS;
      break;
    case 'processing':
      statusText = 'Sedang membuat tim dan menyiapkan channel...';
      color = EMBED_COLORS.WARNING;
      break;
    case 'cancelled':
      statusText = 'Pembuatan tim dibatalkan.';
      color = EMBED_COLORS.DANGER;
      break;
    default:
      statusText = 'Memulai...';
      color = EMBED_COLORS.INFO;
  }

  return new EmbedBuilder()
    .setTitle('Buat Tim Baru (Staff)')
    .setColor(color)
    .addFields(
      { name: 'Nama Tim', value: `**${teamName}**`, inline: true },
      { name: 'Mode', value: 'Staff Override (No Invite)', inline: true },
      { name: 'Challenge', value: chDisplay, inline: true },
      { name: 'Link Tim NSAC', value: linkDisplay, inline: false },
      { name: 'Leader', value: leaderDisplay, inline: false },
      { name: 'Anggota Lain', value: otherMembers, inline: false },
      { name: 'Status', value: statusText, inline: false }
    )
    .setFooter({ text: 'NSAC Hackathon • Staff Team Creation' })
    .setTimestamp();
}

/**
 * Build member select dropdown for a given eligible members list and team name.
 * Returns null if eligibleMembers is empty (caller should handle gracefully).
 */
function buildMemberSelectRow({ eligibleMembers, min, max, isStaff = false }) {
  if (!eligibleMembers || eligibleMembers.length === 0) return null;

  const selectOptions = eligibleMembers.slice(0, 25).map((m) => {
    const displayName = (m.displayName || m.user.username).substring(0, 100);
    const tag = `@${m.user.username}`.substring(0, 100);
    return new StringSelectMenuOptionBuilder()
      .setLabel(displayName)
      .setDescription(tag)
      .setValue(m.id);
  });

  const actualMax = Math.min(max, selectOptions.length);
  const actualMin = Math.min(min, actualMax);

  // Use static customIds to avoid 100-char Discord limit from encoded team names
  const customId = isStaff ? 'select_staff_reg_members' : 'select_unreg_members';

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

/**
 * Build challenge select dropdown for registration.
 */
function buildChallengeSelectRow({ challenges, selectedChallengeId = null, isStaff = false }) {
  if (!challenges || challenges.length === 0) return null;

  const customId = isStaff ? CUSTOM_IDS.SELECT_STAFF_TEAM_CHALLENGE : CUSTOM_IDS.SELECT_TEAM_CHALLENGE;
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Belum Memilih Challenge')
      .setDescription('Kosongkan/lewati pemilihan challenge saat ini')
      .setValue('none')
      .setDefault(!selectedChallengeId)
  ];

  for (const c of challenges.slice(0, 24)) {
    const isSelected = selectedChallengeId && String(selectedChallengeId) === String(c.id);
    const desc = c.description
      ? c.description.substring(0, 50) + (c.description.length > 50 ? '...' : '')
      : 'Lihat web NSAC untuk detail selengkapnya';
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(c.title.substring(0, 100))
        .setDescription(desc)
        .setValue(c.id.toString())
        .setDefault(Boolean(isSelected))
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Pilih challenge yang akan diikuti timmu (opsional)...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}



export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // ========================================================
    // 0. AUTOCOMPLETE ROUTER
    // ========================================================
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        logger.warn(`[Autocomplete Error /${interaction.commandName}] ${error.message}`);
      }
      return;
    }

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
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Pendaftaran Ditutup', 'Pendaftaran tim saat ini sedang ditutup oleh panitia.')]
          });
        }

        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (activeTeam) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Sudah Terdaftar', `Anda sudah terdaftar atau memiliki registrasi aktif di tim **${activeTeam.name}**!`)]
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(CUSTOM_IDS.MODAL_REGISTER_TEAM)
          .setTitle('Team Registration');

        const teamNameInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_TEAM_NAME)
          .setLabel('Team Name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Contoh: Code Wizards, Team Alpha')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(32);

        const teamLinkInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_TEAM_LINK)
          .setLabel('Link Tim Terdaftar di NSAC Resmi')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://...')
          .setRequired(true)
          .setMinLength(8)
          .setMaxLength(300);

        modal.addComponents(
          new ActionRowBuilder().addComponents(teamNameInput),
          new ActionRowBuilder().addComponents(teamLinkInput)
        );

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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Unauthorized', 'Only staff can confirm team deletion.')] });
        }
        const teamId = parseInt(customId.replace(CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM, ''), 10);
        
        await interaction.update({
          embeds: [infoEmbed('Menghapus Tim...', 'Sedang menghapus seluruh channel, role tim, dan mengembalikan role @No-Team...')],
          components: []
        });

        await TeamService.deleteTeam(teamId, interaction.guild, interaction.client, interaction.user.tag);
        
        return await interaction.editReply({
          embeds: [successEmbed('Tim Berhasil Dihapus', 'Tim dan seluruh channel/role telah berhasil dihapus. Seluruh mantan anggota telah dikembalikan ke status belum memiliki tim (**@No-Team**).')],
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'You do not have permission.')] });
        }
        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        return await interaction.update({ embeds: [embed], components });
      }

      // J. Team Panel: Export Summary
      if (customId === 'team_panel_export_summary') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'You do not have permission.')] });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { rows: allTeams } = await pool.query(`
          SELECT t.id, t.name, t.status, t.nsac_link, c.title as challenge_title,
                 u.username as leader_name, u.discord_id as leader_discord_id,
                 ARRAY_TO_STRING(ARRAY_AGG(mu.username || ' (<@' || mu.discord_id || '>)'), ', ') as member_list
          FROM teams t
          LEFT JOIN users u ON t.leader_id = u.id
          LEFT JOIN challenges c ON t.challenge_id = c.id
          LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'ACTIVE'
          LEFT JOIN users mu ON tm.user_id = mu.id
          GROUP BY t.id, t.name, t.status, t.nsac_link, c.title, u.username, u.discord_id
          ORDER BY t.status, t.name
        `);

        if (allTeams.length === 0) {
          return await interaction.editReply({ embeds: [infoEmbed('Data Tim Kosong', 'Belum ada tim yang terdaftar.')] });
        }

        const lines = allTeams.map((t, idx) => {
          const ch = t.challenge_title ? `[Challenge: ${t.challenge_title}]` : '[Challenge: Belum memilih]';
          const link = t.nsac_link ? `\n   • Web NSAC: ${t.nsac_link}` : '';
          return `**${idx + 1}. ${t.name}** [Status: \`${t.status}\`] ${ch}\n` +
                 `   • Leader: <@${t.leader_discord_id}> (${t.leader_name})\n` +
                 `   • Anggota: ${t.member_list || 'Belum ada anggota'}` +
                 link;
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
              .setTitle('Ringkasan Lengkap Seluruh Tim Hackathon')
              .setDescription(chunks[0])
              .setColor(EMBED_COLORS.PRIMARY)
              .setFooter({ text: `Total Tim: ${allTeams.length}` })
              .setTimestamp()
          ]
        });
      }

      // JA. Team Panel: Purge Disbanded Prompt
      if (customId === 'team_panel_purge_disbanded') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const { rows } = await pool.query(`SELECT COUNT(*) as count FROM teams WHERE status = 'DISBANDED'`);
        const count = parseInt(rows[0]?.count || 0, 10);

        if (count === 0) {
          const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
          return await interaction.update({ embeds: [embed], components });
        }

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('team_panel_purge_confirm')
            .setLabel(`Konfirmasi Hapus (${count} Tim)`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('team_panel_purge_cancel')
            .setLabel('Batal')
            .setStyle(ButtonStyle.Secondary)
        );

        return await interaction.update({
          embeds: [
            warningEmbed(
              'Konfirmasi Pembersihan Tim Bubar',
              `Terdapat **${count}** tim berstatus DISBANDED di database.\n\n` +
              'Tindakan ini akan **menghapus permanen** data tim tersebut beserta riwayat anggota dan undangannya dari database.\n\n' +
              'Apakah kamu yakin ingin melanjutkan?'
            )
          ],
          components: [confirmRow]
        });
      }

      // JB. Team Panel: Purge Disbanded Confirm
      if (customId === 'team_panel_purge_confirm') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const purged = await purgeDisbandedTeams();

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.TEAMS_PURGED,
          title: 'Pembersihan Tim Bubar',
          actorTag: interaction.user.tag,
          details: `${purged.length} tim berstatus DISBANDED dihapus permanen dari database.`
        });

        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        await interaction.update({ embeds: [embed], components });
        return await replyDismissable(interaction, {
          embeds: [successEmbed('Pembersihan Berhasil', `Sebanyak **${purged.length}** tim berstatus DISBANDED telah berhasil dihapus permanen dari database.`)]
        });
      }

      // JC. Team Panel: Purge Disbanded Cancel
      if (customId === 'team_panel_purge_cancel') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        return await interaction.update({ embeds: [embed], components });
      }

      // K. Team Panel: Quick Action (Approve / Archive / Delete from panel)
      if (customId.startsWith('team_panel_action_approve_')) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }
        const teamId = parseInt(customId.replace('team_panel_action_approve_', ''), 10);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await TeamService.finalizeTeamCreation(teamId, interaction.guild, interaction.client);
          return await interaction.editReply({ embeds: [successEmbed('Approved', `Tim #${teamId} berhasil disetujui dan channel telah dibuat.`)] });
        } catch (err) {
          return await interaction.editReply({ embeds: [errorEmbed('Approval Failed', err.message)] });
        }
      }

      if (customId.startsWith('team_panel_action_archive_')) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }
        const teamId = parseInt(customId.replace('team_panel_action_archive_', ''), 10);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          await TeamService.archiveTeam(teamId, interaction.guild, interaction.client, interaction.user.tag);
          return await interaction.editReply({ embeds: [successEmbed('Archived', `Tim #${teamId} telah diarsipkan.`)] });
        } catch (err) {
          return await interaction.editReply({ embeds: [errorEmbed('Archive Failed', err.message)] });
        }
      }

      // L. Team Panel: Staff Add Team — show modal for team name (new single-embed flow)
      if (customId === CUSTOM_IDS.BTN_STAFF_ADD_TEAM) {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const modal = new ModalBuilder()
          .setCustomId(CUSTOM_IDS.MODAL_STAFF_ADD_TEAM)
          .setTitle('Buat Tim Baru (Staff)');

        const teamNameInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_STAFF_TEAM_NAME)
          .setLabel('Nama Tim')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Contoh: Tim Jember Alpha')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(32);

        const teamLinkInput = new TextInputBuilder()
          .setCustomId(CUSTOM_IDS.INPUT_STAFF_TEAM_LINK)
          .setLabel('Link Tim Terdaftar di NSAC Resmi (Opsional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://...')
          .setRequired(false)
          .setMaxLength(300);

        modal.addComponents(
          new ActionRowBuilder().addComponents(teamNameInput),
          new ActionRowBuilder().addComponents(teamLinkInput)
        );
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
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: session.memberIds,
            step: 'processing'
          })],
          components: []
        });

        try {
          const result = await TeamService.startRegistration({
            teamName: session.teamName,
            leaderMember: interaction.member,
            memberIds: session.memberIds,
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel,
            nsacLink: session.nsacLink,
            challengeId: session.challengeId
          });

          deleteSession(sessionKey);

          if (!result.success) {
            return await interaction.editReply({
              embeds: [errorEmbed('Pendaftaran Gagal', result.error)],
              components: []
            });
          }

          // Langsung provision channel & role tim karena tim langsung ACTIVE
          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

          if (result.pendingInvitations) {
            const unixExpiry = Math.floor(new Date(result.expiresAt).getTime() / 1000);
            const memberMentions = session.memberIds.map((id) => `<@${id}>`).join(', ');
            return await interaction.editReply({
              embeds: [successEmbed(
                'Tim Berhasil Dibuat & Undangan Terkirim',
                `Tim **${session.teamName}** telah aktif dan channel tim sudah siap digunakan.\n\n` +
                `Undangan telah dikirimkan ke: ${memberMentions}\n` +
                `Batas waktu konfirmasi: <t:${unixExpiry}:R>\n\n` +
                `Ketika anggota menekan **Terima**, mereka akan langsung otomatis bergabung ke dalam tim dan mendapatkan akses channel tim.`
              )],
              components: []
            });
          } else {
            return await interaction.editReply({
              embeds: [successEmbed('Tim Berhasil Dibuat', `Tim **${session.teamName}** telah aktif dan channel tim siap digunakan.`)],
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
          embeds: [buildMemberRegEmbed({ userId: interaction.user.id, teamName: '—', nsacLink: null, challengeTitle: null, memberIds: [], step: 'cancelled' })],
          components: []
        });
      }

      // N2. Create Team Immediately (member) — skip member selection, register solo
      if (customId === CUSTOM_IDS.BTN_REG_CREATE_SOLO) {
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Silakan mulai ulang dari awal.')], components: [] });
        }

        await interaction.update({
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: [],
            step: 'processing'
          })],
          components: []
        });

        try {
          const result = await TeamService.startRegistration({
            teamName: session.teamName,
            leaderMember: interaction.member,
            memberIds: [],
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel,
            allowSolo: true,
            nsacLink: session.nsacLink,
            challengeId: session.challengeId
          });

          deleteSession(sessionKey);

          if (!result.success) {
            return await interaction.editReply({ embeds: [errorEmbed('Pendaftaran Gagal', result.error)], components: [] });
          }

          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

          return await interaction.editReply({
            embeds: [successEmbed('Tim Berhasil Dibuat', `Tim **${session.teamName}** telah aktif dan channel tim siap digunakan.`)],
            components: []
          });
        } catch (err) {
          logger.error(`[Reg Create Solo Error] ${err.message}`);
          return await interaction.editReply({ embeds: [errorEmbed('Error', `Gagal memproses pendaftaran: ${err.message}`)], components: [] });
        }
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

        const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const selectRow = buildMemberSelectRow({ eligibleMembers, min: minSelect, max: maxSelect });

        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: false });

        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const components = [selectRow, challengeRow, cancelRow].filter(Boolean);

        return await interaction.update({
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: [],
            step: 'select_members'
          })],
          components
        });
      }

      // P. Change Team Name (member) — show modal, store message ref in session
      if (customId === CUSTOM_IDS.BTN_REG_CHANGE_NAME) {
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey) || {};
        session.messageId = interaction.message.id;
        session.channelId = interaction.channelId;
        setSession(sessionKey, session);

        const modal = new ModalBuilder().setCustomId(CUSTOM_IDS.MODAL_REG_CHANGE_NAME).setTitle('Ubah Nama Tim');
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
          embeds: [buildStaffRegEmbed({
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: session.memberIds,
            step: 'processing'
          })],
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
            skipInvitations: true,
            nsacLink: session.nsacLink,
            challengeId: session.challengeId
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
              'Tim Berhasil Dibuat',
              `Tim **${session.teamName}** berhasil dibuat dan channel telah disiapkan!\n\n` +
              `• Leader: <@${leaderId}>\n` +
              `• Challenge: ${session.challengeTitle ? `**${session.challengeTitle}**` : '*(Belum memilih)*'}\n` +
              `• Link Tim NSAC: ${session.nsacLink || '*(Belum diatur)*'}\n` +
              `• Anggota: ${memberMentions}`
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
          embeds: [buildStaffRegEmbed({ teamName: '—', nsacLink: null, challengeTitle: null, memberIds: [], step: 'cancelled' })],
          components: []
        });
      }

      // R2. Create Team Immediately (staff) — skip member selection, register with leader only
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_CREATE_SOLO) {
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Silakan mulai ulang.')], components: [] });
        }

        await interaction.update({
          embeds: [buildStaffRegEmbed({
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: [],
            step: 'processing'
          })],
          components: []
        });

        try {
          const result = await TeamService.startRegistration({
            teamName: session.teamName,
            leaderMember: interaction.member,
            memberIds: [],
            guild: interaction.guild,
            client: interaction.client,
            skipInvitations: true,
            allowSolo: true,
            nsacLink: session.nsacLink,
            challengeId: session.challengeId
          });

          deleteSession(sessionKey);

          if (!result.success) {
            return await interaction.editReply({ embeds: [errorEmbed('Gagal Membuat Tim', result.error)], components: [] });
          }

          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

          return await interaction.editReply({
            embeds: [successEmbed('Tim Berhasil Dibuat', `Tim **${session.teamName}** berhasil dibuat dengan leader <@${interaction.user.id}>!`)],
            components: []
          });
        } catch (err) {
          logger.error(`[Staff Reg Create Solo Error] ${err.message}`);
          return await interaction.editReply({ embeds: [errorEmbed('Error', err.message)], components: [] });
        }
      }

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

        const selectRow = buildMemberSelectRow({ eligibleMembers, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: true });

        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const components = [selectRow, challengeRow, cancelRow].filter(Boolean);
        return await interaction.update({
          embeds: [buildStaffRegEmbed({
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: [],
            step: 'select_members'
          })],
          components
        });
      }

      // T. Change Team Name (staff)
      if (customId === CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME) {
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey) || {};
        session.messageId = interaction.message.id;
        session.channelId = interaction.channelId;
        setSession(sessionKey, session);

        const modal = new ModalBuilder().setCustomId(CUSTOM_IDS.MODAL_STAFF_REG_CHANGE_NAME).setTitle('Ubah Nama Tim (Staff)');
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
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat mengubah status pendaftaran.')]
          });
        }

        await interaction.deferUpdate().catch(() => {});
        const current = GuildConfigService.get('REGISTRATION_OPEN') !== 'false';
        const nextState = current ? 'false' : 'true';
        await GuildConfigService.set('REGISTRATION_OPEN', nextState);

        await DashboardService.refreshOverviewPanel(interaction.guild);
        return;
      }

      if (customId === 'dashboard_refresh_all' || customId === 'dashboard_refresh') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat merefresh dashboard.')]
          });
        }

        await interaction.deferUpdate().catch(() => {});
        await DashboardService.refreshAllPanels(interaction.guild);
        return;
      }

      if (customId === 'dashboard_invite_refresh') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }
        await interaction.deferUpdate().catch(() => {});
        await DashboardService.refreshInvitesPanel(interaction.guild);
        return;
      }

      if (customId === 'dashboard_invite_create') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat membuat link invite.')] });
        }

        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('dashboard_invite_select_role')
          .setPlaceholder('Pilih role (bisa pilih lebih dari 1, misal: Participant + No-Team)...')
          .setMinValues(1)
          .setMaxValues(10);

        return await replyPermanent(interaction, {
          embeds: [
            infoEmbed(
              'Buat Dynamic Auto-Role Invite Link',
              'Silakan pilih **satu atau beberapa role** dari menu di bawah (misal: **Participant + No-Team**).\n' +
              'Bot akan membuat link invite Discord permanen baru, dan setiap member yang bergabung dengan link ini akan **otomatis diberikan seluruh role tersebut**.'
            )
          ],
          components: [new ActionRowBuilder().addComponents(roleSelect)]
        });
      }


      if (customId === 'dashboard_invite_delete') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const dynamicInvites = await getAllInviteRoles();
        if (dynamicInvites.length === 0) {
          return await replyDismissable(interaction, {
            embeds: [infoEmbed('Tidak Ada Link Invite', 'Belum ada link invite dinamis yang terdaftar untuk dihapus.')]
          });
        }

        const options = dynamicInvites.slice(0, 25).map((inv) => {
          const roleObj = interaction.guild.roles.cache.get(inv.role_id);
          const roleName = inv.label || (roleObj ? roleObj.name : inv.role_id);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${roleName} (${inv.invite_code})`.substring(0, 100))
            .setDescription(`Role: @${roleName} • Code: ${inv.invite_code}`.substring(0, 100))
            .setValue(inv.invite_code);
        });

        const deleteSelect = new StringSelectMenuBuilder()
          .setCustomId('dashboard_invite_select_delete')
          .setPlaceholder('Pilih link invite yang ingin dihapus...')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);

        return await replyPermanent(interaction, {
          embeds: [
            warningEmbed(
              'Hapus Dynamic Invite Link',
              'Pilih link invite dari dropdown di bawah untuk dihapus dari sistem bot dan server Discord.'
            )
          ],
          components: [new ActionRowBuilder().addComponents(deleteSelect)]
        });
      }

      // Legacy create participant invite
      if (customId === 'dashboard_gen_invite') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Staff Only', 'Hanya staf/admin yang dapat membuat link invite.')]
          });
        }

        try {
          const invite = await InviteService.createParticipantInvite(interaction.guild);
          await DashboardService.refreshInvitesPanel(interaction.guild);

          return await replyPermanent(interaction, {
            embeds: [successEmbed(
              'Link Invite Peserta Dibuat',
              `Link invite khusus peserta berhasil dibuat:\n**${invite.url}**\n\n` +
              `• Kode: \`${invite.code}\`\n` +
              `• *Member baru yang join via link ini otomatis mendapat @Participant + @No-Team.*`
            )]
          });
        } catch (err) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Gagal Membuat Invite', err.message)]
          });
        }
      }

      // Dashboard: Open Team Panel (ephemeral)
      if (customId === 'dashboard_open_team_panel') {
        if (!PermissionService.isStaff(interaction.member)) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }
        const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
        return await replyPermanent(interaction, { embeds: [embed], components });
      }

      // ========================================================
      // TEAM MANAGEMENT BUTTONS (Kick, Leave, Panel Buttons)
      // ========================================================

      // Kick Member Confirm
      if (customId.startsWith(CUSTOM_IDS.BTN_TEAM_KICK_CONFIRM)) {
        const payload = customId.replace(CUSTOM_IDS.BTN_TEAM_KICK_CONFIRM, '');
        const [teamIdStr, targetUserId] = payload.split('_');
        const teamId = parseInt(teamIdStr, 10);

        await interaction.deferUpdate();
        const result = await TeamService.kickMember(teamId, interaction.user.id, targetUserId, interaction.guild, interaction.client);
        if (!result.success) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Mengeluarkan Anggota', result.error)],
            components: []
          });
        }

        return await interaction.editReply({
          embeds: [successEmbed('Anggota Dikeluarkan', `<@${targetUserId}> telah berhasil dikeluarkan dari tim.`)],
          components: []
        });
      }

      // Kick Member Cancel
      if (customId === CUSTOM_IDS.BTN_TEAM_KICK_CANCEL) {
        return await interaction.update({
          embeds: [infoEmbed('Dibatalkan', 'Pengeluaran anggota tim dibatalkan.')],
          components: []
        });
      }

      // Leave Team Confirm
      if (customId === CUSTOM_IDS.BTN_TEAM_LEAVE_CONFIRM) {
        await interaction.deferUpdate();
        const result = await TeamService.leaveTeam(interaction.user.id, interaction.guild, interaction.client);
        if (!result.success) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Keluar Tim', result.error)],
            components: []
          });
        }

        return await interaction.editReply({
          embeds: [successEmbed('Berhasil Keluar', `Kamu telah keluar dari tim **${result.team.name}**.`)],
          components: []
        });
      }

      // Leave Team Cancel
      if (customId === CUSTOM_IDS.BTN_TEAM_LEAVE_CANCEL) {
        return await interaction.update({
          embeds: [infoEmbed('Dibatalkan', 'Aksi keluar tim dibatalkan.')],
          components: []
        });
      }

      // Team Welcome Panel Button: Pilih / Ubah Challenge
      if (customId === CUSTOM_IDS.BTN_TEAM_PANEL_SET_CHALLENGE) {
        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Akses Terbatas', 'Hanya Team Leader yang bisa memilih atau mengubah challenge tim.')]
          });
        }

        const challenges = await getAllChallenges();
        if (!challenges || challenges.length === 0) {
          return await replyDismissable(interaction, {
            embeds: [infoEmbed('Belum Ada Challenge', 'Saat ini belum ada challenge yang ditambahkan oleh panitia ke sistem.')]
          });
        }

        const options = ChallengeService.buildChallengeSelectOptions(challenges);
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_IDS.SELECT_TEAM_PANEL_CHALLENGE}${activeTeam.id}`)
          .setPlaceholder('Pilih challenge yang akan diikuti timmu...')
          .addOptions(options);

        const currentChallenge = activeTeam.challenge_title ? `**${activeTeam.challenge_title}**` : '*(Belum memilih)*';

        return await replyPermanent(interaction, {
          embeds: [
            infoEmbed(
              'Pilih Challenge Tim',
              `Challenge saat ini untuk tim **${activeTeam.name}**: ${currentChallenge}\n\n` +
              `Pilih challenge dari dropdown di bawah untuk memperbarui challenge tim.`
            )
          ],
          components: [new ActionRowBuilder().addComponents(selectMenu)]
        });
      }

      // Team Welcome Panel Button: Invite Anggota
      if (customId === CUSTOM_IDS.BTN_TEAM_PANEL_INVITE) {
        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Akses Terbatas', 'Hanya Team Leader yang bisa mengundang anggota. Gunakan command `/team invite @user` untuk mengundang rekanmu.')]
          });
        }
        return await replyDismissable(interaction, {
          embeds: [infoEmbed('Undang Anggota', 'Gunakan perintah `/team invite @user` di channel untuk mengundang anggota baru ke tim kamu.')]
        });
      }

      // Team Welcome Panel Button: Buka Rekrutmen
      if (customId === CUSTOM_IDS.BTN_TEAM_PANEL_RECRUIT) {
        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Akses Terbatas', 'Hanya Team Leader yang bisa membuka rekrutmen tim.')]
          });
        }

        const existing = await getOpenRecruitmentByTeam(activeTeam.id);
        if (existing) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Rekrutmen Sudah Ada', 'Tim kamu sudah memiliki postingan rekrutmen aktif. Gunakan `/team recruit-close` jika ingin menutupnya.')]
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`${CUSTOM_IDS.MODAL_TEAM_RECRUIT}${activeTeam.id}`)
          .setTitle('Buka Lowongan Rekrutmen Tim');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(CUSTOM_IDS.INPUT_RECRUIT_SLOTS)
              .setLabel('Berapa anggota yang kamu butuhkan?')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Contoh: 2')
              .setMinLength(1)
              .setMaxLength(1)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(CUSTOM_IDS.INPUT_RECRUIT_DESC)
              .setLabel('Deskripsi kebutuhan tim (opsional)')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('Contoh: Mencari anggota yang menguasai UI/UX atau backend.')
              .setMaxLength(300)
              .setRequired(false)
          )
        );

        return await interaction.showModal(modal);
      }

      // Team Welcome Panel Button: Tutup Rekrutmen
      if (customId === CUSTOM_IDS.BTN_TEAM_PANEL_RECRUIT_CLOSE) {
        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Akses Terbatas', 'Hanya Team Leader yang bisa menutup rekrutmen tim.')]
          });
        }

        const openRecruit = await getOpenRecruitmentByTeam(activeTeam.id);
        if (!openRecruit) {
          await TeamService.refreshTeamWelcomePanel(activeTeam.id, interaction.guild);
          return await replyDismissable(interaction, {
            embeds: [infoEmbed('Tidak Ada Rekrutmen', 'Tidak ada lowongan rekrutmen aktif untuk tim kamu.')]
          });
        }

        await closeRecruitment(openRecruit.id);

        // Update pesan board publik jadi [DITUTUP] & kosongkan komponen
        try {
          const recruitChannel = interaction.guild.channels.cache.get(openRecruit.channel_id)
            || await interaction.guild.channels.fetch(openRecruit.channel_id).catch(() => null);
          if (recruitChannel && recruitChannel.isTextBased()) {
            const bMsg = await recruitChannel.messages.fetch(openRecruit.message_id).catch(() => null);
            if (bMsg) {
              await bMsg.edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle(`[DITUTUP] Rekrutmen Tim ${activeTeam.name}`)
                    .setColor(EMBED_COLORS.DARK)
                    .setDescription('Lowongan rekrutmen tim ini telah ditutup oleh leader tim.')
                    .setTimestamp()
                ],
                components: []
              }).catch(() => {});
            }
          }
        } catch (err) {
          logger.warn(`[Recruit Close] Gagal update pesan board: ${err.message}`);
        }

        // Refresh welcome panel tim agar tombol kembali jadi Buka Rekrutmen
        await TeamService.refreshTeamWelcomePanel(activeTeam.id, interaction.guild);

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_CLOSED,
          title: 'Rekrutmen Ditutup',
          actorTag: interaction.user.tag,
          teamId: activeTeam.id,
          teamName: activeTeam.name,
          details: `Leader menutup rekrutmen tim "${activeTeam.name}" dari embed panel tim.`
        });

        return await replyDismissable(interaction, {
          embeds: [successEmbed('Rekrutmen Ditutup', `Lowongan rekrutmen tim **${activeTeam.name}** berhasil ditutup.`)]
        });
      }

      // Team Welcome Panel Button: Info Tim
      if (customId === CUSTOM_IDS.BTN_TEAM_PANEL_INFO) {
        const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (!activeTeam) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Tim Tidak Ditemukan', 'Kamu tidak berada di tim mana pun.')]
          });
        }
        const members = await getTeamMembers(activeTeam.id);
        const embed = teamInfoEmbed(activeTeam, members);
        return await replyPermanent(interaction, { embeds: [embed] });
      }

      // ========================================================
      // RECRUITMENT INTERACTION BUTTONS
      // ========================================================

      // Peserta klik "Minta Bergabung" di Board Rekrutmen
      if (customId.startsWith(CUSTOM_IDS.BTN_RECRUIT_REQUEST_JOIN)) {
        const recruitId = parseInt(customId.replace(CUSTOM_IDS.BTN_RECRUIT_REQUEST_JOIN, ''), 10);
        const recruitment = await getRecruitmentById(recruitId);

        if (!recruitment || recruitment.status !== 'OPEN') {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Rekrutmen Ditutup', 'Lowongan rekrutmen tim ini sudah ditutup.')]
          });
        }

        // Cek anti-double-team untuk pemohon
        const userTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
        if (userTeam) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Sudah Punya Tim', `Kamu sudah terdaftar di tim **${userTeam.name}**!`)]
          });
        }

        // Cek tim tujuan sudah penuh atau belum
        const currentMembers = await countActiveTeamMembers(recruitment.team_id);
        if (currentMembers >= env.MAX_TEAM_SIZE) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Tim Penuh', 'Tim ini sudah mencapai kapasitas maksimal anggota.')]
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Kirim notifikasi DM ke leader tim (Opsi A)
        let leaderMember = null;
        if (recruitment.leader_discord_id) {
          leaderMember = await interaction.guild.members.fetch(recruitment.leader_discord_id).catch(() => null);
        }

        if (!leaderMember) {
          return await interaction.editReply({
            embeds: [errorEmbed('Leader Tidak Ditemukan', 'Tidak dapat menghubungi leader tim saat ini.')]
          });
        }

        const requestRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.BTN_RECRUIT_ACCEPT}${recruitment.id}_${interaction.user.id}`)
            .setLabel('Terima')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.BTN_RECRUIT_REJECT}${recruitment.id}_${interaction.user.id}`)
            .setLabel('Tolak')
            .setStyle(ButtonStyle.Danger)
        );

        const dmSent = await leaderMember.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('Permintaan Bergabung ke Tim')
              .setColor(EMBED_COLORS.PRIMARY)
              .setDescription(
                `Peserta <@${interaction.user.id}> (${interaction.user.tag || interaction.user.username}) mengajukan permintaan untuk bergabung ke tim **${recruitment.team_name}**.\n\n` +
                `Apakah kamu ingin menerima peserta ini ke dalam tim?`
              )
              .setFooter({ text: 'NSAC Hackathon • Team Recruitment' })
              .setTimestamp()
          ],
          components: [requestRow]
        }).catch(() => null);

        if (!dmSent) {
          return await interaction.editReply({
            embeds: [warningEmbed(
              'DM Leader Tertutup',
              `Permintaan tidak dapat dikirim karena direct message (DM) leader tim <@${recruitment.leader_discord_id}> sedang tertutup. Silakan hubungi leader secara langsung.`
            )]
          });
        }

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_REQUEST_SENT,
          title: 'Permintaan Join Tim Terkirim',
          actorTag: interaction.user.tag,
          teamId: recruitment.team_id,
          teamName: recruitment.team_name,
          details: `<@${interaction.user.id}> mengirim permintaan bergabung ke tim "${recruitment.team_name}".`
        });

        return await interaction.editReply({
          embeds: [successEmbed(
            'Permintaan Terkirim',
            `Permintaan bergabung ke tim **${recruitment.team_name}** telah dikirim ke leader tim via DM. Mohon tunggu konfirmasi dari leader.`
          )]
        });
      }

      // Leader klik tombol "Tutup Rekrutmen" di pesan board
      if (customId.startsWith(CUSTOM_IDS.BTN_TEAM_RECRUIT_CLOSE)) {
        const recruitId = parseInt(customId.replace(CUSTOM_IDS.BTN_TEAM_RECRUIT_CLOSE, ''), 10);
        const recruitment = await getRecruitmentById(recruitId);

        if (!recruitment) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Tidak Ditemukan', 'Data rekrutmen tidak ditemukan.')] });
        }

        const isLeader = recruitment.leader_discord_id === interaction.user.id;
        const isStaff = PermissionService.isStaff(interaction.member);

        if (!isLeader && !isStaff) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Akses Ditolak', 'Hanya leader tim bersangkutan atau staf yang dapat menutup rekrutmen ini.')]
          });
        }

        await closeRecruitment(recruitment.id);

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle(`[DITUTUP] Rekrutmen Tim ${recruitment.team_name}`)
              .setColor(EMBED_COLORS.DARK)
              .setDescription('Lowongan rekrutmen untuk tim ini telah ditutup.')
              .setTimestamp()
          ],
          components: []
        });

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_CLOSED,
          title: 'Rekrutmen Ditutup',
          actorTag: interaction.user.tag,
          teamId: recruitment.team_id,
          teamName: recruitment.team_name,
          details: `Rekrutmen tim "${recruitment.team_name}" ditutup.`
        });
        return;
      }

      // Leader terima permintaan join dari DM (BTN_RECRUIT_ACCEPT)
      if (customId.startsWith(CUSTOM_IDS.BTN_RECRUIT_ACCEPT)) {
        await interaction.deferUpdate();

        const payload = customId.replace(CUSTOM_IDS.BTN_RECRUIT_ACCEPT, '');
        const [recruitIdStr, applicantDiscordId] = payload.split('_');
        const recruitId = parseInt(recruitIdStr, 10);

        const recruitment = await getRecruitmentById(recruitId);
        if (!recruitment) {
          return await interaction.editReply({
            embeds: [errorEmbed('Tidak Ditemukan', 'Data rekrutmen tidak ditemukan.')],
            components: []
          });
        }

        const guild = interaction.client.guilds.cache.get(env.GUILD_ID)
          || await interaction.client.guilds.fetch(env.GUILD_ID).catch(() => null);

        if (!guild) {
          return await interaction.editReply({ embeds: [errorEmbed('Error', 'Server tidak ditemukan.')], components: [] });
        }

        // Cek kuota tim
        const currentCount = await countActiveTeamMembers(recruitment.team_id);
        if (currentCount >= env.MAX_TEAM_SIZE) {
          return await interaction.editReply({
            embeds: [errorEmbed('Tim Penuh', `Tim **${recruitment.team_name}** sudah mencapai kuota maksimal (${env.MAX_TEAM_SIZE} orang).`)],
            components: []
          });
        }

        // Cek anti-double-team
        const applicantTeam = await getUserActiveTeamByDiscordId(applicantDiscordId);
        if (applicantTeam) {
          return await interaction.editReply({
            embeds: [errorEmbed('Sudah Punya Tim', `<@${applicantDiscordId}> saat ini sudah bergabung di tim lain (${applicantTeam.name}).`)],
            components: []
          });
        }

        // Tambah pemohon ke tim secara langsung
        const addResult = await TeamService.addMemberToTeam(
          recruitment.team_id,
          applicantDiscordId,
          guild,
          interaction.client,
          interaction.user.tag
        );

        if (!addResult.success) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Menambahkan', addResult.error)],
            components: []
          });
        }

        // Kurangi slot rekrutmen
        const updatedRecruit = await decrementRecruitmentSlot(recruitment.id);

        // Kirim DM konfirmasi ke pemohon
        const applicantMember = await guild.members.fetch(applicantDiscordId).catch(() => null);
        if (applicantMember) {
          await applicantMember.send({
            embeds: [
              successEmbed(
                'Permintaan Bergabung Diterima',
                `Selamat! Leader tim **${recruitment.team_name}** telah menerima permintaanmu.\n\n` +
                `Role tim dan akses ke channel tim sudah diberikan. Silakan cek channel tim kamu!`
              )
            ]
          }).catch(() => {});
        }

        // Notif ke channel tim
        if (recruitment.text_channel_id) {
          const teamTextChannel = guild.channels.cache.get(recruitment.text_channel_id);
          if (teamTextChannel && teamTextChannel.isTextBased()) {
            await teamTextChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(EMBED_COLORS.SUCCESS)
                  .setDescription(`<@${applicantDiscordId}> resmi bergabung ke dalam tim melalui jalur rekrutmen terbuka. Selamat bergabung!`)
                  .setTimestamp()
              ]
            }).catch(() => {});
          }
        }

        // Periksa apakah kuota tim sudah penuh atau slot rekrutmen habis
        const newCount = await countActiveTeamMembers(recruitment.team_id);
        const shouldClose = newCount >= env.MAX_TEAM_SIZE || (updatedRecruit && updatedRecruit.status === 'CLOSED');

        try {
          const recruitChannel = guild.channels.cache.get(recruitment.channel_id)
            || await guild.channels.fetch(recruitment.channel_id).catch(() => null);

          if (recruitChannel && recruitChannel.isTextBased()) {
            const bMsg = await recruitChannel.messages.fetch(recruitment.message_id).catch(() => null);
            if (bMsg) {
              if (shouldClose) {
                await closeRecruitment(recruitment.id);
                await bMsg.edit({
                  embeds: [
                    new EmbedBuilder()
                      .setTitle(`[DITUTUP] Rekrutmen Tim ${recruitment.team_name}`)
                      .setColor(EMBED_COLORS.DARK)
                      .setDescription('Lowongan rekrutmen tim ini telah ditutup karena kuota tim telah terpenuhi.')
                      .setTimestamp()
                  ],
                  components: []
                }).catch(() => {});
              } else {
                // Update embed board dengan sisa slot dan jumlah anggota terkini
                const remainingSlots = updatedRecruit?.slots_needed ?? Math.max(0, (recruitment.slots_needed || 1) - 1);
                const updatedBoardEmbed = TeamService.buildRecruitmentBoardEmbed({
                  teamName: recruitment.team_name,
                  description: recruitment.description,
                  leaderDiscordId: recruitment.leader_discord_id,
                  challengeTitle: recruitment.challenge_title,
                  slotsNeeded: remainingSlots,
                  currentCount: newCount,
                  maxTeamSize: env.MAX_TEAM_SIZE
                });

                const boardButtons = [
                  new ButtonBuilder()
                    .setCustomId(`${CUSTOM_IDS.BTN_RECRUIT_REQUEST_JOIN}${recruitment.id}`)
                    .setLabel('Minta Bergabung')
                    .setStyle(ButtonStyle.Success)
                ];

                if (recruitment.nsac_link && (recruitment.nsac_link.startsWith('http://') || recruitment.nsac_link.startsWith('https://'))) {
                  boardButtons.push(
                    new ButtonBuilder()
                      .setLabel('Profil Tim (NSAC Web)')
                      .setStyle(ButtonStyle.Link)
                      .setURL(recruitment.nsac_link)
                  );
                }

                await bMsg.edit({
                  embeds: [updatedBoardEmbed],
                  components: [new ActionRowBuilder().addComponents(boardButtons)]
                }).catch(() => {});
              }
            }
          }
        } catch (err) {
          logger.warn(`[Recruit Accept] Gagal update pesan board: ${err.message}`);
        }

        // Refresh welcome panel tim di channel tim
        await TeamService.refreshTeamWelcomePanel(recruitment.team_id, guild);

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_REQUEST_ACCEPTED,
          title: 'Permintaan Join Tim Diterima',
          actorTag: interaction.user.tag,
          teamId: recruitment.team_id,
          teamName: recruitment.team_name,
          details: `Leader menerima <@${applicantDiscordId}> bergabung ke tim "${recruitment.team_name}".`
        });

        return await interaction.editReply({
          embeds: [successEmbed('Permintaan Diterima', `<@${applicantDiscordId}> telah berhasil ditambahkan ke tim **${recruitment.team_name}**!`)],
          components: []
        });
      }

      // Leader tolak permintaan join dari DM (BTN_RECRUIT_REJECT)
      if (customId.startsWith(CUSTOM_IDS.BTN_RECRUIT_REJECT)) {
        await interaction.deferUpdate();

        const payload = customId.replace(CUSTOM_IDS.BTN_RECRUIT_REJECT, '');
        const [recruitIdStr, applicantDiscordId] = payload.split('_');
        const recruitId = parseInt(recruitIdStr, 10);

        const recruitment = await getRecruitmentById(recruitId);
        const teamName = recruitment?.team_name || 'tim';

        const guild = interaction.client.guilds.cache.get(env.GUILD_ID)
          || await interaction.client.guilds.fetch(env.GUILD_ID).catch(() => null);

        if (guild) {
          const applicantMember = await guild.members.fetch(applicantDiscordId).catch(() => null);
          if (applicantMember) {
            await applicantMember.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('Permintaan Bergabung Ditolak')
                  .setColor(EMBED_COLORS.WARNING)
                  .setDescription(`Maaf, permintaanmu untuk bergabung ke tim **${teamName}** belum dapat diterima oleh leader tim saat ini.`)
                  .setTimestamp()
              ]
            }).catch(() => {});
          }
        }

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_REQUEST_REJECTED,
          title: 'Permintaan Join Tim Ditolak',
          actorTag: interaction.user.tag,
          teamId: recruitment?.team_id || null,
          teamName,
          details: `Leader menolak permintaan <@${applicantDiscordId}> untuk bergabung ke tim "${teamName}".`
        });

        return await interaction.editReply({
          embeds: [infoEmbed('Permintaan Ditolak', `Kamu telah menolak permintaan bergabung dari <@${applicantDiscordId}>.`)],
          components: []
        });
      }

      return;
    }



    // ========================================================
    // 3. MODAL SUBMISSION ROUTER
    // ========================================================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === CUSTOM_IDS.MODAL_REGISTER_TEAM) {
        const teamName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_TEAM_NAME).trim();
        const nsacLink = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_TEAM_LINK)?.trim();

        const nameValidation = validateTeamName(teamName);
        if (!nameValidation.valid) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Nama Tim Tidak Valid', nameValidation.error)]
          });
        }

        if (!nsacLink || (!nsacLink.startsWith('http://') && !nsacLink.startsWith('https://'))) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Link NSAC Tidak Valid', 'Anda wajib memasukkan tautan tim yang terdaftar di situs web resmi NSAC (harus diawali http:// atau https://).')]
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
                  .setLabel('Tutup Tiket')
                  .setStyle(ButtonStyle.Danger)
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

        // If no eligible members and members required, solo team path
        if (eligibleMembers.length === 0 && minMembersToSelect > 0) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed(
              'Tidak Ada Anggota Tersedia',
              `Tidak ditemukan anggota yang memenuhi syarat di server untuk diundang ke tim **${teamName}**.\n\n` +
              (filterRoleId
                ? `Pastikan rekan tim Anda sudah bergabung ke server ini dan memiliki role <@&${filterRoleId}>.`
                : 'Pastikan rekan tim Anda sudah bergabung ke server Discord ini.')
            )]
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
            ticketChannel: interaction.channel,
            allowSolo: true,
            nsacLink,
            challengeId: null
          });
          if (!result.success) {
            return await replyDismissable(interaction, { embeds: [errorEmbed('Gagal Registrasi', result.error)] });
          }
          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);
          return await interaction.reply({
            embeds: [successEmbed('Tim Berhasil Dibuat', `Tim **${teamName}** telah dibuat dan channel telah siap!`)]
          });
        }

        // Show the single registration embed with member dropdown & challenge dropdown
        const selectRow = buildMemberSelectRow({ eligibleMembers, min: minMembersToSelect, max: maxMembersToSelect });
        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: null, isStaff: false });

        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const replyComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
        await interaction.reply({
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName,
            nsacLink,
            challengeTitle: null,
            memberIds: [],
            step: 'select_members'
          })],
          components: replyComponents
        });
        const reply = await interaction.fetchReply();

        // Store session
        setSession(`member_${interaction.user.id}`, {
          teamName,
          nsacLink,
          challengeId: null,
          challengeTitle: null,
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
        const nsacLink = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_STAFF_TEAM_LINK)?.trim() || null;

        const nameValidation = validateTeamName(teamName);
        if (!nameValidation.valid) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Nama Tim Tidak Valid', nameValidation.error)] });
        }

        if (nsacLink && (!nsacLink.startsWith('http://') && !nsacLink.startsWith('https://'))) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Link NSAC Tidak Valid', 'Tautan tim harus diawali http:// atau https://.')] });
        }

        // Build eligible members list (role-filtered, staff themselves NOT excluded)
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');

        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const selectRow = buildMemberSelectRow({ eligibleMembers, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: null, isStaff: true });

        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const replyComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
        await interaction.reply({
          embeds: [buildStaffRegEmbed({
            teamName,
            nsacLink,
            challengeTitle: null,
            memberIds: [],
            step: 'select_members'
          })],
          components: replyComponents,
          flags: MessageFlags.Ephemeral
        });
        const reply = await interaction.fetchReply();

        // Store session
        setSession(`staff_${interaction.user.id}`, {
          teamName,
          nsacLink,
          challengeId: null,
          challengeTitle: null,
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Nama Tidak Valid', nameValidation.error)] });
        }

        if (session) {
          session.teamName = newName;
          setSession(sessionKey, session);

          // Rebuild dropdowns with new name and update original message
          await interaction.guild.members.fetch().catch(() => {});
          const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
          const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
            if (m.user.bot || m.id === interaction.user.id) return false;
            if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
            return true;
          });

          const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
          const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
          const selectRow = buildMemberSelectRow({ eligibleMembers, min: minSelect, max: maxSelect });

          const challenges = await getAllChallenges();
          const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: false });

          const isConfirmStep = session.memberIds && session.memberIds.length > 0;
          const buttonRow = isConfirmStep
            ? new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
              )
            : new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
              );

          try {
            const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
            if (channel) {
              const msg = await channel.messages.fetch(session.messageId).catch(() => null);
              if (msg) {
                const editComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
                await msg.edit({
                  embeds: [buildMemberRegEmbed({
                    userId: interaction.user.id,
                    teamName: newName,
                    nsacLink: session.nsacLink,
                    challengeTitle: session.challengeTitle,
                    memberIds: session.memberIds || [],
                    step: isConfirmStep ? 'confirm' : 'select_members'
                  })],
                  components: editComponents
                });
              }
            }
          } catch (err) {
            logger.warn(`[Reg Change Name] Could not edit original message: ${err.message}`);
          }
        }

        return await replyDismissable(interaction, { content: `Nama tim diperbarui menjadi **${newName}**.` });
      }

      // Change Team Name modal submit (staff)
      if (interaction.customId === CUSTOM_IDS.MODAL_STAFF_REG_CHANGE_NAME) {
        const newName = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_STAFF_REG_NEW_NAME).trim();
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);

        const nameValidation = validateTeamName(newName);
        if (!nameValidation.valid) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Nama Tidak Valid', nameValidation.error)] });
        }

        if (session) {
          session.teamName = newName;
          setSession(sessionKey, session);

          await interaction.guild.members.fetch().catch(() => {});
          const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
          const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
            if (m.user.bot) return false;
            if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
            return true;
          });

          const selectRow = buildMemberSelectRow({ eligibleMembers, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
          const challenges = await getAllChallenges();
          const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: true });

          const isConfirmStep = session.memberIds && session.memberIds.length > 0;
          const buttonRow = isConfirmStep
            ? new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
              )
            : new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
              );

          try {
            const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
            if (channel) {
              const msg = await channel.messages.fetch(session.messageId).catch(() => null);
              if (msg) {
                const editComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
                await msg.edit({
                  embeds: [buildStaffRegEmbed({
                    teamName: newName,
                    nsacLink: session.nsacLink,
                    challengeTitle: session.challengeTitle,
                    memberIds: session.memberIds || [],
                    step: isConfirmStep ? 'confirm' : 'select_members'
                  })],
                  components: editComponents
                });
              }
            }
          } catch (err) {
            logger.warn(`[Staff Reg Change Name] Could not edit original message: ${err.message}`);
          }
        }

        return await replyDismissable(interaction, { content: `Nama tim diperbarui menjadi **${newName}**.` });
      }

      // Handler Modal Buka Lowongan Rekrutmen Tim
      if (interaction.customId.startsWith(CUSTOM_IDS.MODAL_TEAM_RECRUIT)) {
        const teamIdStr = interaction.customId.replace(CUSTOM_IDS.MODAL_TEAM_RECRUIT, '');
        const teamId = parseInt(teamIdStr, 10);

        const slotsStr = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_RECRUIT_SLOTS).trim();
        const description = interaction.fields.getTextInputValue(CUSTOM_IDS.INPUT_RECRUIT_DESC)?.trim() || '';

        const slots = parseInt(slotsStr, 10);
        if (isNaN(slots) || slots <= 0) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Jumlah Tidak Valid', 'Jumlah anggota yang dibutuhkan harus berupa angka positif minimal 1.')]
          });
        }

        const team = await getTeamById(teamId);
        if (!team) {
          return await replyDismissable(interaction, { embeds: [errorEmbed('Tim Tidak Ditemukan', 'Data tim tidak ditemukan.')] });
        }

        // Cek kuota sisa yang valid
        const currentCount = await countActiveTeamMembers(team.id);
        const maxAvailable = env.MAX_TEAM_SIZE - currentCount;
        if (maxAvailable <= 0) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Tim Penuh', `Tim kamu sudah penuh (${currentCount}/${env.MAX_TEAM_SIZE} anggota). Tidak bisa membuka rekrutmen.`)]
          });
        }

        if (slots > maxAvailable) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed(
              'Jumlah Melebihi Kuota',
              `Tim kamu saat ini memiliki ${currentCount} anggota. Kuota maksimal adalah ${env.MAX_TEAM_SIZE}.\n` +
              `Kamu hanya bisa mencari maksimal **${maxAvailable}** anggota baru.`
            )]
          });
        }

        // Ambil channel rekrutmen dari GuildConfig
        const recruitChannelId = GuildConfigService.get('RECRUITMENT_CHANNEL_ID');
        if (!recruitChannelId) {
          return await replyDismissable(interaction, {
            embeds: [warningEmbed(
              'Channel Belum Diatur',
              'Channel board rekrutmen tim belum dikonfigurasi oleh panitia (`RECRUITMENT_CHANNEL_ID`). Silakan laporkan hal ini kepada panitia.'
            )]
          });
        }

        const recruitChannel = interaction.guild.channels.cache.get(recruitChannelId)
          || await interaction.guild.channels.fetch(recruitChannelId).catch(() => null);

        if (!recruitChannel || !recruitChannel.isTextBased()) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Channel Tidak Valid', 'Channel board rekrutmen tidak dapat diakses atau bukan text channel.')]
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Buat embed board rekrutmen
        const recruitEmbed = TeamService.buildRecruitmentBoardEmbed({
          teamName: team.name,
          description,
          leaderDiscordId: team.leader_discord_id,
          challengeTitle: team.challenge_title,
          slotsNeeded: slots,
          currentCount,
          maxTeamSize: env.MAX_TEAM_SIZE
        });

        // Kirim placeholder message dulu untuk mendapatkan message ID
        const boardMsg = await recruitChannel.send({
          embeds: [recruitEmbed]
        });

        // Simpan ke DB
        const recruitmentRecord = await createRecruitment({
          teamId: team.id,
          channelId: recruitChannel.id,
          messageId: boardMsg.id,
          slotsNeeded: slots,
          description
        });

        // Update board message dengan action buttons
        const boardButtons = [
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.BTN_RECRUIT_REQUEST_JOIN}${recruitmentRecord.id}`)
            .setLabel('Minta Bergabung')
            .setStyle(ButtonStyle.Success)
        ];

        if (team.nsac_link && (team.nsac_link.startsWith('http://') || team.nsac_link.startsWith('https://'))) {
          boardButtons.push(
            new ButtonBuilder()
              .setLabel('Profil Tim (NSAC Web)')
              .setStyle(ButtonStyle.Link)
              .setURL(team.nsac_link)
          );
        }

        const boardRow = new ActionRowBuilder().addComponents(boardButtons);
        await boardMsg.edit({ components: [boardRow] }).catch(() => {});

        // Refresh welcome panel tim di channel tim agar tombol otomatis berubah menjadi "Tutup Rekrutmen"
        await TeamService.refreshTeamWelcomePanel(team.id, interaction.guild);

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.RECRUITMENT_POSTED,
          title: 'Rekrutmen Tim Dibuka',
          actorTag: interaction.user.tag,
          teamId: team.id,
          teamName: team.name,
          details: `Leader memposting rekrutmen tim "${team.name}" untuk ${slots} slot di channel <#${recruitChannel.id}>.`
        });

        return await interaction.editReply({
          embeds: [successEmbed(
            'Lowongan Rekrutmen Diposting',
            `Lowongan tim **${team.name}** berhasil diposting di <#${recruitChannel.id}>!\n\n` +
            `Peserta lain dapat melihat dan mengajukan permintaan bergabung. Jika ada yang mendaftar, kamu akan menerima notifikasi konfirmasi langsung via DM.`
          )]
        });
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
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
                'Dynamic Invite Link Berhasil Dibuat',
                `Link invite khusus untuk role **[${label}]** (${roleMentions}) berhasil dibuat:\n\n` +
                `**${invite.url}**\n` +
                `• Kode: \`${invite.code}\`\n` +
                `• Auto-Role: ${roleMentions}\n\n` +
                `*Setiap anggota yang bergabung menggunakan link ini akan langsung mendapatkan seluruh role tersebut.*`
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Staff Only', 'Unauthorized')] });
        }

        const selectedCode = interaction.values[0];
        await interaction.deferUpdate();

        try {
          await InviteService.deleteDynamicInvite(interaction.guild, selectedCode);
          await DashboardService.refreshInvitesPanel(interaction.guild);

          return await interaction.editReply({
            embeds: [
              successEmbed(
                'Link Invite Berhasil Dihapus',
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
          return await replyDismissable(interaction, { embeds: [errorEmbed('Not Found', 'Tim tidak ditemukan.')] });
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
          );
        }

        if (team.status === 'ACTIVE') {
          actionButtons.addComponents(
            new ButtonBuilder()
              .setCustomId(`team_panel_action_archive_${team.id}`)
              .setLabel('Arsipkan Tim')
              .setStyle(ButtonStyle.Secondary)
          );
        }

        actionButtons.addComponents(
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM}${team.id}`)
            .setLabel('Hapus Tim')
            .setStyle(ButtonStyle.Danger)
        );

        return await replyPermanent(interaction, {
          embeds: [embed],
          components: [actionButtons]
        });
      }

      // B. Member: Select Anggota Tim → show CONFIRMATION step (not register directly)
      if (
        interaction.customId === 'select_unreg_members' ||
        interaction.customId === 'select_team_members'
      ) {
        const selectedMemberIds = interaction.values;
        const sessionKey = `member_${interaction.user.id}`;

        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Sesi pendaftaran habis. Silakan mulai ulang dari awal.')], components: [] });
        }

        // Update session with selected members
        session.memberIds = selectedMemberIds;
        session.messageId = interaction.message.id;
        setSession(sessionKey, session);

        // Rebuild the dropdowns
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot || m.id === interaction.user.id) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const selectRow = buildMemberSelectRow({ eligibleMembers, min: minSelect, max: maxSelect });

        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: false });

        // Confirmation buttons row
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const updateComponents = [selectRow, challengeRow, confirmRow].filter(Boolean);
        return await interaction.update({
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: selectedMemberIds,
            step: 'confirm'
          })],
          components: updateComponents
        });
      }

      // B2. Member: Select Challenge Dropdown (during registration)
      if (interaction.customId === CUSTOM_IDS.SELECT_TEAM_CHALLENGE) {
        const selectedVal = interaction.values[0];
        const sessionKey = `member_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Sesi pendaftaran habis.')], components: [] });
        }

        if (selectedVal === 'none') {
          session.challengeId = null;
          session.challengeTitle = null;
        } else {
          const chId = parseInt(selectedVal, 10);
          const ch = await getChallengeById(chId);
          session.challengeId = ch ? ch.id : null;
          session.challengeTitle = ch ? ch.title : null;
        }
        setSession(sessionKey, session);

        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot || m.id === interaction.user.id) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const minSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const maxSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);
        const selectRow = buildMemberSelectRow({ eligibleMembers, min: minSelect, max: maxSelect });

        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: false });

        const isConfirmStep = session.memberIds && session.memberIds.length > 0;
        const buttonRow = isConfirmStep
          ? new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
            )
          : new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
            );

        const updateComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
        return await interaction.update({
          embeds: [buildMemberRegEmbed({
            userId: interaction.user.id,
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: session.memberIds || [],
            step: isConfirmStep ? 'confirm' : 'select_members'
          })],
          components: updateComponents
        });
      }

      // C. Staff: Select Anggota Tim → show CONFIRMATION step
      if (interaction.customId === 'select_staff_reg_members') {
        const selectedMemberIds = interaction.values;
        const sessionKey = `staff_${interaction.user.id}`;

        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Sesi pendaftaran habis. Silakan mulai ulang.')], components: [] });
        }

        // Update session
        session.memberIds = selectedMemberIds;
        session.messageId = interaction.message.id;
        setSession(sessionKey, session);

        // Rebuild dropdowns
        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const selectRow = buildMemberSelectRow({ eligibleMembers, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: true });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
        );

        const updateComponents = [selectRow, challengeRow, confirmRow].filter(Boolean);
        return await interaction.update({
          embeds: [buildStaffRegEmbed({
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: selectedMemberIds,
            step: 'confirm'
          })],
          components: updateComponents
        });
      }

      // C2. Staff: Select Challenge Dropdown (during registration)
      if (interaction.customId === CUSTOM_IDS.SELECT_STAFF_TEAM_CHALLENGE) {
        const selectedVal = interaction.values[0];
        const sessionKey = `staff_${interaction.user.id}`;
        const session = getSession(sessionKey);
        if (!session) {
          return await interaction.update({ embeds: [errorEmbed('Sesi Kadaluarsa', 'Sesi pendaftaran habis.')], components: [] });
        }

        if (selectedVal === 'none') {
          session.challengeId = null;
          session.challengeTitle = null;
        } else {
          const chId = parseInt(selectedVal, 10);
          const ch = await getChallengeById(chId);
          session.challengeId = ch ? ch.id : null;
          session.challengeTitle = ch ? ch.title : null;
        }
        setSession(sessionKey, session);

        await interaction.guild.members.fetch().catch(() => {});
        const filterRoleId = GuildConfigService.get('TEAM_MEMBER_SELECT_ROLE_ID') || GuildConfigService.get('NO_TEAM_ROLE_ID');
        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (filterRoleId && !m.roles.cache.has(filterRoleId)) return false;
          return true;
        });

        const selectRow = buildMemberSelectRow({ eligibleMembers, min: 1, max: env.MAX_TEAM_SIZE, isStaff: true });
        const challenges = await getAllChallenges();
        const challengeRow = buildChallengeSelectRow({ challenges, selectedChallengeId: session.challengeId, isStaff: true });

        const isConfirmStep = session.memberIds && session.memberIds.length > 0;
        const buttonRow = isConfirmStep
          ? new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CONFIRM).setLabel('Konfirmasi').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_RESELECT).setLabel('Pilih Ulang').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
            )
          : new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CREATE_SOLO).setLabel('Buat Tim Langsung').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CHANGE_NAME).setLabel('Ubah Nama Tim').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(CUSTOM_IDS.BTN_STAFF_REG_CANCEL).setLabel('Batal').setStyle(ButtonStyle.Danger)
            );

        const updateComponents = [selectRow, challengeRow, buttonRow].filter(Boolean);
        return await interaction.update({
          embeds: [buildStaffRegEmbed({
            teamName: session.teamName,
            nsacLink: session.nsacLink,
            challengeTitle: session.challengeTitle,
            memberIds: session.memberIds || [],
            step: isConfirmStep ? 'confirm' : 'select_members'
          })],
          components: updateComponents
        });
      }

      // D. Team Welcome Panel: Select Challenge (by leader in team channel)
      if (interaction.customId.startsWith(CUSTOM_IDS.SELECT_TEAM_PANEL_CHALLENGE)) {
        const teamIdStr = interaction.customId.replace(CUSTOM_IDS.SELECT_TEAM_PANEL_CHALLENGE, '');
        const teamId = parseInt(teamIdStr, 10);
        const selectedVal = interaction.values[0];
        const challengeId = selectedVal === 'none' ? null : parseInt(selectedVal, 10);

        await interaction.deferUpdate();
        const result = await TeamService.setTeamChallenge(teamId, challengeId, interaction.guild, interaction.client, interaction.user.tag);
        if (!result.success) {
          return await replyDismissable(interaction, {
            embeds: [errorEmbed('Gagal Memilih Challenge', result.error)]
          });
        }

        const chText = result.team.challenge_title ? `**${result.team.challenge_title}**` : '*(Belum memilih)*';
        return await replyDismissable(interaction, {
          embeds: [successEmbed('Challenge Diperbarui', `Challenge tim **${result.team.name}** berhasil diatur menjadi: ${chText}`)]
        });
      }

    }
  }
};

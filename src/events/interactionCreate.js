import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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
import { buildTeamPanelDashboard } from '../commands/admin/teamPanel.js';
import { validateTeamName } from '../utils/validators.js';
import { errorEmbed, successEmbed, infoEmbed, warningEmbed, teamInfoEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';

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
            embeds: [errorEmbed('Invalid Team Name', nameValidation.error)],
            flags: MessageFlags.Ephemeral
          });
        }

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

        await interaction.guild.members.fetch().catch(() => {});
        const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');

        const eligibleMembers = Array.from(interaction.guild.members.cache.values()).filter((m) => {
          if (m.user.bot) return false;
          if (m.id === interaction.user.id) return false;
          if (unregisteredRoleId && !m.roles.cache.has(unregisteredRoleId)) return false;
          return true;
        });

        const minMembersToSelect = Math.max(0, env.MIN_TEAM_SIZE - 1);
        const maxMembersToSelect = Math.max(1, env.MAX_TEAM_SIZE - 1);

        if (eligibleMembers.length === 0 && minMembersToSelect > 0) {
          return await interaction.reply({
            embeds: [
              errorEmbed(
                'Tidak Ada Anggota Tersedia',
                `❌ Tidak ditemukan anggota yang memenuhi syarat di server untuk diundang ke tim **${teamName}**.\n\n` +
                (unregisteredRoleId
                  ? 'Pastikan rekan tim Anda sudah bergabung ke server Discord ini dan memiliki role `@Unregistered`.'
                  : 'Pastikan rekan tim Anda sudah bergabung ke server Discord ini.')
              )
            ],
            flags: MessageFlags.Ephemeral
          });
        }

        const encodedName = encodeURIComponent(teamName);

        if (eligibleMembers.length > 0) {
          const selectOptions = eligibleMembers.slice(0, 25).map((m) => {
            const displayName = (m.displayName || m.user.username).substring(0, 100);
            const tag = `@${m.user.username}`.substring(0, 100);
            return new StringSelectMenuOptionBuilder()
              .setLabel(displayName)
              .setDescription(tag)
              .setValue(m.id)
              .setEmoji('👤');
          });

          const actualMax = Math.min(maxMembersToSelect, selectOptions.length);
          const actualMin = Math.min(minMembersToSelect, actualMax);

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_unreg_members_${encodedName}`)
            .setPlaceholder('Pilih anggota tim dari daftar di bawah')
            .setMinValues(actualMin === 0 ? 0 : 1)
            .setMaxValues(actualMax)
            .addOptions(selectOptions);

          const row = new ActionRowBuilder().addComponents(selectMenu);

          return await interaction.reply({
            embeds: [
              infoEmbed(
                `Pilih Anggota Tim: "${teamName}"`,
                `**Nama Tim:** \`${teamName}\`\n` +
                `**Team Leader:** <@${interaction.user.id}>\n\n` +
                `👉 Pilih antara **${actualMin} sampai ${actualMax}** anggota dari menu dropdown di bawah.\n` +
                (unregisteredRoleId ? `*(Hanya anggota berstatus **@Unregistered** yang ditampilkan)*` : '')
              )
            ],
            components: [row]
          });
        } else {
          const result = await TeamService.startRegistration({
            teamName,
            leaderMember: interaction.member,
            memberIds: [],
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel
          });

          if (!result.success) {
            return await interaction.reply({
              embeds: [errorEmbed('Gagal Registrasi', result.error)],
              flags: MessageFlags.Ephemeral
            });
          }

          await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);
          return await interaction.reply({
            embeds: [successEmbed('Tim Berhasil Dibuat!', `Tim **${teamName}** telah dibuat dan channels telah siap!`)]
          });
        }
      }
      return;
    }

    // ========================================================
    // 4. SELECT MENU ROUTER
    // ========================================================
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
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

      // B. Anggota Tim Dropdown
      if (
        interaction.customId.startsWith('select_unreg_members_') ||
        interaction.customId.startsWith('select_team_members_')
      ) {
        const rawName = interaction.customId
          .replace('select_unreg_members_', '')
          .replace('select_team_members_', '');
        const teamName = decodeURIComponent(rawName);
        const selectedMemberIds = interaction.values;

        await interaction.update({
          embeds: [infoEmbed('Memproses Pendaftaran...', `Sedang mendaftarkan tim **${teamName}** dan mengirim undangan...`)],
          components: []
        });

        try {
          const result = await TeamService.startRegistration({
            teamName,
            leaderMember: interaction.member,
            memberIds: selectedMemberIds,
            guild: interaction.guild,
            client: interaction.client,
            ticketChannel: interaction.channel
          });

          if (!result.success) {
            return await interaction.followUp({
              embeds: [errorEmbed('Pendaftaran Gagal', result.error)],
              flags: MessageFlags.Ephemeral
            });
          }

          if (result.pendingInvitations) {
            const unixExpiry = Math.floor(new Date(result.expiresAt).getTime() / 1000);
            const memberMentions = selectedMemberIds.map((id) => `<@${id}>`).join(', ');

            return await interaction.followUp({
              embeds: [
                successEmbed(
                  'Undangan Tim Terkirim',
                  `Tim **${teamName}** berhasil didaftarkan dalam status menunggu konfirmasi!\n\n` +
                  `📨 **Undangan dikirim ke:** ${memberMentions}\n` +
                  `⏱️ **Batas Waktu:** <t:${unixExpiry}:R>\n\n` +
                  `Setelah semua rekan tim menekan tombol **Accept**, role dan channel tim Anda akan otomatis dibuatkan oleh bot.`
                )
              ]
            });
          } else {
            await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);
            return await interaction.followUp({
              embeds: [
                successEmbed(
                  'Tim Berhasil Dibuat!',
                  `Tim **${teamName}** telah berhasil dibuat dan seluruh channel telah disiapkan!`
                )
              ]
            });
          }
        } catch (err) {
          logger.error(`[Registration Process Error] ${err.message}`);
          return await interaction.followUp({
            embeds: [errorEmbed('Error', `Gagal memproses pendaftaran: ${err.message}`)],
            flags: MessageFlags.Ephemeral
          });
        }
      }
    }
  }
};

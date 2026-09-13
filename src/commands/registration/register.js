import { SlashCommandBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { TicketService } from '../../services/ticketService.js';
import { AuditService } from '../../services/auditService.js';
import { upsertUser } from '../../database/queries/userQueries.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Hackathon registration commands for participants and teams')
    // ================= Subcommand: member =================
    .addSubcommand((sub) =>
      sub
        .setName('member')
        .setDescription('[Staff] Manually register a member (removes @Unregistered and assigns Participant roles)')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('The member to register')
            .setRequired(true)
        )
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Optional specific role to assign (defaults to Participant + No-Team)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('keep_unregistered')
            .setDescription('Keep the @Unregistered role instead of removing it (default: false)')
            .setRequired(false)
        )
    )
    // ================= Subcommand: team =================
    .addSubcommand((sub) =>
      sub
        .setName('team')
        .setDescription('Start a team registration ticket to register your hackathon team')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // ==========================================
    // 1. REGISTER TEAM SUBCOMMAND
    // ==========================================
    if (subcommand === 'team') {
      return await TicketService.createTeamRegistrationTicket(interaction);
    }

    // ==========================================
    // 2. REGISTER MEMBER SUBCOMMAND (Staff Only)
    // ==========================================
    if (subcommand === 'member') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!PermissionService.isStaff(interaction.member)) {
        return await interaction.editReply({
          embeds: [errorEmbed('Staff Only', 'Hanya staf atau admin yang dapat mendaftarkan role member secara manual.')]
        });
      }

      const targetUser = interaction.options.getUser('user');
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) {
        return await interaction.editReply({
          embeds: [errorEmbed('Member Tidak Ditemukan', `User <@${targetUser.id}> tidak ditemukan di dalam server ini.`)]
        });
      }

      const customRole = interaction.options.getRole('role');
      const keepUnregistered = interaction.options.getBoolean('keep_unregistered') || false;

      const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');
      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
      const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');

      // Determine roles to add
      const rolesToAdd = [];
      if (customRole) {
        rolesToAdd.push(customRole.id);
        // If custom role is the participant role, also assign no-team
        if (participantRoleId && customRole.id === participantRoleId && noTeamRoleId) {
          rolesToAdd.push(noTeamRoleId);
        }
      } else {
        if (!participantRoleId) {
          return await interaction.editReply({
            embeds: [errorEmbed('Konfigurasi Belum Lengkap', 'Role **Participant** belum diatur di sistem! Atur terlebih dahulu menggunakan `/setup config set key:PARTICIPANT_ROLE_ID`.')]
          });
        }
        rolesToAdd.push(participantRoleId);
        if (noTeamRoleId) {
          rolesToAdd.push(noTeamRoleId);
        }
      }

      // Filter out roles the member already has
      const rolesToApply = rolesToAdd.filter((rId) => !targetMember.roles.cache.has(rId));

      // Determine roles to remove (e.g. Unregistered)
      const rolesToRemove = [];
      if (!keepUnregistered && unregisteredRoleId && targetMember.roles.cache.has(unregisteredRoleId)) {
        rolesToRemove.push(unregisteredRoleId);
      }

      try {
        // 1. Remove unregistered role
        if (rolesToRemove.length > 0) {
          await targetMember.roles.remove(rolesToRemove, `Manual registration by staff ${interaction.user.tag}`);
        }

        // 2. Add target roles
        if (rolesToApply.length > 0) {
          await targetMember.roles.add(rolesToApply, `Manual registration by staff ${interaction.user.tag}`);
        }

        // 3. Upsert user in database
        const dbUser = await upsertUser(targetMember.id, targetMember.user.tag || targetMember.user.username);

        // 4. Log to AuditService
        const addedNames = rolesToAdd.map((id) => {
          const r = interaction.guild.roles.cache.get(id);
          return r ? `@${r.name}` : id;
        }).join(' + ');

        await AuditService.log(interaction.client, {
          action: AUDIT_ACTIONS.ROLE_ASSIGNED,
          title: 'Manual Member Registration via /register',
          actorId: interaction.user.id,
          targetUserId: dbUser.id,
          targetTag: targetMember.user.tag,
          details: `Staff ${interaction.user.tag} manually registered ${targetMember.user.tag}.\n` +
                   `• Roles Added: ${addedNames}\n` +
                   `• Roles Removed: ${rolesToRemove.length > 0 ? '@Unregistered' : 'None'}`
        });

        const addedMentions = rolesToAdd.map((id) => `<@&${id}>`).join(' + ');
        const removedMentions = rolesToRemove.map((id) => `<@&${id}>`).join(', ') || '*(Tidak ada)*';

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Registrasi Member Berhasil ✅',
              `Role member <@${targetMember.id}> telah berhasil diperbarui oleh <@${interaction.user.id}>!\n\n` +
              `➕ **Role Diberikan:** ${addedMentions}\n` +
              `➖ **Role Dicabut:** ${removedMentions}\n\n` +
              `*User telah tercatat aktif di database hackathon.*`
            )
          ]
        });
      } catch (err) {
        logger.error(`[/register member error] ${err.message}`);
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Memperbarui Role', `Terjadi kendala saat mengubah role member: ${err.message}\nPastikan posisi role bot berada di atas role yang ingin diberikan di server settings.`)]
        });
      }
    }
  }
};

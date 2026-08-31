import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { TeamService } from '../../services/teamService.js';
import { InvitationService } from '../../services/invitationService.js';
import { AuditService } from '../../services/auditService.js';
import {
  getTeamByName,
  getTeamById,
  updateTeamStatus
} from '../../database/queries/teamQueries.js';
import {
  getTeamMembers,
  getActiveTeamMembers,
  getUserActiveTeamByDiscordId
} from '../../database/queries/memberQueries.js';
import {
  getPendingInvitationsForTeam,
  cancelPendingInvitationsForTeam
} from '../../database/queries/invitationQueries.js';
import { getUserByDiscordId, upsertUser } from '../../database/queries/userQueries.js';
import { errorEmbed, successEmbed, teamInfoEmbed, warningEmbed } from '../../utils/embeds.js';
import { AUDIT_ACTIONS, CUSTOM_IDS, MEMBER_ROLE, MEMBER_STATUS, TEAM_STATUS } from '../../config/constants.js';
import { env } from '../../config/env.js';

export default {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Hackathon team management commands')
    // ================= User Subcommands =================
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('View team information and channels')
        .addStringOption((opt) => opt.setName('name').setDescription('Team name (leave empty for your own team)'))
        .addUserOption((opt) => opt.setName('user').setDescription('View team of a specific user'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('members')
        .setDescription('List all members of a team')
        .addStringOption((opt) => opt.setName('name').setDescription('Team name (leave empty for your own team)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Team Leader: Invite a new member to your team')
        .addUserOption((opt) => opt.setName('user').setDescription('User to invite').setRequired(true))
    )
    // ================= Staff Subcommands =================
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('[Staff] Manually create an active team')
        .addStringOption((opt) => opt.setName('name').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('leader').setDescription('Team leader').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('[Staff] Force-approve a pending team and provision resources')
        .addStringOption((opt) => opt.setName('name').setDescription('Pending team name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-member')
        .setDescription('[Staff] Add a member to an existing team')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User to add').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-member')
        .setDescription('[Staff] Remove a member from a team')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User to remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('[Staff] Rename a team and all its Discord resources')
        .addStringOption((opt) => opt.setName('team').setDescription('Current team name').setRequired(true))
        .addStringOption((opt) => opt.setName('new_name').setDescription('New team name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer-leader')
        .setDescription('[Staff] Transfer leadership of a team')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('new_leader').setDescription('New team leader').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('archive')
        .setDescription('[Staff] Archive a team and set channels to read-only')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('[Staff] Delete a team and its Discord channels/roles')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-add')
        .setDescription('[Staff Override] Force add user into team bypassing checks')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User to force add').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-remove')
        .setDescription('[Staff Override] Force remove user from team')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User to force remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('resend-invite')
        .setDescription('[Staff Override] Resend invitation to a member')
        .addStringOption((opt) => opt.setName('team').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('Invited user').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel-registration')
        .setDescription('[Staff Override] Cancel a pending team registration')
        .addStringOption((opt) => opt.setName('team').setDescription('Pending team name').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-register')
        .setDescription('[Staff Override] Instantly register and provision a team with members')
        .addStringOption((opt) => opt.setName('name').setDescription('Team name').setRequired(true))
        .addUserOption((opt) => opt.setName('leader').setDescription('Leader').setRequired(true))
        .addUserOption((opt) => opt.setName('member1').setDescription('Member 1').setRequired(false))
        .addUserOption((opt) => opt.setName('member2').setDescription('Member 2').setRequired(false))
        .addUserOption((opt) => opt.setName('member3').setDescription('Member 3').setRequired(false))
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const isStaffUser = PermissionService.isStaff(interaction.member);

    // ========================================================
    // 1. INFO SUBCOMMAND
    // ========================================================
    if (subcommand === 'info') {
      await interaction.deferReply();

      const nameInput = interaction.options.getString('name');
      const targetUser = interaction.options.getUser('user');

      let team = null;
      if (nameInput) {
        team = await getTeamByName(nameInput);
      } else if (targetUser) {
        team = await getUserActiveTeamByDiscordId(targetUser.id);
      } else {
        team = await getUserActiveTeamByDiscordId(interaction.user.id);
      }

      if (!team) {
        return await interaction.editReply({
          embeds: [errorEmbed('Team Not Found', 'Could not find the specified team or active membership.')]
        });
      }

      const members = await getTeamMembers(team.id);
      const embed = teamInfoEmbed(team, members);
      return await interaction.editReply({ embeds: [embed] });
    }

    // ========================================================
    // 2. MEMBERS SUBCOMMAND
    // ========================================================
    if (subcommand === 'members') {
      await interaction.deferReply();

      const nameInput = interaction.options.getString('name');
      let team = null;

      if (nameInput) {
        team = await getTeamByName(nameInput);
      } else {
        team = await getUserActiveTeamByDiscordId(interaction.user.id);
      }

      if (!team) {
        return await interaction.editReply({
          embeds: [errorEmbed('Team Not Found', 'Could not find the specified team.')]
        });
      }

      const members = await getActiveTeamMembers(team.id);
      const memberList = members.map((m, idx) => {
        const badge = m.role === 'LEADER' ? '👑 Leader' : '👤 Member';
        return `${idx + 1}. ${badge} - <@${m.discord_id}> (${m.username})`;
      }).join('\n') || 'No members';

      return await interaction.editReply({
        embeds: [successEmbed(`Team Members: ${team.name}`, memberList)]
      });
    }

    // ========================================================
    // 3. INVITE SUBCOMMAND (Leader Only)
    // ========================================================
    if (subcommand === 'invite') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('user');
      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
        return await interaction.editReply({
          embeds: [errorEmbed('Permission Denied', 'Only the Team Leader can invite new members.')]
        });
      }

      if (targetUser.id === interaction.user.id) {
        return await interaction.editReply({
          embeds: [errorEmbed('Invalid User', 'You cannot invite yourself.')]
        });
      }

      if (targetUser.bot) {
        return await interaction.editReply({
          embeds: [errorEmbed('Invalid User', 'You cannot invite a bot.')]
        });
      }

      // Check anti-double-team
      const targetTeam = await getUserActiveTeamByDiscordId(targetUser.id);
      if (targetTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Already Registered', `❌ <@${targetUser.id}> is already registered in another team (${targetTeam.name}).`)]
        });
      }

      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const leaderUser = await getUserByDiscordId(interaction.user.id);
      const invitedDbUser = await upsertUser(targetUser.id, targetUser.tag || targetUser.username);

      await InvitationService.createTeamInvitation({
        teamId: activeTeam.id,
        invitedUserId: invitedDbUser.id,
        invitedBy: leaderUser.id,
        expiresAt
      });

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember) {
        await InvitationService.sendInvitationMessage({
          guild: interaction.guild,
          team: activeTeam,
          leaderMember: interaction.member,
          targetMember,
          expiresAt
        });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Invitation Sent', `Invitation sent to <@${targetUser.id}>!`)]
      });
    }

    // ========================================================
    // ALL REMAINING SUBCOMMANDS REQUIRE STAFF ROLE
    // ========================================================
    if (!isStaffUser) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to execute this staff command.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // 4. CREATE (Staff Manual)
    if (subcommand === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const leader = interaction.options.getUser('leader');

      const leaderMember = await interaction.guild.members.fetch(leader.id).catch(() => null);
      if (!leaderMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'Leader is not in this server.')] });
      }

      const result = await TeamService.startRegistration({
        teamName: name,
        leaderMember,
        memberIds: [],
        guild: interaction.guild,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Failed', result.error)] });
      }

      await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

      return await interaction.editReply({
        embeds: [successEmbed('Team Created', `Team **${name}** created with leader <@${leader.id}>!`)]
      });
    }

    // 5. APPROVE (Staff Force Finalize)
    if (subcommand === 'approve') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const team = await getTeamByName(name);

      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${name}" not found.`)] });
      }

      try {
        await TeamService.finalizeTeamCreation(team.id, interaction.guild, interaction.client);
        return await interaction.editReply({
          embeds: [successEmbed('Team Approved', `Team **${team.name}** has been force-approved and channels provisioned.`)]
        });
      } catch (err) {
        return await interaction.editReply({ embeds: [errorEmbed('Approval Failed', err.message)] });
      }
    }

    // 6. ADD-MEMBER (Staff)
    if (subcommand === 'add-member' || subcommand === 'force-add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const result = await TeamService.addMemberToTeam(team.id, targetUser.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Failed', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Member Added', `Successfully added <@${targetUser.id}> to team **${team.name}**.`)]
      });
    }

    // 7. REMOVE-MEMBER (Staff)
    if (subcommand === 'remove-member' || subcommand === 'force-remove') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const result = await TeamService.removeMemberFromTeam(team.id, targetUser.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Failed', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Member Removed', `Successfully removed <@${targetUser.id}> from team **${team.name}**.`)]
      });
    }

    // 8. RENAME (Staff)
    if (subcommand === 'rename') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const newName = interaction.options.getString('new_name');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const result = await TeamService.renameTeam(team.id, newName, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Rename Failed', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Team Renamed', `Team **${result.oldName}** has been renamed to **${result.newName}**.`)]
      });
    }

    // 9. TRANSFER-LEADER (Staff)
    if (subcommand === 'transfer-leader') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const newLeader = interaction.options.getUser('new_leader');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const result = await TeamService.transferLeader(team.id, newLeader.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Failed', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Leader Transferred', `Leadership of team **${team.name}** transferred to <@${newLeader.id}>.`)]
      });
    }

    // 10. ARCHIVE (Staff)
    if (subcommand === 'archive') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      await TeamService.archiveTeam(team.id, interaction.guild, interaction.client, interaction.user.tag);

      return await interaction.editReply({
        embeds: [successEmbed('Team Archived', `Team **${team.name}** is now archived and channels are read-only.`)]
      });
    }

    // 11. DELETE (Staff Confirmation Prompt)
    if (subcommand === 'delete') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM}${team.id}`)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️'),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CANCEL}${team.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.editReply({
        embeds: [
          warningEmbed(
            'Confirm Team Deletion',
            `⚠️ Are you sure you want to permanently delete team **${team.name}**?\n\n` +
            'This action will:\n' +
            '• Delete the Discord role\n' +
            '• Delete the Category, Text, and Voice channels\n' +
            '• Mark team as DISBANDED in database\n' +
            '• Restore @Unregistered role to members'
          )
        ],
        components: [row]
      });
    }

    // 12. RESEND-INVITE (Staff)
    if (subcommand === 'resend-invite') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'User not in server.')] });
      }

      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const leaderMember = team.leader_discord_id ? await interaction.guild.members.fetch(team.leader_discord_id).catch(() => null) : interaction.member;

      await InvitationService.sendInvitationMessage({
        guild: interaction.guild,
        team,
        leaderMember: leaderMember || interaction.member,
        targetMember,
        expiresAt
      });

      return await interaction.editReply({
        embeds: [successEmbed('Invitation Resent', `Resent invitation for team **${team.name}** to <@${targetUser.id}>.`)]
      });
    }

    // 13. CANCEL-REGISTRATION (Staff)
    if (subcommand === 'cancel-registration') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Not Found', `Team "${teamName}" not found.`)] });
      }

      if (team.status !== TEAM_STATUS.PENDING) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', `Team "${team.name}" is not in PENDING status.`)] });
      }

      await cancelPendingInvitationsForTeam(team.id);
      await updateTeamStatus(team.id, TEAM_STATUS.DISBANDED);

      await AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.REGISTRATION_REJECTED,
        title: 'Registration Cancelled by Staff',
        actorTag: interaction.user.tag,
        teamId: team.id,
        teamName: team.name,
        details: `Pending registration for "${team.name}" cancelled.`
      });

      return await interaction.editReply({
        embeds: [successEmbed('Registration Cancelled', `Pending registration for **${team.name}** has been cancelled.`)]
      });
    }

    // 14. FORCE-REGISTER (Staff Instant Provisioning)
    if (subcommand === 'force-register') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const leader = interaction.options.getUser('leader');
      const member1 = interaction.options.getUser('member1');
      const member2 = interaction.options.getUser('member2');
      const member3 = interaction.options.getUser('member3');

      const memberIds = [member1, member2, member3].filter(Boolean).map((u) => u.id);

      const leaderMember = await interaction.guild.members.fetch(leader.id).catch(() => null);
      if (!leaderMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'Leader not found in server.')] });
      }

      const result = await TeamService.startRegistration({
        teamName: name,
        leaderMember,
        memberIds: [],
        guild: interaction.guild,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', result.error)] });
      }

      // Provision channels
      await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

      // Add extra members
      for (const mId of memberIds) {
        await TeamService.addMemberToTeam(result.team.id, mId, interaction.guild, interaction.client, interaction.user.tag);
      }

      return await interaction.editReply({
        embeds: [successEmbed('Team Force-Registered', `Team **${name}** created and activated with ${memberIds.length + 1} members!`)]
      });
    }
  }
};

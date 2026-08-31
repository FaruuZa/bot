import { env } from '../config/env.js';
import { AUDIT_ACTIONS, MEMBER_ROLE, MEMBER_STATUS, TEAM_STATUS, TICKET_TYPE } from '../config/constants.js';
import { withTransaction } from '../database/pool.js';
import { upsertUser, getUserByDiscordId } from '../database/queries/userQueries.js';
import { getActiveUserTicket, closeTicket } from '../database/queries/ticketQueries.js';
import {
  createTeam,
  getTeamById,
  getTeamByName,
  updateTeamDiscordResources,
  updateTeamStatus,
  updateTeamName,
  updateTeamLeader
} from '../database/queries/teamQueries.js';
import {
  addTeamMember,
  getTeamMembers,
  getActiveTeamMembers,
  getUserActiveTeamByDiscordId,
  updateMemberRole,
  removeTeamMember,
  countActiveTeamMembers
} from '../database/queries/memberQueries.js';
import { DiscordService } from './discordService.js';
import { AuditService } from './auditService.js';
import { InvitationService } from './invitationService.js';
import { validateTeamName, validateTeamSize } from '../utils/validators.js';
import { logger } from '../utils/logger.js';
import { successEmbed } from '../utils/embeds.js';

export class TeamService {
  /**
   * Validate potential team registration before creating
   */
  static async validateRegistration({ teamName, leaderMember, memberIds, guild }) {
    // 1. Validate team name
    const nameCheck = validateTeamName(teamName);
    if (!nameCheck.valid) {
      return { valid: false, error: nameCheck.error };
    }

    // Check name uniqueness
    const existingTeam = await getTeamByName(teamName);
    if (existingTeam) {
      return { valid: false, error: `A team named "${teamName}" already exists or is pending registration.` };
    }

    // 2. Validate team size
    // memberIds should not include leader
    const uniqueMemberIds = [...new Set(memberIds.filter((id) => id !== leaderMember.id))];
    const totalCount = uniqueMemberIds.length + 1; // +1 for leader

    const sizeCheck = validateTeamSize(totalCount);
    if (!sizeCheck.valid) {
      return { valid: false, error: sizeCheck.error };
    }

    // 3. Validate leader active status
    const leaderActiveTeam = await getUserActiveTeamByDiscordId(leaderMember.id);
    if (leaderActiveTeam) {
      return {
        valid: false,
        error: `You (<@${leaderMember.id}>) are already registered in team **${leaderActiveTeam.name}**.`
      };
    }

    // 4. Validate each member
    for (const memberId of uniqueMemberIds) {
      // Check in guild
      const member = await guild.members.fetch(memberId).catch(() => null);
      if (!member) {
        return {
          valid: false,
          error: `<@${memberId}> is not in this Discord server.`
        };
      }

      if (member.user.bot) {
        return {
          valid: false,
          error: `<@${memberId}> is a bot and cannot join a team.`
        };
      }

      // Check anti-double-team
      const memberActiveTeam = await getUserActiveTeamByDiscordId(memberId);
      if (memberActiveTeam) {
        return {
          valid: false,
          error: `❌ <@${memberId}> is already registered in another team (${memberActiveTeam.name}).`
        };
      }
    }

    return { valid: true, uniqueMemberIds };
  }

  /**
   * Register a new team with pending invitations
   */
  static async startRegistration({ teamName, leaderMember, memberIds, guild, client, ticketChannel = null }) {
    const validation = await this.validateRegistration({ teamName, leaderMember, memberIds, guild });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { uniqueMemberIds } = validation;

    // Run DB writes inside a transaction
    const { team, leaderUser, invitedUsers, expiresAt } = await withTransaction(async (dbClient) => {
      // 1. Ensure leader user record
      const leaderUser = await upsertUser(leaderMember.id, leaderMember.user.tag || leaderMember.user.username, dbClient);

      // 2. Create pending team
      const team = await createTeam({
        name: teamName,
        leaderId: leaderUser.id,
        status: TEAM_STATUS.PENDING
      }, dbClient);

      // 3. Add leader as member
      await addTeamMember({
        teamId: team.id,
        userId: leaderUser.id,
        role: MEMBER_ROLE.LEADER,
        status: MEMBER_STATUS.PENDING
      }, dbClient);

      // 4. Create invitations for members
      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const invitedUsers = [];

      for (const memberId of uniqueMemberIds) {
        const member = await guild.members.fetch(memberId);
        const memberUser = await upsertUser(member.id, member.user.tag || member.user.username, dbClient);
        invitedUsers.push({ user: memberUser, member });

        await InvitationService.createTeamInvitation({
          teamId: team.id,
          invitedUserId: memberUser.id,
          invitedBy: leaderUser.id,
          expiresAt,
          dbClient
        });
      }

      return { team, leaderUser, invitedUsers, expiresAt };
    });

    // If no other members needed (solo team if configured), create immediately
    if (uniqueMemberIds.length === 0) {
      return { success: true, team, pendingInvitations: false };
    }

    // 5. Dispatch DM invitations AFTER transaction committed so invitation rows exist in DB
    setImmediate(async () => {
      for (const { member } of invitedUsers) {
        await InvitationService.sendInvitationMessage({
          guild,
          team,
          leaderMember,
          targetMember: member,
          expiresAt
        });
      }
    });

    // 6. Audit Log AFTER transaction committed so team row exists in DB
    await AuditService.log(client, {
      action: AUDIT_ACTIONS.INVITATION_SENT,
      title: 'Team Registration Initiated',
      actorId: leaderUser.id,
      actorTag: leaderMember.user.tag,
      teamId: team.id,
      teamName: team.name,
      details: `Invited ${uniqueMemberIds.length} members for team "${team.name}".`
    });

    return {
      success: true,
      team,
      pendingInvitations: true,
      invitedCount: uniqueMemberIds.length,
      expiresAt
    };
  }

  /**
   * Finalize team creation once all members have accepted
   */
  static async finalizeTeamCreation(teamId, guild, client) {
    const team = await getTeamById(teamId);
    if (!team) {
      throw new Error(`Team with ID ${teamId} not found.`);
    }

    if (team.status === TEAM_STATUS.ACTIVE) {
      logger.warn(`[TeamService] Team ${team.name} is already ACTIVE.`);
      return team;
    }

    logger.info(`[TeamService] Finalizing creation for team "${team.name}" (ID: ${team.id})`);

    // 1. Provision Discord Resources (Role, Category, Text, Voice)
    const discordResources = await DiscordService.provisionTeamResources(guild, team.name);

    try {
      // 2. Update Database in Transaction
      await withTransaction(async (dbClient) => {
        // Update team resources & status
        await updateTeamDiscordResources(team.id, discordResources, dbClient);
        await updateTeamStatus(team.id, TEAM_STATUS.ACTIVE, dbClient);

        // Activate all team members in DB
        const members = await getTeamMembers(team.id, dbClient);
        for (const m of members) {
          await dbClient.query(
            `UPDATE team_members SET status = 'ACTIVE' WHERE team_id = $1 AND user_id = $2`,
            [team.id, m.user_id]
          );
        }
      });

      // 3. Assign Discord Roles to all members
      const activeMembers = await getActiveTeamMembers(team.id);
      for (const member of activeMembers) {
        await DiscordService.assignTeamMembershipRoles(guild, member.discord_id, discordResources.roleId);
      }

      // 4. Send Welcome Message to the new team text channel
      const textChannel = guild.channels.cache.get(discordResources.textChannelId);
      if (textChannel && textChannel.isTextBased()) {
        const welcomeEmbed = successEmbed(
          `Welcome to Team ${team.name}!`,
          `Congratulations! Your hackathon team workspace is ready.\n\n` +
          `**Team Leader:** <@${team.leader_discord_id}>\n` +
          `**Members:** ${activeMembers.map((m) => `<@${m.discord_id}>`).join(', ')}\n\n` +
          `Use this category and channels for your team collaboration during the hackathon. Good luck!`
        );
        await textChannel.send({
          content: activeMembers.map((m) => `<@${m.discord_id}>`).join(' '),
          embeds: [welcomeEmbed]
        }).catch(() => {});
      }

      // 5. Automatically close and delete registration ticket channel
      try {
        const leaderTicket = await getActiveUserTicket(team.leader_id, TICKET_TYPE.TEAM_REGISTRATION);
        if (leaderTicket) {
          await closeTicket(leaderTicket.discord_channel_id).catch(() => {});
          const ticketChannel = guild.channels.cache.get(leaderTicket.discord_channel_id) || await guild.channels.fetch(leaderTicket.discord_channel_id).catch(() => null);
          if (ticketChannel && ticketChannel.isTextBased()) {
            await ticketChannel.send({
              embeds: [
                successEmbed(
                  'Pendaftaran Selesai & Tim Aktif!',
                  `🎉 Selamat! Seluruh anggota telah mengonfirmasi dan tim **${team.name}** telah resmi dibuat.\n\n` +
                  `💬 Text Channel: <#${discordResources.textChannelId}>\n` +
                  `🔊 Voice Channel: <#${discordResources.voiceChannelId}>\n\n` +
                  `*Channel tiket pendaftaran ini akan otomatis ditutup dan dihapus dalam 5 detik.*`
                )
              ]
            }).catch(() => {});

            setTimeout(async () => {
              await ticketChannel.delete('Registration ticket auto-closed after team creation').catch(() => {});
            }, 5000);
          }
        }
      } catch (err) {
        logger.warn(`[TeamService] Could not auto-close registration ticket: ${err.message}`);
      }

      // 6. Audit Log
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAM_CREATED,
        title: 'Team Created Successfully',
        teamId: team.id,
        teamName: team.name,
        actorTag: team.leader_username,
        details: `Team "${team.name}" activated with ${activeMembers.length} members.`
      });

      return team;
    } catch (error) {
      logger.error(`[TeamService] Failed to finalize team "${team.name}": ${error.message}`);
      // Clean up Discord resources if DB update fails
      await DiscordService.deleteTeamResources(guild, discordResources).catch(() => {});
      throw error;
    }
  }

  /**
   * Add a member to an existing active team
   */
  static async addMemberToTeam(teamId, memberDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    const currentCount = await countActiveTeamMembers(teamId);
    if (currentCount >= env.MAX_TEAM_SIZE) {
      return { success: false, error: `Team is already full (${currentCount}/${env.MAX_TEAM_SIZE}).` };
    }

    const memberActiveTeam = await getUserActiveTeamByDiscordId(memberDiscordId);
    if (memberActiveTeam) {
      return { success: false, error: `User <@${memberDiscordId}> is already in team "${memberActiveTeam.name}".` };
    }

    const guildMember = await guild.members.fetch(memberDiscordId).catch(() => null);
    if (!guildMember) return { success: false, error: 'User is not in this Discord server.' };

    const user = await upsertUser(memberDiscordId, guildMember.user.tag || guildMember.user.username);
    await addTeamMember({
      teamId: team.id,
      userId: user.id,
      role: MEMBER_ROLE.MEMBER,
      status: MEMBER_STATUS.ACTIVE
    });

    if (team.role_id) {
      await DiscordService.assignTeamMembershipRoles(guild, memberDiscordId, team.role_id);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_ADDED,
      title: 'Member Added to Team',
      actorTag,
      targetUserId: user.id,
      targetTag: guildMember.user.tag,
      teamId: team.id,
      teamName: team.name,
      details: `<@${memberDiscordId}> was added to team "${team.name}".`
    });

    return { success: true, team, user };
  }

  /**
   * Remove a member from an active team
   */
  static async removeMemberFromTeam(teamId, memberDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    const user = await getUserByDiscordId(memberDiscordId);
    if (!user) return { success: false, error: 'User record not found.' };

    if (team.leader_id === user.id) {
      return {
        success: false,
        error: 'Cannot remove the Team Leader. Transfer leadership to another member first.'
      };
    }

    await removeTeamMember(team.id, user.id);

    if (team.role_id) {
      await DiscordService.removeTeamMembershipRoles(guild, memberDiscordId, team.role_id, true);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      title: 'Member Removed from Team',
      actorTag,
      targetUserId: user.id,
      targetTag: user.username,
      teamId: team.id,
      teamName: team.name,
      details: `<@${memberDiscordId}> was removed from team "${team.name}".`
    });

    return { success: true, team, user };
  }

  /**
   * Transfer leadership of a team
   */
  static async transferLeader(teamId, newLeaderDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    const newLeaderUser = await getUserByDiscordId(newLeaderDiscordId);
    if (!newLeaderUser) return { success: false, error: 'User record not found.' };

    const members = await getActiveTeamMembers(team.id);
    const isMember = members.some((m) => m.user_id === newLeaderUser.id);
    if (!isMember) {
      return { success: false, error: `<@${newLeaderDiscordId}> is not an active member of this team.` };
    }

    await withTransaction(async (dbClient) => {
      // Demote current leader to member
      if (team.leader_id) {
        await updateMemberRole(team.id, team.leader_id, MEMBER_ROLE.MEMBER, dbClient);
      }
      // Promote new leader
      await updateMemberRole(team.id, newLeaderUser.id, MEMBER_ROLE.LEADER, dbClient);
      // Update team record
      await updateTeamLeader(team.id, newLeaderUser.id, dbClient);
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.LEADER_TRANSFERRED,
      title: 'Leader Transferred',
      actorTag,
      targetUserId: newLeaderUser.id,
      targetTag: newLeaderUser.username,
      teamId: team.id,
      teamName: team.name,
      details: `Leadership of team "${team.name}" transferred to <@${newLeaderDiscordId}>.`
    });

    return { success: true, team, newLeaderUser };
  }

  /**
   * Rename a team
   */
  static async renameTeam(teamId, newName, guild, client, actorTag) {
    const nameCheck = validateTeamName(newName);
    if (!nameCheck.valid) return { success: false, error: nameCheck.error };

    const existing = await getTeamByName(newName);
    if (existing && existing.id !== teamId) {
      return { success: false, error: `A team named "${newName}" already exists.` };
    }

    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    const oldName = team.name;
    await updateTeamName(team.id, newName);

    // Update Discord resources
    await DiscordService.renameTeamResources(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id,
      newName
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_RENAMED,
      title: 'Team Renamed',
      actorTag,
      teamId: team.id,
      teamName: newName,
      details: `Team renamed from "${oldName}" to "${newName}".`
    });

    return { success: true, oldName, newName };
  }

  /**
   * Archive a team (read-only)
   */
  static async archiveTeam(teamId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    await updateTeamStatus(team.id, TEAM_STATUS.ARCHIVED);

    await DiscordService.archiveTeamChannels(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_ARCHIVED,
      title: 'Team Archived',
      actorTag,
      teamId: team.id,
      teamName: team.name,
      details: `Team "${team.name}" was archived.`
    });

    return { success: true, team };
  }

  /**
   * Delete a team
   */
  static async deleteTeam(teamId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Team not found.' };

    // Get list of members before removing records
    const members = await getTeamMembers(team.id);

    // 1. Delete Discord Resources (Role, Category, Text, Voice)
    await DiscordService.deleteTeamResources(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id
    });

    // 2. Update DB status to DISBANDED and remove members
    await withTransaction(async (dbClient) => {
      await updateTeamStatus(team.id, TEAM_STATUS.DISBANDED, dbClient);
      await dbClient.query(
        `UPDATE team_members SET status = 'REMOVED', removed_at = NOW() WHERE team_id = $1`,
        [team.id]
      );
    });

    // 3. Remove Participant role & restore Unregistered role for all former members
    for (const m of members) {
      await DiscordService.removeTeamMembershipRoles(guild, m.discord_id, team.role_id, true);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_DELETED,
      title: 'Team Deleted',
      actorTag,
      teamId: team.id,
      teamName: team.name,
      details: `Team "${team.name}" and its Discord channels/roles were deleted. All members were returned to @Unregistered.`
    });

    return { success: true, team };
  }
}

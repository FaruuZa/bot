import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { CUSTOM_IDS, INVITATION_STATUS, MEMBER_ROLE, MEMBER_STATUS, AUDIT_ACTIONS, TEAM_STATUS } from '../config/constants.js';
import {
  createInvitation,
  getInvitationById,
  getPendingInvitationsForTeam,
  updateInvitationStatus,
  markExpiredInvitations
} from '../database/queries/invitationQueries.js';
import { addTeamMember, getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { getTeamById, updateTeamStatus } from '../database/queries/teamQueries.js';
import { getUserByDiscordId } from '../database/queries/userQueries.js';
import { invitationEmbed, successEmbed, errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { AuditService } from './auditService.js';

export class InvitationService {
  /**
   * Create an invitation record in the database
   */
  static async createTeamInvitation({ teamId, invitedUserId, invitedBy, expiresAt, dbClient }) {
    return await createInvitation({
      teamId,
      invitedUserId,
      invitedBy,
      expiresAt
    }, dbClient);
  }

  /**
   * Send the interactive DM/Message invitation to a user
   */
  static async sendInvitationMessage({ guild, team, leaderMember, targetMember, expiresAt }) {
    const embed = invitationEmbed(team.name, leaderMember.user.tag, expiresAt);

    // Get the invitation ID from DB
    const user = await getUserByDiscordId(targetMember.id);
    if (!user) return;

    const pending = await getPendingInvitationsForTeam(team.id);
    const invite = pending.find((i) => i.invited_user_id === user.id);
    if (!invite) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.BTN_INVITE_ACCEPT}${invite.id}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.BTN_INVITE_DECLINE}${invite.id}`)
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✖️')
    );

    // Attempt to DM the user; if DMs are closed, notify in registration channel or log
    try {
      await targetMember.send({ embeds: [embed], components: [row] });
      logger.info(`[InvitationService] Sent invitation DM to ${targetMember.user.tag} for team "${team.name}"`);
    } catch (err) {
      logger.warn(`[InvitationService] Could not DM user ${targetMember.user.tag}: ${err.message}.`);
    }
  }

  /**
   * Handle member clicking 'Accept' button
   */
  static async handleAccept(interaction, invitationId, teamService) {
    const invite = await getInvitationById(invitationId);
    if (!invite) {
      return await interaction.reply({
        embeds: [errorEmbed('Invitation Not Found', 'This invitation does not exist or has already been removed.')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (invite.status !== INVITATION_STATUS.PENDING) {
      return await interaction.reply({
        embeds: [errorEmbed('Invalid Invitation', `This invitation is already **${invite.status}**.`)],
        flags: MessageFlags.Ephemeral
      });
    }

    if (new Date(invite.expires_at) <= new Date()) {
      await updateInvitationStatus(invite.id, INVITATION_STATUS.EXPIRED);
      return await interaction.reply({
        embeds: [errorEmbed('Invitation Expired', 'This invitation has expired.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // Verify button clicker is the invited user
    if (interaction.user.id !== invite.invited_discord_id) {
      return await interaction.reply({
        embeds: [errorEmbed('Unauthorized', 'This invitation was not sent to you.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // Anti-double-team check
    const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
    if (activeTeam) {
      return await interaction.reply({
        embeds: [errorEmbed('Already in a Team', `❌ You are already registered in team **${activeTeam.name}**.`)],
        flags: MessageFlags.Ephemeral
      });
    }

    // 1. Mark invitation ACCEPTED
    await updateInvitationStatus(invite.id, INVITATION_STATUS.ACCEPTED);

    // 2. Add member record (PENDING until all accept, or will be activated upon finalization)
    await addTeamMember({
      teamId: invite.team_id,
      userId: invite.invited_user_id,
      role: MEMBER_ROLE.MEMBER,
      status: MEMBER_STATUS.PENDING
    });

    await interaction.update({
      embeds: [successEmbed('Invitation Accepted!', `✅ Kamu telah bergabung ke tim **${invite.team_name}**!\n\nMenunggu seluruh anggota lain menerima undangan, setelah itu channel tim akan dibuat secara otomatis.`)],
      components: []
    });

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
      title: 'Invitation Accepted',
      actorTag: interaction.user.tag,
      teamId: invite.team_id,
      teamName: invite.team_name,
      details: `<@${interaction.user.id}> accepted invitation to join team "${invite.team_name}".`
    });

    // 3. Check if all invitations are now accepted
    const remainingPending = await getPendingInvitationsForTeam(invite.team_id);
    if (remainingPending.length === 0) {
      // All accepted! Fetch guild (interaction is in DM so interaction.guild is null)
      try {
        const { env } = await import('../config/env.js');
        const guild = interaction.guild ?? await interaction.client.guilds.fetch(env.GUILD_ID).catch(() => null);
        if (!guild) {
          logger.error(`[InvitationService] Could not fetch guild (GUILD_ID: ${env.GUILD_ID}) to finalize team.`);
          return;
        }
        await teamService.finalizeTeamCreation(invite.team_id, guild, interaction.client);
      } catch (err) {
        logger.error(`[InvitationService] Failed to finalize team after all invites accepted: ${err.stack || err.message}`);
      }
    }
  }

  /**
   * Handle member clicking 'Decline' button
   */
  static async handleDecline(interaction, invitationId) {
    const invite = await getInvitationById(invitationId);
    if (!invite) {
      return await interaction.reply({
        embeds: [errorEmbed('Invitation Not Found', 'This invitation does not exist.')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== invite.invited_discord_id) {
      return await interaction.reply({
        embeds: [errorEmbed('Unauthorized', 'This invitation was not sent to you.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await updateInvitationStatus(invite.id, INVITATION_STATUS.DECLINED);

    await interaction.update({
      embeds: [errorEmbed('Invitation Declined', `You declined the invitation to join **${invite.team_name}**.`)]
      ,
      components: []
    });

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.INVITATION_DECLINED,
      title: 'Invitation Declined',
      actorTag: interaction.user.tag,
      teamId: invite.team_id,
      teamName: invite.team_name,
      details: `<@${interaction.user.id}> declined invitation for team "${invite.team_name}".`
    });
  }

  /**
   * Background sweeper to expire stale invitations
   */
  static startExpirationSweeper(client) {
    logger.info('[InvitationService] Starting background invitation expiration sweeper (5m interval).');

    setInterval(async () => {
      try {
        const expired = await markExpiredInvitations();
        if (expired.length > 0) {
          logger.info(`[InvitationService] Swept and expired ${expired.length} pending invitations.`);
        }
      } catch (err) {
        logger.error(`[InvitationService Sweeper Error] ${err.message}`);
      }
    }, 5 * 60 * 1000);
  }
}

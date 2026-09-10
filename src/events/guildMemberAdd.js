import { Events } from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { upsertUser } from '../database/queries/userQueries.js';
import { DiscordService } from '../services/discordService.js';
import { AuditService } from '../services/auditService.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { InviteService } from '../services/inviteService.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    logger.info(`[Member Join] User joined: ${member.user.tag} (${member.id})`);

    try {
      // Upsert user in database
      const user = await upsertUser(member.id, member.user.tag || member.user.username);

      // Check if user is already an active member of a team (rejoin case)
      const activeTeam = await getUserActiveTeamByDiscordId(member.id);

      if (activeTeam && activeTeam.status === 'ACTIVE') {
        logger.info(`[Member Rejoin] Restoring team membership for ${member.user.tag} in team "${activeTeam.name}"`);
        await DiscordService.assignTeamMembershipRoles(member.guild, member.id, activeTeam.role_id);

        await AuditService.log(member.client, {
          action: AUDIT_ACTIONS.ROLE_RESTORED,
          title: 'Membership Restored on Rejoin',
          targetUserId: user.id,
          targetTag: member.user.tag,
          teamId: activeTeam.id,
          teamName: activeTeam.name,
          details: `User rejoined server and roles for team "${activeTeam.name}" were restored.`
        });
      } else {
        // Check if member joined via participant invite link
        const usedInvite = await InviteService.findUsedInvite(member);
        const participantInviteCode = GuildConfigService.get('PARTICIPANT_INVITE_CODE');
        const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
        const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');
        const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');

        const isParticipantInvite = Boolean(
          usedInvite &&
          participantInviteCode &&
          usedInvite.code.toLowerCase() === participantInviteCode.toLowerCase()
        );

        if (isParticipantInvite && participantRoleId) {
          // Participant join: assign identity role (@Participant) + status role (@No-Team)
          const rolesToAdd = [];
          if (!member.roles.cache.has(participantRoleId)) rolesToAdd.push(participantRoleId);
          if (noTeamRoleId && !member.roles.cache.has(noTeamRoleId)) rolesToAdd.push(noTeamRoleId);

          if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, 'Auto-assigned @Participant + @No-Team via Participant Invite Link').catch((err) => {
              logger.warn(`[Member Join Warning] Could not assign Participant/No-Team roles: ${err.message}`);
            });
          }
          logger.info(`[Member Join] Assigned @Participant + @No-Team to ${member.user.tag} (Invite: ${usedInvite.code})`);

          await AuditService.log(member.client, {
            action: AUDIT_ACTIONS.ROLE_ASSIGNED,
            title: 'Participant Role Assigned via Invite Link',
            targetUserId: user.id,
            targetTag: member.user.tag,
            details: `User joined using participant invite link (\`${usedInvite.code}\`) and was automatically assigned @Participant + @No-Team.`
          });
        } else if (unregisteredRoleId) {
          // Non-participant join: assign @Unregistered
          await member.roles.add(unregisteredRoleId, 'Assigned Unregistered role on join').catch((err) => {
            logger.warn(`[Member Join Warning] Could not assign Unregistered role: ${err.message}`);
          });
          logger.info(`[Member Join] Assigned @Unregistered to ${member.user.tag}`);
        }
      }
    } catch (error) {
      logger.error(`[Member Join Error] Failed to process ${member.user.tag}: ${error.message}`);
    }
  }
};

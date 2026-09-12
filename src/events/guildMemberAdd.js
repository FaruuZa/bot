import { Events } from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { upsertUser } from '../database/queries/userQueries.js';
import { getInviteRoleByCode } from '../database/queries/inviteQueries.js';
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
        // Detect used invite
        const usedInvite = await InviteService.findUsedInvite(member);
        const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
        const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');
        const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');
        const legacyParticipantCode = GuildConfigService.get('PARTICIPANT_INVITE_CODE');

        let assignedRoleName = null;

        if (usedInvite) {
          // Check dynamic invite in database
          const dynamicInvite = await getInviteRoleByCode(usedInvite.code);

          if (dynamicInvite) {
            const rolesToAdd = [];
            if (!member.roles.cache.has(dynamicInvite.role_id)) {
              rolesToAdd.push(dynamicInvite.role_id);
            }

            // If the assigned role is the Participant role, also assign No-Team role
            if (participantRoleId && dynamicInvite.role_id === participantRoleId) {
              if (noTeamRoleId && !member.roles.cache.has(noTeamRoleId)) {
                rolesToAdd.push(noTeamRoleId);
              }
            }

            if (rolesToAdd.length > 0) {
              await member.roles.add(rolesToAdd, `Auto-assigned via dynamic invite (${usedInvite.code})`).catch((err) => {
                logger.warn(`[Member Join Warning] Could not assign dynamic invite role: ${err.message}`);
              });
            }

            const targetRole = member.guild.roles.cache.get(dynamicInvite.role_id);
            assignedRoleName = targetRole ? targetRole.name : (dynamicInvite.label || 'Role');

            logger.info(`[Member Join] Assigned @${assignedRoleName} to ${member.user.tag} (Invite: ${usedInvite.code})`);

            await AuditService.log(member.client, {
              action: AUDIT_ACTIONS.ROLE_ASSIGNED,
              title: 'Dynamic Invite Role Assigned',
              targetUserId: user.id,
              targetTag: member.user.tag,
              details: `User joined using dynamic invite link (\`${usedInvite.code}\`) and was automatically assigned @${assignedRoleName}${dynamicInvite.role_id === participantRoleId && noTeamRoleId ? ' + @No-Team' : ''}.`
            });
          } else if (
            legacyParticipantCode &&
            usedInvite.code.toLowerCase() === legacyParticipantCode.toLowerCase() &&
            participantRoleId
          ) {
            // Legacy participant fallback
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
            assignedRoleName = 'Participant';
          }
        }

        // If no configured invite was matched, assign @Unregistered (if configured)
        if (!assignedRoleName && unregisteredRoleId) {
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


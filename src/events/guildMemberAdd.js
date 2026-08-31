import { Events } from 'discord.js';
import { env } from '../config/env.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';
import { upsertUser } from '../database/queries/userQueries.js';
import { DiscordService } from '../services/discordService.js';
import { AuditService } from '../services/auditService.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

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
        // Assign Unregistered role
        if (env.UNREGISTERED_ROLE_ID) {
          await member.roles.add(env.UNREGISTERED_ROLE_ID, 'Assigned Unregistered role on join');
          logger.info(`[Member Join] Assigned @Unregistered to ${member.user.tag}`);
        }
      }
    } catch (error) {
      logger.error(`[Member Join Error] Failed to process ${member.user.tag}: ${error.message}`);
    }
  }
};

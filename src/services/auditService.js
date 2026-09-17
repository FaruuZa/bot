import { GuildConfigService } from './guildConfigService.js';
import { createAuditLog } from '../database/queries/auditQueries.js';
import { auditLogEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

export class AuditService {
  /**
   * Log an activity to PostgreSQL and Discord #bot-log channel
   * @param {import('discord.js').Client} client 
   * @param {object} options
   * @param {string} options.action
   * @param {string} [options.title]
   * @param {number} [options.actorId]
   * @param {string} [options.actorTag]
   * @param {number} [options.targetUserId]
   * @param {string} [options.targetTag]
   * @param {number} [options.teamId]
   * @param {string} [options.teamName]
   * @param {object|string} [options.details]
   */
  static async log(client, {
    action,
    title,
    actorId = null,
    actorTag = null,
    targetUserId = null,
    targetTag = null,
    teamId = null,
    teamName = null,
    details = {}
  }) {
    const safeAction = action || 'GENERAL_LOG';

    // 1. Console Log
    logger.info(`[AUDIT: ${safeAction}] ${title || ''} Team: ${teamName || 'N/A'}, Actor: ${actorTag || 'N/A'}`);

    // 2. PostgreSQL Insert
    try {
      let safeActorId = null;
      let actorDiscordId = null;
      if (typeof actorId === 'number' && Number.isInteger(actorId) && actorId > 0 && actorId <= 2147483647) {
        safeActorId = actorId;
      } else if (typeof actorId === 'string') {
        if (/^\d{1,9}$/.test(actorId)) {
          safeActorId = parseInt(actorId, 10);
        } else {
          actorDiscordId = actorId;
        }
      }

      let safeTargetUserId = null;
      let targetDiscordId = null;
      if (typeof targetUserId === 'number' && Number.isInteger(targetUserId) && targetUserId > 0 && targetUserId <= 2147483647) {
        safeTargetUserId = targetUserId;
      } else if (typeof targetUserId === 'string') {
        if (/^\d{1,9}$/.test(targetUserId)) {
          safeTargetUserId = parseInt(targetUserId, 10);
        } else {
          targetDiscordId = targetUserId;
        }
      }

      let safeTeamId = null;
      if (typeof teamId === 'number' && Number.isInteger(teamId) && teamId > 0 && teamId <= 2147483647) {
        safeTeamId = teamId;
      } else if (typeof teamId === 'string' && /^\d{1,9}$/.test(teamId)) {
        safeTeamId = parseInt(teamId, 10);
      }

      await createAuditLog({
        action: safeAction,
        actorId: safeActorId,
        targetUserId: safeTargetUserId,
        teamId: safeTeamId,
        metadata: {
          title,
          actorTag,
          targetTag,
          actorDiscordId: actorDiscordId || undefined,
          targetDiscordId: targetDiscordId || undefined,
          teamName,
          details
        }
      });
    } catch (err) {
      logger.error(`[AuditService DB Error] Failed to persist audit log: ${err.message}`);
    }

    // 3. Discord Log Channel
    const logChannelId = GuildConfigService.get('LOG_CHANNEL_ID');
    if (!logChannelId || !client) return;

    try {
      const channel = await client.channels.fetch(logChannelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        const embed = auditLogEmbed({
          title: title || action.replace(/_/g, ' '),
          action,
          actor: actorTag,
          target: targetTag,
          team: teamName,
          details
        });
        await channel.send({ embeds: [embed] }).catch((err) => {
          logger.warn(`[AuditService Discord Error] Could not send to log channel: ${err.message}`);
        });
      }
    } catch (error) {
      logger.error(`[AuditService Channel Error] ${error.message}`);
    }
  }
}

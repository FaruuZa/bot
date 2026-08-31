import { env } from '../config/env.js';
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
    // 1. Console Log
    logger.info(`[AUDIT: ${action}] ${title || ''} Team: ${teamName || 'N/A'}, Actor: ${actorTag || 'N/A'}`);

    // 2. PostgreSQL Insert
    try {
      await createAuditLog({
        action,
        actorId,
        targetUserId,
        teamId,
        metadata: {
          title,
          actorTag,
          targetTag,
          teamName,
          details
        }
      });
    } catch (err) {
      logger.error(`[AuditService DB Error] Failed to persist audit log: ${err.message}`);
    }

    // 3. Discord Log Channel
    if (!env.LOG_CHANNEL_ID || !client) return;

    try {
      const channel = await client.channels.fetch(env.LOG_CHANNEL_ID).catch(() => null);
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

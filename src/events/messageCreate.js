import { Events } from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || !message.channel) return;

    try {
      const dashboardChannelId = GuildConfigService.get('DASHBOARD_CHANNEL_ID');
      if (!dashboardChannelId || message.channelId !== dashboardChannelId) {
        return;
      }

      // Check if message is one of the persistent panel embeds
      const overviewId = GuildConfigService.get('DASHBOARD_OVERVIEW_MSG_ID') || GuildConfigService.get('DASHBOARD_MESSAGE_ID');
      const rolesId = GuildConfigService.get('DASHBOARD_ROLES_MSG_ID');
      const invitesId = GuildConfigService.get('DASHBOARD_INVITES_MSG_ID');
      const panelIds = new Set([overviewId, rolesId, invitesId].filter(Boolean));

      if (panelIds.has(message.id)) {
        return; // Don't delete dashboard panel embeds
      }

      // Auto-delete any extraneous messages in the dashboard channel to prevent clutter
      const delayMs = message.author.bot ? 5000 : 2500;
      setTimeout(async () => {
        try {
          await message.delete();
          logger.info(`[Auto-Clean] Deleted extraneous message (${message.id}) from #${message.channel.name}`);
        } catch {
          // Message might already be deleted
        }
      }, delayMs);
    } catch (err) {
      logger.warn(`[MessageCreate Auto-Clean Error] ${err.message}`);
    }
  }
};

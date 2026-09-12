import { Events } from 'discord.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { DashboardService } from '../services/dashboardService.js';
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

      // 1. Immediately check if message is a registered panel message ID
      if (DashboardService.isPanelMessage(message.id)) {
        return;
      }

      // 2. If it is sent by the bot and contains our dashboard title, register and protect it
      if (message.author.id === message.client.user.id && message.embeds?.length > 0) {
        const title = message.embeds[0]?.title || '';
        if (title.includes('NSAC Admin Dashboard')) {
          DashboardService.registerPanelMessageId(message.id);
          return;
        }
      }

      // 3. Extraneous message detected -> schedule deletion
      const delayMs = message.author.bot ? 5000 : 2000;
      setTimeout(async () => {
        try {
          // Re-check before deletion to ensure message was not registered as a panel in the meantime
          if (DashboardService.isPanelMessage(message.id)) {
            return;
          }

          if (message.author.id === message.client.user.id && message.embeds?.length > 0) {
            const title = message.embeds[0]?.title || '';
            if (title.includes('NSAC Admin Dashboard')) {
              DashboardService.registerPanelMessageId(message.id);
              return;
            }
          }

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

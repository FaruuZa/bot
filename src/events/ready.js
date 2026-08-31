import { ActivityType, Events } from 'discord.js';
import { runMigrations } from '../database/migrate.js';
import { deployCommands } from '../deploy-commands.js';
import { InvitationService } from '../services/invitationService.js';
import { GuildConfigService } from '../services/guildConfigService.js';
import { markExpiredInvitations } from '../database/queries/invitationQueries.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`=================================================`);
    logger.info(`Logged in as: ${client.user.tag} (ID: ${client.user.id})`);
    logger.info(`Connected to ${client.guilds.cache.size} guild(s)`);
    logger.info(`=================================================`);

    // 1. Run database migrations / verify connection
    try {
      await runMigrations();
      logger.success('[Startup] PostgreSQL connection and schema verified.');
    } catch (err) {
      logger.error(`[Startup Error] Database initialization failed: ${err.message}`);
    }

    // 2. Preload dynamic guild configuration from database
    try {
      await GuildConfigService.loadAll();
    } catch (err) {
      logger.error(`[Startup Error] Failed to load guild configs: ${err.message}`);
    }

    // 3. Auto-register slash commands to Discord
    try {
      await deployCommands();
    } catch (err) {
      logger.warn(`[Startup Warning] Failed to auto-deploy commands: ${err.message}`);
    }

    // 4. Clean up expired invitations on startup
    try {
      const expired = await markExpiredInvitations();
      if (expired.length > 0) {
        logger.info(`[Startup Recovery] Marked ${expired.length} stale invitations as EXPIRED.`);
      }
    } catch (err) {
      logger.error(`[Startup Recovery Error] Failed to expire invitations: ${err.message}`);
    }

    // 5. Start background invitation expiration sweeper
    InvitationService.startExpirationSweeper(client);

    // 6. Set bot presence
    client.user.setActivity('Hackathon Teams 🚀', { type: ActivityType.Watching });

    // 7. Verify Guild and Key Configurations
    if (env.GUILD_ID) {
      const guild = client.guilds.cache.get(env.GUILD_ID);
      if (guild) {
        logger.info(`[Startup] Target Guild: "${guild.name}" (${guild.id}) - Members: ${guild.memberCount}`);
      } else {
        logger.warn(`[Startup] Target Guild with ID ${env.GUILD_ID} was not found in cache.`);
      }
    }

    logger.success('[Startup] Hackathon Management Bot is fully initialized and ready!');
  }
};

import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

// Import all commands
import registerTeamCmd from './commands/registration/registerTeam.js';
import teamCmd from './commands/team/team.js';
import ticketCmd from './commands/ticket/close.js';
import setupPanelsCmd from './commands/admin/setupPanels.js';
import setupConfigCmd from './commands/admin/setupConfig.js';
import announceCmd from './commands/admin/announce.js';
import purgeCmd from './commands/admin/purge.js';

const commands = [
  registerTeamCmd.data.toJSON(),
  teamCmd.data.toJSON(),
  ticketCmd.data.toJSON(),
  setupPanelsCmd.data.toJSON(),
  setupConfigCmd.data.toJSON(),
  announceCmd.data.toJSON(),
  purgeCmd.data.toJSON()
];

export async function deployCommands() {
  if (!env.DISCORD_TOKEN || !env.CLIENT_ID) {
    logger.error('[Deploy Commands] DISCORD_TOKEN or CLIENT_ID is missing in .env! Cannot register slash commands.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  try {
    logger.info(`[Deploy Commands] Started refreshing ${commands.length} application (/) commands...`);

    if (env.GUILD_ID) {
      // Guild-specific registration (instantly visible in the server)
      const data = await rest.put(
        Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID),
        { body: commands }
      );
      logger.success(`[Deploy Commands] Successfully reloaded ${data.length} guild application (/) commands for Guild ID: ${env.GUILD_ID}.`);
    } else {
      // Global registration (may take up to 1 hour to propagate)
      const data = await rest.put(
        Routes.applicationCommands(env.CLIENT_ID),
        { body: commands }
      );
      logger.success(`[Deploy Commands] Successfully reloaded ${data.length} global application (/) commands.`);
    }
  } catch (error) {
    logger.error(`[Deploy Commands Error] Failed to register slash commands: ${error.message}`);
    throw error;
  }
}

// Auto-run when executed directly (e.g. `npm run deploy-commands` or `node src/deploy-commands.js`)
const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (executedFilePath && path.normalize(currentFilePath).toLowerCase() === path.normalize(executedFilePath).toLowerCase()) {
  deployCommands()
    .then(() => {
      logger.info('[Deploy Commands] Pendaftaran slash commands selesai.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('[Deploy Commands] Error:', err.message);
      process.exit(1);
    });
}

import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'url';
import path from 'path';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

// Import all commands
import registerCmd from './commands/registration/register.js';
import teamCmd from './commands/team/team.js';
import ticketCmd from './commands/ticket/close.js';
import setupCmd from './commands/admin/setup.js';
import faqCmd from './commands/admin/faq.js';
import announceCmd from './commands/admin/announce.js';
import purgeCmd from './commands/admin/purge.js';

const commands = [
  registerCmd.data.toJSON(),
  teamCmd.data.toJSON(),
  ticketCmd.data.toJSON(),
  setupCmd.data.toJSON(),
  faqCmd.data.toJSON(),
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
      const data = await rest.put(
        Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID),
        { body: commands }
      );
      logger.success(`[Deploy Commands] Successfully reloaded ${data.length} guild application (/) commands for Guild ID: ${env.GUILD_ID}.`);
    } else {
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

import { pool } from './database/pool.js';

const isDirectRun = Boolean(
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
);

if (isDirectRun) {
  deployCommands()
    .then(async () => {
      logger.info('[Deploy Commands] Pendaftaran slash commands selesai.');
      try { await pool.end(); } catch (_) {}
      setTimeout(() => process.exit(0), 150);
    })
    .catch(async (err) => {
      logger.error('[Deploy Commands] Error:', err.message);
      try { await pool.end(); } catch (_) {}
      setTimeout(() => process.exit(1), 150);
    });
}

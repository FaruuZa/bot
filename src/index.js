import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './config/env.js';
import { pool } from './database/pool.js';
import { logger } from './utils/logger.js';

// Import Commands
import registerTeamCmd from './commands/registration/registerTeam.js';
import teamCmd from './commands/team/team.js';
import ticketCmd from './commands/ticket/close.js';
import setupPanelsCmd from './commands/admin/setupPanels.js';
import setupConfigCmd from './commands/admin/setupConfig.js';
import teamPanelCmd from './commands/admin/teamPanel.js';
import faqCmd from './commands/admin/faq.js';
import announceCmd from './commands/admin/announce.js';
import purgeCmd from './commands/admin/purge.js';

// Import Events
import readyEvent from './events/ready.js';
import guildMemberAddEvent from './events/guildMemberAdd.js';
import interactionCreateEvent from './events/interactionCreate.js';

// Initialize Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

// Register Commands
client.commands = new Collection();
const commandList = [
  registerTeamCmd,
  teamCmd,
  ticketCmd,
  setupPanelsCmd,
  setupConfigCmd,
  teamPanelCmd,
  faqCmd,
  announceCmd,
  purgeCmd
];

for (const cmd of commandList) {
  if (cmd?.data?.name) {
    client.commands.set(cmd.data.name, cmd);
    logger.info(`[Command Loader] Loaded command: /${cmd.data.name}`);
  }
}

// Register Events
client.once(readyEvent.name, (...args) => readyEvent.execute(...args));
client.on(guildMemberAddEvent.name, (...args) => guildMemberAddEvent.execute(...args));
client.on(interactionCreateEvent.name, (...args) => interactionCreateEvent.execute(...args));

// Handle Process Termination Gracefully
async function gracefulShutdown(signal) {
  logger.warn(`[Process] Received ${signal}. Gracefully shutting down...`);
  try {
    client.destroy();
    await pool.end();
    logger.info('[Process] Database connection pool and Discord client closed.');
    process.exit(0);
  } catch (err) {
    logger.error(`[Process Error] Error during shutdown: ${err.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[Uncaught Exception]', error);
});

// Login to Discord
client.login(env.DISCORD_TOKEN).catch((err) => {
  logger.error(`[Discord Login Error] Failed to log in: ${err.message}`);
  process.exit(1);
});

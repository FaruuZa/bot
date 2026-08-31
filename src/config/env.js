import dotenv from 'dotenv';
dotenv.config();

/**
 * Validates and exports parsed environment variables.
 * Note: Discord Roles, Channels, and Categories IDs are now stored
 * dynamically in the database via GuildConfigService.
 */
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'DATABASE_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`[Config Warning] Missing required environment variable: ${envVar}. Bot may fail if not set.`);
  }
}

export const env = {
  // Discord Bot Credentials
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '',

  // Database Connection
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Hackathon Team Rules (Numerical parameters)
  MIN_TEAM_SIZE: parseInt(process.env.MIN_TEAM_SIZE || '2', 10),
  MAX_TEAM_SIZE: parseInt(process.env.MAX_TEAM_SIZE || '4', 10),
  INVITATION_EXPIRE_HOURS: parseInt(process.env.INVITATION_EXPIRE_HOURS || '24', 10)
};

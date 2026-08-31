import dotenv from 'dotenv';
dotenv.config();

/**
 * Validates and exports parsed environment variables.
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
  // Discord Bot
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Hackathon Team Rules
  MIN_TEAM_SIZE: parseInt(process.env.MIN_TEAM_SIZE || '2', 10),
  MAX_TEAM_SIZE: parseInt(process.env.MAX_TEAM_SIZE || '4', 10),
  INVITATION_EXPIRE_HOURS: parseInt(process.env.INVITATION_EXPIRE_HOURS || '24', 10),

  // Discord Categories
  REGISTRATION_CATEGORY_ID: process.env.REGISTRATION_CATEGORY_ID || '',
  TEAM_PARENT_CATEGORY_ID: process.env.TEAM_PARENT_CATEGORY_ID || '',
  SUPPORT_CATEGORY_ID: process.env.SUPPORT_CATEGORY_ID || '',

  // Discord Roles
  ADMINISTRATOR_ROLE_ID: process.env.ADMINISTRATOR_ROLE_ID || '',
  STAFF_ROLE_ID: process.env.STAFF_ROLE_ID || '',
  TECHNICAL_SUPPORT_ROLE_ID: process.env.TECHNICAL_SUPPORT_ROLE_ID || '',
  JUDGE_ROLE_ID: process.env.JUDGE_ROLE_ID || '',
  PARTICIPANT_ROLE_ID: process.env.PARTICIPANT_ROLE_ID || '',
  UNREGISTERED_ROLE_ID: process.env.UNREGISTERED_ROLE_ID || '',

  // Discord Channels
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || '',
  REGISTRATION_CHANNEL_ID: process.env.REGISTRATION_CHANNEL_ID || '',
  SUPPORT_CHANNEL_ID: process.env.SUPPORT_CHANNEL_ID || ''
};

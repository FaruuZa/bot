import { ActivityType } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { pool } from '../database/pool.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_PRESENCE_CONFIG = {
  enabled: true,
  intervalSeconds: 60,
  statusType: 'online', // 'online' | 'idle' | 'dnd' | 'invisible'
  activities: [
    {
      id: 'default_1',
      type: 'WATCHING',
      text: '{countdown}',
      enabled: true
    },
    {
      id: 'default_2',
      type: 'WATCHING',
      text: '{teams} Tim • {participants} Peserta',
      enabled: true
    },
    {
      id: 'default_3',
      type: 'LISTENING',
      text: 'Ketik /team untuk info tim',
      enabled: true
    }
  ]
};

const ACTIVITY_TYPE_MAP = {
  PLAYING: ActivityType.Playing,
  STREAMING: ActivityType.Streaming,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  COMPETING: ActivityType.Competing,
  CUSTOM: ActivityType.Custom
};

export class CountdownService {
  /** @type {import('discord.js').Client|null} */
  static client = null;
  /** @type {NodeJS.Timeout|null} */
  static presenceInterval = null;
  /** @type {NodeJS.Timeout|null} */
  static channelInterval = null;
  /** @type {number} */
  static presenceStep = 0;
  /** @type {number} */
  static lastChannelUpdate = 0;
  /** @type {string} */
  static currentPresenceText = '';

  /**
   * Get the countdown status and labels
   * @returns {{ phase: 'UPCOMING'|'HACKING'|'ENDED'|'UNSET', label: string, shortLabel: string, days: number, hours: number }}
   */
  static getCountdownInfo() {
    const startStr = GuildConfigService.get('HACKATHON_START_DATE');
    const endStr = GuildConfigService.get('HACKATHON_END_DATE');

    if (!startStr) {
      return { phase: 'UNSET', label: 'NSAC Jember 2026', shortLabel: 'NSAC 2026', days: 0, hours: 0 };
    }

    const now = new Date();
    const startDate = new Date(startStr);
    const endDate = endStr ? new Date(endStr) : new Date(startDate.getTime() + 48 * 3600 * 1000);

    if (isNaN(startDate.getTime())) {
      return { phase: 'UNSET', label: 'NSAC Jember 2026', shortLabel: 'NSAC 2026', days: 0, hours: 0 };
    }

    const msUntilStart = startDate.getTime() - now.getTime();

    // 1. Before Hackathon
    if (msUntilStart > 0) {
      const days = Math.floor(msUntilStart / (1000 * 60 * 60 * 24));
      const hours = Math.floor((msUntilStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      if (days > 0) {
        return {
          phase: 'UPCOMING',
          label: `H-${days} Menuju NASA Space Apps`,
          shortLabel: `⏳ H-${days} Hackathon`,
          days,
          hours
        };
      } else {
        return {
          phase: 'UPCOMING',
          label: `${hours} Jam Menuju Hackathon`,
          shortLabel: `⏱️ ${hours}j Menuju Hackathon`,
          days: 0,
          hours
        };
      }
    }

    // 2. During Hackathon
    const msUntilEnd = endDate.getTime() - now.getTime();
    if (msUntilEnd > 0) {
      const hours = Math.ceil(msUntilEnd / (1000 * 60 * 60));
      return {
        phase: 'HACKING',
        label: `🔥 Hacking: Sisa ${hours} Jam`,
        shortLabel: `🔥 Sisa ${hours} Jam`,
        days: 0,
        hours
      };
    }

    // 3. After Hackathon
    return {
      phase: 'ENDED',
      label: '🏆 NSAC 2026 Selesai',
      shortLabel: '🏆 NSAC Selesai',
      days: 0,
      hours: 0
    };
  }

  /**
   * Get current presence configuration parsed from DB or defaults.
   * @returns {typeof DEFAULT_PRESENCE_CONFIG}
   */
  static getPresenceConfig() {
    const raw = GuildConfigService.get('BOT_PRESENCE_CONFIG');
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PRESENCE_CONFIG));

    try {
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled !== false,
        intervalSeconds: Math.max(10, Math.min(3600, parseInt(parsed.intervalSeconds, 10) || 60)),
        statusType: ['online', 'idle', 'dnd', 'invisible'].includes(parsed.statusType) ? parsed.statusType : 'online',
        activities: Array.isArray(parsed.activities) && parsed.activities.length > 0
          ? parsed.activities.map((a, idx) => ({
              id: a.id || `act_${idx + 1}`,
              type: a.type && ACTIVITY_TYPE_MAP[a.type] !== undefined ? a.type : 'WATCHING',
              text: (a.text || '').trim() || 'NSAC Jember 2026',
              enabled: a.enabled !== false
            }))
          : JSON.parse(JSON.stringify(DEFAULT_PRESENCE_CONFIG.activities))
      };
    } catch (e) {
      logger.warn(`[CountdownService] Failed to parse BOT_PRESENCE_CONFIG: ${e.message}`);
      return JSON.parse(JSON.stringify(DEFAULT_PRESENCE_CONFIG));
    }
  }

  /**
   * Gather dynamic placeholder variables for bot texts.
   * @param {import('discord.js').Client} [client]
   * @returns {Promise<{ countdown: string, teams: number, participants: number, members: number }>}
   */
  static async getLiveVariables(client = this.client) {
    const countdown = this.getCountdownInfo();

    let teamCount = 0;
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) as count FROM teams WHERE status = 'ACTIVE'`);
      teamCount = parseInt(rows[0]?.count || 0, 10);
    } catch {}

    let participantCount = 0;
    let memberCount = 0;

    if (client) {
      const guild = client.guilds.cache.get(env.GUILD_ID) || client.guilds.cache.first();
      if (guild) {
        memberCount = guild.memberCount || guild.members.cache.size || 0;
        const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
        if (participantRoleId) {
          participantCount = guild.roles.cache.get(participantRoleId)?.members?.size || 0;
        }
      }
    }

    return {
      countdown: countdown.label || 'NSAC Jember 2026',
      teams: teamCount,
      participants: participantCount,
      members: memberCount
    };
  }

  /**
   * Interpolate template placeholders like {teams}, {participants}, {countdown}, {members}.
   * @param {string} text
   * @param {Awaited<ReturnType<typeof CountdownService.getLiveVariables>>} vars
   * @returns {string}
   */
  static interpolateText(text, vars) {
    if (!text) return '';
    return text
      .replace(/{countdown}/gi, vars.countdown)
      .replace(/{teams}|{teamCount}/gi, String(vars.teams))
      .replace(/{participants}|{participantCount}/gi, String(vars.participants))
      .replace(/{members}/gi, String(vars.members));
  }

  /**
   * Save and immediately apply presence config.
   * @param {typeof DEFAULT_PRESENCE_CONFIG} newConfig
   * @param {import('discord.js').Client} [client]
   */
  static async savePresenceConfig(newConfig, client = this.client) {
    const sanitized = {
      enabled: newConfig.enabled !== false,
      intervalSeconds: Math.max(10, Math.min(3600, parseInt(newConfig.intervalSeconds, 10) || 60)),
      statusType: ['online', 'idle', 'dnd', 'invisible'].includes(newConfig.statusType) ? newConfig.statusType : 'online',
      activities: (newConfig.activities || []).map((a, idx) => ({
        id: a.id || `act_${Date.now()}_${idx}`,
        type: a.type && ACTIVITY_TYPE_MAP[a.type] !== undefined ? a.type : 'WATCHING',
        text: (a.text || '').trim() || 'NSAC Jember 2026',
        enabled: a.enabled !== false
      }))
    };

    await GuildConfigService.set('BOT_PRESENCE_CONFIG', JSON.stringify(sanitized));

    // Restart presence timer with new interval
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
    }

    if (client) {
      this.presenceStep = 0;
      await this.rotateBotPresence(client);

      if (sanitized.enabled) {
        this.presenceInterval = setInterval(() => {
          this.rotateBotPresence(client);
        }, sanitized.intervalSeconds * 1000);
      }
    }

    logger.info(`[CountdownService] Presence config saved. Cycle enabled: ${sanitized.enabled}, interval: ${sanitized.intervalSeconds}s.`);
    return sanitized;
  }

  /**
   * Update the locked voice channel name at the top of the server
   * @param {import('discord.js').Client} client 
   */
  static async updateCountdownChannel(client) {
    const channelId = GuildConfigService.get('COUNTDOWN_CHANNEL_ID');
    if (!channelId) return;

    // Rate-limit safety: Discord allows 2 channel name edits per 10 minutes
    const now = Date.now();
    if (now - this.lastChannelUpdate < 10 * 60 * 1000) {
      return;
    }

    try {
      const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
      if (!channel) return;

      const info = this.getCountdownInfo();
      if (info.phase === 'UNSET') return;

      const targetName = info.shortLabel;
      if (channel.name !== targetName) {
        await channel.setName(targetName);
        this.lastChannelUpdate = Date.now();
        logger.info(`[CountdownService] Channel ${channelId} name updated to "${targetName}"`);
      }
    } catch (err) {
      logger.warn(`[CountdownService] Failed to update countdown channel: ${err.message}`);
    }
  }

  /**
   * Rotate bot presence activities based on dynamic configuration
   * @param {import('discord.js').Client} client 
   */
  static async rotateBotPresence(client) {
    if (!client || !client.user) return;

    try {
      const config = this.getPresenceConfig();
      const status = config.statusType || 'online';
      const enabledActs = config.activities.filter((a) => a.enabled);

      if (enabledActs.length === 0) {
        client.user.setPresence({ status, activities: [] });
        this.currentPresenceText = '';
        return;
      }

      const activeItem = enabledActs[this.presenceStep % enabledActs.length];
      const vars = await this.getLiveVariables(client);
      const resolvedText = this.interpolateText(activeItem.text, vars);
      const actType = ACTIVITY_TYPE_MAP[activeItem.type] ?? ActivityType.Watching;

      client.user.setPresence({
        status,
        activities: [
          {
            name: resolvedText,
            type: actType
          }
        ]
      });

      this.currentPresenceText = `${activeItem.type}: ${resolvedText}`;

      // Increment step only if cycling is enabled
      if (config.enabled && enabledActs.length > 1) {
        this.presenceStep = (this.presenceStep + 1) % enabledActs.length;
      }
    } catch (err) {
      logger.warn(`[CountdownService] Presence rotation error: ${err.message}`);
    }
  }

  /**
   * Start recurring background countdown & presence tasks
   * @param {import('discord.js').Client} client 
   */
  static start(client) {
    this.client = client;
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.channelInterval) clearInterval(this.channelInterval);

    const config = this.getPresenceConfig();

    // Initial triggers
    this.rotateBotPresence(client);
    this.updateCountdownChannel(client);

    // Rotate bot presence according to config
    if (config.enabled) {
      this.presenceInterval = setInterval(() => {
        this.rotateBotPresence(client);
      }, (config.intervalSeconds || 60) * 1000);
    }

    // Check and update countdown channel every 10 minutes
    this.channelInterval = setInterval(() => {
      this.updateCountdownChannel(client);
    }, 10 * 60 * 1000);

    logger.info(`[CountdownService] Presence rotation (${config.intervalSeconds}s) & countdown updater started.`);
  }

  /**
   * Stop background tasks
   */
  static stop() {
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.channelInterval) clearInterval(this.channelInterval);
    this.presenceInterval = null;
    this.channelInterval = null;
  }
}

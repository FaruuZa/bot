import { ActivityType } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { pool } from '../database/pool.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class CountdownService {
  /** @type {NodeJS.Timeout|null} */
  static presenceInterval = null;
  /** @type {NodeJS.Timeout|null} */
  static channelInterval = null;
  /** @type {number} */
  static presenceStep = 0;
  /** @type {number} */
  static lastChannelUpdate = 0;

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
   * Rotate bot presence activities
   * @param {import('discord.js').Client} client 
   */
  static async rotateBotPresence(client) {
    if (!client.user) return;

    try {
      const countdown = this.getCountdownInfo();

      switch (this.presenceStep % 3) {
        case 0:
          // Activity 1: Countdown / Phase
          if (countdown.phase === 'HACKING') {
            client.user.setActivity(countdown.label, { type: ActivityType.Competing });
          } else if (countdown.phase === 'UPCOMING') {
            client.user.setActivity(countdown.label, { type: ActivityType.Watching });
          } else {
            client.user.setActivity('NSAC Jember 2026 🚀', { type: ActivityType.Watching });
          }
          break;

        case 1: {
          // Activity 2: Server Live Stats
          let teamCount = 0;
          try {
            const { rows } = await pool.query(`SELECT COUNT(*) as count FROM teams WHERE status = 'ACTIVE'`);
            teamCount = parseInt(rows[0]?.count || 0, 10);
          } catch {}

          const guild = client.guilds.cache.get(env.GUILD_ID);
          const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
          let participantCount = 0;

          if (guild && participantRoleId) {
            participantCount = guild.roles.cache.get(participantRoleId)?.members?.size || 0;
          }

          if (participantCount > 0) {
            client.user.setActivity(`${teamCount} Tim • ${participantCount} Peserta`, { type: ActivityType.Watching });
          } else {
            client.user.setActivity(`${teamCount} Tim Bertanding 🚀`, { type: ActivityType.Watching });
          }
          break;
        }

        case 2:
          // Activity 3: Actionable Tip / Command Help
          client.user.setActivity('Ketik /team untuk info tim', { type: ActivityType.Listening });
          break;
      }

      this.presenceStep = (this.presenceStep + 1) % 3;
    } catch (err) {
      logger.warn(`[CountdownService] Presence rotation error: ${err.message}`);
    }
  }

  /**
   * Start recurring background countdown & presence tasks
   * @param {import('discord.js').Client} client 
   */
  static start(client) {
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    if (this.channelInterval) clearInterval(this.channelInterval);

    // Initial triggers
    this.rotateBotPresence(client);
    this.updateCountdownChannel(client);

    // Rotate bot presence every 90 seconds
    this.presenceInterval = setInterval(() => {
      this.rotateBotPresence(client);
    }, 90 * 1000);

    // Check and update countdown channel every 10 minutes
    this.channelInterval = setInterval(() => {
      this.updateCountdownChannel(client);
    }, 10 * 60 * 1000);

    logger.info('[CountdownService] Presence rotation & countdown updater started.');
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

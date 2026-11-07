import { getAllConfigs, setConfig } from '../database/queries/configQueries.js';
import { logger } from '../utils/logger.js';

export class ConfigMissingError extends Error {
  /**
   * @param {string} configKey 
   * @param {string} [friendlyName]
   */
  constructor(configKey, friendlyName = null) {
    super(`Config "${configKey}" is required but not configured.`);
    this.name = 'ConfigMissingError';
    this.configKey = configKey;
    this.friendlyName = friendlyName || configKey;
  }
}

export const CONFIG_DEFINITIONS = {
  // Roles
  ADMINISTRATOR_ROLE_ID: { key: 'ADMINISTRATOR_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Administrator Role', description: 'Bypass all staff permissions' },
  STAFF_ROLE_ID: { key: 'STAFF_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Staff Role', description: 'General staff/committee role' },
  TECHNICAL_SUPPORT_ROLE_ID: { key: 'TECHNICAL_SUPPORT_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Tech Support Role', description: 'Technical assistance role' },
  JUDGE_ROLE_ID: { key: 'JUDGE_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Judge Role', description: 'Hackathon judge role' },
  PARTICIPANT_ROLE_ID: { key: 'PARTICIPANT_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Participant Role', description: 'Identitas peserta resmi (tidak dihapus saat masuk/keluar tim)' },
  UNREGISTERED_ROLE_ID: { key: 'UNREGISTERED_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Unregistered Role', description: 'Diberikan ke member yang join bukan via link peserta' },
  NO_TEAM_ROLE_ID: { key: 'NO_TEAM_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'No-Team Status Role', description: 'Status role untuk Participant yang belum punya tim (dihapus saat masuk tim, dikembalikan saat keluar/tim dihapus)' },
  TEAM_MEMBER_SELECT_ROLE_ID: { key: 'TEAM_MEMBER_SELECT_ROLE_ID', type: 'ROLE', category: 'ROLES', label: 'Team Select Role Filter', description: 'Role required for users to appear in the team member invite dropdown' },

  // Channels
  LOG_CHANNEL_ID: { key: 'LOG_CHANNEL_ID', type: 'CHANNEL', category: 'CHANNELS', label: 'Audit Log Channel', description: 'Channel for audit and system logs' },
  REGISTRATION_CHANNEL_ID: { key: 'REGISTRATION_CHANNEL_ID', type: 'CHANNEL', category: 'CHANNELS', label: 'Registration Panel Channel', description: 'Channel where team registration panel is posted' },
  SUPPORT_CHANNEL_ID: { key: 'SUPPORT_CHANNEL_ID', type: 'CHANNEL', category: 'CHANNELS', label: 'Support Panel Channel', description: 'Channel where support ticket panel is posted' },
  RECRUITMENT_CHANNEL_ID: { key: 'RECRUITMENT_CHANNEL_ID', type: 'CHANNEL', category: 'CHANNELS', label: 'Recruitment Board Channel', description: 'Channel khusus menampilkan board lowongan rekrutmen tim' },
  DASHBOARD_CHANNEL_ID: { key: 'DASHBOARD_CHANNEL_ID', type: 'CHANNEL', category: 'CHANNELS', label: 'Dashboard Channel', description: 'Channel where the Admin Control Panel is deployed' },

  // Categories
  REGISTRATION_CATEGORY_ID: { key: 'REGISTRATION_CATEGORY_ID', type: 'CATEGORY', category: 'CHANNELS', label: 'Registration Category', description: 'Category for team registration tickets' },
  SUPPORT_CATEGORY_ID: { key: 'SUPPORT_CATEGORY_ID', type: 'CATEGORY', category: 'CHANNELS', label: 'Support Category', description: 'Category for support tickets' },

  // Countdown & Event Schedule
  COUNTDOWN_CHANNEL_ID: { key: 'COUNTDOWN_CHANNEL_ID', type: 'VOICE_CHANNEL', category: 'SCHEDULE', label: 'Countdown Voice Channel', description: 'Voice channel di sidebar yang namanya menampilkan countdown' },
  HACKATHON_START_DATE: { key: 'HACKATHON_START_DATE', type: 'DATETIME', category: 'SCHEDULE', label: 'Hackathon Start Date', description: 'Waktu mulai hackathon (contoh: 2026-10-03T09:00:00+07:00)' },
  HACKATHON_END_DATE: { key: 'HACKATHON_END_DATE', type: 'DATETIME', category: 'SCHEDULE', label: 'Hackathon End Date', description: 'Waktu akhir hackathon (contoh: 2026-10-04T23:59:59+07:00)' },

  // System & Dashboard Controls
  REGISTRATION_OPEN: { key: 'REGISTRATION_OPEN', type: 'BOOLEAN', category: 'SYSTEM', label: 'Registration Status', description: 'Whether team registration is open ("true" or "false")' },
  PARTICIPANT_INVITE_CODE: { key: 'PARTICIPANT_INVITE_CODE', type: 'TEXT', category: 'SYSTEM', label: 'Participant Invite Code', description: 'Invite code that automatically grants Participant role on join' },
  DASHBOARD_MESSAGE_ID: { key: 'DASHBOARD_MESSAGE_ID', type: 'TEXT', category: 'SYSTEM', label: 'Dashboard Message ID', description: 'Discord Message ID for live dashboard updates' },
  BOT_PRESENCE_CONFIG: { key: 'BOT_PRESENCE_CONFIG', type: 'JSON', category: 'SYSTEM', label: 'Bot Presence Configuration', description: 'Konfigurasi rotasi status dan teks bot Discord' }
};

export class GuildConfigService {
  /** @type {Map<string, string>} */
  static cache = new Map();
  static isLoaded = false;

  /**
   * Preload all configs from DB into cache.
   */
  static async loadAll() {
    try {
      const all = await getAllConfigs();
      this.cache.clear();
      for (const [k, v] of Object.entries(all)) {
        if (v) this.cache.set(k, v);
      }
      this.isLoaded = true;
      logger.info(`[GuildConfigService] Loaded ${this.cache.size} config entry/entries from database.`);
    } catch (err) {
      logger.error(`[GuildConfigService] Failed to preload configs: ${err.message}`);
    }
  }

  /**
   * Get a config value by key from in-memory cache.
   * @param {string} key
   * @returns {string|null}
   */
  static get(key) {
    return this.cache.get(key) || null;
  }

  /**
   * Set and persist a config value.
   * @param {string} key
   * @param {string} value
   */
  static async set(key, value) {
    const trimmed = (value || '').trim();
    await setConfig(key, trimmed);
    if (trimmed) {
      this.cache.set(key, trimmed);
    } else {
      this.cache.delete(key);
    }
    logger.info(`[GuildConfigService] Config updated: ${key} = ${trimmed}`);
  }

  /**
   * Require a config value. Throws ConfigMissingError if missing/empty.
   * @param {string} key
   * @param {string} [friendlyName]
   * @returns {string}
   */
  static require(key, friendlyName = null) {
    const val = this.get(key);
    if (!val) {
      const def = CONFIG_DEFINITIONS[key];
      throw new ConfigMissingError(key, friendlyName || def?.label || key);
    }
    return val;
  }

  /**
   * Get all entries as an object.
   * @returns {Record<string, string>}
   */
  static getAll() {
    return Object.fromEntries(this.cache.entries());
  }
}

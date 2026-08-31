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
  ADMINISTRATOR_ROLE_ID: { key: 'ADMINISTRATOR_ROLE_ID', type: 'ROLE', label: 'Administrator Role', description: 'Bypass all staff permissions' },
  STAFF_ROLE_ID: { key: 'STAFF_ROLE_ID', type: 'ROLE', label: 'Staff Role', description: 'General staff/committee role' },
  TECHNICAL_SUPPORT_ROLE_ID: { key: 'TECHNICAL_SUPPORT_ROLE_ID', type: 'ROLE', label: 'Tech Support Role', description: 'Technical assistance role' },
  JUDGE_ROLE_ID: { key: 'JUDGE_ROLE_ID', type: 'ROLE', label: 'Judge Role', description: 'Hackathon judge role' },
  PARTICIPANT_ROLE_ID: { key: 'PARTICIPANT_ROLE_ID', type: 'ROLE', label: 'Participant Role', description: 'Assigned to active team members' },
  UNREGISTERED_ROLE_ID: { key: 'UNREGISTERED_ROLE_ID', type: 'ROLE', label: 'Unregistered Role', description: 'Assigned to members without a team' },

  // Channels
  LOG_CHANNEL_ID: { key: 'LOG_CHANNEL_ID', type: 'CHANNEL', label: 'Audit Log Channel', description: 'Channel for audit and system logs' },
  REGISTRATION_CHANNEL_ID: { key: 'REGISTRATION_CHANNEL_ID', type: 'CHANNEL', label: 'Registration Panel Channel', description: 'Channel where team registration panel is posted' },
  SUPPORT_CHANNEL_ID: { key: 'SUPPORT_CHANNEL_ID', type: 'CHANNEL', label: 'Support Panel Channel', description: 'Channel where support ticket panel is posted' },

  // Categories
  REGISTRATION_CATEGORY_ID: { key: 'REGISTRATION_CATEGORY_ID', type: 'CATEGORY', label: 'Registration Category', description: 'Category for team registration tickets' },
  TEAM_PARENT_CATEGORY_ID: { key: 'TEAM_PARENT_CATEGORY_ID', type: 'CATEGORY', label: 'Team Parent Category', description: 'Parent category for team text/voice channels' },
  SUPPORT_CATEGORY_ID: { key: 'SUPPORT_CATEGORY_ID', type: 'CATEGORY', label: 'Support Category', description: 'Category for support tickets' }
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

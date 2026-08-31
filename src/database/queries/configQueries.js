import { pool } from '../pool.js';

/**
 * Get a single config value by key from database.
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function getConfig(key) {
  const { rows } = await pool.query(
    'SELECT value FROM guild_config WHERE key = $1',
    [key]
  );
  return rows[0]?.value ?? null;
}

/**
 * Set (upsert) a config value in database.
 * @param {string} key
 * @param {string} value
 */
export async function setConfig(key, value) {
  await pool.query(
    `INSERT INTO guild_config (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()`,
    [key, value]
  );
}

/**
 * Get all config entries as a plain object { key: value }.
 * @returns {Promise<Record<string, string>>}
 */
export async function getAllConfigs() {
  const { rows } = await pool.query('SELECT key, value FROM guild_config');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

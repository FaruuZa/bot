import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('[Migration] Starting PostgreSQL database migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('[Migration] Database schema applied successfully.');
  } catch (error) {
    console.error('[Migration Error] Failed to apply database schema:', error);
    throw error;
  }
}

// Allow direct execution via CLI (e.g. `npm run migrate`)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      console.log('[Migration] Done. Exiting.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Failed with error:', err);
      process.exit(1);
    });
}

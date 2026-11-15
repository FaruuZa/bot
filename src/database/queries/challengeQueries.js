import { pool } from '../pool.js';
import { matchWebTeam, normalizeTeamName } from '../../utils/teamMatch.js';

/**
 * Buat challenge baru
 */
export async function createChallenge({ title, description }, client = pool) {
  const sql = `
    INSERT INTO challenges (title, description, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING *;
  `;
  const res = await client.query(sql, [title.trim(), description?.trim() || null]);
  return res.rows[0];
}

/**
 * Helper to compute team counts for challenges using the shared team matcher
 */
function attachTeamCountsToChallenges(challenges, dcTeams, webTeams) {
  return challenges.map((c) => {
    const normChTitle = normalizeTeamName(c.title);

    // Hitung tim Discord yang memilih challenge ini
    const dcTeamCount = dcTeams.filter((t) => t.challenge_id === c.id).length;

    // Hitung tim web resmi NASA Space Apps yang memilih challenge ini
    // dan BELUM terdaftar sebagai tim Discord
    const webTeamCount = webTeams.filter((wt) => {
      if (!wt.challenge_title || normalizeTeamName(wt.challenge_title) !== normChTitle) {
        return false;
      }
      return !dcTeams.some((t) => matchWebTeam(t, wt));
    }).length;

    return {
      ...c,
      dc_team_count: dcTeamCount,
      web_team_count: webTeamCount,
      team_count: dcTeamCount + webTeamCount
    };
  });
}

/**
 * Ambil semua challenge (menghitung tim di Discord dan tim dari web NASA Space Apps)
 */
export async function getAllChallenges(client = pool) {
  const [chRes, dcRes, webRes] = await Promise.all([
    client.query('SELECT * FROM challenges ORDER BY title ASC'),
    client.query("SELECT id, name, nsac_link, challenge_id FROM teams WHERE status = 'ACTIVE'"),
    client.query('SELECT slug, title, challenge_title FROM web_teams WHERE present_in_latest_sync = true')
  ]);

  return attachTeamCountsToChallenges(chRes.rows, dcRes.rows, webRes.rows);
}

/**
 * Ambil challenge berdasarkan ID
 */
export async function getChallengeById(id, client = pool) {
  const [chRes, dcRes, webRes] = await Promise.all([
    client.query('SELECT * FROM challenges WHERE id = $1', [id]),
    client.query("SELECT id, name, nsac_link, challenge_id FROM teams WHERE status = 'ACTIVE'"),
    client.query('SELECT slug, title, challenge_title FROM web_teams WHERE present_in_latest_sync = true')
  ]);

  if (chRes.rows.length === 0) return null;
  const enriched = attachTeamCountsToChallenges(chRes.rows, dcRes.rows, webRes.rows);
  return enriched[0] || null;
}

/**
 * Update challenge
 */
export async function updateChallenge(id, { title, description }, client = pool) {
  const sql = `
    UPDATE challenges
    SET title = $2, description = $3, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await client.query(sql, [id, title.trim(), description?.trim() || null]);
  return res.rows[0] || null;
}

/**
 * Hapus challenge
 */
export async function deleteChallenge(id, client = pool) {
  const sql = `
    DELETE FROM challenges WHERE id = $1 RETURNING *;
  `;
  const res = await client.query(sql, [id]);
  return res.rows[0] || null;
}

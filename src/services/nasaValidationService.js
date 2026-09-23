import { Agent } from 'undici';
import { EmbedBuilder } from 'discord.js';
import { getAllChallenges } from '../database/queries/challengeQueries.js';
import { pool } from '../database/pool.js';
import { EMBED_COLORS, AUDIT_ACTIONS } from '../config/constants.js';
import { TeamService } from './teamService.js';
import { AuditService } from './auditService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Custom dispatcher to handle environments with local SSL certificate inspection
const sslSafeDispatcher = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

export class NasaValidationService {
  /**
   * Validate a team URL from spaceappschallenge.org
   * 
   * @param {string} url - The team profile URL
   * @returns {Promise<{
   *   valid: boolean,
   *   error?: string,
   *   warning?: string,
   *   inputUrl?: string,
   *   isJember?: boolean,
   *   extractedTitle?: string,
   *   challengeId?: number|null,
   *   challengeTitle?: string|null
   * }>}
   */
  static async validateTeamUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, inputUrl: url || '', error: 'Tautan URL tidak boleh kosong.' };
    }

    const trimmedUrl = url.trim();

    // 1. Syntactic & Domain Validation
    let parsedUrl;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      return { valid: false, inputUrl: trimmedUrl, error: 'Format URL tidak valid (harus diawali http:// atau https://).' };
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname !== 'spaceappschallenge.org' && !hostname.endsWith('.spaceappschallenge.org')) {
      return {
        valid: false,
        inputUrl: trimmedUrl,
        error: 'Tautan harus mengarah ke situs resmi NASA Space Apps Challenge (**spaceappschallenge.org**).'
      };
    }

    // 2. Fetch HTML from NASA website
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const response = await fetch(trimmedUrl, {
        method: 'GET',
        dispatcher: sslSafeDispatcher,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Halaman tim tidak ditemukan di web NASA Space Apps (Status 404). Pastikan tim sudah dibuat dan link disalin dengan benar.'
        };
      }

      if (!response.ok) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: `Situs web NASA merespons dengan status HTTP ${response.status}. Mohon coba lagi beberapa saat.`
        };
      }

      const html = await response.text();
      const lowerHtml = html.toLowerCase();

      // 3. Location Verification (Jember Check)
      const hasJember = lowerHtml.includes('jember');
      if (!hasJember) {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Tautan tim ditemukan di situs NASA, namun tidak terafiliasi dengan lokasi **Jember** (Pastikan tim Anda terdaftar di event lokal Jember).'
        };
      }

      // 4. Extract Page Title / Team Name
      let extractedTitle = null;
      const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        extractedTitle = ogTitleMatch[1].trim();
      } else {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          extractedTitle = titleMatch[1].split('|')[0].trim();
        }
      }

      // 5. Detect Challenge from Database if matching
      let challengeId = null;
      let challengeTitle = null;

      try {
        const dbChallenges = await getAllChallenges();
        if (dbChallenges && dbChallenges.length > 0) {
          for (const ch of dbChallenges) {
            const chTitleLower = ch.title.toLowerCase();
            if (chTitleLower.length > 4 && lowerHtml.includes(chTitleLower)) {
              challengeId = ch.id;
              challengeTitle = ch.title;
              break;
            }
          }
        }
      } catch (dbErr) {
        logger.warn(`[NasaValidation] Could not match challenges from DB: ${dbErr.message}`);
      }

      return {
        valid: true,
        inputUrl: trimmedUrl,
        isJember: true,
        extractedTitle,
        challengeId,
        challengeTitle,
        url: trimmedUrl
      };
    } catch (err) {
      logger.error(`[NasaValidation] Fetch failed: ${err.message}`);
      if (err.name === 'AbortError') {
        return {
          valid: false,
          inputUrl: trimmedUrl,
          error: 'Koneksi ke server web NASA Space Apps mengalami batas waktu (Timeout). Mohon periksa kembali link atau coba lagi sesaat lagi.'
        };
      }

      return {
        valid: false,
        inputUrl: trimmedUrl,
        error: `Gagal melakukan verifikasi ke situs NASA: ${err.message}`
      };
    }
  }

  /**
   * Sync challenge for all active teams with a valid NASA link
   * @param {import('discord.js').Client} client 
   */
  static async syncAllActiveTeams(client) {
    logger.info('[NasaSync] Memulai sinkronisasi tantangan tim aktif dari web NASA...');
    let teams = [];
    try {
      const { rows } = await pool.query(`
        SELECT t.id, t.name, t.nsac_link, t.challenge_id, t.text_channel_id,
               c.title as current_challenge_title
        FROM teams t
        LEFT JOIN challenges c ON t.challenge_id = c.id
        WHERE t.status = 'ACTIVE' AND t.nsac_link IS NOT NULL AND t.nsac_link != ''
      `);
      teams = rows;
    } catch (dbErr) {
      logger.error(`[NasaSync] Gagal mengambil daftar tim aktif dari database: ${dbErr.message}`);
      return;
    }

    if (!teams || teams.length === 0) {
      logger.info('[NasaSync] Tidak ada tim aktif dengan tautan web NASA untuk disinkronkan.');
      return;
    }

    let updatedCount = 0;

    for (const team of teams) {
      try {
        // Delay 1.5 detik antar request agar ramah ke server NASA
        await new Promise((r) => setTimeout(r, 1500));

        const val = await this.validateTeamUrl(team.nsac_link);
        if (val.valid && val.challengeId && val.challengeId !== team.challenge_id) {
          logger.info(`[NasaSync] Challenge tim "${team.name}" berubah: "${team.current_challenge_title || 'Belum ada'}" -> "${val.challengeTitle}"`);

          // 1. Update database
          await pool.query(
            'UPDATE teams SET challenge_id = $1, updated_at = NOW() WHERE id = $2',
            [val.challengeId, team.id]
          );

          // 2. Beri notifikasi di channel privat tim
          if (team.text_channel_id) {
            const channel = client.channels.cache.get(team.text_channel_id)
              || await client.channels.fetch(team.text_channel_id).catch(() => null);

            if (channel && channel.isTextBased()) {
              const noticeEmbed = new EmbedBuilder()
                .setTitle('Pembaruan Tantangan (Challenge)')
                .setDescription(
                  `Tantangan tim Anda di situs web resmi NASA Space Apps Challenge terdeteksi telah diperbarui menjadi:\n\n` +
                  `**${val.challengeTitle}**`
                )
                .setColor(EMBED_COLORS.PRIMARY)
                .setFooter({ text: 'Sinkronisasi Otomatis Web NASA • Pukul 00:00 WIB' })
                .setTimestamp();

              await channel.send({ embeds: [noticeEmbed] }).catch(() => {});
            }

            // 3. Refresh pinned welcome panel
            const guild = client.guilds.cache.get(env.GUILD_ID);
            if (guild) {
              await TeamService.refreshTeamWelcomePanel(team.id, guild).catch(() => {});
            }
          }

          // 4. Catat ke Audit Log
          await AuditService.log(client, {
            action: AUDIT_ACTIONS.TEAM_CHALLENGE_UPDATED,
            title: 'Auto Challenge Sync',
            teamId: team.id,
            teamName: team.name,
            details: `Tantangan otomatis disinkronkan dari web NASA menjadi "${val.challengeTitle}".`
          }).catch(() => {});

          updatedCount++;
        }
      } catch (err) {
        logger.warn(`[NasaSync] Gagal menyinkronkan tim "${team.name}": ${err.message}`);
      }
    }

    logger.info(`[NasaSync] Sinkronisasi selesai. Sebanyak ${updatedCount} tim berhasil diperbarui.`);
  }

  /**
   * Schedule daily sync at 00:00 WIB
   * @param {import('discord.js').Client} client 
   */
  static startDailyMidnightSync(client) {
    const scheduleNext = () => {
      const now = new Date();
      // Calculate next midnight in local time
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
      const delay = nextMidnight.getTime() - now.getTime();

      setTimeout(async () => {
        logger.info('[NasaSync] Menjalankan sinkronisasi tantangan tim tengah malam (00:00)...');
        try {
          await this.syncAllActiveTeams(client);
        } catch (err) {
          logger.error(`[NasaSync] Sinkronisasi tengah malam mengalami error: ${err.message}`);
        }
        scheduleNext();
      }, delay);

      const hoursUntil = (delay / (1000 * 60 * 60)).toFixed(1);
      logger.info(`[NasaSync] Sinkronisasi tengah malam berikutnya dijadwalkan dalam ${hoursUntil} jam.`);
    };

    scheduleNext();
  }
}

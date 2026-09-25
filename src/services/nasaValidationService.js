import { Agent } from 'undici';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { getAllChallenges } from '../database/queries/challengeQueries.js';
import { getTeamById } from '../database/queries/teamQueries.js';
import { countActiveTeamMembers } from '../database/queries/memberQueries.js';
import {
  createRecruitment,
  getOpenRecruitmentByTeam,
  closeAllRecruitmentsByTeam
} from '../database/queries/recruitmentQueries.js';
import { pool } from '../database/pool.js';
import { EMBED_COLORS, AUDIT_ACTIONS, CUSTOM_IDS } from '../config/constants.js';
import { TeamService } from './teamService.js';
import { AuditService } from './auditService.js';
import { GuildConfigService } from './guildConfigService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Custom dispatcher to handle environments with local SSL certificate inspection
const sslSafeDispatcher = new Agent({
  connect: {
    rejectUnauthorized: false
  }
});

/**
 * Throttled FIFO queue to prevent concurrent requests to NASA's servers
 */
class AsyncQueue {
  constructor(delayMs = 1500) {
    this.delayMs = delayMs;
    this.queue = [];
    this.processing = false;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const { fn, resolve, reject } = this.queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      if (this.queue.length > 0) {
        setTimeout(() => {
          this.processing = false;
          this.processNext();
        }, this.delayMs);
      } else {
        this.processing = false;
      }
    }
  }
}

const nasaRequestQueue = new AsyncQueue(1500);

// Cooldown map: teamId -> timestamp (milliseconds)
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const teamSyncCooldowns = new Map();

export class NasaValidationService {
  /**
   * Get remaining cooldown time in milliseconds for a team
   * @param {number} teamId
   * @returns {number} remaining ms, 0 if not on cooldown
   */
  static getSyncCooldown(teamId, lastSyncedAt = null) {
    let lastSync = teamSyncCooldowns.get(teamId);
    if (!lastSync && lastSyncedAt) {
      lastSync = new Date(lastSyncedAt).getTime();
      teamSyncCooldowns.set(teamId, lastSync);
    }
    if (!lastSync) return 0;
    const remaining = lastSync + COOLDOWN_MS - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Set cooldown for a team
   * @param {number} teamId
   */
  static setSyncCooldown(teamId) {
    teamSyncCooldowns.set(teamId, Date.now());
  }

  /**
   * Validate and parse a team URL from spaceappschallenge.org
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
   *   challengeTitle?: string|null,
   *   isLookingForTeammates?: boolean,
   *   desiredSkills?: string[],
   *   url?: string
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

    // 2. Fetch HTML through sequential FIFO queue
    return await nasaRequestQueue.enqueue(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

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

        // 5. Extract Challenge Details
        let challengeTitle = null;
        let challengeId = null;

        const chMatch = html.match(/challengeDetails\\":\{.*?title\\":\\"([^"\\]+)\\"/);
        if (chMatch && chMatch[1]) {
          challengeTitle = chMatch[1].trim();
        }

        try {
          const dbChallenges = await getAllChallenges();
          if (dbChallenges && dbChallenges.length > 0) {
            if (challengeTitle) {
              const matched = dbChallenges.find(
                (c) => c.title.toLowerCase() === challengeTitle.toLowerCase()
              );
              if (matched) {
                challengeId = matched.id;
                challengeTitle = matched.title;
              }
            }

            // Fallback: match by title inclusion if not yet identified
            if (!challengeId) {
              for (const ch of dbChallenges) {
                const chTitleLower = ch.title.toLowerCase();
                if (chTitleLower.length > 4 && lowerHtml.includes(chTitleLower)) {
                  challengeId = ch.id;
                  challengeTitle = ch.title;
                  break;
                }
              }
            }
          }
        } catch (dbErr) {
          logger.warn(`[NasaValidation] Could not match challenges from DB: ${dbErr.message}`);
        }

        // 6. Extract Recruitment Status (Looking for teammates vs Not looking)
        const canAcceptMatch = html.match(/canAcceptMembers\\":([^,}]+)/);
        const canAcceptMembers = canAcceptMatch ? canAcceptMatch[1].trim() === 'true' : false;
        const hasJoinCta = html.includes('JoinTeamCta');
        const isLookingForTeammates = canAcceptMembers || hasJoinCta;

        // 7. Extract Desired Skills
        const skillsMatch = html.match(/desiredSkills\\":(\[.*?\])/);
        let desiredSkills = [];
        if (skillsMatch) {
          try {
            const cleanJson = skillsMatch[1].replace(/\\"/g, '"');
            desiredSkills = JSON.parse(cleanJson);
          } catch (e) {
            logger.warn(`[NasaValidation] Failed to parse desiredSkills JSON: ${e.message}`);
          }
        }

        return {
          valid: true,
          inputUrl: trimmedUrl,
          isJember: true,
          extractedTitle,
          challengeId,
          challengeTitle,
          isLookingForTeammates,
          desiredSkills,
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
    });
  }

  /**
   * Synchronize a single team from NASA Space Apps Challenge website
   * 
   * @param {number} teamId 
   * @param {import('discord.js').Client} client 
   * @returns {Promise<{
   *   success: boolean,
   *   error?: string,
   *   teamName?: string,
   *   challengeTitle?: string,
   *   challengeUpdated?: boolean,
   *   isLookingForTeammates?: boolean,
   *   desiredSkills?: string[],
   *   recruitmentOpened?: boolean,
   *   recruitmentClosed?: boolean
   * }>}
   */
  static async syncTeam(teamId, client) {
    const team = await getTeamById(teamId);
    if (!team) {
      return { success: false, error: 'Data tim tidak ditemukan di database.' };
    }
    if (!team.nsac_link) {
      return { success: false, error: 'Tautan web NASA belum diatur untuk tim ini.' };
    }

    const val = await this.validateTeamUrl(team.nsac_link);
    if (!val.valid) {
      return { success: false, error: val.error || 'Gagal memvalidasi profil tim di web NASA.' };
    }

    const guild = client.guilds.cache.get(env.GUILD_ID);
    let challengeUpdated = false;
    let recruitmentOpened = false;
    let recruitmentClosed = false;

    // 1. Update Challenge if changed
    if (val.challengeId && val.challengeId !== team.challenge_id) {
      await pool.query(
        'UPDATE teams SET challenge_id = $1, updated_at = NOW() WHERE id = $2',
        [val.challengeId, team.id]
      );
      challengeUpdated = true;
      team.challenge_id = val.challengeId;
      team.challenge_title = val.challengeTitle;

      // Notification in team channel
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
            .setFooter({ text: 'Sinkronisasi Web NASA' })
            .setTimestamp();
          await channel.send({ embeds: [noticeEmbed] }).catch(() => {});
        }
      }

      // Audit Log
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAM_CHALLENGE_UPDATED,
        title: 'Auto Challenge Sync',
        teamId: team.id,
        teamName: team.name,
        details: `Tantangan otomatis disinkronkan dari web NASA menjadi "${val.challengeTitle}".`
      }).catch(() => {});
    }

    // 2. Sync Recruitment Status
    const openRecruit = await getOpenRecruitmentByTeam(team.id);
    const recruitChannelId = GuildConfigService.get('RECRUITMENT_CHANNEL_ID');
    let recruitChannel = null;
    if (guild && recruitChannelId) {
      recruitChannel = guild.channels.cache.get(recruitChannelId)
        || await guild.channels.fetch(recruitChannelId).catch(() => null);
    }

    if (val.isLookingForTeammates) {
      // Team is looking for teammates on NASA
      if (!openRecruit) {
        const currentCount = await countActiveTeamMembers(team.id);
        const maxAvailable = env.MAX_TEAM_SIZE - currentCount;
        if (maxAvailable > 0 && recruitChannel && recruitChannel.isTextBased()) {
          const slots = maxAvailable;
          const skillsText = val.desiredSkills && val.desiredSkills.length > 0
            ? `Keahlian yang dicari: ${val.desiredSkills.join(', ')}`
            : '';
          const description = skillsText
            ? `Disinkronkan dari profil resmi web NASA.\n\n${skillsText}`
            : 'Disinkronkan dari profil resmi web NASA — Tim sedang membuka lowongan anggota baru.';

          const recruitEmbed = TeamService.buildRecruitmentBoardEmbed({
            teamName: team.name,
            description,
            leaderDiscordId: team.leader_discord_id,
            challengeTitle: team.challenge_title || val.challengeTitle,
            slotsNeeded: slots,
            currentCount,
            maxTeamSize: env.MAX_TEAM_SIZE
          });

          const boardMsg = await recruitChannel.send({ embeds: [recruitEmbed] }).catch(() => null);
          if (boardMsg) {
            const recruitmentRecord = await createRecruitment({
              teamId: team.id,
              channelId: recruitChannel.id,
              messageId: boardMsg.id,
              slotsNeeded: slots,
              description
            });

            const boardButtons = [
              new ButtonBuilder()
                .setCustomId(`${CUSTOM_IDS.BTN_RECRUIT_REQUEST_JOIN}${recruitmentRecord.id}`)
                .setLabel('Minta Bergabung')
                .setStyle(ButtonStyle.Success)
            ];
            if (team.nsac_link && (team.nsac_link.startsWith('http://') || team.nsac_link.startsWith('https://'))) {
              boardButtons.push(
                new ButtonBuilder()
                  .setLabel('Profil Tim (NSAC Web)')
                  .setStyle(ButtonStyle.Link)
                  .setURL(team.nsac_link)
              );
            }
            await boardMsg.edit({ components: [new ActionRowBuilder().addComponents(boardButtons)] }).catch(() => {});

            recruitmentOpened = true;

            // Notify team channel
            if (team.text_channel_id) {
              const channel = client.channels.cache.get(team.text_channel_id)
                || await client.channels.fetch(team.text_channel_id).catch(() => null);
              if (channel && channel.isTextBased()) {
                const noticeEmbed = new EmbedBuilder()
                  .setTitle('Pembaruan Rekrutmen Tim')
                  .setDescription(
                    `Status tim di situs web NASA terdeteksi **Mencari Anggota Baru** (Looking for teammates).\n\n` +
                    `Lowongan rekrutmen tim otomatis dibuka di channel <#${recruitChannel.id}>.`
                  )
                  .setColor(EMBED_COLORS.SUCCESS)
                  .setFooter({ text: 'Sinkronisasi Web NASA' })
                  .setTimestamp();
                await channel.send({ embeds: [noticeEmbed] }).catch(() => {});
              }
            }

            // Audit Log
            await AuditService.log(client, {
              action: AUDIT_ACTIONS.RECRUITMENT_POSTED,
              title: 'Auto Recruitment Sync',
              teamId: team.id,
              teamName: team.name,
              details: `Rekrutmen otomatis dibuka di recruitment board berdasarkan status web NASA.`
            }).catch(() => {});
          }
        }
      } else if (challengeUpdated && recruitChannel && recruitChannel.isTextBased()) {
        // Update existing recruitment post if challenge was updated
        const msg = await recruitChannel.messages.fetch(openRecruit.message_id).catch(() => null);
        if (msg) {
          const currentCount = await countActiveTeamMembers(team.id);
          const updatedBoardEmbed = TeamService.buildRecruitmentBoardEmbed({
            teamName: team.name,
            description: openRecruit.description,
            leaderDiscordId: team.leader_discord_id,
            challengeTitle: team.challenge_title,
            slotsNeeded: openRecruit.slots_needed,
            currentCount,
            maxTeamSize: env.MAX_TEAM_SIZE
          });
          await msg.edit({ embeds: [updatedBoardEmbed] }).catch(() => {});
        }
      }
    } else {
      // Team is NOT looking for teammates on NASA
      if (openRecruit) {
        await closeAllRecruitmentsByTeam(team.id);
        if (recruitChannel && recruitChannel.isTextBased()) {
          const msg = await recruitChannel.messages.fetch(openRecruit.message_id).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`[DITUTUP] Rekrutmen Tim ${team.name}`)
                  .setColor(EMBED_COLORS.DARK)
                  .setDescription('Lowongan rekrutmen ditutup berdasarkan sinkronisasi status web NASA.')
                  .setTimestamp()
              ],
              components: []
            }).catch(() => {});
          }
        }

        recruitmentClosed = true;

        // Notify team channel
        if (team.text_channel_id) {
          const channel = client.channels.cache.get(team.text_channel_id)
            || await client.channels.fetch(team.text_channel_id).catch(() => null);
          if (channel && channel.isTextBased()) {
            const noticeEmbed = new EmbedBuilder()
              .setTitle('Pembaruan Rekrutmen Tim')
              .setDescription(
                `Status tim di situs web NASA terdeteksi **Tidak Mencari Anggota** (Not looking for teammates).\n\n` +
                `Lowongan tim di channel recruitment board telah otomatis ditutup.`
              )
              .setColor(EMBED_COLORS.DARK)
              .setFooter({ text: 'Sinkronisasi Web NASA' })
              .setTimestamp();
            await channel.send({ embeds: [noticeEmbed] }).catch(() => {});
          }
        }

        // Audit Log
        await AuditService.log(client, {
          action: AUDIT_ACTIONS.RECRUITMENT_CLOSED,
          title: 'Auto Recruitment Sync',
          teamId: team.id,
          teamName: team.name,
          details: `Rekrutmen otomatis ditutup berdasarkan status web NASA (tidak mencari anggota).`
        }).catch(() => {});
      }
    }

    // 3. Refresh welcome panel in team channel
    if (guild) {
      await TeamService.refreshTeamWelcomePanel(team.id, guild).catch(() => {});
    }

    // Update last_synced_at in database
    await pool.query(
      'UPDATE teams SET last_synced_at = NOW(), updated_at = NOW() WHERE id = $1',
      [team.id]
    ).catch((err) => logger.warn(`[NasaSync] Gagal update last_synced_at tim ${team.id}: ${err.message}`));

    // Update in-memory cooldown
    this.setSyncCooldown(team.id);

    return {
      success: true,
      teamName: team.name,
      challengeTitle: val.challengeTitle || team.challenge_title || 'Belum diatur',
      challengeUpdated,
      isLookingForTeammates: val.isLookingForTeammates,
      desiredSkills: val.desiredSkills,
      recruitmentOpened,
      recruitmentClosed
    };
  }

  /**
   * Sync challenge and recruitment for all active teams with a valid NASA link
   * @param {import('discord.js').Client} client 
   */
  static async syncAllActiveTeams(client) {
    logger.info('[NasaSync] Memulai sinkronisasi tantangan dan rekrutmen tim aktif dari web NASA...');
    let teams = [];
    try {
      const { rows } = await pool.query(`
        SELECT id, name, nsac_link, last_synced_at FROM teams
        WHERE status = 'ACTIVE' AND nsac_link IS NOT NULL AND nsac_link != ''
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
    let skippedCount = 0;
    // Ambang batas: Tim yang disinkronkan dalam 4 jam terakhir (misal jam 20:00 - 23:59)
    // dilewati saat sinkronisasi jam 12 malam agar tidak boros request & tidak spam.
    const RECENT_SYNC_THRESHOLD_MS = 4 * 60 * 60 * 1000;

    for (const team of teams) {
      try {
        const lastSyncTime = teamSyncCooldowns.get(team.id) || (team.last_synced_at ? new Date(team.last_synced_at).getTime() : 0);
        if (lastSyncTime && (Date.now() - lastSyncTime < RECENT_SYNC_THRESHOLD_MS)) {
          const hoursAgo = ((Date.now() - lastSyncTime) / (1000 * 60 * 60)).toFixed(1);
          logger.info(`[NasaSync] Tim "${team.name}" dilewati karena baru saja disinkronkan (${hoursAgo} jam lalu).`);
          skippedCount++;
          continue;
        }

        const res = await this.syncTeam(team.id, client);
        if (res.challengeUpdated || res.recruitmentOpened || res.recruitmentClosed) {
          updatedCount++;
        }
      } catch (err) {
        logger.warn(`[NasaSync] Gagal menyinkronkan tim "${team.name}": ${err.message}`);
      }
    }

    logger.info(`[NasaSync] Sinkronisasi tengah malam selesai. Sebanyak ${updatedCount} tim diperbarui, ${skippedCount} tim dilewati (sudah sync sebelumnya).`);
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
        logger.info('[NasaSync] Menjalankan sinkronisasi tantangan dan rekrutmen tim tengah malam (00:00)...');
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

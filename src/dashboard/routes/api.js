import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { GuildConfigService, CONFIG_DEFINITIONS } from '../../services/guildConfigService.js';
import { NasaValidationService } from '../../services/nasaValidationService.js';
import { AuditService } from '../../services/auditService.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { closeRecruitment, getRecruitmentById, getOpenRecruitmentByTeam } from '../../database/queries/recruitmentQueries.js';
import { TeamService } from '../../services/teamService.js';
import { getTeamById } from '../../database/queries/teamQueries.js';
import { getActiveTeamMembers } from '../../database/queries/memberQueries.js';
import { TicketService } from '../../services/ticketService.js';
import { getTickets, getTicketById, countOpenTickets } from '../../database/queries/ticketQueries.js';
import { logger } from '../../utils/logger.js';

// Setup multer memory storage for image upload (max 8MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (PNG, JPG, GIF, WebP) yang diperbolehkan!'));
    }
  }
});

// Active dashboard session tokens in memory
const activeTokens = new Set();

export function createApiRouter(client) {
  const router = express.Router();

  // Helper to get active Guild
  const getGuild = () => {
    if (env.GUILD_ID && client.guilds.cache.has(env.GUILD_ID)) {
      return client.guilds.cache.get(env.GUILD_ID);
    }
    return client.guilds.cache.first();
  };

  // Auth Middleware
  const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.headers['x-dashboard-token'] || req.query.token;

    if (!token || !activeTokens.has(token)) {
      return res.status(401).json({ success: false, error: 'Akses tidak sah. Silakan login terlebih dahulu.' });
    }
    next();
  };

  // ==========================================
  // 1. Auth Endpoints
  // ==========================================
  router.post('/auth/login', (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== env.DASHBOARD_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Kata sandi dashboard salah.' });
    }

    const token = crypto.randomUUID();
    activeTokens.add(token);
    return res.json({ success: true, token, user: 'Panitia / Administrator' });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    return res.json({ success: true, authenticated: true });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.headers['x-dashboard-token'];
    if (token) activeTokens.delete(token);
    return res.json({ success: true });
  });

  // ==========================================
  // 2. Stats & Overview
  // ==========================================
  router.get('/stats', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();

      if (guild) {
        if (guild.members.cache.size < guild.memberCount) {
          await guild.members.fetch().catch((err) => {
            logger.warn(`[Dashboard API] /stats guild.members.fetch failed: ${err.message}`);
          });
        }
        if (guild.roles.cache.size === 0) {
          await guild.roles.fetch().catch((err) => {
            logger.warn(`[Dashboard API] /stats guild.roles.fetch failed: ${err.message}`);
          });
        }
      }

      const [teamsRes, recruitRes, inTeamsRes] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM teams WHERE status != 'DISBANDED'"),
        pool.query("SELECT COUNT(*) FROM team_recruitments WHERE status = 'OPEN'"),
        pool.query("SELECT COUNT(DISTINCT user_id) as count FROM team_members WHERE status = 'ACTIVE'")
      ]);

      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
      const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');

      let participantCount = null;
      let participantRoleConfigured = false;
      if (participantRoleId && guild) {
        const role = guild.roles.cache.get(participantRoleId);
        if (role) {
          participantCount = role.members.size;
          participantRoleConfigured = true;
        }
      }

      let noTeamCount = null;
      if (noTeamRoleId && guild) {
        const role = guild.roles.cache.get(noTeamRoleId);
        if (role) {
          noTeamCount = role.members.size;
        }
      }

      const inTeamsCount = parseInt(inTeamsRes.rows[0]?.count || '0', 10);

      return res.json({
        success: true,
        data: {
          bot: {
            tag: client.user?.tag || 'NSAC Bot',
            id: client.user?.id || '',
            avatar: client.user?.displayAvatarURL() || '',
            ping: client.ws.ping || 0,
            uptime: Math.floor(process.uptime())
          },
          guild: {
            id: guild?.id || '',
            name: guild?.name || 'NSAC Server',
            icon: guild?.iconURL() || '',
            memberCount: guild?.memberCount || 0
          },
          stats: {
            totalTeams: parseInt(teamsRes.rows[0]?.count || '0', 10),
            openRecruitments: parseInt(recruitRes.rows[0]?.count || '0', 10),
            participantCount,
            participantRoleConfigured,
            inTeamsCount,
            noTeamCount
          }
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] /stats error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 3. Channels & Roles for Announcement
  // ==========================================
  router.get('/channels', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan' });

      await guild.channels.fetch().catch(() => {});

      const validChannels = guild.channels.cache
        .filter((c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement))
        .map((c) => ({
          id: c.id,
          name: c.name,
          categoryName: c.parent?.name || 'Tanpa Kategori',
          isAnnouncement: c.type === ChannelType.GuildAnnouncement,
          position: c.rawPosition
        }))
        .sort((a, b) => a.position - b.position);

      return res.json({ success: true, channels: validChannels });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/roles', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan' });

      await guild.roles.fetch().catch(() => {});

      const roles = guild.roles.cache
        .filter((r) => r.name !== '@everyone')
        .map((r) => ({
          id: r.id,
          name: r.name,
          color: r.hexColor !== '#000000' ? r.hexColor : '#99aab5',
          position: r.position
        }))
        .sort((a, b) => b.position - a.position);

      return res.json({ success: true, roles });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 4. Post Announcement (WYSIWYG)
  // ==========================================
  router.post('/announce', requireAuth, upload.single('image'), async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan' });

      const {
        channelId,
        title,
        message,
        color = 'PRIMARY',
        mentionType = 'none',
        roleId = '',
        roleId2 = '',
        imageUrl = '',
        footerText = ''
      } = req.body;

      if (!channelId) {
        return res.status(400).json({ success: false, error: 'Channel tujuan wajib dipilih.' });
      }
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: 'Judul pengumuman wajib diisi.' });
      }
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Isi pesan pengumuman wajib diisi.' });
      }

      const targetChannel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);

      if (!targetChannel || !targetChannel.isTextBased()) {
        return res.status(400).json({ success: false, error: 'Channel tidak valid atau bukan text channel.' });
      }

      const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
      if (botMember && !targetChannel.permissionsFor(botMember).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return res.status(403).json({ success: false, error: `Bot tidak memiliki izin SendMessages / EmbedLinks di channel <#${channelId}>.` });
      }

      // Safe embed texts (Discord limits)
      const safeTitle = title.trim().length > 256 ? `${title.trim().substring(0, 253)}...` : title.trim();
      const safeDesc = message.trim().length > 4096 ? `${message.trim().substring(0, 4093)}...` : message.trim();

      // Determine embed color
      let embedColor = EMBED_COLORS.PRIMARY;
      if (EMBED_COLORS[color]) {
        embedColor = EMBED_COLORS[color];
      } else if (typeof color === 'string' && color.startsWith('#')) {
        embedColor = parseInt(color.replace('#', ''), 16);
      }

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📢 ${safeTitle}`)
        .setDescription(safeDesc)
        .setFooter({ text: footerText?.trim() || `NSAC Jember Announcement • Web Dashboard` })
        .setTimestamp();

      // Files attachment array
      const files = [];
      if (req.file) {
        // Uploaded file directly from dashboard
        const ext = req.file.mimetype.split('/')[1] || 'png';
        const filename = `announcement_banner_${Date.now()}.${ext}`;
        files.push({
          attachment: req.file.buffer,
          name: filename
        });
        embed.setImage(`attachment://${filename}`);
      } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        embed.setImage(imageUrl.trim());
      }

      // Mentions construction
      const mentions = [];
      if (mentionType === 'everyone') mentions.push('@everyone');
      else if (mentionType === 'here') mentions.push('@here');
      else if (mentionType === 'role' && roleId) mentions.push(`<@&${roleId}>`);

      if (roleId2) mentions.push(`<@&${roleId2}>`);

      const content = mentions.length > 0 ? mentions.join(' ') : undefined;

      const sentMsg = await targetChannel.send({
        content,
        embeds: [embed],
        files: files.length > 0 ? files : undefined,
        allowedMentions: { parse: ['roles', 'users', 'everyone'] }
      });

      // Audit log
      AuditService.log(client, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_POSTED || 'ANNOUNCEMENT_POSTED',
        title: 'Web Dashboard Announcement',
        details: `Pengumuman "${safeTitle}" berhasil diposting ke channel #${targetChannel.name} oleh Web Dashboard.`
      }).catch(() => {});

      return res.json({
        success: true,
        data: {
          messageId: sentMsg.id,
          channelId: targetChannel.id,
          channelName: targetChannel.name
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] /announce error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 5. Teams & Recruitments Management
  // ==========================================
  router.get('/teams', requireAuth, async (req, res) => {
    try {
      const { status, limit = 50, offset = 0 } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

      const params = [];
      let whereClause = "WHERE t.status != 'DISBANDED'";
      if (status && ['PENDING', 'ACTIVE', 'ARCHIVED'].includes(String(status).toUpperCase())) {
        params.push(String(status).toUpperCase());
        whereClause = `WHERE t.status = $${params.length}`;
      }

      params.push(parsedLimit, parsedOffset);

      const { rows: teams } = await pool.query(`
        SELECT 
          t.id, t.name, t.status, t.nsac_link, t.created_at, t.last_synced_at,
          t.text_channel_id, t.voice_channel_id, t.category_id, t.role_id,
          u.username as leader_username, u.discord_id as leader_discord_id,
          c.title as challenge_title,
          (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count,
          tr.id as recruitment_id, tr.status as recruitment_status, tr.slots_needed, tr.description as recruitment_desc
        FROM teams t
        LEFT JOIN users u ON t.leader_id = u.id
        LEFT JOIN challenges c ON t.challenge_id = c.id
        LEFT JOIN team_recruitments tr ON tr.team_id = t.id AND tr.status = 'OPEN'
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      return res.json({ success: true, teams });
    } catch (err) {
      logger.error(`[Dashboard API] /teams error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/teams/:id', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      if (isNaN(teamId)) {
        return res.status(400).json({ success: false, error: 'ID Tim tidak valid.' });
      }

      const team = await getTeamById(teamId);
      if (!team || team.status === 'DISBANDED') {
        return res.status(404).json({ success: false, error: 'Tim tidak ditemukan.' });
      }

      const [members, openRecruit] = await Promise.all([
        getActiveTeamMembers(teamId),
        getOpenRecruitmentByTeam(teamId)
      ]);

      return res.json({
        success: true,
        team: {
          ...team,
          members: members.map(m => ({
            id: m.id,
            user_id: m.user_id,
            username: m.username,
            discord_id: m.discord_id,
            role: m.role,
            status: m.status,
            joined_at: m.joined_at
          })),
          recruitment: openRecruit ? {
            id: openRecruit.id,
            status: openRecruit.status,
            slots_needed: openRecruit.slots_needed,
            description: openRecruit.description
          } : null
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] GET /teams/:id error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/rename', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { name } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Nama tim baru wajib diisi.' });
      }

      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.renameTeam(teamId, name.trim(), guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] renameTeam error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/transfer-leader', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { discordId } = req.body || {};
      if (!discordId || !discordId.trim()) {
        return res.status(400).json({ success: false, error: 'Discord ID ketua baru wajib diisi.' });
      }

      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.transferLeader(teamId, discordId.trim(), guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] transferLeader error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/add-member', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { discordId } = req.body || {};
      if (!discordId || !discordId.trim()) {
        return res.status(400).json({ success: false, error: 'Discord ID anggota wajib diisi.' });
      }

      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.addMemberToTeam(teamId, discordId.trim(), guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] addMemberToTeam error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/remove-member', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { discordId } = req.body || {};
      if (!discordId || !discordId.trim()) {
        return res.status(400).json({ success: false, error: 'Discord ID anggota wajib diisi.' });
      }

      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.removeMemberFromTeam(teamId, discordId.trim(), guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] removeMemberFromTeam error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/archive', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.archiveTeam(teamId, guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] archiveTeam error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/delete', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const result = await TeamService.deleteTeam(teamId, guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] deleteTeam error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/teams/:id/nsac-link', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { nsacLink } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const trimmedLink = nsacLink && String(nsacLink).trim().length > 0 ? String(nsacLink).trim() : null;
      const result = await TeamService.setTeamNsacLink(teamId, trimmedLink, guild, client, 'Web Dashboard');
      if (!result.success) {
        return res.status(400).json(result);
      }

      if (trimmedLink) {
        try {
          await NasaValidationService.syncTeam(teamId, client);
        } catch (syncErr) {
          logger.warn(`[Dashboard API] Sync NASA after link update failed for team ${teamId}: ${syncErr.message}`);
        }
      }

      return res.json({ success: true, message: 'Tautan web NASA berhasil disimpan.', team: result.team });
    } catch (err) {
      logger.error(`[Dashboard API] setTeamNsacLink error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/recruitments', requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT 
          tr.*,
          t.name as local_team_name,
          u.discord_id as leader_discord_id,
          u.username as leader_username,
          c.title as challenge_title
        FROM team_recruitments tr
        LEFT JOIN teams t ON tr.team_id = t.id
        LEFT JOIN users u ON t.leader_id = u.id
        LEFT JOIN challenges c ON t.challenge_id = c.id
        WHERE tr.status = 'OPEN'
        ORDER BY tr.created_at DESC
      `);

      return res.json({ success: true, recruitments: rows });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/recruitments/:id/close', requireAuth, async (req, res) => {
    try {
      const recruitId = parseInt(req.params.id, 10);
      const recruit = await getRecruitmentById(recruitId);
      if (!recruit) {
        return res.status(404).json({ success: false, error: 'Data lowongan tidak ditemukan.' });
      }

      await closeRecruitment(recruitId);

      // Attempt to edit or delete message on Discord
      const guild = getGuild();
      if (guild && recruit.channel_id && recruit.message_id) {
        const ch = guild.channels.cache.get(recruit.channel_id)
          || await guild.channels.fetch(recruit.channel_id).catch(() => null);
        if (ch && ch.isTextBased()) {
          const msg = await ch.messages.fetch(recruit.message_id).catch(() => null);
          if (msg) {
            const closedEmbed = EmbedBuilder.from(msg.embeds[0] || {})
              .setTitle(`[DITUTUP] ${msg.embeds[0]?.title || 'Lowongan Tim'}`)
              .setColor(EMBED_COLORS.SECONDARY || 0x747f8d);
            await msg.edit({ embeds: [closedEmbed], components: [] }).catch(() => {});
          }
        }
      }

      return res.json({ success: true, message: 'Lowongan berhasil ditutup.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Trigger manual sync from NASA Space Apps Website
  router.post('/teams/sync-nasa', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      const result = await NasaValidationService.syncOpenRecruitmentFromWeb(client, guild);
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] /teams/sync-nasa error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 6. Config Management
  // ==========================================
  router.get('/config', requireAuth, async (req, res) => {
    try {
      const configs = [];
      for (const [key, def] of Object.entries(CONFIG_DEFINITIONS)) {
        configs.push({
          key,
          label: def.label,
          type: def.type,
          description: def.description,
          value: GuildConfigService.get(key) || ''
        });
      }
      return res.json({ success: true, configs });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/config', requireAuth, async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || !CONFIG_DEFINITIONS[key]) {
        return res.status(400).json({ success: false, error: 'Kunci konfigurasi tidak valid.' });
      }

      await GuildConfigService.set(key, String(value || '').trim());
      return res.json({ success: true, message: `Konfigurasi ${key} berhasil diperbarui.` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { env } from '../../config/env.js';
import { pool } from '../../database/pool.js';
import { EMBED_COLORS } from '../../config/constants.js';
import { GuildConfigService, CONFIG_DEFINITIONS } from '../../services/guildConfigService.js';
import { PermissionService } from '../../services/permissionService.js';
import { NasaValidationService } from '../../services/nasaValidationService.js';
import { AuditService } from '../../services/auditService.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { closeRecruitment, getRecruitmentById, getOpenRecruitmentByTeam } from '../../database/queries/recruitmentQueries.js';
import { TeamService } from '../../services/teamService.js';
import { getTeamById, updateTeamChallenge, purgeDisbandedTeams } from '../../database/queries/teamQueries.js';
import { getActiveTeamMembers } from '../../database/queries/memberQueries.js';
import { upsertUser } from '../../database/queries/userQueries.js';
import { ChallengeService } from '../../services/challengeService.js';
import {
  getAllChallenges,
  getChallengeById,
  createChallenge,
  updateChallenge,
  deleteChallenge
} from '../../database/queries/challengeQueries.js';
import { buildTeamPanelDashboard } from '../../commands/team/team.js';
import { TicketService } from '../../services/ticketService.js';
import { getTickets, getTicketById, countOpenTickets } from '../../database/queries/ticketQueries.js';
import { getAuditLogs } from '../../database/queries/auditQueries.js';
import {
  getAllDynamicEmbeds,
  getDynamicEmbedById,
  createDynamicEmbed,
  updateDynamicEmbedHeader,
  updateDynamicEmbedFields,
  deleteDynamicEmbed
} from '../../database/queries/faqQueries.js';
import { FAQService } from '../../services/faqService.js';
import { CountdownService } from '../../services/countdownService.js';
import { InviteService } from '../../services/inviteService.js';
import { getRecentInviteJoins, getTopInviters, getInviteTrackerStats } from '../../database/queries/inviteQueries.js';
import { ExportService } from '../../services/exportService.js';
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

// Active dashboard session tokens in memory: token -> sessionUser
const activeSessions = new Map();

export function createApiRouter(client) {
  const router = express.Router();

  // Helper to get active Guild
  const getGuild = () => {
    if (env.GUILD_ID && client.guilds.cache.has(env.GUILD_ID)) {
      return client.guilds.cache.get(env.GUILD_ID);
    }
    return client.guilds.cache.first();
  };

  // Helper to determine OAuth2 Redirect URI
  const getRedirectUri = (req) => {
    if (env.DASHBOARD_BASE_URL && env.DASHBOARD_BASE_URL.startsWith('http')) {
      return `${env.DASHBOARD_BASE_URL.replace(/\/$/, '')}/api/auth/discord/callback`;
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${protocol}://${host}/api/auth/discord/callback`;
  };

  // Auth Middleware
  const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.headers['x-dashboard-token'];

    if (!token || !activeSessions.has(token)) {
      return res.status(401).json({ success: false, error: 'Akses tidak sah. Silakan login terlebih dahulu.' });
    }
    req.user = activeSessions.get(token);
    next();
  };

  // ==========================================
  // 1. Discord OAuth2 Auth Endpoints (Pure OAuth2 RBAC)
  // ==========================================

  // Discord OAuth2 Login redirect
  router.get('/auth/discord/login', (req, res) => {
    if (!env.CLIENT_ID) {
      return res.status(500).send('CLIENT_ID belum dikonfigurasi di server.');
    }
    const redirectUri = getRedirectUri(req);
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify`;
    return res.redirect(discordAuthUrl);
  });

  // Discord OAuth2 Callback
  router.get('/auth/discord/callback', async (req, res) => {
    const { code, error, error_description } = req.query;

    if (error || !code) {
      const msg = error_description || 'Otorisasi Discord dibatalkan atau gagal.';
      return res.redirect(`/?error=${encodeURIComponent(msg)}`);
    }

    const clientSecret = (
      process.env.DISCORD_CLIENT_SECRET ||
      process.env.CLIENT_SECRET ||
      process.env.DISCORD_SECRET ||
      env.DISCORD_CLIENT_SECRET ||
      ''
    ).trim().replace(/^["']|["']$/g, '');

    if (!clientSecret) {
      logger.error('[OAuth2 Error] DISCORD_CLIENT_SECRET belum aktif di container');
      return res.redirect(`/?error=${encodeURIComponent('Server belum membaca DISCORD_CLIENT_SECRET.')}`);
    }

    try {
      const redirectUri = getRedirectUri(req);

      // Exchange code for access token
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: env.CLIENT_ID,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: redirectUri
        })
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        logger.error(`[OAuth2 Error] Gagal exchange token Discord: ${JSON.stringify(tokenData)}`);
        return res.redirect(`/?error=${encodeURIComponent(tokenData.error_description || 'Gagal menukar kode otorisasi Discord. Pastikan Redirect URI di Discord Developer Portal sesuai.')}`);
      }

      // Fetch user profile from Discord
      const userRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      });

      const userData = await userRes.json();
      if (!userRes.ok || !userData.id) {
        return res.redirect(`/?error=${encodeURIComponent('Gagal mengambil data profil pengguna dari Discord.')}`);
      }

      // Check Guild Member & Staff / Admin Permissions
      const guild = getGuild();
      if (!guild) {
        return res.redirect(`/?error=${encodeURIComponent('Server Discord NSAC Jember tidak ditemukan oleh bot.')}`);
      }

      const member = guild.members.cache.get(userData.id)
        || await guild.members.fetch(userData.id).catch(() => null);

      if (!member) {
        return res.redirect(`/?error=${encodeURIComponent('Akses Ditolak: Anda belum bergabung di server Discord NSAC Jember.')}`);
      }

      const isStaffOrAdmin = PermissionService.isStaff(member);
      if (!isStaffOrAdmin) {
        return res.redirect(`/?error=${encodeURIComponent('Akses Ditolak: Akun Discord @' + userData.username + ' tidak memiliki role Staff/Panitia/Admin di server NSAC Jember.')}`);
      }

      // Create authenticated session
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const avatarUrl = userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${(parseInt(userData.discriminator || '0', 10) || 0) % 5}.png`;

      activeSessions.set(sessionToken, {
        userId: userData.id,
        username: userData.username,
        globalName: userData.global_name || userData.username,
        avatar: userData.avatar,
        avatarUrl,
        isStaff: true,
        createdAt: Date.now()
      });

      logger.info(`[OAuth2 Login] Panitia @${userData.username} (${userData.id}) berhasil login ke Web Dashboard.`);

      await AuditService.log(client, {
        action: 'GENERAL_LOG',
        title: 'Dashboard Login',
        actorId: userData.id,
        actorTag: userData.username,
        details: `Panitia @${userData.username} (${userData.id}) berhasil login ke Web Dashboard via Discord OAuth2.`
      }).catch(() => {});

      return res.redirect(`/?token=${sessionToken}`);
    } catch (err) {
      logger.error(`[OAuth2 Error] Exception callback: ${err.message}`);
      return res.redirect(`/?error=${encodeURIComponent('Terjadi kesalahan internal saat autentikasi Discord.')}`);
    }
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    return res.json({ success: true, authenticated: true, user: req.user });
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.headers['x-dashboard-token'];

    if (token) {
      activeSessions.delete(token);
    }
    return res.json({ success: true, message: 'Berhasil logout.' });
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
        roleIds = [],
        imageUrl = '',
        footerText = '',
        blocks = []
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
        .setTitle(safeTitle)
        .setDescription(safeDesc)
        .setTimestamp();

      if (footerText && footerText.trim()) {
        embed.setFooter({ text: footerText.trim() });
      }

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

      // Multi-Role Mentions construction
      const mentions = [];
      if (mentionType === 'everyone') {
        mentions.push('@everyone');
      } else if (mentionType === 'here') {
        mentions.push('@here');
      } else if (mentionType === 'role') {
        let parsedRoleIds = [];
        if (Array.isArray(roleIds)) {
          parsedRoleIds = roleIds;
        } else if (typeof roleIds === 'string' && roleIds.trim()) {
          try {
            parsedRoleIds = JSON.parse(roleIds);
          } catch {
            parsedRoleIds = roleIds.split(',').map(s => s.trim()).filter(Boolean);
          }
        }
        if (roleId && !parsedRoleIds.includes(roleId)) parsedRoleIds.push(roleId);
        if (roleId2 && !parsedRoleIds.includes(roleId2)) parsedRoleIds.push(roleId2);

        for (const rid of parsedRoleIds) {
          if (rid && /^\d+$/.test(rid)) {
            mentions.push(`<@&${rid}>`);
          }
        }
      }

      const content = mentions.length > 0 ? mentions.join(' ') : undefined;

      // Interleaved Multi-Embed Blocks (Teks & Gambar bergantian)
      let parsedBlocks = [];
      if (Array.isArray(blocks)) {
        parsedBlocks = blocks;
      } else if (typeof blocks === 'string' && blocks.trim()) {
        try {
          parsedBlocks = JSON.parse(blocks);
        } catch {
          parsedBlocks = [];
        }
      }

      const allEmbeds = [embed];
      if (Array.isArray(parsedBlocks)) {
        for (const blk of parsedBlocks) {
          if (!blk || (!blk.text && !blk.imageUrl && !blk.title)) continue;
          const bEmbed = new EmbedBuilder().setColor(embedColor);
          if (blk.title && blk.title.trim()) {
            bEmbed.setTitle(blk.title.trim().substring(0, 256));
          }
          if (blk.text && blk.text.trim()) {
            bEmbed.setDescription(blk.text.trim().substring(0, 4096));
          }
          if (blk.imageUrl && (blk.imageUrl.startsWith('http://') || blk.imageUrl.startsWith('https://'))) {
            bEmbed.setImage(blk.imageUrl.trim());
          }
          allEmbeds.push(bEmbed);
          if (allEmbeds.length >= 10) break; // Discord limit is max 10 embeds per message
        }
      }

      const sentMsg = await targetChannel.send({
        content,
        embeds: allEmbeds,
        files: files.length > 0 ? files : undefined,
        allowedMentions: { parse: ['roles', 'users', 'everyone'] }
      });

      // Audit log
      AuditService.log(client, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_POSTED || 'ANNOUNCEMENT_POSTED',
        title: 'Web Dashboard Announcement',
        details: `Pengumuman "${safeTitle}" (${allEmbeds.length} embed) berhasil diposting ke channel #${targetChannel.name} oleh Web Dashboard.`
      }).catch(() => {});

      return res.json({
        success: true,
        data: {
          messageId: sentMsg.id,
          channelId: targetChannel.id,
          channelName: targetChannel.name,
          embedCount: allEmbeds.length
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] /announce error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // Dynamic Live Embeds (Rules / FAQ / Guides)
  // ==========================================
  router.get('/dynamic-embeds', requireAuth, async (req, res) => {
    try {
      const embeds = await getAllDynamicEmbeds();
      return res.json({ success: true, embeds });
    } catch (err) {
      logger.error(`[Dashboard API] GET /dynamic-embeds error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/dynamic-embeds/:id', requireAuth, async (req, res) => {
    try {
      const embed = await getDynamicEmbedById(req.params.id);
      if (!embed) {
        return res.status(404).json({ success: false, error: 'Dynamic embed tidak ditemukan' });
      }
      return res.json({ success: true, embed });
    } catch (err) {
      logger.error(`[Dashboard API] GET /dynamic-embeds/:id error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/dynamic-embeds', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan' });

      const { id, channelId, title, description = '', color = 'PRIMARY', fields = [] } = req.body;

      if (!id || !id.trim()) {
        return res.status(400).json({ success: false, error: 'ID embed wajib diisi (misal: faq-peserta, rules).' });
      }
      const safeId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');

      const existing = await getDynamicEmbedById(safeId);
      if (existing) {
        return res.status(400).json({ success: false, error: `Embed dengan ID "${safeId}" sudah ada. Gunakan ID lain atau edit yang sudah ada.` });
      }

      if (!channelId) {
        return res.status(400).json({ success: false, error: 'Channel Discord tujuan wajib dipilih.' });
      }
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, error: 'Judul embed wajib diisi.' });
      }

      const targetChannel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);

      if (!targetChannel || !targetChannel.isTextBased()) {
        return res.status(400).json({ success: false, error: 'Channel Discord tidak valid atau bukan text channel.' });
      }

      // Build Discord embed
      const embedData = {
        title: title.trim(),
        description: description?.trim() || '',
        color: color || 'PRIMARY',
        fields: Array.isArray(fields) ? fields : []
      };

      const embed = FAQService.buildEmbed(embedData);
      const sentMsg = await targetChannel.send({ embeds: [embed] });

      const record = await createDynamicEmbed({
        id: safeId,
        channelId: targetChannel.id,
        messageId: sentMsg.id,
        title: embedData.title,
        description: embedData.description,
        color: embedData.color,
        fields: embedData.fields
      });

      AuditService.log(client, {
        action: 'DYNAMIC_EMBED_CREATED',
        title: 'Dynamic Embed Created',
        details: `Embed "${safeId}" diposting ke #${targetChannel.name} (Msg ID: ${sentMsg.id}).`
      }).catch(() => {});

      return res.json({ success: true, embed: record });
    } catch (err) {
      logger.error(`[Dashboard API] POST /dynamic-embeds error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/dynamic-embeds/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getDynamicEmbedById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Dynamic embed tidak ditemukan' });
      }

      const { title, description, color, fields } = req.body;

      if (title !== undefined || description !== undefined || color !== undefined) {
        await updateDynamicEmbedHeader(id, {
          title: title ? title.trim() : existing.title,
          description: description !== undefined ? description.trim() : existing.description,
          color: color || existing.color
        });
      }

      if (fields !== undefined) {
        const safeFields = Array.isArray(fields) ? fields : [];
        await updateDynamicEmbedFields(id, safeFields);
      }

      const updatedRecord = await getDynamicEmbedById(id);

      // Sync to live Discord message in-place
      await FAQService.syncDiscordMessage(client, updatedRecord);

      AuditService.log(client, {
        action: 'DYNAMIC_EMBED_UPDATED',
        title: 'Dynamic Embed Updated',
        details: `Dynamic embed "${id}" diperbarui dan disinkronkan ke Discord.`
      }).catch(() => {});

      return res.json({ success: true, embed: updatedRecord });
    } catch (err) {
      logger.error(`[Dashboard API] PUT /dynamic-embeds/:id error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/dynamic-embeds/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await getDynamicEmbedById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Dynamic embed tidak ditemukan' });
      }

      // Try deleting message from Discord channel
      try {
        const guild = getGuild();
        if (guild) {
          const channel = guild.channels.cache.get(existing.channel_id)
            || await guild.channels.fetch(existing.channel_id).catch(() => null);
          if (channel && channel.isTextBased()) {
            const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
          }
        }
      } catch (e) {
        logger.warn(`[Dashboard API] Could not delete Discord message for embed "${id}": ${e.message}`);
      }

      await deleteDynamicEmbed(id);

      AuditService.log(client, {
        action: 'DYNAMIC_EMBED_DELETED',
        title: 'Dynamic Embed Deleted',
        details: `Dynamic embed "${id}" dihapus dari database & channel.`
      }).catch(() => {});

      return res.json({ success: true, message: `Embed "${id}" berhasil dihapus.` });
    } catch (err) {
      logger.error(`[Dashboard API] DELETE /dynamic-embeds/:id error: ${err.message}`);
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

      const result = await TeamService.renameTeam(teamId, name.trim(), guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

      const result = await TeamService.transferLeader(teamId, discordId.trim(), guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

      const result = await TeamService.addMemberToTeam(teamId, discordId.trim(), guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

      const result = await TeamService.removeMemberFromTeam(teamId, discordId.trim(), guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

      const result = await TeamService.archiveTeam(teamId, guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

      const result = await TeamService.deleteTeam(teamId, guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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
      const result = await TeamService.setTeamNsacLink(teamId, trimmedLink, guild, client, req.user?.username ? `@${req.user.username}` : 'Web Dashboard');
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

  // ==========================================
  // Team Advanced Staff Endpoints (/team subcommands)
  // ==========================================

  // Set / Update Team Challenge (/team set-challenge)
  router.post('/teams/:id/challenge', requireAuth, async (req, res) => {
    try {
      const teamId = parseInt(req.params.id, 10);
      const { challengeId } = req.body || {};
      const parsedChallengeId = challengeId ? parseInt(challengeId, 10) : null;

      const team = await getTeamById(teamId);
      if (!team) return res.status(404).json({ success: false, error: 'Tim tidak ditemukan.' });

      await updateTeamChallenge(teamId, parsedChallengeId);

      const guild = getGuild();
      if (guild && team.text_channel_id) {
        const teamChannel = guild.channels.cache.get(team.text_channel_id);
        if (teamChannel) {
          const chObj = parsedChallengeId ? await getChallengeById(parsedChallengeId) : null;
          const challengeTitle = chObj ? chObj.title : 'Belum Memilih Challenge';
          await teamChannel.setTopic(`Tim: ${team.name} | Topik: ${challengeTitle}`).catch(() => {});
        }
      }

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAM_CHALLENGE_UPDATED || 'TEAM_CHALLENGE_UPDATED',
        title: 'Topik Challenge Tim Diperbarui',
        actorTag: req.user?.username ? `@${req.user.username}` : 'Web Dashboard',
        details: `Topik challenge untuk tim "${team.name}" diperbarui ke ID ${parsedChallengeId || 'None'} oleh Web Dashboard.`
      });

      return res.json({ success: true, message: 'Challenge tim berhasil diperbarui.' });
    } catch (err) {
      logger.error(`[Dashboard API] /teams/:id/challenge error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Purge Disbanded Teams (/team purge-disbanded)
  router.post('/teams/purge-disbanded', requireAuth, async (req, res) => {
    try {
      const purgedTeams = await purgeDisbandedTeams();
      const count = purgedTeams.length;

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAMS_PURGED || 'TEAMS_PURGED',
        title: 'Pembersihan Tim Bubar via Dashboard',
        actorTag: req.user?.username ? `@${req.user.username}` : 'Web Dashboard',
        details: `${count} tim berstatus DISBANDED dihapus permanen dari database oleh Web Dashboard.`
      });

      return res.json({
        success: true,
        message: count > 0 ? `Berhasil menghapus permanen ${count} tim bubar.` : 'Tidak ada data tim berstatus DISBANDED di database.',
        count,
        purgedTeams
      });
    } catch (err) {
      logger.error(`[Dashboard API] /teams/purge-disbanded error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Force Register Team (/team force-register)
  router.post('/teams/force-register', requireAuth, async (req, res) => {
    try {
      const { name, leaderId, memberIds = [], challengeId, nsacLink } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Nama tim minimal 3 karakter.' });
      }
      if (!leaderId) {
        return res.status(400).json({ success: false, error: 'Leader Discord ID wajib diisi.' });
      }

      const leaderMember = guild.members.cache.get(leaderId) || await guild.members.fetch(leaderId).catch(() => null);
      if (!leaderMember) {
        return res.status(400).json({ success: false, error: 'User leader tidak ditemukan di server Discord.' });
      }

      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      const cleanMemberIds = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];

      const result = await TeamService.startRegistration({
        teamName: name.trim(),
        leaderMember,
        memberIds: cleanMemberIds,
        guild,
        client,
        skipInvitations: true,
        allowSolo: true
      });

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      await TeamService.finalizeTeamCreation(result.team.id, guild, client);

      if (challengeId) {
        const parsedChId = parseInt(challengeId, 10);
        if (!isNaN(parsedChId)) {
          await updateTeamChallenge(result.team.id, parsedChId);
        }
      }

      if (nsacLink && String(nsacLink).trim().length > 0) {
        await TeamService.setTeamNsacLink(result.team.id, String(nsacLink).trim(), guild, client, actorTag);
      }

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAM_CREATED || 'TEAM_CREATED',
        title: 'Force Register Tim via Dashboard',
        actorTag,
        details: `Tim "${name.trim()}" (ID: ${result.team.id}) berhasil didaftarkan langsung oleh ${actorTag} dengan ${cleanMemberIds.length + 1} anggota.`
      });

      return res.json({ success: true, message: `Tim "${name.trim()}" berhasil didaftarkan dan diaktifkan.`, team: result.team });
    } catch (err) {
      logger.error(`[Dashboard API] /teams/force-register error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Deploy Team Interactive Panel (/team panel)
  router.post('/teams/deploy-panel', requireAuth, async (req, res) => {
    try {
      const { channelId } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      let targetChannel = null;
      if (channelId) {
        targetChannel = guild.channels.cache.get(channelId);
      } else {
        const regChannelId = GuildConfigService.get('REGISTRATION_PANEL_CHANNEL_ID');
        if (regChannelId) targetChannel = guild.channels.cache.get(regChannelId);
      }

      if (!targetChannel || !targetChannel.isTextBased()) {
        return res.status(400).json({ success: false, error: 'Channel panel tidak valid atau tidak ditemukan.' });
      }

      const { embed, components } = await buildTeamPanelDashboard(guild);
      await targetChannel.send({ embeds: [embed], components });

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_POSTED || 'ANNOUNCEMENT_POSTED',
        title: 'Team Panel Deployed',
        actorTag: req.user?.username ? `@${req.user.username}` : 'Web Dashboard',
        details: `Interactive team panel deployed to #${targetChannel.name} by Web Dashboard.`
      });

      return res.json({ success: true, message: `Panel registrasi & tim berhasil diposting ke channel #${targetChannel.name}.` });
    } catch (err) {
      logger.error(`[Dashboard API] /teams/deploy-panel error: ${err.message}`);
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

  // ==========================================
  // NASA Web Teams (Snapshots from spaceappschallenge.org)
  // ==========================================
  router.get('/web-teams', requireAuth, async (req, res) => {
    try {
      const { recruiting, matched, q } = req.query;

      // 1. Get all web teams from DB
      const { rows: webTeams } = await pool.query(`
        SELECT * FROM web_teams
        ORDER BY is_recruiting DESC, title ASC
      `);

      // 2. Get active local teams for matching
      const { rows: localTeams } = await pool.query(`
        SELECT id, name, nsac_link
        FROM teams
        WHERE status != 'DISBANDED'
      `);

      // 3. Perform matching using identical logic
      let list = webTeams.map((wt) => {
        const matchedLocal = localTeams.find((lt) => {
          const nameMatches = lt.name && wt.title && lt.name.trim().toLowerCase() === wt.title.trim().toLowerCase();
          const linkMatches = lt.nsac_link && wt.slug && lt.nsac_link.toLowerCase().includes(wt.slug.toLowerCase());
          return nameMatches || linkMatches;
        });

        return {
          ...wt,
          matched_team_id: matchedLocal ? matchedLocal.id : null,
          matched_team_name: matchedLocal ? matchedLocal.name : null
        };
      });

      // 4. Filters
      if (recruiting === 'true') {
        list = list.filter(t => t.is_recruiting === true);
      } else if (recruiting === 'false') {
        list = list.filter(t => t.is_recruiting === false);
      }

      if (matched === 'true') {
        list = list.filter(t => t.matched_team_id !== null);
      } else if (matched === 'false') {
        list = list.filter(t => t.matched_team_id === null);
      }

      if (q && q.trim()) {
        const query = q.trim().toLowerCase();
        list = list.filter(t =>
          (t.title && t.title.toLowerCase().includes(query)) ||
          (t.challenge_title && t.challenge_title.toLowerCase().includes(query)) ||
          (t.matched_team_name && t.matched_team_name.toLowerCase().includes(query))
        );
      }

      return res.json({ success: true, webTeams: list });
    } catch (err) {
      logger.error(`[Dashboard API] /web-teams error: ${err.message}`);
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
      const guild = getGuild();
      const discordOptions = {
        roles: [],
        textChannels: [],
        voiceChannels: [],
        categories: []
      };

      if (guild) {
        await guild.channels.fetch().catch(() => {});
        await guild.roles.fetch().catch(() => {});

        discordOptions.roles = guild.roles.cache
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));

        discordOptions.textChannels = guild.channels.cache
          .filter((c) => c.isTextBased())
          .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
          .map((c) => ({ id: c.id, name: c.name, type: c.type }));

        discordOptions.voiceChannels = guild.channels.cache
          .filter((c) => c.type === ChannelType.GuildVoice)
          .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
          .map((c) => ({ id: c.id, name: c.name }));

        discordOptions.categories = guild.channels.cache
          .filter((c) => c.type === ChannelType.GuildCategory)
          .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
          .map((c) => ({ id: c.id, name: c.name }));
      }

      const configs = [];
      for (const [key, def] of Object.entries(CONFIG_DEFINITIONS)) {
        if (key === 'BOT_PRESENCE_CONFIG') continue;
        configs.push({
          key,
          label: def.label,
          type: def.type,
          category: def.category || 'SYSTEM',
          description: def.description,
          value: GuildConfigService.get(key) || ''
        });
      }
      return res.json({ success: true, configs, options: discordOptions });
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

      await GuildConfigService.set(key, String(value ?? '').trim());
      return res.json({ success: true, message: `Konfigurasi ${key} berhasil diperbarui.` });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // Bot Presence & Activity Management Endpoints
  // ==========================================
  router.get('/bot-presence', requireAuth, async (req, res) => {
    try {
      const config = CountdownService.getPresenceConfig();
      const liveVariables = await CountdownService.getLiveVariables(client);
      const currentActivity = CountdownService.currentPresenceText;

      return res.json({
        success: true,
        config,
        liveVariables,
        currentActivity,
        availablePlaceholders: [
          { tag: '{countdown}', label: 'Hitung Mundur Hackathon', sample: liveVariables.countdown },
          { tag: '{teams}', label: 'Jumlah Tim Aktif', sample: String(liveVariables.teams) },
          { tag: '{participants}', label: 'Jumlah Peserta Terdaftar', sample: String(liveVariables.participants) },
          { tag: '{members}', label: 'Total Member Server', sample: String(liveVariables.members) }
        ],
        activityTypes: [
          { value: 'WATCHING', label: 'Menonton (Watching)' },
          { value: 'PLAYING', label: 'Bermain (Playing)' },
          { value: 'LISTENING', label: 'Mendengarkan (Listening)' },
          { value: 'COMPETING', label: 'Bertanding (Competing)' },
          { value: 'CUSTOM', label: 'Kustom (Custom)' }
        ],
        statusTypes: [
          { value: 'online', label: 'Online (Hijau)' },
          { value: 'idle', label: 'Idle (Kuning)' },
          { value: 'dnd', label: 'Jangan Ganggu (Merah)' },
          { value: 'invisible', label: 'Invisible (Offline)' }
        ]
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/bot-presence', requireAuth, async (req, res) => {
    try {
      const { enabled, intervalSeconds, statusType, activities } = req.body;
      if (!Array.isArray(activities) || activities.length === 0) {
        return res.status(400).json({ success: false, error: 'Daftar aktivitas status bot tidak boleh kosong.' });
      }

      const saved = await CountdownService.savePresenceConfig({
        enabled: !!enabled,
        intervalSeconds: parseInt(intervalSeconds, 10) || 60,
        statusType: statusType || 'online',
        activities
      }, client);

      return res.json({
        success: true,
        message: 'Status dan perputaran teks bot berhasil diperbarui dan diterapkan.',
        config: saved
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // Invite Tracker Endpoints
  // ==========================================
  router.get('/invites', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) {
        return res.status(503).json({ success: false, error: 'Guild Discord tidak ditemukan.' });
      }

      const [invites, recentJoins, topInviters, trackerStats] = await Promise.all([
        InviteService.getAllGuildInvitesWithStats(guild),
        getRecentInviteJoins(50),
        getTopInviters(10),
        getInviteTrackerStats()
      ]);

      const totalUses = invites.reduce((acc, inv) => acc + (inv.uses || 0), 0);
      const dynamicCount = invites.filter((inv) => inv.isDynamic).length;
      const activeInvites = invites.filter((inv) => !inv.isExpired).length;

      return res.json({
        success: true,
        invites,
        recentJoins,
        topInviters,
        stats: {
          totalInvites: invites.length,
          activeInvites,
          totalUses,
          dynamicCount,
          totalJoinsTracked: trackerStats.totalJoins,
          uniqueMembersTracked: trackerStats.uniqueMembers
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] /invites error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/invites', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) {
        return res.status(503).json({ success: false, error: 'Guild Discord tidak ditemukan.' });
      }

      const { roleIds, channelId, label, maxAge = 0, maxUses = 0 } = req.body;
      if (!roleIds || !Array.isArray(roleIds) || roleIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal satu role untuk link invite otomatis.' });
      }

      let targetChannel = null;
      if (channelId) {
        targetChannel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      }

      const creatorTag = req.user ? (req.user.username || req.user.tag) : 'Staff Dashboard';
      const created = await InviteService.createDynamicInvite(
        guild,
        roleIds,
        targetChannel,
        creatorTag,
        {
          maxAge: parseInt(maxAge, 10) || 0,
          maxUses: parseInt(maxUses, 10) || 0
        }
      );

      return res.json({
        success: true,
        message: `Link invite ${created.invite.code} berhasil dibuat.`,
        invite: {
          code: created.invite.code,
          url: created.invite.url,
          label: created.label,
          roleNames: created.roleNames
        }
      });
    } catch (err) {
      logger.error(`[Dashboard API] POST /invites error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/invites/:code', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) {
        return res.status(503).json({ success: false, error: 'Guild Discord tidak ditemukan.' });
      }

      const codeToDelete = (req.params.code || '').trim();
      if (!codeToDelete) {
        return res.status(400).json({ success: false, error: 'Kode invite tidak valid.' });
      }

      await InviteService.deleteDynamicInvite(guild, codeToDelete);
      return res.json({ success: true, message: `Link invite ${codeToDelete} berhasil dihapus.` });
    } catch (err) {
      logger.error(`[Dashboard API] DELETE /invites/:code error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // Ticket Management Endpoints
  // ==========================================
  router.get('/tickets', requireAuth, async (req, res) => {
    try {
      const { status, type, limit = 50, offset = 0 } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

      const guild = getGuild();
      const guildId = guild ? guild.id : (env.GUILD_ID || '');

      const tickets = await getTickets({ status, type, limit: parsedLimit, offset: parsedOffset });
      const openCount = await countOpenTickets();

      const enriched = tickets.map((t) => {
        const channelExists = !!(guild && guild.channels.cache.has(t.discord_channel_id));
        return {
          ...t,
          channel_exists: channelExists,
          discord_jump_url: guildId && t.discord_channel_id ? `https://discord.com/channels/${guildId}/${t.discord_channel_id}` : null
        };
      });

      return res.json({ success: true, tickets: enriched, openCount, limit: parsedLimit, offset: parsedOffset });
    } catch (err) {
      logger.error(`[Dashboard API] /tickets error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/tickets/open-count', requireAuth, async (req, res) => {
    try {
      const count = await countOpenTickets();
      return res.json({ success: true, count });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/tickets/:id/close', requireAuth, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
      }

      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      const result = await TicketService.closeTicketByChannelId(ticket.discord_channel_id, client, actorTag);
      return res.json(result);
    } catch (err) {
      logger.error(`[Dashboard API] /tickets/:id/close error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/tickets/:id/reply', requireAuth, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      const { message } = req.body || {};
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Pesan balasan tidak boleh kosong.' });
      }
      if (message.length > 2000) {
        return res.status(400).json({ success: false, error: 'Pesan balasan maksimal 2000 karakter.' });
      }

      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan.' });
      }

      const channel = client.channels.cache.get(ticket.discord_channel_id)
        || await client.channels.fetch(ticket.discord_channel_id).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ success: false, error: 'Channel tiket tidak ditemukan atau sudah terhapus di Discord.' });
      }

      const actorTag = req.user?.username ? `@${req.user.username}` : 'Panitia';
      await channel.send({
        content: `**[Balasan Panitia - ${actorTag}]**\n${message.trim()}`
      });

      await AuditService.log(client, {
        action: 'GENERAL_LOG',
        title: 'Ticket Reply',
        actorTag,
        actorId: req.user?.userId || null,
        details: `Membalas tiket #${ticket.id} (${ticket.type}) di channel #${channel.name}: "${message.trim().substring(0, 200)}"`
      }).catch(() => {});

      return res.json({ success: true, message: 'Balasan berhasil dikirim ke channel Discord.' });
    } catch (err) {
      logger.error(`[Dashboard API] /tickets/:id/reply error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 6B. Challenges API (/challenge CRUD & Broadcast)
  // ==========================================
  router.get('/challenges', requireAuth, async (req, res) => {
    try {
      const challenges = await getAllChallenges();
      return res.json({ success: true, challenges });
    } catch (err) {
      logger.error(`[Dashboard API] GET /challenges error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/challenges', requireAuth, async (req, res) => {
    try {
      const { title, description } = req.body || {};
      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      const result = await ChallengeService.create({ title, description, actorTag, client });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json({ success: true, message: 'Challenge berhasil ditambahkan.', challenge: result.challenge });
    } catch (err) {
      logger.error(`[Dashboard API] POST /challenges error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.put('/challenges/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { title, description } = req.body || {};
      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      const result = await ChallengeService.edit({ id, title, description, actorTag, client });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json({ success: true, message: 'Challenge berhasil diperbarui.', challenge: result.challenge });
    } catch (err) {
      logger.error(`[Dashboard API] PUT /challenges/:id error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.delete('/challenges/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      const result = await ChallengeService.remove({ id, actorTag, client });
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json({ success: true, message: 'Challenge berhasil dihapus.', challenge: result.challenge });
    } catch (err) {
      logger.error(`[Dashboard API] DELETE /challenges/:id error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/challenges/broadcast', requireAuth, async (req, res) => {
    try {
      const { channelId } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const targetChannel = guild.channels.cache.get(channelId);
      if (!targetChannel || !targetChannel.isTextBased()) {
        return res.status(400).json({ success: false, error: 'Channel target tidak valid atau bukan text channel.' });
      }

      const { challenges, embed } = await ChallengeService.getChallengesEmbed();
      await targetChannel.send({ embeds: [embed] });

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_POSTED || 'ANNOUNCEMENT_POSTED',
        title: 'Broadcast Daftar Challenge',
        actorTag: req.user?.username ? `@${req.user.username}` : 'Web Dashboard',
        details: `Daftar ${challenges.length} challenge diposting ke #${targetChannel.name} oleh Web Dashboard.`
      });

      return res.json({ success: true, message: `Daftar challenge berhasil diposting ke channel #${targetChannel.name}.` });
    } catch (err) {
      logger.error(`[Dashboard API] POST /challenges/broadcast error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 6C. Guild Members & Member Registration (/register member)
  // ==========================================
  router.get('/guild-members', requireAuth, async (req, res) => {
    try {
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const members = await guild.members.fetch({ limit: 1000 }).catch(() => guild.members.cache);
      const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');
      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');

      const mapped = members.filter((m) => !m.user.bot).map((m) => ({
        id: m.id,
        username: m.user.username,
        discriminator: m.user.discriminator,
        tag: m.user.tag || m.user.username,
        displayName: m.displayName,
        avatarUrl: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
        roles: m.roles.cache.map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
        isUnregistered: unregisteredRoleId ? m.roles.cache.has(unregisteredRoleId) : false,
        isParticipant: participantRoleId ? m.roles.cache.has(participantRoleId) : false
      }));

      return res.json({ success: true, members: mapped.slice(0, 500) });
    } catch (err) {
      logger.error(`[Dashboard API] /guild-members error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/members/register', requireAuth, async (req, res) => {
    try {
      const { userId, roleId, keepUnregistered = false } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      if (!userId) {
        return res.status(400).json({ success: false, error: 'User ID wajib dipilih.' });
      }

      const targetMember = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!targetMember) {
        return res.status(404).json({ success: false, error: 'Member tidak ditemukan di server Discord.' });
      }

      const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');
      const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
      const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');

      const rolesToAdd = [];
      if (roleId) {
        rolesToAdd.push(roleId);
        if (participantRoleId && roleId === participantRoleId && noTeamRoleId) {
          rolesToAdd.push(noTeamRoleId);
        }
      } else {
        if (!participantRoleId) {
          return res.status(400).json({ success: false, error: 'Role Participant belum diatur di konfigurasi server!' });
        }
        rolesToAdd.push(participantRoleId);
        if (noTeamRoleId) rolesToAdd.push(noTeamRoleId);
      }

      const rolesToApply = rolesToAdd.filter((rId) => !targetMember.roles.cache.has(rId));
      const rolesToRemove = [];
      if (!keepUnregistered && unregisteredRoleId && targetMember.roles.cache.has(unregisteredRoleId)) {
        rolesToRemove.push(unregisteredRoleId);
      }

      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';

      if (rolesToRemove.length > 0) {
        await targetMember.roles.remove(rolesToRemove, `Manual registration by ${actorTag}`);
      }
      if (rolesToApply.length > 0) {
        await targetMember.roles.add(rolesToApply, `Manual registration by ${actorTag}`);
      }

      const dbUser = await upsertUser(targetMember.id, targetMember.user.tag || targetMember.user.username);

      const addedNames = rolesToAdd.map((id) => {
        const r = guild.roles.cache.get(id);
        return r ? `@${r.name}` : id;
      }).join(' + ');

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.ROLE_ASSIGNED,
        title: 'Manual Member Registration via Dashboard',
        actorTag,
        targetUserId: dbUser.id,
        targetTag: targetMember.user.tag,
        details: `Member @${targetMember.user.tag} berhasil didaftarkan dengan role: ${addedNames}${rolesToRemove.length > 0 ? ' (role @Unregistered dicabut)' : ''}.`
      });

      return res.json({
        success: true,
        message: `Member @${targetMember.user.tag} berhasil didaftarkan dengan role ${addedNames}.`
      });
    } catch (err) {
      logger.error(`[Dashboard API] /members/register error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 6D. Channel Message Purge (/purge)
  // ==========================================
  router.post('/channels/purge', requireAuth, async (req, res) => {
    try {
      const { channelId, amount = 10, userId = null } = req.body || {};
      const guild = getGuild();
      if (!guild) return res.status(404).json({ success: false, error: 'Guild tidak ditemukan.' });

      const parsedAmount = Math.min(Math.max(parseInt(amount, 10) || 1, 1), 100);
      const targetChannel = guild.channels.cache.get(channelId);
      if (!targetChannel || !targetChannel.isTextBased()) {
        return res.status(400).json({ success: false, error: 'Channel tidak valid atau bukan text channel.' });
      }

      const actorTag = req.user?.username ? `@${req.user.username}` : 'Web Dashboard';
      let deletedCount = 0;

      if (userId) {
        const messages = await targetChannel.messages.fetch({ limit: 100 });
        const userMessages = messages.filter((m) => m.author.id === userId).first(parsedAmount);
        if (userMessages.length === 0) {
          return res.status(404).json({ success: false, error: 'Tidak ditemukan pesan dari user tersebut dalam 100 pesan terakhir.' });
        }
        const deleted = await targetChannel.bulkDelete(userMessages, true);
        deletedCount = deleted.size;
      } else {
        const deleted = await targetChannel.bulkDelete(parsedAmount, true);
        deletedCount = deleted.size;
      }

      await AuditService.log(client, {
        action: AUDIT_ACTIONS.MESSAGES_PURGED || 'MESSAGES_PURGED',
        title: 'Bulk Message Purge via Dashboard',
        actorTag,
        details: `Berhasil menghapus ${deletedCount} pesan di channel #${targetChannel.name}${userId ? ` dari user ${userId}` : ''}.`
      });

      return res.json({
        success: true,
        message: `Berhasil menghapus ${deletedCount} pesan di channel #${targetChannel.name}.`,
        deletedCount
      });
    } catch (err) {
      logger.error(`[Dashboard API] /channels/purge error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 7. Audit Logs
  // ==========================================
  router.get('/audit-logs', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const action = req.query.action || null;
      const teamId = req.query.teamId ? parseInt(req.query.teamId, 10) : null;
      const q = req.query.q || null;

      const { logs, total } = await getAuditLogs({ limit, offset, action, teamId, q });
      return res.json({ success: true, logs, total });
    } catch (err) {
      logger.error(`[Dashboard API] /audit-logs error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 8. Data Export (CSV / Excel for Teams & Participants)
  // ==========================================
  router.get('/export/teams', requireAuth, async (req, res) => {
    try {
      const format = (req.query.format || 'xlsx').toLowerCase();
      const guild = getGuild();
      const fileData = format === 'csv'
        ? await ExportService.exportTeamsToCsv(guild)
        : await ExportService.exportTeamsToExcel(guild);

      res.setHeader('Content-Type', fileData.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      return res.send(fileData.buffer);
    } catch (err) {
      logger.error(`[Dashboard API] /export/teams error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/export/participants', requireAuth, async (req, res) => {
    try {
      const format = (req.query.format || 'xlsx').toLowerCase();
      const guild = getGuild();
      const fileData = format === 'csv'
        ? await ExportService.exportParticipantsToCsv(guild)
        : await ExportService.exportParticipantsToExcel(guild);

      res.setHeader('Content-Type', fileData.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileData.filename}"`);
      return res.send(fileData.buffer);
    } catch (err) {
      logger.error(`[Dashboard API] /export/participants error: ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

import ExcelJS from 'exceljs';
import { pool } from '../database/pool.js';
import { GuildConfigService } from './guildConfigService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class ExportService {
  /**
   * Helper to format Date to Indonesian locale string
   */
  static formatDate(date) {
    if (!date) return '-';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(/\./g, ':');
    } catch {
      return String(date);
    }
  }

  /**
   * Mengumpulkan data seluruh tim (Discord dan Web Space Apps)
   */
  static async getTeamsExportData(guild = null) {
    // 1. Ambil tim Discord
    const { rows: dcTeams } = await pool.query(`
      SELECT 
        t.id, t.name, t.status, t.nsac_link, t.created_at, t.last_synced_at,
        t.text_channel_id, t.voice_channel_id,
        u.username as leader_username, u.discord_id as leader_discord_id,
        c.title as challenge_title,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') as member_count,
        tr.id as recruitment_id, tr.status as recruitment_status, tr.slots_needed
      FROM teams t
      LEFT JOIN users u ON t.leader_id = u.id
      LEFT JOIN challenges c ON t.challenge_id = c.id
      LEFT JOIN team_recruitments tr ON tr.team_id = t.id AND tr.status = 'OPEN'
      WHERE t.status != 'DISBANDED'
      ORDER BY t.created_at ASC
    `);

    // 2. Ambil snapshot tim web Space Apps
    const { rows: webTeams } = await pool.query(`
      SELECT * FROM web_teams
      ORDER BY title ASC
    `);

    const result = [];
    let counter = 1;

    // Masukkan tim Discord terlebih dahulu
    for (const t of dcTeams) {
      const activeCount = parseInt(t.member_count || 1, 10);
      const isRecruiting = t.recruitment_status === 'OPEN';
      const slotsNeeded = isRecruiting ? (t.slots_needed || Math.max(0, env.MAX_TEAM_SIZE - activeCount)) : 0;

      // Cek apakah tim ini terhubung ke web
      const matchedWeb = webTeams.find((wt) => {
        const nameMatches = wt.title && t.name && wt.title.trim().toLowerCase() === t.name.trim().toLowerCase();
        const linkMatches = t.nsac_link && wt.slug && t.nsac_link.toLowerCase().includes(wt.slug.toLowerCase());
        return nameMatches || linkMatches;
      });

      let channelName = '-';
      if (guild && t.text_channel_id) {
        const ch = guild.channels.cache.get(t.text_channel_id);
        if (ch) channelName = `#${ch.name}`;
      }

      result.push({
        no: counter++,
        tipe: matchedWeb ? 'Discord & Web' : 'Discord Server',
        nama: t.name,
        status: t.status,
        jumlahAnggota: activeCount,
        maxAnggota: env.MAX_TEAM_SIZE,
        slotKosong: Math.max(0, env.MAX_TEAM_SIZE - activeCount),
        statusRekrutmen: isRecruiting ? `Buka (${slotsNeeded} slot)` : 'Tutup',
        challenge: t.challenge_title || (matchedWeb?.challenge_title) || 'Belum memilih',
        leader: t.leader_username ? `@${t.leader_username}` : '-',
        leaderDiscordId: t.leader_discord_id || '-',
        nsacLink: t.nsac_link || matchedWeb?.url || '-',
        channelDiscord: channelName,
        terakhirSync: this.formatDate(t.last_synced_at || matchedWeb?.last_synced_at),
        dibuatPada: this.formatDate(t.created_at)
      });
    }

    // Masukkan tim Web yang BELUM terdaftar di Discord
    for (const wt of webTeams) {
      const alreadyInDc = dcTeams.some((t) => {
        const nameMatches = wt.title && t.name && wt.title.trim().toLowerCase() === t.name.trim().toLowerCase();
        const linkMatches = t.nsac_link && wt.slug && t.nsac_link.toLowerCase().includes(wt.slug.toLowerCase());
        return nameMatches || linkMatches;
      });

      if (!alreadyInDc) {
        const count = wt.member_count || 1;
        result.push({
          no: counter++,
          tipe: 'Space Apps Web (Belum di DC)',
          nama: wt.title,
          status: 'WEB ONLY',
          jumlahAnggota: count,
          maxAnggota: env.MAX_TEAM_SIZE,
          slotKosong: Math.max(0, env.MAX_TEAM_SIZE - count),
          statusRekrutmen: wt.is_recruiting ? 'Buka (Web)' : 'Tutup',
          challenge: wt.challenge_title || 'Belum memilih',
          leader: '*(Akun Web NASA)*',
          leaderDiscordId: '-',
          nsacLink: wt.url || `https://www.spaceappschallenge.org/2026/find-a-team/${wt.slug}/`,
          channelDiscord: '-',
          terakhirSync: this.formatDate(wt.last_synced_at),
          dibuatPada: this.formatDate(wt.created_at)
        });
      }
    }

    return result;
  }

  /**
   * Mengumpulkan data seluruh peserta (Guild members + Team info)
   */
  static async getParticipantsExportData(guild) {
    if (!guild) {
      throw new Error('Server Discord (Guild) tidak ditemukan.');
    }

    // Pastikan seluruh anggota server ter-fetch
    const members = await guild.members.fetch({ limit: 1000 }).catch(() => guild.members.cache);
    const participantRoleId = GuildConfigService.get('PARTICIPANT_ROLE_ID');
    const noTeamRoleId = GuildConfigService.get('NO_TEAM_ROLE_ID');
    const unregisteredRoleId = GuildConfigService.get('UNREGISTERED_ROLE_ID');

    // Ambil semua keanggotaan aktif tim dari database
    const { rows: teamMemberships } = await pool.query(`
      SELECT 
        tm.user_id, tm.role as team_role, tm.status as member_status, tm.joined_at,
        u.discord_id, u.username as db_username,
        t.name as team_name, t.status as team_status,
        c.title as challenge_title
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      JOIN teams t ON tm.team_id = t.id
      LEFT JOIN challenges c ON t.challenge_id = c.id
      WHERE tm.status = 'ACTIVE' AND t.status != 'DISBANDED'
    `);

    const membershipMap = new Map();
    for (const m of teamMemberships) {
      membershipMap.set(m.discord_id, m);
    }

    const result = [];
    let counter = 1;

    // Filter hanya user manusia (non-bot)
    const humanMembers = members.filter((m) => !m.user.bot);

    for (const [_, member] of humanMembers) {
      const membership = membershipMap.get(member.id);
      const isParticipant = participantRoleId ? member.roles.cache.has(participantRoleId) : false;
      const hasNoTeamRole = noTeamRoleId ? member.roles.cache.has(noTeamRoleId) : false;
      const isUnregistered = unregisteredRoleId ? member.roles.cache.has(unregisteredRoleId) : false;

      let statusPeserta = 'Tamu';
      if (membership) {
        statusPeserta = 'Dalam Tim';
      } else if (isParticipant) {
        statusPeserta = hasNoTeamRole ? 'Mencari Tim' : 'Peserta Resmi';
      } else if (isUnregistered) {
        statusPeserta = 'Belum Terdaftar';
      }

      const roleNames = member.roles.cache
        .filter((r) => r.name !== '@everyone')
        .map((r) => r.name)
        .join(', ') || '-';

      result.push({
        no: counter++,
        discordId: member.id,
        username: member.user.username,
        tag: member.user.tag || member.user.username,
        displayName: member.displayName || member.user.username,
        statusPeserta,
        namaTim: membership ? membership.team_name : (isParticipant ? 'Belum Memiliki Tim' : '-'),
        peranTim: membership ? membership.team_role : '-',
        statusTim: membership ? membership.team_status : '-',
        challengeTim: membership?.challenge_title || '-',
        bergabungServer: this.formatDate(member.joinedAt),
        rolesDiscord: roleNames
      });
    }

    // Urutkan: yang sudah ada di tim dulu, lalu peserta resmi, lalu lainnya
    result.sort((a, b) => {
      const order = { 'Dalam Tim': 1, 'Mencari Tim': 2, 'Peserta Resmi': 3, 'Belum Terdaftar': 4, 'Tamu': 5 };
      const diff = (order[a.statusPeserta] || 99) - (order[b.statusPeserta] || 99);
      if (diff !== 0) return diff;
      return a.namaTim.localeCompare(b.namaTim);
    });

    // Reset nomor urut setelah sorting
    result.forEach((item, index) => {
      item.no = index + 1;
    });

    return result;
  }

  /**
   * Export Teams ke format XLSX (Excel)
   */
  static async exportTeamsToExcel(guild = null) {
    const data = await this.getTeamsExportData(guild);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NSAC Jember Bot';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Daftar Tim NSAC');

    sheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tipe Tim', key: 'tipe', width: 24 },
      { header: 'Nama Tim', key: 'nama', width: 28 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Anggota', key: 'jumlahAnggota', width: 10 },
      { header: 'Maksimal', key: 'maxAnggota', width: 10 },
      { header: 'Slot Kosong', key: 'slotKosong', width: 12 },
      { header: 'Status Rekrutmen', key: 'statusRekrutmen', width: 20 },
      { header: 'Tantangan (Challenge)', key: 'challenge', width: 34 },
      { header: 'Leader Tim', key: 'leader', width: 22 },
      { header: 'Leader Discord ID', key: 'leaderDiscordId', width: 22 },
      { header: 'Tautan Web NSAC', key: 'nsacLink', width: 40 },
      { header: 'Channel Discord', key: 'channelDiscord', width: 20 },
      { header: 'Terakhir Sync', key: 'terakhirSync', width: 20 },
      { header: 'Dibuat Pada', key: 'dibuatPada', width: 20 }
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate 800
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 26;

    // Add rows
    for (const item of data) {
      const row = sheet.addRow(item);
      row.alignment = { vertical: 'middle' };
      // Center numerical and status columns
      row.getCell('no').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('jumlahAnggota').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('maxAnggota').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('slotKosong').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('statusRekrutmen').alignment = { vertical: 'middle', horizontal: 'center' };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `NSAC_Jember_Teams_${new Date().toISOString().slice(0, 10)}.xlsx`,
      buffer: Buffer.from(buffer),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Export Teams ke format CSV (RFC-4180 with UTF-8 BOM)
   */
  static async exportTeamsToCsv(guild = null) {
    const data = await this.getTeamsExportData(guild);
    const headers = [
      'No',
      'Tipe Tim',
      'Nama Tim',
      'Status',
      'Jumlah Anggota',
      'Maksimal Anggota',
      'Slot Kosong',
      'Status Rekrutmen',
      'Tantangan (Challenge)',
      'Leader Tim',
      'Leader Discord ID',
      'Tautan Web NSAC',
      'Channel Discord',
      'Terakhir Sync',
      'Dibuat Pada'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(',')];

    for (const item of data) {
      rows.push([
        escapeCsv(item.no),
        escapeCsv(item.tipe),
        escapeCsv(item.nama),
        escapeCsv(item.status),
        escapeCsv(item.jumlahAnggota),
        escapeCsv(item.maxAnggota),
        escapeCsv(item.slotKosong),
        escapeCsv(item.statusRekrutmen),
        escapeCsv(item.challenge),
        escapeCsv(item.leader),
        escapeCsv(item.leaderDiscordId),
        escapeCsv(item.nsacLink),
        escapeCsv(item.channelDiscord),
        escapeCsv(item.terakhirSync),
        escapeCsv(item.dibuatPada)
      ].join(','));
    }

    // UTF-8 BOM (\uFEFF) ensures Excel opens Indonesian characters cleanly
    const csvContent = '\uFEFF' + rows.join('\r\n');
    return {
      filename: `NSAC_Jember_Teams_${new Date().toISOString().slice(0, 10)}.csv`,
      buffer: Buffer.from(csvContent, 'utf8'),
      mimeType: 'text/csv; charset=utf-8'
    };
  }

  /**
   * Export Participants ke format XLSX (Excel)
   */
  static async exportParticipantsToExcel(guild) {
    const data = await this.getParticipantsExportData(guild);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NSAC Jember Bot';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Daftar Peserta NSAC');

    sheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Discord ID', key: 'discordId', width: 22 },
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Display Name', key: 'displayName', width: 24 },
      { header: 'Status Peserta', key: 'statusPeserta', width: 18 },
      { header: 'Nama Tim', key: 'namaTim', width: 28 },
      { header: 'Peran di Tim', key: 'peranTim', width: 14 },
      { header: 'Status Tim', key: 'statusTim', width: 14 },
      { header: 'Tantangan (Challenge)', key: 'challengeTim', width: 34 },
      { header: 'Bergabung Server', key: 'bergabungServer', width: 20 },
      { header: 'Roles Discord', key: 'rolesDiscord', width: 36 }
    ];

    // Style Header Row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate 800
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 26;

    // Add rows
    for (const item of data) {
      const row = sheet.addRow(item);
      row.alignment = { vertical: 'middle' };
      row.getCell('no').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('statusPeserta').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('peranTim').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('statusTim').alignment = { vertical: 'middle', horizontal: 'center' };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `NSAC_Jember_Participants_${new Date().toISOString().slice(0, 10)}.xlsx`,
      buffer: Buffer.from(buffer),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Export Participants ke format CSV (RFC-4180 with UTF-8 BOM)
   */
  static async exportParticipantsToCsv(guild) {
    const data = await this.getParticipantsExportData(guild);
    const headers = [
      'No',
      'Discord ID',
      'Username',
      'Display Name',
      'Status Peserta',
      'Nama Tim',
      'Peran di Tim',
      'Status Tim',
      'Tantangan (Challenge)',
      'Bergabung Server',
      'Roles Discord'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(',')];

    for (const item of data) {
      rows.push([
        escapeCsv(item.no),
        escapeCsv(item.discordId),
        escapeCsv(item.username),
        escapeCsv(item.displayName),
        escapeCsv(item.statusPeserta),
        escapeCsv(item.namaTim),
        escapeCsv(item.peranTim),
        escapeCsv(item.statusTim),
        escapeCsv(item.challengeTim),
        escapeCsv(item.bergabungServer),
        escapeCsv(item.rolesDiscord)
      ].join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    return {
      filename: `NSAC_Jember_Participants_${new Date().toISOString().slice(0, 10)}.csv`,
      buffer: Buffer.from(csvContent, 'utf8'),
      mimeType: 'text/csv; charset=utf-8'
    };
  }
}

import ExcelJS from 'exceljs';
import { pool } from '../database/pool.js';
import { GuildConfigService } from './guildConfigService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { matchWebTeam, normalizeTeamName } from '../utils/teamMatch.js';

export const TEAM_COLUMNS = [
  { header: 'No', key: 'no', width: 6, align: 'center' },
  { header: 'Nama Tim', key: 'nama', width: 28 },
  { header: 'Status', key: 'status', width: 14, align: 'center' },
  { header: 'Jumlah Anggota', key: 'jumlahAnggota', width: 16, align: 'center' },
  { header: 'Status Rekrutmen', key: 'statusRekrutmen', width: 20, align: 'center' },
  { header: 'Tantangan', key: 'challenge', width: 34 },
  { header: 'Leader Tim', key: 'leader', width: 22 },
  { header: 'Daftar Anggota', key: 'daftarAnggota', width: 45 },
  { header: 'Tautan Web NSAC', key: 'nsacLink', width: 40 },
  { header: 'Dibuat Pada', key: 'dibuatPada', width: 20, align: 'center' }
];

export const PARTICIPANT_COLUMNS = [
  { header: 'No', key: 'no', width: 6, align: 'center' },
  { header: 'Username', key: 'username', width: 24 },
  { header: 'Status Peserta', key: 'statusPeserta', width: 18, align: 'center' },
  { header: 'Nama Tim', key: 'namaTim', width: 28 },
  { header: 'Peran di Tim', key: 'peranTim', width: 16, align: 'center' },
  { header: 'Tantangan', key: 'challengeTim', width: 34 },
  { header: 'Tanggal Gabung Tim', key: 'tanggalGabungTim', width: 20, align: 'center' }
];

export class ExportService {
  /**
   * Helper to format Date deterministically to DD/MM/YYYY HH:MM (Asia/Jakarta)
   */
  static formatDate(date) {
    if (!date) return '-';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '-';
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const parts = formatter.formatToParts(d);
      const part = (type) => parts.find(p => p.type === type)?.value || '';
      return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
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
        u.username as leader_username,
        c.title as challenge_title,
        tr.id as recruitment_id, tr.status as recruitment_status, tr.slots_needed
      FROM teams t
      LEFT JOIN users u ON t.leader_id = u.id
      LEFT JOIN challenges c ON t.challenge_id = c.id
      LEFT JOIN team_recruitments tr ON tr.team_id = t.id AND tr.status = 'OPEN'
      WHERE t.status = 'ACTIVE'
      ORDER BY t.created_at ASC
    `);

    // 2. Ambil seluruh anggota tim aktif Discord untuk kolom Daftar Anggota
    const { rows: allTeamMembers } = await pool.query(`
      SELECT tm.team_id, tm.role, tm.joined_at, u.username
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.status = 'ACTIVE' AND t.status = 'ACTIVE'
      ORDER BY tm.team_id ASC, (CASE WHEN tm.role = 'LEADER' THEN 0 ELSE 1 END) ASC, u.username ASC
    `);

    const teamMembersMap = new Map();
    for (const row of allTeamMembers) {
      if (!teamMembersMap.has(row.team_id)) {
        teamMembersMap.set(row.team_id, []);
      }
      teamMembersMap.get(row.team_id).push(row);
    }

    // 3. Ambil snapshot tim web Space Apps yang masih ada pada sync terakhir
    const { rows: webTeams } = await pool.query(`
      SELECT * FROM web_teams
      WHERE present_in_latest_sync = true
      ORDER BY title ASC
    `);

    const result = [];
    let counter = 1;

    // Masukkan tim Discord terlebih dahulu
    for (const t of dcTeams) {
      const isRecruiting = t.recruitment_status === 'OPEN';

      // Cek apakah tim ini terhubung ke web dengan matcher bersama
      const matchedWeb = webTeams.find((wt) => matchWebTeam(t, wt));

      // Susun daftar anggota: Discord members (leader first, lalu alfabetis)
      const dcMembers = teamMembersMap.get(t.id) || [];
      const memberNames = dcMembers.map((m) => `@${m.username}`);

      // Tambahkan anggota web jika ada yang belum tercover di Discord
      let webMembers = [];
      if (matchedWeb?.members) {
        if (Array.isArray(matchedWeb.members)) {
          webMembers = matchedWeb.members;
        } else if (typeof matchedWeb.members === 'string') {
          try {
            webMembers = JSON.parse(matchedWeb.members);
          } catch {}
        }
      }

      if (webMembers.length > 0) {
        const existingNormalized = new Set(dcMembers.map((m) => normalizeTeamName(m.username)));
        for (const wm of webMembers) {
          const rawName = wm.fullName || wm.name || wm.username || '';
          const norm = normalizeTeamName(rawName);
          const normUser = normalizeTeamName(wm.username);
          if (norm && !existingNormalized.has(norm) && (!normUser || !existingNormalized.has(normUser))) {
            existingNormalized.add(norm);
            if (normUser) existingNormalized.add(normUser);
            memberNames.push(`${rawName.trim()} (web)`);
          }
        }
      }

      const totalMembers = memberNames.length;
      const slotsNeeded = isRecruiting ? (t.slots_needed || Math.max(0, env.MAX_TEAM_SIZE - totalMembers)) : 0;

      result.push({
        no: counter++,
        nama: t.name,
        status: t.status,
        jumlahAnggota: totalMembers,
        statusRekrutmen: isRecruiting ? `Buka (${slotsNeeded} slot)` : 'Tutup',
        challenge: t.challenge_title || matchedWeb?.challenge_title || 'Belum memilih',
        leader: t.leader_username ? `@${t.leader_username}` : '-',
        daftarAnggota: memberNames.length > 0 ? memberNames.join(', ') : '-',
        nsacLink: t.nsac_link || matchedWeb?.url || '-',
        dibuatPada: this.formatDate(t.created_at)
      });
    }

    // Masukkan tim Web yang BELUM terdaftar di Discord
    for (const wt of webTeams) {
      const alreadyInDc = dcTeams.some((t) => matchWebTeam(t, wt));

      if (!alreadyInDc) {
        let webMembers = [];
        if (wt.members) {
          if (Array.isArray(wt.members)) {
            webMembers = wt.members;
          } else if (typeof wt.members === 'string') {
            try {
              webMembers = JSON.parse(wt.members);
            } catch {}
          }
        }

        const memberNames = webMembers.map((wm) => {
          const n = wm.fullName || wm.name || wm.username || 'Member';
          return `${n.trim()} (web)`;
        });

        const totalMembers = memberNames.length > 0 ? memberNames.length : (wt.member_count || 0);

        result.push({
          no: counter++,
          nama: wt.title,
          status: 'WEB ONLY',
          jumlahAnggota: totalMembers,
          statusRekrutmen: wt.is_recruiting ? 'Buka (Web)' : 'Tutup',
          challenge: wt.challenge_title || 'Belum memilih',
          leader: '-',
          daftarAnggota: memberNames.length > 0 ? memberNames.join(', ') : '-',
          nsacLink: wt.url || (wt.slug ? `https://www.spaceappschallenge.org/2026/find-a-team/${wt.slug}/` : '-'),
          dibuatPada: '-'
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
      WHERE tm.status = 'ACTIVE' AND t.status = 'ACTIVE'
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

      result.push({
        no: counter++,
        username: member.user.username,
        statusPeserta,
        namaTim: membership ? membership.team_name : (isParticipant ? 'Belum Memiliki Tim' : '-'),
        peranTim: membership ? membership.team_role : '-',
        challengeTim: membership?.challenge_title || '-',
        tanggalGabungTim: membership?.joined_at ? this.formatDate(membership.joined_at) : '-'
      });
    }

    // Urutkan: yang sudah ada di tim dulu, lalu mencari tim, lalu peserta resmi, dll.
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
    sheet.columns = TEAM_COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width
    }));

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

    // Add rows & apply alignments
    for (const item of data) {
      const row = sheet.addRow(item);
      row.alignment = { vertical: 'middle' };
      for (const col of TEAM_COLUMNS) {
        if (col.align) {
          row.getCell(col.key).alignment = { vertical: 'middle', horizontal: col.align };
        }
      }
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
    const headers = TEAM_COLUMNS.map((c) => c.header);

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(',')];

    for (const item of data) {
      rows.push(TEAM_COLUMNS.map((c) => escapeCsv(item[c.key])).join(','));
    }

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
    sheet.columns = PARTICIPANT_COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width
    }));

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

    // Add rows & apply alignments
    for (const item of data) {
      const row = sheet.addRow(item);
      row.alignment = { vertical: 'middle' };
      for (const col of PARTICIPANT_COLUMNS) {
        if (col.align) {
          row.getCell(col.key).alignment = { vertical: 'middle', horizontal: col.align };
        }
      }
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
    const headers = PARTICIPANT_COLUMNS.map((c) => c.header);

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(',')];

    for (const item of data) {
      rows.push(PARTICIPANT_COLUMNS.map((c) => escapeCsv(item[c.key])).join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    return {
      filename: `NSAC_Jember_Participants_${new Date().toISOString().slice(0, 10)}.csv`,
      buffer: Buffer.from(csvContent, 'utf8'),
      mimeType: 'text/csv; charset=utf-8'
    };
  }
}

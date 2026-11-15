import ExcelJS from 'exceljs';
import { pool } from '../database/pool.js';
import { GuildConfigService } from './guildConfigService.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { matchWebTeam, normalizeTeamName } from '../utils/teamMatch.js';

export const TEAM_COLUMNS = [
  { header: 'No', key: 'no', width: 6, align: 'center' },
  { header: 'Nama Tim', key: 'nama', width: 28 },
  { header: 'Jumlah Anggota', key: 'jumlahAnggota', width: 16, align: 'center' },
  { header: 'Status Rekrutmen', key: 'statusRekrutmen', width: 20, align: 'center' },
  { header: 'Tantangan', key: 'challenge', width: 34 },
  { header: 'Leader Tim', key: 'leader', width: 24 },
  { header: 'Daftar Anggota', key: 'daftarAnggota', width: 50 },
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
    // 1. Ambil snapshot tim resmi dari web Space Apps (sumber utama laporan)
    const { rows: webTeams } = await pool.query(`
      SELECT * FROM web_teams
      WHERE present_in_latest_sync = true
      ORDER BY title ASC
    `);

    // 2. Ambil tim Discord aktif untuk matching korelasi (Discord cuma bonus)
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

    const result = [];
    let counter = 1;

    // Loop utama: Seluruh tim resmi terdaftar di web Space Apps
    for (const wt of webTeams) {
      const matchedDc = dcTeams.find((t) => matchWebTeam(t, wt));

      // Parse seluruh anggota resmi dari web
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

      // Bersihkan daftar nama anggota (tanpa @ dan tanpa (web))
      const memberNames = webMembers.map((wm) => {
        const raw = wm.fullName || wm.name || wm.username || '';
        return raw.trim();
      }).filter(Boolean);

      const totalMembers = memberNames.length > 0 ? memberNames.length : (wt.member_count || 1);

      // Cari ketua tim dari web (owner atau urutan pertama di web)
      const ownerMember = webMembers.find((wm) => wm.isOwner) || webMembers[0];
      const leaderName = ownerMember
        ? (ownerMember.fullName || ownerMember.name || ownerMember.username || '').trim()
        : '-';

      // Status rekrutmen: Buka (X slot) atau Tutup (baik web maupun discord)
      const isRecruiting = wt.is_recruiting || (matchedDc && matchedDc.recruitment_status === 'OPEN');
      const maxTeamSize = env.MAX_TEAM_SIZE || 6;
      const slotsNeeded = matchedDc?.slots_needed || Math.max(1, maxTeamSize - totalMembers);
      const statusRekrutmen = isRecruiting ? `Buka (${slotsNeeded} slot)` : 'Tutup';

      result.push({
        no: counter++,
        nama: wt.title,
        jumlahAnggota: totalMembers,
        statusRekrutmen,
        challenge: wt.challenge_title || matchedDc?.challenge_title || 'Belum memilih',
        leader: leaderName || '-',
        daftarAnggota: memberNames.length > 0 ? memberNames.join(', ') : '-',
        nsacLink: wt.url || (wt.slug ? `https://www.spaceappschallenge.org/2026/find-a-team/${wt.slug}/` : (matchedDc?.nsac_link || '-')),
        dibuatPada: this.formatDate(wt.last_synced_at || wt.created_at || matchedDc?.created_at)
      });
    }

    // Fallback: Jika ada tim aktif di Discord yang belum terdata di web (Discord cuma bonus)
    for (const dt of dcTeams) {
      const alreadyInWeb = webTeams.some((wt) => matchWebTeam(dt, wt));
      if (!alreadyInWeb) {
        const maxTeamSize = env.MAX_TEAM_SIZE || 6;
        const isRecruiting = dt.recruitment_status === 'OPEN';
        const slotsNeeded = dt.slots_needed || maxTeamSize;

        result.push({
          no: counter++,
          nama: dt.name,
          jumlahAnggota: 1,
          statusRekrutmen: isRecruiting ? `Buka (${slotsNeeded} slot)` : 'Tutup',
          challenge: dt.challenge_title || 'Belum memilih',
          leader: dt.leader_username || '-',
          daftarAnggota: dt.leader_username || '-',
          nsacLink: dt.nsac_link || '-',
          dibuatPada: this.formatDate(dt.created_at)
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

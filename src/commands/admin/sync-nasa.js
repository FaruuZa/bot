import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { NasaValidationService } from '../../services/nasaValidationService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('sync-nasa')
    .setDescription('[Staff] Sinkronisasi manual data profil dan lowongan tim dari web spaceappschallenge.org')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Pilih cakupan sinkronisasi')
        .setRequired(false)
        .addChoices(
          { name: 'Semua (Snapshot Web + Recruitment Board)', value: 'all' },
          { name: 'Khusus Tim Aktif Discord', value: 'active_teams' },
          { name: 'Uji Scrape Tim Tertentu (Cek Anggota)', value: 'test_team' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('team')
        .setDescription('Nama tim, slug, atau URL untuk diuji (wajib untuk mode test_team)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'Hanya panitia atau admin yang dapat memicu sinkronisasi web NASA Space Apps.')]
      });
    }

    const mode = interaction.options.getString('mode') || 'all';
    const targetTeamInput = interaction.options.getString('team');

    try {
      if (mode === 'test_team') {
        if (!targetTeamInput || !targetTeamInput.trim()) {
          return await interaction.editReply({
            embeds: [errorEmbed('Parameter Kurang', 'Silakan masukkan nama tim, slug, atau URL pada opsi team untuk mode uji scrape.')]
          });
        }

        let targetUrl = targetTeamInput.trim();
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          const cleanSlug = targetUrl.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
          targetUrl = `https://www.spaceappschallenge.org/2026/find-a-team/${cleanSlug}/`;
        }

        const details = await NasaValidationService.extractTeamDetailsFromUrl(targetUrl);
        const memberListText = details.members && details.members.length > 0
          ? details.members.map((m, idx) => `${idx + 1}. **${m.fullName || m.name}** (@${m.username || 'user'})`).join('\n')
          : '*(Tidak ada anggota terdeteksi atau halaman tidak ditemukan)*';

        const embed = successEmbed(
          'Hasil Uji Scraping Anggota Tim',
          `Berhasil melakukan scraping data anggota langsung dari halaman web NASA Space Apps!\n\n` +
          `• **URL Tim:** [Buka Profil Tim](${targetUrl})\n` +
          `• **Total Anggota Terdeteksi:** **${details.memberCount}** / 6 orang\n` +
          `• **Deskripsi Tim:** ${details.description ? `"${details.description.substring(0, 150)}..."` : '*(Tidak ada deskripsi)*'}\n\n` +
          `**Daftar Anggota:**\n${memberListText}`
        );

        return await interaction.editReply({ embeds: [embed] });
      }

      if (mode === 'active_teams') {
        const result = await NasaValidationService.syncAllActiveTeams(interaction.client);

        let desc = `Berhasil menyinkronkan seluruh tim aktif di server Discord dengan situs resmi NASA Space Apps Challenge!\n\n` +
          `• **Total Tim Diperiksa:** ${result.totalTeams}\n` +
          `• **Berhasil:** ${result.successCount}\n` +
          `• **Gagal / Cooldown:** ${result.failCount}\n` +
          `• **Diperbarui:** ${result.updatedCount}\n`;

        if (result.staleTeams && result.staleTeams.length > 0) {
          const list = result.staleTeams.slice(0, 5).map((t) => `• **${t.name}**`).join('\n');
          const extra = result.staleTeams.length > 5 ? `\n*...dan ${result.staleTeams.length - 5} tim lainnya.*` : '';
          desc += `\n**Tim Discord yang tautan web-nya sudah tidak ditemukan (404):**\n${list}${extra}\n*(Silakan diarsip dari dashboard bila sudah dihapus)*\n`;
        }

        if (result.renamedTeams && result.renamedTeams.length > 0) {
          const list = result.renamedTeams.slice(0, 5).map((t) => `• **${t.name}** (slug baru: \`${t.newSlug}\`)`).join('\n');
          const extra = result.renamedTeams.length > 5 ? `\n*...dan ${result.renamedTeams.length - 5} tim lainnya.*` : '';
          desc += `\n**Tim yang terdeteksi berganti nama/slug di web:**\n${list}${extra}\n*(Tautan tim otomatis diperbarui)*\n`;
        }

        return await interaction.editReply({
          embeds: [successEmbed('Sinkronisasi Tim Aktif Selesai', desc)]
        });
      } else {
        const result = await NasaValidationService.syncOpenRecruitmentFromWeb(interaction.client, interaction.guild);

        let desc = `Berhasil menyinkronkan snapshot tim resmi lokasi Jember dari spaceappschallenge.org ke sistem bot!\n\n` +
          `• **Total Tim Web Terambil:** ${result.totalWebTeams || 0}\n` +
          `• **Lowongan Baru Diposting:** ${result.createdCount || 0}\n` +
          `• **Lowongan Diperbarui:** ${result.updatedCount || 0}\n` +
          `• **Lowongan Ditutup Otomatis:** ${result.closedCount || 0}\n` +
          `• **Total Lowongan Aktif di Board:** ${result.totalOpenRec || 0}\n`;

        if (result.closedStaleCount > 0) {
          desc += `• **Lowongan Tim Web Dihapus yang Ditutup:** ${result.closedStaleCount}\n`;
        }

        if (result.staleWebTeams && result.staleWebTeams.length > 0) {
          const list = result.staleWebTeams.slice(0, 5).map((title) => `• **${title}**`).join('\n');
          const extra = result.staleWebTeams.length > 5 ? `\n*...dan ${result.staleWebTeams.length - 5} tim lainnya.*` : '';
          desc += `\n**Tim web yang sudah dihapus dari NASA:**\n${list}${extra}\n`;
        }

        if (result.staleLocalTeams && result.staleLocalTeams.length > 0) {
          const list = result.staleLocalTeams.slice(0, 5).map((t) => `• **${t.name}**`).join('\n');
          const extra = result.staleLocalTeams.length > 5 ? `\n*...dan ${result.staleLocalTeams.length - 5} tim lainnya.*` : '';
          desc += `\n**Tim Discord yang tautannya tidak ditemukan di web:**\n${list}${extra}\n*(Silakan cek atau arsip melalui dashboard)*\n`;
        }

        if (result.renamedTeams && result.renamedTeams.length > 0) {
          const list = result.renamedTeams.slice(0, 5).map((t) => `• **${t.name}** (slug baru: \`${t.newSlug}\`)`).join('\n');
          const extra = result.renamedTeams.length > 5 ? `\n*...dan ${result.renamedTeams.length - 5} tim lainnya.*` : '';
          desc += `\n**Tim yang terdeteksi berganti nama/slug:**\n${list}${extra}\n*(Tautan tim otomatis diperbarui)*\n`;
        }

        return await interaction.editReply({
          embeds: [successEmbed('Sinkronisasi Web NASA Selesai', desc)]
        });
      }
    } catch (err) {
      logger.error(`[/sync-nasa error] ${err.message}`);
      return await interaction.editReply({
        embeds: [errorEmbed('Sinkronisasi Gagal', `Terjadi kendala saat menghubungi API NASA Space Apps: ${err.message}`)]
      });
    }
  }
};

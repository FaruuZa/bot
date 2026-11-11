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
          { name: 'Khusus Tim Aktif Discord', value: 'active_teams' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'Hanya panitia atau admin yang dapat memicu sinkronisasi web NASA Space Apps.')]
      });
    }

    const mode = interaction.options.getString('mode') || 'all';

    try {
      if (mode === 'active_teams') {
        const result = await NasaValidationService.syncAllActiveTeams(interaction.client);
        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Sinkronisasi Tim Aktif Selesai',
              `Berhasil menyinkronkan seluruh tim aktif di server Discord dengan situs resmi NASA Space Apps Challenge!\n\n` +
              `• **Total Tim Diperiksa:** ${result.totalTeams}\n` +
              `• **Berhasil:** ${result.successCount}\n` +
              `• **Gagal / Cooldown:** ${result.failCount}\n\n` +
              `*Tantangan dan lowongan anggota pada channel tim telah diperbarui.*`
            )
          ]
        });
      } else {
        const result = await NasaValidationService.syncOpenRecruitmentFromWeb(interaction.client, interaction.guild);
        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Sinkronisasi Web NASA Selesai',
              `Berhasil menyinkronkan snapshot tim resmi lokasi Jember dari spaceappschallenge.org ke sistem bot!\n\n` +
              `• **Total Tim Web Terambil:** ${result.totalWebTeams || 0}\n` +
              `• **Lowongan Baru Diposting:** ${result.createdCount || 0}\n` +
              `• **Lowongan Diperbarui:** ${result.updatedCount || 0}\n` +
              `• **Lowongan Ditutup Otomatis:** ${result.closedCount || 0}\n` +
              `• **Total Lowongan Aktif di Board:** ${result.totalOpenRec || 0}\n\n` +
              `*Data tim terbaru dapat dilihat langsung pada dashboard panitia.*`
            )
          ]
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

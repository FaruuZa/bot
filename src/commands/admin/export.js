import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { ExportService } from '../../services/exportService.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('[Staff Only] Export data tim atau peserta ke file Excel (.xlsx) atau CSV')
    .addStringOption((opt) =>
      opt
        .setName('data')
        .setDescription('Data yang ingin diexport')
        .setRequired(true)
        .addChoices(
          { name: 'Daftar Tim (Teams)', value: 'teams' },
          { name: 'Daftar Peserta (Participants)', value: 'participants' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('format')
        .setDescription('Format file export (Excel .xlsx atau CSV)')
        .setRequired(false)
        .addChoices(
          { name: 'Excel (.xlsx)', value: 'xlsx' },
          { name: 'CSV (.csv)', value: 'csv' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'Anda tidak memiliki izin untuk menggunakan perintah ini.')]
      });
    }

    const dataType = interaction.options.getString('data');
    const format = interaction.options.getString('format') || 'xlsx';
    const guild = interaction.guild;

    try {
      let fileResult;
      if (dataType === 'teams') {
        fileResult = format === 'csv'
          ? await ExportService.exportTeamsToCsv(guild)
          : await ExportService.exportTeamsToExcel(guild);
      } else {
        fileResult = format === 'csv'
          ? await ExportService.exportParticipantsToCsv(guild)
          : await ExportService.exportParticipantsToExcel(guild);
      }

      const attachment = new AttachmentBuilder(fileResult.buffer, { name: fileResult.filename });

      const label = dataType === 'teams' ? 'Tim' : 'Peserta';
      const sizeKb = (fileResult.buffer.length / 1024).toFixed(1);

      return await interaction.editReply({
        content: `Data **${label}** berhasil diexport ke format **${format.toUpperCase()}** (${sizeKb} KB). Silakan unduh lampiran di bawah ini:`,
        files: [attachment]
      });
    } catch (err) {
      logger.error(`[Export Command] Failed to export ${dataType} as ${format}: ${err.message}`);
      return await interaction.editReply({
        embeds: [errorEmbed('Gagal Export Data', `Terjadi kesalahan saat memproses data export: ${err.message}`)]
      });
    }
  }
};

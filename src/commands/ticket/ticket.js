import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { TicketService } from '../../services/ticketService.js';
import { getTicketByChannelId } from '../../database/queries/ticketQueries.js';
import { errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Kelola tiket pendaftaran tim dan bantuan teknis panitia')
    // ================= Subcommand: create =================
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Buka tiket baru untuk bantuan panitia atau pendaftaran tim')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Jenis tiket yang ingin dibuat')
            .setRequired(true)
            .addChoices(
              { name: 'Bantuan Teknis / Support', value: 'support' },
              { name: 'Pendaftaran Tim Hackathon', value: 'registration' }
            )
        )
    )
    // ================= Subcommand: close =================
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Tutup channel tiket saat masalah atau pendaftaran telah selesai')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // 1. CREATE TICKET
    if (subcommand === 'create') {
      const type = interaction.options.getString('type');
      if (type === 'registration') {
        return await TicketService.createTeamRegistrationTicket(interaction);
      } else {
        return await TicketService.createSupportTicket(interaction);
      }
    }

    // 2. CLOSE TICKET
    if (subcommand === 'close') {
      const ticket = await getTicketByChannelId(interaction.channel.id);
      if (!ticket) {
        return await interaction.reply({
          embeds: [errorEmbed('Bukan Channel Tiket', 'Perintah ini hanya dapat dijalankan di dalam channel tiket aktif.')],
          flags: MessageFlags.Ephemeral
        });
      }

      await TicketService.handleCloseTicket(interaction);
    }
  }
};

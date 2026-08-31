import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { TicketService } from '../../services/ticketService.js';
import { getTicketByChannelId } from '../../database/queries/ticketQueries.js';
import { errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management commands')
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close the current ticket channel')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'close') {
      const ticket = await getTicketByChannelId(interaction.channel.id);
      if (!ticket) {
        return await interaction.reply({
          embeds: [errorEmbed('Invalid Channel', 'This channel is not an active ticket channel.')],
          flags: MessageFlags.Ephemeral
        });
      }

      await TicketService.handleCloseTicket(interaction);
    }
  }
};

import { SlashCommandBuilder } from 'discord.js';
import { TicketService } from '../../services/ticketService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('register-team')
    .setDescription('Start a team registration ticket to register your hackathon team'),

  async execute(interaction) {
    await TicketService.createTeamRegistrationTicket(interaction);
  }
};

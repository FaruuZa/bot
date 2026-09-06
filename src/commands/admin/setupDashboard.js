import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionsBitField
} from 'discord.js';
import { DashboardService } from '../../services/dashboardService.js';
import { PermissionService } from '../../services/permissionService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { replyAutoDismiss } from '../../utils/interactionUtils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup-dashboard')
    .setDescription('[Admin/Staff] Deploy or refresh the central Admin Control Panel channel')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await replyAutoDismiss(interaction, {
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
      }, 7000);
    }

    try {
      const { channel } = await DashboardService.setupDashboard(interaction.guild, interaction.client);

      return await replyAutoDismiss(interaction, {
        embeds: [
          successEmbed(
            'Admin Dashboard Siap 🎛️',
            `Panel kendali staf & admin berhasil di-deploy ke channel <#${channel.id}>!\n\n` +
            `• Channel tersebut otomatis dikunci privat hanya untuk Staff & Administrator.\n` +
            `• Anda dapat mengatur status pendaftaran, link invite auto-role peserta, dan filter role tim langsung dari panel tersebut.`
          )
        ]
      }, 10000);
    } catch (err) {
      return await replyAutoDismiss(interaction, {
        embeds: [errorEmbed('Dashboard Error', err.message)]
      }, 10000);
    }
  }
};

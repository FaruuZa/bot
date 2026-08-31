import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { registrationPanelEmbed, supportPanelEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { CUSTOM_IDS } from '../../config/constants.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup-panels')
    .setDescription('[Staff] Deploy interactive Registration and Support panels')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Which panel to post')
        .setRequired(true)
        .addChoices(
          { name: 'Team Registration Panel', value: 'registration' },
          { name: 'Support Ticket Panel', value: 'support' },
          { name: 'Both Panels', value: 'both' }
        )
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to post the panel in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
      });
    }

    const type = interaction.options.getString('type');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    const configuredRegChannelId = GuildConfigService.get('REGISTRATION_CHANNEL_ID');
    const configuredSupportChannelId = GuildConfigService.get('SUPPORT_CHANNEL_ID');

    if (type === 'registration' || type === 'both') {
      const regRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CREATE_REG_TICKET)
          .setLabel('Create Team Registration')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎫')
      );

      let regChannel = targetChannel;
      if (type === 'both' && configuredRegChannelId) {
        regChannel = await interaction.guild.channels.fetch(configuredRegChannelId).catch(() => targetChannel);
      }

      await regChannel.send({
        embeds: [registrationPanelEmbed()],
        components: [regRow]
      });
    }

    if (type === 'support' || type === 'both') {
      const supRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CREATE_SUPPORT_TICKET)
          .setLabel('Create Support Ticket')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🆘')
      );

      let supChannel = targetChannel;
      if (type === 'both' && configuredSupportChannelId) {
        supChannel = await interaction.guild.channels.fetch(configuredSupportChannelId).catch(() => targetChannel);
      }

      await supChannel.send({
        embeds: [supportPanelEmbed()],
        components: [supRow]
      });
    }

    return await interaction.editReply({
      embeds: [successEmbed('Panels Deployed', `Successfully deployed panel(s) to designated channel(s).`)]
    });
  }
};

import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { registrationPanelEmbed, supportPanelEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { CUSTOM_IDS } from '../../config/constants.js';
import { env } from '../../config/env.js';

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
    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const type = interaction.options.getString('type');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (type === 'registration' || type === 'both') {
      const regRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_CREATE_REG_TICKET)
          .setLabel('Create Team Registration')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎫')
      );

      const regChannel = (type === 'both' && env.REGISTRATION_CHANNEL_ID)
        ? await interaction.guild.channels.fetch(env.REGISTRATION_CHANNEL_ID).catch(() => targetChannel)
        : targetChannel;

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

      const supChannel = (type === 'both' && env.SUPPORT_CHANNEL_ID)
        ? await interaction.guild.channels.fetch(env.SUPPORT_CHANNEL_ID).catch(() => targetChannel)
        : targetChannel;

      await supChannel.send({
        embeds: [supportPanelEmbed()],
        components: [supRow]
      });
    }

    return await interaction.reply({
      embeds: [successEmbed('Panels Deployed', `Successfully deployed panel(s) to designated channel(s).`)],
      flags: MessageFlags.Ephemeral
    });
  }
};

import { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { EMBED_COLORS } from '../../config/constants.js';

export default {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('[Staff] Post a formatted announcement embed to a channel')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to send announcement to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Announcement title').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Announcement message content (supports markdown and \\n)').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('color')
        .setDescription('Embed color')
        .addChoices(
          { name: 'Blurple (Default)', value: 'PRIMARY' },
          { name: 'Green (Success)', value: 'SUCCESS' },
          { name: 'Red (Urgent)', value: 'DANGER' },
          { name: 'Yellow (Warning)', value: 'WARNING' },
          { name: 'Blue (Info)', value: 'INFO' }
        )
    ),

  async execute(interaction) {
    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const rawMessage = interaction.options.getString('message');
    const colorChoice = interaction.options.getString('color') || 'PRIMARY';

    const formattedMessage = rawMessage.replace(/\\n/g, '\n');

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS[colorChoice] || EMBED_COLORS.PRIMARY)
      .setTitle(`📢 ${title}`)
      .setDescription(formattedMessage)
      .setFooter({ text: `Announced by ${interaction.user.tag}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    return await interaction.reply({
      embeds: [successEmbed('Announcement Sent', `Announcement posted to <#${channel.id}>.`)],
      flags: MessageFlags.Ephemeral
    });
  }
};

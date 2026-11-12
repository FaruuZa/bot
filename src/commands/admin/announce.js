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
    )
    .addAttachmentOption((opt) =>
      opt
        .setName('image')
        .setDescription('Upload file gambar / poster pengumuman')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('image_url')
        .setDescription('URL gambar luar (opsional jika tidak upload file)')
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName('role')
        .setDescription('Role to ping / mention (e.g. @Participant)')
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName('role2')
        .setDescription('Second role to ping (optional)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('mention')
        .setDescription('Global ping type')
        .setRequired(false)
        .addChoices(
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
      });
    }

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const rawMessage = interaction.options.getString('message');
    const colorChoice = interaction.options.getString('color') || 'PRIMARY';
    const imageAttachment = interaction.options.getAttachment('image');
    const imageUrlInput = interaction.options.getString('image_url');
    const role = interaction.options.getRole('role');
    const role2 = interaction.options.getRole('role2');
    const mentionChoice = interaction.options.getString('mention');

    const formattedMessage = rawMessage.replace(/\\n/g, '\n');
    const safeTitle = title.length > 256 ? `${title.substring(0, 253)}...` : title;
    const safeDesc = formattedMessage.length > 4096 ? `${formattedMessage.substring(0, 4093)}...` : formattedMessage;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS[colorChoice] || EMBED_COLORS.PRIMARY)
      .setTitle(safeTitle)
      .setDescription(safeDesc)
      .setTimestamp();

    // Attach image if provided
    let finalImageUrl = null;
    if (imageAttachment) {
      if (imageAttachment.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(imageAttachment.name)) {
        finalImageUrl = imageAttachment.url;
      }
    } else if (imageUrlInput && (imageUrlInput.startsWith('http://') || imageUrlInput.startsWith('https://'))) {
      finalImageUrl = imageUrlInput.trim();
    }

    if (finalImageUrl) {
      embed.setImage(finalImageUrl);
    }

    // Construct outer text mentions so Discord triggers audio/push alerts
    const mentions = [];
    if (mentionChoice === 'everyone') mentions.push('@everyone');
    else if (mentionChoice === 'here') mentions.push('@here');
    if (role) mentions.push(`<@&${role.id}>`);
    if (role2) mentions.push(`<@&${role2.id}>`);

    const content = mentions.length > 0 ? mentions.join(' ') : undefined;

    await channel.send({
      content,
      embeds: [embed],
      allowedMentions: {
        parse: ['roles', 'users', 'everyone']
      }
    });

    const pingNotice = mentions.length > 0 ? ` (dengan mention: ${mentions.join(' ')})` : '';
    return await interaction.editReply({
      embeds: [successEmbed('Pengumuman Terkirim', `Pengumuman berhasil diposting ke <#${channel.id}>${pingNotice}.`)]
    });
  }
};

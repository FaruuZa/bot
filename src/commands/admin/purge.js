import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { AuditService } from '../../services/auditService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('[Staff] Bulk delete messages in the current channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('Number of messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Filter deletion by a specific user only')
        .setRequired(false)
    ),

  async execute(interaction) {
    // 1. Backend permission check
    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to delete messages.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('user');
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
      return await interaction.reply({
        embeds: [errorEmbed('Invalid Channel', 'This command can only be used in text channels.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let deletedCount = 0;

      if (targetUser) {
        // Fetch up to 100 messages, filter by user, and delete
        const messages = await channel.messages.fetch({ limit: 100 });
        const userMessages = messages.filter((m) => m.author.id === targetUser.id).first(amount);

        if (userMessages.length === 0) {
          return await interaction.editReply({
            embeds: [errorEmbed('No Messages Found', `No recent messages from <@${targetUser.id}> were found to delete.`)]
          });
        }

        const deleted = await channel.bulkDelete(userMessages, true);
        deletedCount = deleted.size;
      } else {
        // Direct bulk delete (ignoring messages older than 14 days)
        const deleted = await channel.bulkDelete(amount, true);
        deletedCount = deleted.size;
      }

      await AuditService.log(interaction.client, {
        action: 'MESSAGES_PURGED',
        title: 'Messages Purged',
        actorTag: interaction.user.tag,
        targetTag: targetUser ? targetUser.tag : null,
        details: `Deleted ${deletedCount} message(s) in <#${channel.id}>${targetUser ? ` from @${targetUser.tag}` : ''}.`
      });

      return await interaction.editReply({
        embeds: [
          successEmbed(
            'Messages Purged',
            `🧹 Successfully deleted **${deletedCount}** message(s) in this channel${targetUser ? ` from <@${targetUser.id}>` : ''}.\n\n*(Note: Messages older than 14 days cannot be bulk deleted by Discord)*`
          )
        ]
      });
    } catch (error) {
      return await interaction.editReply({
        embeds: [errorEmbed('Purge Failed', `Failed to delete messages: ${error.message}`)]
      });
    }
  }
};

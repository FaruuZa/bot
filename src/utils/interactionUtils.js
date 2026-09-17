import { MessageFlags } from 'discord.js';

/**
 * Send an ephemeral reply and automatically delete it after timeoutMs (default: 7000ms).
 * Designed for slash commands (like /faq) so the screen does not get cluttered.
 * For component interactions (buttons/select menus), it safely sends an ephemeral followUp
 * without ever deleting the source component message.
 * @param {import('discord.js').ChatInputCommandInteraction|import('discord.js').ButtonInteraction|import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} payload
 * @param {number} [timeoutMs=7000]
 */
export async function replyAutoDismiss(interaction, payload, timeoutMs = 7000) {
  let response;

  if (interaction.isChatInputCommand?.()) {
    if (interaction.deferred || interaction.replied) {
      response = await interaction.editReply(payload);
    } else {
      response = await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }

    if (timeoutMs > 0) {
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch {
          // Ignore if already deleted
        }
      }, timeoutMs);
    }
  } else {
    // Component interaction (button / select menu)
    // NEVER call deleteReply() here as it would delete the component's parent message!
    if (interaction.deferred || interaction.replied) {
      response = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else {
      response = await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }

  return response;
}

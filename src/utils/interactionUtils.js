import { MessageFlags } from 'discord.js';

/**
 * Send or edit an ephemeral reply and automatically delete it after timeoutMs (default: 7000ms).
 * Useful for FAQ edits and admin actions so the screen does not get cluttered.
 * @param {import('discord.js').ChatInputCommandInteraction|import('discord.js').ButtonInteraction|import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} payload
 * @param {number} [timeoutMs=7000]
 */
export async function replyAutoDismiss(interaction, payload, timeoutMs = 7000) {
  let response;
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
        // Ignore if already deleted by user or client
      }
    }, timeoutMs);
  }

  return response;
}

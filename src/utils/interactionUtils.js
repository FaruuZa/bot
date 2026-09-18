import { MessageFlags } from 'discord.js';

/**
 * Helper terpadu untuk mengirim pesan respons Ephemeral.
 * Bisa memilih apakah ephemeral tersebut otomatis hilang (auto-dismiss) atau tetap bertahan.
 *
 * @param {import('discord.js').BaseInteraction} interaction - Objek interaksi Discord
 * @param {string|import('discord.js').InteractionReplyOptions} payload - Pesan teks / payload (embeds, components, dsb)
 * @param {object} [options={}]
 * @param {boolean} [options.autoDismiss=false] - Jika true, pesan akan otomatis terhapus setelah timeoutMs
 * @param {number} [options.timeoutMs=8000] - Durasi tampil sebelum otomatis hilang (default: 8000ms / 8 detik)
 * @returns {Promise<import('discord.js').Message|import('discord.js').InteractionResponse|null>}
 */
export async function replyEphemeral(interaction, payload, { autoDismiss = false, timeoutMs = 8000 } = {}) {
  const data = typeof payload === 'string'
    ? { content: payload, flags: MessageFlags.Ephemeral }
    : { ...payload, flags: MessageFlags.Ephemeral };

  let isFollowUp = false;
  let response = null;

  try {
    if (interaction.deferred || interaction.replied) {
      if (interaction.ephemeral) {
        response = await interaction.editReply(data);
      } else if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.()) {
        isFollowUp = true;
        response = await interaction.followUp(data);
      } else {
        response = await interaction.editReply(data);
      }
    } else {
      response = await interaction.reply(data);
    }
  } catch (err) {
    return null;
  }

  if (autoDismiss && timeoutMs > 0) {
    setTimeout(async () => {
      try {
        if (isFollowUp && response?.id) {
          await interaction.deleteReply(response.id);
        } else {
          await interaction.deleteReply();
        }
      } catch {
        // Abaikan jika sudah ditutup manual oleh pengguna atau channel terhapus
      }
    }, timeoutMs);
  }

  return response;
}

/**
 * Pesan ephemeral yang OTOMATIS HILANG setelah durasi tertentu.
 * Cocok untuk: pesan error, pemberitahuan izin (staff only), notifikasi cepat.
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {string|import('discord.js').InteractionReplyOptions} payload
 * @param {number} [timeoutMs=8000]
 */
export async function replyDismissable(interaction, payload, timeoutMs = 8000) {
  return await replyEphemeral(interaction, payload, { autoDismiss: true, timeoutMs });
}

/**
 * Pesan ephemeral yang TETAP BERTAHAN (tidak hilang otomatis sampai ditutup manual oleh pengguna).
 * Cocok untuk: menu form pendaftaran, dropdown pilihan, link yang harus disalin, panduan rinci.
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {string|import('discord.js').InteractionReplyOptions} payload
 */
export async function replyPermanent(interaction, payload) {
  return await replyEphemeral(interaction, payload, { autoDismiss: false });
}

/**
 * Backward-compatible alias untuk kode lama yang menggunakan replyAutoDismiss
 */
export const replyAutoDismiss = replyDismissable;


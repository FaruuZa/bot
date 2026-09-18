import { AuditService } from './auditService.js';
import { AUDIT_ACTIONS, EMBED_COLORS } from '../config/constants.js';
import {
  createChallenge,
  getAllChallenges,
  getChallengeById,
  updateChallenge,
  deleteChallenge
} from '../database/queries/challengeQueries.js';
import { EmbedBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

export class ChallengeService {
  /**
   * Build embed daftar semua challenge
   */
  static buildChallengeListEmbed(challenges) {
    if (!challenges || challenges.length === 0) {
      return new EmbedBuilder()
        .setTitle('🎯 Daftar Challenge NSAC')
        .setColor(EMBED_COLORS.INFO)
        .setDescription('*(Belum ada challenge yang terdaftar. Hubungi panitia atau gunakan `/challenge add` untuk menambahkan.)*')
        .setFooter({ text: 'NSAC Hackathon • Challenge Management' })
        .setTimestamp();
    }

    const lines = challenges.map((c, idx) => {
      const desc = c.description ? `\n   > ${c.description}` : '';
      const teamCount = c.team_count !== undefined ? ` • ${c.team_count} tim` : '';
      return `**${idx + 1}. ${c.title}** \`[ID: ${c.id}]\`${teamCount}${desc}`;
    });

    return new EmbedBuilder()
      .setTitle('🎯 Daftar Challenge NSAC')
      .setColor(EMBED_COLORS.PRIMARY)
      .setDescription(lines.join('\n\n'))
      .setFooter({ text: `Total: ${challenges.length} challenge • NSAC Hackathon` })
      .setTimestamp();
  }

  /**
   * Ambil semua challenge dan build embed
   */
  static async getChallengesEmbed() {
    const challenges = await getAllChallenges();
    return { challenges, embed: this.buildChallengeListEmbed(challenges) };
  }

  /**
   * Buat challenge baru
   */
  static async create({ title, description, actorTag, client }) {
    const trimTitle = title?.trim();
    if (!trimTitle || trimTitle.length < 3) {
      return { success: false, error: 'Judul challenge minimal 3 karakter.' };
    }
    if (trimTitle.length > 255) {
      return { success: false, error: 'Judul challenge maksimal 255 karakter.' };
    }

    const challenge = await createChallenge({ title: trimTitle, description });

    if (client) {
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.CHALLENGE_CREATED,
        title: 'Challenge Ditambahkan',
        actorTag,
        details: `Challenge "${challenge.title}" (ID: ${challenge.id}) ditambahkan oleh ${actorTag}.`
      });
    }

    return { success: true, challenge };
  }

  /**
   * Edit challenge
   */
  static async edit({ id, title, description, actorTag, client }) {
    const existing = await getChallengeById(id);
    if (!existing) {
      return { success: false, error: `Challenge dengan ID ${id} tidak ditemukan.` };
    }

    const trimTitle = title?.trim() || existing.title;
    if (trimTitle.length < 3) {
      return { success: false, error: 'Judul challenge minimal 3 karakter.' };
    }

    const updated = await updateChallenge(id, {
      title: trimTitle,
      description: description?.trim() ?? existing.description
    });

    if (client) {
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.CHALLENGE_UPDATED,
        title: 'Challenge Diperbarui',
        actorTag,
        details: `Challenge "${updated.title}" (ID: ${id}) diperbarui oleh ${actorTag}.`
      });
    }

    return { success: true, challenge: updated };
  }

  /**
   * Hapus challenge
   */
  static async remove({ id, actorTag, client }) {
    const existing = await getChallengeById(id);
    if (!existing) {
      return { success: false, error: `Challenge dengan ID ${id} tidak ditemukan.` };
    }

    await deleteChallenge(id);

    if (client) {
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.CHALLENGE_DELETED,
        title: 'Challenge Dihapus',
        actorTag,
        details: `Challenge "${existing.title}" (ID: ${id}) dihapus oleh ${actorTag}.`
      });
    }

    return { success: true, challenge: existing };
  }

  /**
   * Build options untuk StringSelectMenu dari daftar challenge
   * Selalu sertakan opsi "Belum Memilih" (nullable)
   */
  static buildChallengeSelectOptions(challenges) {
    const options = [
      new StringSelectMenuOptionBuilder()
        .setLabel('Belum Memilih Challenge')
        .setDescription('Kosongkan/hapus pilihan challenge tim')
        .setValue('none')
        .setEmoji('❓')
    ];

    for (const c of challenges.slice(0, 24)) { // Discord max 25 options
      const desc = c.description
        ? c.description.substring(0, 50) + (c.description.length > 50 ? '...' : '')
        : 'Lihat web NSAC untuk detail selengkapnya';
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(c.title.substring(0, 100))
          .setDescription(desc)
          .setValue(c.id.toString())
          .setEmoji('🎯')
      );
    }

    return options;
  }
}

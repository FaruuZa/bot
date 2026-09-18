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
   * Build embed daftar semua challenge (bersih untuk peserta: tanpa ID dan team count)
   */
  static buildChallengeListEmbed(challenges) {
    if (!challenges || challenges.length === 0) {
      return new EmbedBuilder()
        .setTitle('Daftar Challenge NSAC')
        .setColor(EMBED_COLORS.INFO)
        .setDescription('*(Belum ada challenge yang terdaftar. Hubungi panitia untuk informasi lebih lanjut.)*')
        .setFooter({ text: 'NSAC Hackathon • Challenge' })
        .setTimestamp();
    }

    const lines = challenges.map((c, idx) => {
      let desc = '';
      if (c.description) {
        const cleanDesc = c.description.trim();
        const shortDesc = cleanDesc.length > 140 ? `${cleanDesc.substring(0, 137)}...` : cleanDesc;
        desc = `\n   > ${shortDesc}`;
      }
      return `**${idx + 1}. ${c.title}**${desc}`;
    });

    let descriptionText = lines.join('\n\n');
    if (descriptionText.length > 3700) {
      descriptionText = descriptionText.substring(0, 3650) + '\n\n*(Daftar dipotong karena batas panjang tampilan).*';
    }

    descriptionText += '\n\n*Gunakan command `/challenge detail` untuk membaca rincian lengkap setiap challenge.*';

    return new EmbedBuilder()
      .setTitle('Daftar Challenge NSAC')
      .setColor(EMBED_COLORS.PRIMARY)
      .setDescription(descriptionText)
      .setFooter({ text: `Total: ${challenges.length} challenge • NSAC Hackathon` })
      .setTimestamp();
  }

  /**
   * Build embed detail untuk satu challenge
   */
  static buildChallengeDetailEmbed(challenge, isStaff = false) {
    const embed = new EmbedBuilder()
      .setTitle(`Detail Challenge: ${challenge.title}`)
      .setColor(EMBED_COLORS.PRIMARY)
      .setDescription(challenge.description || '*(Tidak ada deskripsi rinci untuk challenge ini)*')
      .setFooter({ text: 'NSAC Hackathon • Detail Challenge' })
      .setTimestamp();

    if (isStaff) {
      embed.addFields(
        { name: 'ID Challenge', value: `\`${challenge.id}\``, inline: true },
        { name: 'Total Tim Terdaftar', value: `${challenge.team_count ?? 0} tim`, inline: true }
      );
    } else {
      embed.addFields(
        {
          name: 'Cara Memilih Challenge',
          value: 'Ketua tim dapat memilih challenge ini melalui tombol di channel tim atau command `/team set-challenge`.',
          inline: false
        }
      );
    }

    return embed;
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
    ];

    for (const c of challenges.slice(0, 24)) { // Discord max 25 options
      const desc = c.description
        ? (c.description.length > 50 ? `${c.description.substring(0, 47)}...` : c.description)
        : 'Lihat web NSAC untuk detail selengkapnya';
      const label = c.title.length > 100 ? `${c.title.substring(0, 97)}...` : c.title;
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setDescription(desc)
          .setValue(c.id.toString())
      );
    }

    return options;
  }
}

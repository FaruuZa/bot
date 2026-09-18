import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { ChallengeService } from '../../services/challengeService.js';
import { PermissionService } from '../../services/permissionService.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { getAllChallenges, getChallengeById } from '../../database/queries/challengeQueries.js';

async function resolveChallenge(interaction, paramName = 'challenge') {
  const val = interaction.options.getString(paramName);
  if (!val) return null;
  const parsedId = parseInt(val, 10);
  if (!isNaN(parsedId)) {
    const byId = await getChallengeById(parsedId);
    if (byId) return byId;
  }
  const all = await getAllChallenges();
  return all.find((c) => c.title.toLowerCase() === val.toLowerCase()) || null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Informasi dan manajemen challenge hackathon NSAC')
    // ================= Subcommand: list =================
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Lihat daftar seluruh challenge yang tersedia di hackathon NSAC')
    )
    // ================= Subcommand: detail =================
    .addSubcommand((sub) =>
      sub
        .setName('detail')
        .setDescription('Lihat rincian lengkap suatu challenge')
        .addStringOption((opt) =>
          opt
            .setName('challenge')
            .setDescription('Pilih challenge yang ingin dilihat')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    // ================= Subcommand: add (Staff) =================
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('[Staff] Tambah challenge baru ke daftar challenge hackathon')
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Judul challenge')
            .setRequired(true)
            .setMaxLength(255)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Deskripsi singkat challenge (opsional)')
            .setRequired(false)
            .setMaxLength(1000)
        )
    )
    // ================= Subcommand: edit (Staff) =================
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('[Staff] Edit challenge yang sudah ada')
        .addStringOption((opt) =>
          opt
            .setName('challenge')
            .setDescription('Pilih challenge yang ingin diedit')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Judul baru challenge')
            .setRequired(false)
            .setMaxLength(255)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Deskripsi baru challenge')
            .setRequired(false)
            .setMaxLength(1000)
        )
    )
    // ================= Subcommand: delete (Staff) =================
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('[Staff] Hapus challenge dari daftar')
        .addStringOption((opt) =>
          opt
            .setName('challenge')
            .setDescription('Pilih challenge yang ingin dihapus')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focusedValue = (interaction.options.getFocused() || '').toLowerCase();
    const challenges = await getAllChallenges();
    const filtered = challenges.filter((c) =>
      c.title.toLowerCase().includes(focusedValue) ||
      c.id.toString().includes(focusedValue)
    ).slice(0, 25);

    await interaction.respond(
      filtered.map((c) => ({
        name: c.title.length > 100 ? `${c.title.substring(0, 97)}...` : c.title,
        value: c.id.toString()
      }))
    );
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const isStaffUser = PermissionService.isStaff(interaction.member);

    // ==========================================
    // 1. LIST SUBCOMMAND (Untuk Semua User)
    // ==========================================
    if (subcommand === 'list') {
      await interaction.deferReply();
      const { embed } = await ChallengeService.getChallengesEmbed();
      return await interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // 2. DETAIL SUBCOMMAND (Untuk Semua User)
    // ==========================================
    if (subcommand === 'detail') {
      await interaction.deferReply();
      const challenge = await resolveChallenge(interaction, 'challenge');
      if (!challenge) {
        return await interaction.editReply({
          embeds: [errorEmbed('Challenge Tidak Ditemukan', 'Challenge yang kamu pilih tidak ditemukan. Gunakan `/challenge list` untuk melihat daftar challenge yang tersedia.')]
        });
      }
      const embed = ChallengeService.buildChallengeDetailEmbed(challenge, isStaffUser);
      return await interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // STAFF ONLY SUBCOMMANDS
    // ==========================================
    if (!isStaffUser) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'Hanya staf yang dapat mengelola daftar challenge.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // ==========================================
    // 3. ADD SUBCOMMAND (Staff)
    // ==========================================
    if (subcommand === 'add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');

      const result = await ChallengeService.create({
        title,
        description,
        actorTag: interaction.user.tag,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Menambah Challenge', result.error)]
        });
      }

      return await interaction.editReply({
        embeds: [
          successEmbed(
            'Challenge Berhasil Ditambahkan',
            `Challenge baru berhasil didaftarkan!\n\n` +
            `**Judul:** ${result.challenge.title}\n` +
            `**Deskripsi:** ${result.challenge.description || '*(Tidak ada deskripsi)*'}\n` +
            `**ID:** \`${result.challenge.id}\`\n\n` +
            `Peserta dan ketua tim kini dapat memilih challenge ini saat pendaftaran tim atau melalui \`/team set-challenge\`.`
          )
        ]
      });
    }

    // ==========================================
    // 4. EDIT SUBCOMMAND (Staff)
    // ==========================================
    if (subcommand === 'edit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const challenge = await resolveChallenge(interaction, 'challenge');
      if (!challenge) {
        return await interaction.editReply({
          embeds: [errorEmbed('Challenge Tidak Ditemukan', 'Challenge yang ingin diedit tidak ditemukan.')]
        });
      }

      const id = challenge.id;
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');

      if (!title && description === null) {
        return await interaction.editReply({
          embeds: [errorEmbed('Input Kosong', 'Harap masukkan judul baru atau deskripsi baru yang ingin diubah.')]
        });
      }

      const result = await ChallengeService.edit({
        id,
        title,
        description,
        actorTag: interaction.user.tag,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Mengedit Challenge', result.error)]
        });
      }

      return await interaction.editReply({
        embeds: [
          successEmbed(
            'Challenge Berhasil Diperbarui',
            `Challenge **#${id}** telah diperbarui:\n\n` +
            `**Judul:** ${result.challenge.title}\n` +
            `**Deskripsi:** ${result.challenge.description || '*(Tidak ada deskripsi)*'}`
          )
        ]
      });
    }

    // ==========================================
    // 5. DELETE SUBCOMMAND (Staff)
    // ==========================================
    if (subcommand === 'delete') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const challenge = await resolveChallenge(interaction, 'challenge');
      if (!challenge) {
        return await interaction.editReply({
          embeds: [errorEmbed('Challenge Tidak Ditemukan', 'Challenge yang ingin dihapus tidak ditemukan.')]
        });
      }

      const id = challenge.id;

      const result = await ChallengeService.remove({
        id,
        actorTag: interaction.user.tag,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Menghapus Challenge', result.error)]
        });
      }

      return await interaction.editReply({
        embeds: [
          successEmbed(
            'Challenge Berhasil Dihapus',
            `Challenge **"${result.challenge.title}"** (ID: ${id}) telah dihapus dari sistem.`
          )
        ]
      });
    }
  }
};

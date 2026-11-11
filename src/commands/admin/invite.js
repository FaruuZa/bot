import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ChannelType
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { InviteService } from '../../services/inviteService.js';
import { getRecentInviteJoins, getTopInviters, getInviteTrackerStats } from '../../database/queries/inviteQueries.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { EMBED_COLORS } from '../../config/constants.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('[Staff] Manajemen dynamic invite link dan pelacakan member')
    // ================= Subcommand: create =================
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Buat link invite baru yang otomatis memberikan role saat member bergabung')
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Role utama yang otomatis diberikan')
            .setRequired(true)
        )
        .addRoleOption((opt) =>
          opt
            .setName('role2')
            .setDescription('Role tambahan kedua (opsional)')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel tujuan link invite (default: rules/welcome channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('label')
            .setDescription('Label / catatan untuk link ini (contoh: Peserta Gelombang 2)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_uses')
            .setDescription('Batas maksimal penggunaan link (0 = tanpa batas)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_age')
            .setDescription('Masa aktif link dalam jam (0 = permanen, default: 0)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(168)
        )
    )
    // ================= Subcommand: list =================
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Lihat daftar seluruh link invite server beserta role dan jumlah penggunaannya')
    )
    // ================= Subcommand: delete =================
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus link invite dari server Discord dan database')
        .addStringOption((opt) =>
          opt
            .setName('code')
            .setDescription('Kode invite yang ingin dihapus (contoh: abcXYZ12)')
            .setRequired(true)
        )
    )
    // ================= Subcommand: stats =================
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Lihat ringkasan statistik pelacak undangan (invite tracker) & leaderboard pengundang')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'Hanya panitia atau admin yang dapat mengelola link undangan server.')]
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // ==========================================
    // 1. CREATE INVITE
    // ==========================================
    if (subcommand === 'create') {
      const role1 = interaction.options.getRole('role');
      const role2 = interaction.options.getRole('role2');
      const channel = interaction.options.getChannel('channel');
      const customLabel = interaction.options.getString('label');
      const maxUses = interaction.options.getInteger('max_uses') || 0;
      const maxAgeHours = interaction.options.getInteger('max_age') || 0;
      const maxAgeSeconds = maxAgeHours * 3600;

      const roleIds = [role1.id];
      if (role2 && role2.id !== role1.id) roleIds.push(role2.id);

      try {
        const { invite, roleNames, label } = await InviteService.createDynamicInvite(
          interaction.guild,
          roleIds,
          channel,
          interaction.user.tag,
          { maxAge: maxAgeSeconds, maxUses }
        );

        const mentions = roleIds.map((id) => `<@&${id}>`).join(' + ');

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Link Undangan Berhasil Dibuat',
              `Link undangan kustom telah aktif dan siap dibagikan.\n\n` +
              `• **Tautan:** ${invite.url}\n` +
              `• **Kode:** \`${invite.code}\`\n` +
              `• **Auto-Role:** ${mentions}\n` +
              `• **Channel:** <#${invite.channelId}>\n` +
              `• **Masa Aktif:** ${maxAgeHours > 0 ? `${maxAgeHours} Jam` : 'Permanen'}\n` +
              `• **Batas Penggunaan:** ${maxUses > 0 ? `${maxUses} Kali` : 'Tanpa Batas'}\n\n` +
              `*Setiap pengguna yang bergabung melalui tautan ini akan otomatis memperoleh role yang ditentukan.*`
            )
          ]
        });
      } catch (err) {
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Membuat Invite', err.message)]
        });
      }
    }

    // ==========================================
    // 2. LIST INVITES
    // ==========================================
    if (subcommand === 'list') {
      const invites = await InviteService.getAllGuildInvitesWithStats(interaction.guild);

      if (invites.length === 0) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tidak Ada Link', 'Tidak ditemukan link undangan aktif di server ini.')]
        });
      }

      const lines = invites.slice(0, 15).map((inv, idx) => {
        const rolesText = inv.roles.length > 0
          ? inv.roles.map((r) => `@${r.name}`).join(' + ')
          : '*(Standar / Tanpa Role)*';
        const usesDisplay = inv.maxUses > 0 ? `${inv.uses}/${inv.maxUses}` : `${inv.uses} kali`;
        const channelName = inv.channel ? `#${inv.channel.name}` : '-';

        return `**${idx + 1}. \`${inv.code}\`** — [Buka Link](${inv.url})\n` +
               `• Role: **${rolesText}**\n` +
               `• Penggunaan: \`${usesDisplay}\` • Channel: \`${channelName}\` • Pembuat: \`${inv.createdBy || 'Staff'}\``;
      });

      const embed = new EmbedBuilder()
        .setTitle('Daftar Link Undangan Server')
        .setDescription(lines.join('\n\n'))
        .setColor(EMBED_COLORS.PRIMARY)
        .setFooter({ text: `Menampilkan ${Math.min(15, invites.length)} dari ${invites.length} link undangan server` })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // ==========================================
    // 3. DELETE INVITE
    // ==========================================
    if (subcommand === 'delete') {
      const code = interaction.options.getString('code').trim();

      try {
        const deleted = await InviteService.deleteDynamicInvite(interaction.guild, code);
        if (!deleted) {
          return await interaction.editReply({
            embeds: [errorEmbed('Gagal Menghapus', `Link undangan dengan kode \`${code}\` tidak ditemukan.`)]
          });
        }

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Link Undangan Dihapus',
              `Link undangan dengan kode \`${code}\` berhasil dihapus dari server Discord dan database.`
            )
          ]
        });
      } catch (err) {
        return await interaction.editReply({
          embeds: [errorEmbed('Gagal Menghapus', err.message)]
        });
      }
    }

    // ==========================================
    // 4. STATS & LEADERBOARD
    // ==========================================
    if (subcommand === 'stats') {
      const [invites, topInviters, trackerStats] = await Promise.all([
        InviteService.getAllGuildInvitesWithStats(interaction.guild),
        getTopInviters(5),
        getInviteTrackerStats()
      ]);

      const totalUses = invites.reduce((acc, i) => acc + (i.uses || 0), 0);
      const dynamicCount = invites.filter((i) => i.isDynamic).length;

      const topInvitersText = topInviters.length > 0
        ? topInviters.map((t, idx) => `**${idx + 1}.** \`${t.inviter_tag}\`: **${t.total_joins}** member`).join('\n')
        : '*(Belum ada data member bergabung terdeteksi)*';

      const embed = new EmbedBuilder()
        .setTitle('Statistik Invite Tracker Server')
        .setColor(EMBED_COLORS.PRIMARY)
        .addFields(
          { name: 'Total Link Undangan', value: `${invites.length} link`, inline: true },
          { name: 'Link Auto-Role', value: `${dynamicCount} link`, inline: true },
          { name: 'Total Penggunaan Link', value: `${totalUses} kali`, inline: true },
          { name: 'Total Member Terlacak', value: `${trackerStats.totalJoins} join`, inline: true },
          { name: 'Member Unik', value: `${trackerStats.uniqueMembers} user`, inline: true },
          { name: 'Top Pengundang', value: topInvitersText, inline: false }
        )
        .setFooter({ text: 'NSAC Jember Invite Tracker' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }
  }
};

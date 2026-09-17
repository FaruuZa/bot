import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { TeamService } from '../../services/teamService.js';
import { InvitationService } from '../../services/invitationService.js';
import { AuditService } from '../../services/auditService.js';
import { GuildConfigService } from '../../services/guildConfigService.js';
import { pool } from '../../database/pool.js';
import {
  getTeamByName,
  getTeamById,
  updateTeamStatus
} from '../../database/queries/teamQueries.js';
import {
  getTeamMembers,
  getActiveTeamMembers,
  getUserActiveTeamByDiscordId
} from '../../database/queries/memberQueries.js';
import {
  getPendingInvitationsForTeam,
  cancelPendingInvitationsForTeam
} from '../../database/queries/invitationQueries.js';
import {
  getOpenRecruitmentByTeam,
  closeAllRecruitmentsByTeam
} from '../../database/queries/recruitmentQueries.js';
import { getUserByDiscordId, upsertUser } from '../../database/queries/userQueries.js';
import { errorEmbed, successEmbed, teamInfoEmbed, warningEmbed, infoEmbed } from '../../utils/embeds.js';
import { AUDIT_ACTIONS, CUSTOM_IDS, MEMBER_ROLE, MEMBER_STATUS, TEAM_STATUS, EMBED_COLORS } from '../../config/constants.js';
import { env } from '../../config/env.js';

export async function buildTeamPanelDashboard(guild) {
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_count,
      COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
      COUNT(*) FILTER (WHERE status = 'ARCHIVED') as archived_count,
      COUNT(*) FILTER (WHERE status = 'DISBANDED') as disbanded_count
    FROM teams
  `);

  const { rows: teams } = await pool.query(`
    SELECT t.*, u.discord_id as leader_discord_id, u.username as leader_username,
           (SELECT COUNT(*) FROM team_members WHERE team_id = t.id AND status = 'ACTIVE') as member_count
    FROM teams t
    LEFT JOIN users u ON t.leader_id = u.id
    ORDER BY 
      CASE t.status
        WHEN 'PENDING' THEN 1
        WHEN 'ACTIVE' THEN 2
        WHEN 'ARCHIVED' THEN 3
        ELSE 4
      END,
      t.created_at DESC
    LIMIT 25
  `);

  const s = stats[0] || { active_count: 0, pending_count: 0, archived_count: 0, disbanded_count: 0 };

  const embed = new EmbedBuilder()
    .setTitle('Hackathon Team Admin Panel')
    .setDescription(
      'Panel kontrol terpusat untuk memantau dan mengelola seluruh tim hackathon.\n' +
      'Pilih tim dari dropdown di bawah untuk melihat detail atau menjalankan aksi.'
    )
    .setColor(EMBED_COLORS.PRIMARY)
    .addFields(
      { name: 'Tim Aktif', value: `**${s.active_count}** Tim`, inline: true },
      { name: 'Menunggu Konfirmasi', value: `**${s.pending_count}** Tim`, inline: true },
      { name: 'Diarsipkan / Bubar', value: `**${s.archived_count}** / **${s.disbanded_count}**`, inline: true }
    )
    .setFooter({ text: 'NSAC Team Management Dashboard' })
    .setTimestamp();

  const components = [];

  if (teams.length > 0) {
    const options = teams.map((t) => {
      const leaderTag = t.leader_username ? `@${t.leader_username}` : 'Unknown';
      const desc = `Leader: ${leaderTag} | ${t.member_count} anggota | Status: ${t.status}`;
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${t.name} (ID: ${t.id})`.substring(0, 100))
        .setDescription(desc.substring(0, 100))
        .setValue(t.id.toString())
        .setEmoji(t.status === 'ACTIVE' ? '🛡️' : t.status === 'PENDING' ? '⏳' : '📁');
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('team_panel_select_team')
      .setPlaceholder('Pilih tim untuk melihat detail dan opsi...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
    embed.addFields({ name: 'Daftar Tim', value: '*(Belum ada tim yang terdaftar)*', inline: false });
  }

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.BTN_STAFF_ADD_TEAM)
      .setLabel('Tambah Tim')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('team_panel_refresh')
      .setLabel('Refresh Data')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('team_panel_export_summary')
      .setLabel('Export Ringkasan Tim')
      .setStyle(ButtonStyle.Primary)
  );

  components.push(buttonRow);

  return { embed, components };
}


export default {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Perintah manajemen tim hackathon')
    // ================= User Subcommands =================
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('Lihat informasi tim')
        .addStringOption((opt) => opt.setName('name').setDescription('Nama tim (kosongkan untuk tim sendiri)'))
        .addUserOption((opt) => opt.setName('user').setDescription('Lihat tim dari user tertentu'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('members')
        .setDescription('Lihat daftar anggota tim')
        .addStringOption((opt) => opt.setName('name').setDescription('Nama tim (kosongkan untuk tim sendiri)'))
    )
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Undang anggota baru ke timmu (hanya untuk Team Leader)')
        .addUserOption((opt) => opt.setName('user').setDescription('User yang ingin diundang').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('kick')
        .setDescription('Keluarkan anggota dari timmu (hanya untuk Team Leader)')
        .addUserOption((opt) => opt.setName('user').setDescription('Anggota yang ingin dikeluarkan').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Keluar dari tim secara mandiri')
    )
    .addSubcommand((sub) =>
      sub
        .setName('recruit')
        .setDescription('Buka lowongan anggota tim di channel rekrutmen (hanya untuk Team Leader)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('recruit-close')
        .setDescription('Tutup lowongan rekrutmen tim yang sedang aktif (hanya untuk Team Leader)')
    )
    // ================= Staff Subcommands =================
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('[Staff] Buat tim baru secara manual')
        .addStringOption((opt) => opt.setName('name').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('leader').setDescription('Team leader').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('[Staff] Force-approve tim yang pending')
        .addStringOption((opt) => opt.setName('name').setDescription('Nama tim pending').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-member')
        .setDescription('[Staff] Tambah anggota ke tim')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User yang ditambahkan').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-member')
        .setDescription('[Staff] Hapus anggota dari tim')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User yang dihapus').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('[Staff] Ubah nama tim')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim saat ini').setRequired(true))
        .addStringOption((opt) => opt.setName('new_name').setDescription('Nama tim baru').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('transfer-leader')
        .setDescription('[Staff] Alihkan kepemimpinan tim')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('new_leader').setDescription('Leader baru').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('archive')
        .setDescription('[Staff] Arsipkan tim dan jadikan channel read-only')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('[Staff] Hapus tim dan seluruh channel/rolenya')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-add')
        .setDescription('[Staff Override] Paksa tambah user ke tim tanpa validasi')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User yang ditambahkan').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-remove')
        .setDescription('[Staff Override] Paksa hapus user dari tim')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User yang dihapus').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('resend-invite')
        .setDescription('[Staff Override] Kirim ulang undangan ke anggota')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('user').setDescription('User yang diundang').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel-registration')
        .setDescription('[Staff Override] Batalkan pendaftaran tim yang pending')
        .addStringOption((opt) => opt.setName('team').setDescription('Nama tim pending').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('force-register')
        .setDescription('[Staff Override] Daftarkan tim beserta anggota secara langsung')
        .addStringOption((opt) => opt.setName('name').setDescription('Nama tim').setRequired(true))
        .addUserOption((opt) => opt.setName('leader').setDescription('Leader').setRequired(true))
        .addUserOption((opt) => opt.setName('member1').setDescription('Anggota 1').setRequired(false))
        .addUserOption((opt) => opt.setName('member2').setDescription('Anggota 2').setRequired(false))
        .addUserOption((opt) => opt.setName('member3').setDescription('Anggota 3').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('[Staff] Buka dashboard manajemen tim')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const isStaffUser = PermissionService.isStaff(interaction.member);

    // ========================================================
    // 0. PANEL SUBCOMMAND (Staff Dashboard)
    // ========================================================
    if (subcommand === 'panel') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!isStaffUser) {
        return await interaction.editReply({ embeds: [errorEmbed('Staff Only', 'Hanya staff yang dapat membuka dashboard tim.')] });
      }
      const { embed, components } = await buildTeamPanelDashboard(interaction.guild);
      return await interaction.editReply({ embeds: [embed], components });
    }

    // ========================================================
    // 1. INFO SUBCOMMAND
    // ========================================================
    if (subcommand === 'info') {
      await interaction.deferReply();

      const nameInput = interaction.options.getString('name');
      const targetUser = interaction.options.getUser('user');

      let team = null;
      if (nameInput) {
        team = await getTeamByName(nameInput);
      } else if (targetUser) {
        team = await getUserActiveTeamByDiscordId(targetUser.id);
      } else {
        team = await getUserActiveTeamByDiscordId(interaction.user.id);
      }

      if (!team) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tim Tidak Ditemukan', 'Tidak ditemukan tim atau keanggotaan aktif yang sesuai.')]
        });
      }

      const members = await getTeamMembers(team.id);
      const embed = teamInfoEmbed(team, members);
      return await interaction.editReply({ embeds: [embed] });
    }

    // ========================================================
    // 2. MEMBERS SUBCOMMAND
    // ========================================================
    if (subcommand === 'members') {
      await interaction.deferReply();

      const nameInput = interaction.options.getString('name');
      let team = null;

      if (nameInput) {
        team = await getTeamByName(nameInput);
      } else {
        team = await getUserActiveTeamByDiscordId(interaction.user.id);
      }

      if (!team) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tim Tidak Ditemukan', 'Tim yang dimaksud tidak ditemukan.')]
        });
      }

      const members = await getActiveTeamMembers(team.id);
      const memberList = members.map((m, idx) => {
        const badge = m.role === 'LEADER' ? 'Leader' : 'Anggota';
        return `${idx + 1}. ${badge} — <@${m.discord_id}> (${m.username})`;
      }).join('\n') || 'Belum ada anggota';

      return await interaction.editReply({
        embeds: [successEmbed(`Anggota Tim: ${team.name}`, memberList)]
      });
    }

    // ========================================================
    // 3. INVITE SUBCOMMAND (Leader Only)
    // ========================================================
    if (subcommand === 'invite') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('user');
      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
        return await interaction.editReply({
          embeds: [errorEmbed('Bukan Leader', 'Hanya Team Leader yang bisa mengundang anggota baru.')]
        });
      }

      if (targetUser.id === interaction.user.id) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tidak Valid', 'Kamu tidak bisa mengundang dirimu sendiri.')]
        });
      }

      if (targetUser.bot) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tidak Valid', 'Kamu tidak bisa mengundang bot.')]
        });
      }

      const targetTeam = await getUserActiveTeamByDiscordId(targetUser.id);
      if (targetTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Sudah di Tim Lain', `<@${targetUser.id}> sudah terdaftar di tim **${targetTeam.name}**.`)]
        });
      }

      // Cek batas maksimum anggota
      const currentMemberCount = await countActiveTeamMembers(activeTeam.id);
      if (currentMemberCount >= env.MAX_TEAM_SIZE) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tim Penuh', `Tim sudah mencapai batas maksimum ${env.MAX_TEAM_SIZE} anggota.`)]
        });
      }

      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const leaderUser = await getUserByDiscordId(interaction.user.id);
      const invitedDbUser = await upsertUser(targetUser.id, targetUser.tag || targetUser.username);

      await InvitationService.createTeamInvitation({
        teamId: activeTeam.id,
        invitedUserId: invitedDbUser.id,
        invitedBy: leaderUser.id,
        expiresAt
      });

      // Tambahkan sebagai PENDING ke team_members
      await addTeamMember({
        teamId: activeTeam.id,
        userId: invitedDbUser.id,
        role: MEMBER_ROLE.MEMBER,
        status: MEMBER_STATUS.PENDING
      });

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember) {
        await InvitationService.sendInvitationMessage({
          guild: interaction.guild,
          team: activeTeam,
          leaderMember: interaction.member,
          targetMember,
          expiresAt
        });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Undangan Terkirim', `Undangan berhasil dikirim ke <@${targetUser.id}>!`)]
      });
    }

    // ========================================================
    // 4. KICK SUBCOMMAND (Leader Only)
    // ========================================================
    if (subcommand === 'kick') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('user');
      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
        return await interaction.editReply({
          embeds: [errorEmbed('Bukan Leader', 'Hanya Team Leader yang bisa mengeluarkan anggota.')]
        });
      }

      if (targetUser.id === interaction.user.id) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tidak Valid', 'Kamu tidak bisa mengeluarkan dirimu sendiri. Gunakan `/team leave` jika ingin meninggalkan tim.')]
        });
      }

      // Konfirmasi sebelum kick
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.BTN_TEAM_KICK_CONFIRM}${activeTeam.id}_${targetUser.id}`)
          .setLabel('Ya, Keluarkan')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_KICK_CANCEL)
          .setLabel('Batal')
          .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.editReply({
        embeds: [
          warningEmbed(
            'Konfirmasi Pengeluaran Anggota',
            `Apakah kamu yakin ingin mengeluarkan <@${targetUser.id}> dari tim **${activeTeam.name}**?\n\n` +
            `Anggota ini akan kehilangan akses ke channel tim.`
          )
        ],
        components: [confirmRow]
      });
    }

    // ========================================================
    // 5. LEAVE SUBCOMMAND
    // ========================================================
    if (subcommand === 'leave') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam) {
        return await interaction.editReply({
          embeds: [errorEmbed('Tidak di Tim', 'Kamu tidak terdaftar di tim mana pun.')]
        });
      }

      if (activeTeam.user_team_role === 'LEADER') {
        return await interaction.editReply({
          embeds: [errorEmbed(
            'Tidak Bisa Keluar',
            'Sebagai Team Leader, kamu tidak bisa langsung meninggalkan tim.\n\n' +
            'Alihkan kepemimpinan ke anggota lain terlebih dahulu, atau hubungi panitia untuk membubarkan tim.'
          )]
        });
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_LEAVE_CONFIRM)
          .setLabel('Ya, Keluar dari Tim')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_LEAVE_CANCEL)
          .setLabel('Batal')
          .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.editReply({
        embeds: [
          warningEmbed(
            'Konfirmasi Keluar dari Tim',
            `Apakah kamu yakin ingin keluar dari tim **${activeTeam.name}**?\n\n` +
            `Kamu akan kehilangan akses ke channel tim. Tindakan ini tidak bisa dibatalkan.`
          )
        ],
        components: [confirmRow]
      });
    }

    // ========================================================
    // 6. RECRUIT SUBCOMMAND (Leader Only) — Buka lowongan
    // ========================================================
    if (subcommand === 'recruit') {
      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
        return await interaction.reply({
          embeds: [errorEmbed('Bukan Leader', 'Hanya Team Leader yang bisa membuka lowongan rekrutmen.')],
          flags: MessageFlags.Ephemeral
        });
      }

      // Cek apakah sudah ada rekrutmen yang aktif
      const existing = await getOpenRecruitmentByTeam(activeTeam.id);
      if (existing) {
        return await interaction.reply({
          embeds: [errorEmbed(
            'Rekrutmen Sudah Aktif',
            `Tim **${activeTeam.name}** sudah memiliki lowongan rekrutmen yang aktif.\n\n` +
            `Tutup dulu dengan \`/team recruit-close\` sebelum membuka yang baru.`
          )],
          flags: MessageFlags.Ephemeral
        });
      }

      // Tampilkan modal untuk input detail rekrutmen
      const modal = new ModalBuilder()
        .setCustomId(`${CUSTOM_IDS.MODAL_TEAM_RECRUIT}${activeTeam.id}`)
        .setTitle('Buka Lowongan Rekrutmen Tim');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CUSTOM_IDS.INPUT_RECRUIT_SLOTS)
            .setLabel('Berapa anggota yang kamu butuhkan?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Contoh: 2')
            .setMinLength(1)
            .setMaxLength(1)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(CUSTOM_IDS.INPUT_RECRUIT_DESC)
            .setLabel('Deskripsi kebutuhan tim (opsional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Contoh: Mencari anggota dengan keahlian desain UI/UX atau pengembangan backend.')
            .setMaxLength(300)
            .setRequired(false)
        )
      );

      return await interaction.showModal(modal);
    }

    // ========================================================
    // 7. RECRUIT-CLOSE SUBCOMMAND (Leader Only)
    // ========================================================
    if (subcommand === 'recruit-close') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);

      if (!activeTeam || activeTeam.user_team_role !== 'LEADER') {
        return await interaction.editReply({
          embeds: [errorEmbed('Bukan Leader', 'Hanya Team Leader yang bisa menutup rekrutmen.')]
        });
      }

      const existing = await getOpenRecruitmentByTeam(activeTeam.id);
      if (!existing) {
        return await interaction.editReply({
          embeds: [infoEmbed('Tidak Ada Rekrutmen Aktif', `Tim **${activeTeam.name}** tidak memiliki rekrutmen yang sedang aktif.`)]
        });
      }

      // Tutup di DB
      await closeAllRecruitmentsByTeam(activeTeam.id);

      // Update pesan di channel rekrutmen
      try {
        const recruitChannel = interaction.guild.channels.cache.get(existing.channel_id)
          || await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
        if (recruitChannel && recruitChannel.isTextBased()) {
          const msg = await recruitChannel.messages.fetch(existing.message_id).catch(() => null);
          if (msg) {
            await msg.edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`[DITUTUP] Rekrutmen — ${activeTeam.name}`)
                  .setColor(EMBED_COLORS.DARK)
                  .setDescription('Rekrutmen ini sudah ditutup oleh leader tim.')
                  .setTimestamp()
              ],
              components: []
            }).catch(() => {});
          }
        }
      } catch (err) {
        // Lanjut meskipun gagal update pesan
      }

      await AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.RECRUITMENT_CLOSED,
        title: 'Rekrutmen Ditutup',
        actorTag: interaction.user.tag,
        teamId: activeTeam.id,
        teamName: activeTeam.name,
        details: `Leader menutup rekrutmen tim "${activeTeam.name}".`
      });

      return await interaction.editReply({
        embeds: [successEmbed('Rekrutmen Ditutup', `Lowongan rekrutmen tim **${activeTeam.name}** telah ditutup.`)]
      });
    }

    // ========================================================
    // ALL REMAINING SUBCOMMANDS REQUIRE STAFF ROLE
    // ========================================================
    if (!isStaffUser) {
      return await interaction.reply({
        embeds: [errorEmbed('Staff Only', 'Kamu tidak memiliki akses untuk menjalankan perintah staff ini.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // 8. CREATE (Staff Manual)
    if (subcommand === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const leader = interaction.options.getUser('leader');

      const leaderMember = await interaction.guild.members.fetch(leader.id).catch(() => null);
      if (!leaderMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'Leader tidak ditemukan di server ini.')] });
      }

      const result = await TeamService.startRegistration({
        teamName: name,
        leaderMember,
        memberIds: [],
        guild: interaction.guild,
        client: interaction.client
      });

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal', result.error)] });
      }

      await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

      return await interaction.editReply({
        embeds: [successEmbed('Tim Dibuat', `Tim **${name}** berhasil dibuat dengan leader <@${leader.id}>!`)]
      });
    }

    // 9. APPROVE (Staff Force Finalize)
    if (subcommand === 'approve') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const team = await getTeamByName(name);

      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${name}" tidak ditemukan.`)] });
      }

      try {
        await TeamService.finalizeTeamCreation(team.id, interaction.guild, interaction.client);
        return await interaction.editReply({
          embeds: [successEmbed('Tim Diapprove', `Tim **${team.name}** berhasil di-approve dan channel sudah diprovisioning.`)]
        });
      } catch (err) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal Approve', err.message)] });
      }
    }

    // 10. ADD-MEMBER (Staff)
    if (subcommand === 'add-member' || subcommand === 'force-add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const result = await TeamService.addMemberToTeam(team.id, targetUser.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Anggota Ditambahkan', `<@${targetUser.id}> berhasil ditambahkan ke tim **${team.name}**.`)]
      });
    }

    // 11. REMOVE-MEMBER (Staff)
    if (subcommand === 'remove-member' || subcommand === 'force-remove') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const result = await TeamService.removeMemberFromTeam(team.id, targetUser.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Anggota Dihapus', `<@${targetUser.id}> berhasil dihapus dari tim **${team.name}**.`)]
      });
    }

    // 12. RENAME (Staff)
    if (subcommand === 'rename') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const newName = interaction.options.getString('new_name');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const result = await TeamService.renameTeam(team.id, newName, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal Ubah Nama', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Nama Tim Diubah', `Tim **${result.oldName}** berhasil diubah namanya menjadi **${result.newName}**.`)]
      });
    }

    // 13. TRANSFER-LEADER (Staff)
    if (subcommand === 'transfer-leader') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const newLeader = interaction.options.getUser('new_leader');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const result = await TeamService.transferLeader(team.id, newLeader.id, interaction.guild, interaction.client, interaction.user.tag);

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Gagal', result.error)] });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Kepemimpinan Dialihkan', `Kepemimpinan tim **${team.name}** dialihkan ke <@${newLeader.id}>.`)]
      });
    }

    // 14. ARCHIVE (Staff)
    if (subcommand === 'archive') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      await TeamService.archiveTeam(team.id, interaction.guild, interaction.client, interaction.user.tag);

      return await interaction.editReply({
        embeds: [successEmbed('Tim Diarsipkan', `Tim **${team.name}** telah diarsipkan dan channel dijadikan read-only.`)]
      });
    }

    // 15. DELETE (Staff Confirmation Prompt)
    if (subcommand === 'delete') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CONFIRM}${team.id}`)
          .setLabel('Konfirmasi Hapus')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_IDS.BTN_DELETE_TEAM_CANCEL}${team.id}`)
          .setLabel('Batal')
          .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.editReply({
        embeds: [
          warningEmbed(
            'Konfirmasi Hapus Tim',
            `Apakah kamu yakin ingin menghapus tim **${team.name}** secara permanen?\n\n` +
            'Tindakan ini akan:\n' +
            '- Menghapus role Discord tim\n' +
            '- Menghapus Category, Text, dan Voice channel\n' +
            '- Menandai tim sebagai DISBANDED di database\n' +
            '- Mengembalikan role @Unregistered ke semua mantan anggota'
          )
        ],
        components: [row]
      });
    }

    // 16. RESEND-INVITE (Staff)
    if (subcommand === 'resend-invite') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');

      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'User tidak ditemukan di server.')] });
      }

      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const leaderMember = team.leader_discord_id
        ? await interaction.guild.members.fetch(team.leader_discord_id).catch(() => null)
        : interaction.member;

      await InvitationService.sendInvitationMessage({
        guild: interaction.guild,
        team,
        leaderMember: leaderMember || interaction.member,
        targetMember,
        expiresAt
      });

      return await interaction.editReply({
        embeds: [successEmbed('Undangan Dikirim Ulang', `Undangan tim **${team.name}** dikirim ulang ke <@${targetUser.id}>.`)]
      });
    }

    // 17. CANCEL-REGISTRATION (Staff)
    if (subcommand === 'cancel-registration') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const teamName = interaction.options.getString('team');
      const team = await getTeamByName(teamName);
      if (!team) {
        return await interaction.editReply({ embeds: [errorEmbed('Tidak Ditemukan', `Tim "${teamName}" tidak ditemukan.`)] });
      }

      if (team.status !== TEAM_STATUS.PENDING) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', `Tim "${team.name}" bukan dalam status PENDING.`)] });
      }

      await cancelPendingInvitationsForTeam(team.id);
      await updateTeamStatus(team.id, TEAM_STATUS.DISBANDED);

      await AuditService.log(interaction.client, {
        action: AUDIT_ACTIONS.REGISTRATION_REJECTED,
        title: 'Pendaftaran Dibatalkan oleh Staff',
        actorTag: interaction.user.tag,
        teamId: team.id,
        teamName: team.name,
        details: `Pendaftaran tim "${team.name}" dibatalkan oleh staff.`
      });

      return await interaction.editReply({
        embeds: [successEmbed('Pendaftaran Dibatalkan', `Pendaftaran tim **${team.name}** berhasil dibatalkan.`)]
      });
    }

    // 18. FORCE-REGISTER (Staff Instant Provisioning)
    if (subcommand === 'force-register') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.options.getString('name');
      const leader = interaction.options.getUser('leader');
      const member1 = interaction.options.getUser('member1');
      const member2 = interaction.options.getUser('member2');
      const member3 = interaction.options.getUser('member3');

      const memberIds = [member1, member2, member3].filter(Boolean).map((u) => u.id);

      const leaderMember = await interaction.guild.members.fetch(leader.id).catch(() => null);
      if (!leaderMember) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', 'Leader tidak ditemukan di server.')] });
      }

      const result = await TeamService.startRegistration({
        teamName: name,
        leaderMember,
        memberIds: [],
        guild: interaction.guild,
        client: interaction.client,
        skipInvitations: true
      });

      if (!result.success) {
        return await interaction.editReply({ embeds: [errorEmbed('Error', result.error)] });
      }

      await TeamService.finalizeTeamCreation(result.team.id, interaction.guild, interaction.client);

      for (const mId of memberIds) {
        await TeamService.addMemberToTeam(result.team.id, mId, interaction.guild, interaction.client, interaction.user.tag);
      }

      return await interaction.editReply({
        embeds: [successEmbed('Tim Berhasil Dibuat', `Tim **${name}** dibuat dan diaktifkan dengan ${memberIds.length + 1} anggota!`)]
      });
    }
  }
};

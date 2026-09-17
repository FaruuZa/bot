import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { CUSTOM_IDS, INVITATION_STATUS, MEMBER_ROLE, MEMBER_STATUS, AUDIT_ACTIONS, EMBED_COLORS } from '../config/constants.js';
import {
  createInvitation,
  getInvitationById,
  getPendingInvitationsForTeam,
  updateInvitationStatus,
  markExpiredInvitations
} from '../database/queries/invitationQueries.js';
import {
  addTeamMember,
  getUserActiveTeamByDiscordId,
  updateMemberStatus
} from '../database/queries/memberQueries.js';
import { getTeamById } from '../database/queries/teamQueries.js';
import { getUserByDiscordId } from '../database/queries/userQueries.js';
import { invitationEmbed, successEmbed, errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { AuditService } from './auditService.js';
import { DiscordService } from './discordService.js';

export class InvitationService {
  /**
   * Buat entri undangan di database
   */
  static async createTeamInvitation({ teamId, invitedUserId, invitedBy, expiresAt, dbClient }) {
    return await createInvitation({
      teamId,
      invitedUserId,
      invitedBy,
      expiresAt
    }, dbClient);
  }

  /**
   * Kirim pesan undangan interaktif via DM ke anggota
   */
  static async sendInvitationMessage({ guild, team, leaderMember, targetMember, expiresAt }) {
    const embed = invitationEmbed(team.name, leaderMember.user.tag, expiresAt);

    const user = await getUserByDiscordId(targetMember.id);
    if (!user) return;

    const pending = await getPendingInvitationsForTeam(team.id);
    const invite = pending.find((i) => i.invited_user_id === user.id);
    if (!invite) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.BTN_INVITE_ACCEPT}${invite.id}`)
        .setLabel('Terima')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.BTN_INVITE_DECLINE}${invite.id}`)
        .setLabel('Tolak')
        .setStyle(ButtonStyle.Danger)
    );

    try {
      await targetMember.send({ embeds: [embed], components: [row] });
      logger.info(`[InvitationService] Undangan DM terkirim ke ${targetMember.user.tag} untuk tim "${team.name}"`);
    } catch (err) {
      logger.warn(`[InvitationService] Tidak bisa DM ${targetMember.user.tag}: ${err.message}.`);
    }
  }

  /**
   * Handle member klik tombol 'Terima' undangan.
   * Tim sudah ACTIVE — anggota langsung join dan mendapat role.
   */
  static async handleAccept(interaction, invitationId, teamService) {
    const invite = await getInvitationById(invitationId);
    if (!invite) {
      return await interaction.reply({
        embeds: [errorEmbed('Undangan Tidak Ditemukan', 'Undangan ini tidak ada atau sudah dihapus.')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (invite.status !== INVITATION_STATUS.PENDING) {
      return await interaction.reply({
        embeds: [errorEmbed('Undangan Tidak Valid', `Undangan ini sudah berstatus **${invite.status}**.`)],
        flags: MessageFlags.Ephemeral
      });
    }

    if (new Date(invite.expires_at) <= new Date()) {
      await updateInvitationStatus(invite.id, INVITATION_STATUS.EXPIRED);
      return await interaction.reply({
        embeds: [errorEmbed('Undangan Kedaluwarsa', 'Undangan ini sudah melewati batas waktu.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // Pastikan yang klik adalah orang yang diundang
    if (interaction.user.id !== invite.invited_discord_id) {
      return await interaction.reply({
        embeds: [errorEmbed('Tidak Berwenang', 'Undangan ini bukan untukmu.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // Cek apakah sudah di tim lain
    const activeTeam = await getUserActiveTeamByDiscordId(interaction.user.id);
    if (activeTeam) {
      return await interaction.reply({
        embeds: [errorEmbed('Sudah di Tim Lain', `Kamu sudah terdaftar di tim **${activeTeam.name}**.`)],
        flags: MessageFlags.Ephemeral
      });
    }

    // Ambil data tim yang sudah aktif
    const team = await getTeamById(invite.team_id);
    if (!team) {
      return await interaction.reply({
        embeds: [errorEmbed('Tim Tidak Ditemukan', 'Tim yang bersangkutan tidak ditemukan.')],
        flags: MessageFlags.Ephemeral
      });
    }

    // 1. Tandai undangan sebagai ACCEPTED
    await updateInvitationStatus(invite.id, INVITATION_STATUS.ACCEPTED);

    // 2. Aktifkan status member dari PENDING ke ACTIVE
    await updateMemberStatus(invite.team_id, invite.invited_user_id, MEMBER_STATUS.ACTIVE);

    // 3. Assign Discord role tim langsung
    try {
      const { env } = await import('../config/env.js');
      const guild = interaction.guild ?? await interaction.client.guilds.fetch(env.GUILD_ID).catch(() => null);

      if (guild && team.role_id) {
        await DiscordService.assignTeamMembershipRoles(guild, interaction.user.id, team.role_id);
      }

      // 4. Notifikasi di channel tim bahwa anggota baru bergabung
      if (guild && team.text_channel_id) {
        const textChannel = guild.channels.cache.get(team.text_channel_id)
          || await guild.channels.fetch(team.text_channel_id).catch(() => null);
        if (textChannel && textChannel.isTextBased()) {
          await textChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(EMBED_COLORS.SUCCESS)
                .setDescription(`<@${interaction.user.id}> baru saja bergabung ke tim **${team.name}**. Selamat datang!`)
                .setTimestamp()
            ]
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.error(`[InvitationService] Gagal assign role setelah accept: ${err.message}`);
    }

    // 5. Update pesan undangan
    await interaction.update({
      embeds: [
        successEmbed(
          'Undangan Diterima!',
          `Kamu berhasil bergabung ke tim **${invite.team_name}**.\n\n` +
          `Role dan akses channel tim sudah diberikan. Silakan cek channel tim kamu!`
        )
      ],
      components: []
    });

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
      title: 'Undangan Diterima',
      actorTag: interaction.user.tag,
      teamId: invite.team_id,
      teamName: invite.team_name,
      details: `<@${interaction.user.id}> menerima undangan untuk bergabung ke tim "${invite.team_name}".`
    });
  }

  /**
   * Handle member klik tombol 'Tolak' undangan
   */
  static async handleDecline(interaction, invitationId) {
    const invite = await getInvitationById(invitationId);
    if (!invite) {
      return await interaction.reply({
        embeds: [errorEmbed('Undangan Tidak Ditemukan', 'Undangan ini tidak ada.')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.user.id !== invite.invited_discord_id) {
      return await interaction.reply({
        embeds: [errorEmbed('Tidak Berwenang', 'Undangan ini bukan untukmu.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await updateInvitationStatus(invite.id, INVITATION_STATUS.DECLINED);

    // Hapus entry member dari tim (status PENDING dihapus)
    try {
      const user = await getUserByDiscordId(interaction.user.id);
      if (user) {
        await updateMemberStatus(invite.team_id, user.id, 'REMOVED');
      }
    } catch (err) {
      logger.warn(`[InvitationService] Gagal hapus member setelah decline: ${err.message}`);
    }

    // Notifikasi ke leader via DM
    try {
      const { env } = await import('../config/env.js');
      const guild = interaction.guild ?? await interaction.client.guilds.fetch(env.GUILD_ID).catch(() => null);
      const team = await getTeamById(invite.team_id);
      if (guild && team) {
        const leaderMember = await guild.members.fetch(team.leader_discord_id).catch(() => null);
        if (leaderMember) {
          await leaderMember.send({
            embeds: [
              new EmbedBuilder()
                .setColor(EMBED_COLORS.WARNING)
                .setTitle('Undangan Ditolak')
                .setDescription(
                  `<@${interaction.user.id}> menolak undangan untuk bergabung ke tim **${team.name}**.\n\n` +
                  `Kamu bisa mengundang anggota lain dengan command \`/team invite @user\`.`
                )
                .setTimestamp()
            ]
          }).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn(`[InvitationService] Tidak bisa notif leader setelah decline: ${err.message}`);
    }

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLORS.DANGER)
          .setTitle('Undangan Ditolak')
          .setDescription(`Kamu menolak undangan untuk bergabung ke tim **${invite.team_name}**.`)
          .setTimestamp()
      ],
      components: []
    });

    await AuditService.log(interaction.client, {
      action: AUDIT_ACTIONS.INVITATION_DECLINED,
      title: 'Undangan Ditolak',
      actorTag: interaction.user.tag,
      teamId: invite.team_id,
      teamName: invite.team_name,
      details: `<@${interaction.user.id}> menolak undangan untuk tim "${invite.team_name}".`
    });
  }

  /**
   * Background sweeper untuk expire undangan yang sudah lewat batas waktu
   */
  static startExpirationSweeper(client) {
    logger.info('[InvitationService] Menjalankan sweeper undangan (interval 5 menit).');

    setInterval(async () => {
      try {
        const expired = await markExpiredInvitations();
        if (expired.length > 0) {
          logger.info(`[InvitationService] ${expired.length} undangan sudah diexpire.`);
        }
      } catch (err) {
        logger.error(`[InvitationService Sweeper Error] ${err.message}`);
      }
    }, 5 * 60 * 1000);
  }
}

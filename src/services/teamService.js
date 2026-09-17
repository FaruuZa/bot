import { env } from '../config/env.js';
import { AUDIT_ACTIONS, MEMBER_ROLE, MEMBER_STATUS, TEAM_STATUS, TICKET_TYPE, EMBED_COLORS } from '../config/constants.js';
import { withTransaction } from '../database/pool.js';
import { upsertUser, getUserByDiscordId } from '../database/queries/userQueries.js';
import { getActiveUserTicket, closeTicket } from '../database/queries/ticketQueries.js';
import {
  createTeam,
  getTeamById,
  getTeamByName,
  updateTeamDiscordResources,
  updateTeamStatus,
  updateTeamName,
  updateTeamLeader
} from '../database/queries/teamQueries.js';
import {
  addTeamMember,
  getTeamMembers,
  getActiveTeamMembers,
  getUserActiveTeamByDiscordId,
  updateMemberRole,
  removeTeamMember,
  countActiveTeamMembers
} from '../database/queries/memberQueries.js';
import {
  closeAllRecruitmentsByTeam,
  getRecruitmentById
} from '../database/queries/recruitmentQueries.js';
import { DiscordService } from './discordService.js';
import { AuditService } from './auditService.js';
import { InvitationService } from './invitationService.js';
import { validateTeamName, validateTeamSize } from '../utils/validators.js';
import { logger } from '../utils/logger.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CUSTOM_IDS } from '../config/constants.js';

export class TeamService {
  /**
   * Validate potential team registration before creating
   */
  static async validateRegistration({ teamName, leaderMember, memberIds, guild, allowSolo = false }) {
    // 1. Validate team name
    const nameCheck = validateTeamName(teamName);
    if (!nameCheck.valid) {
      return { valid: false, error: nameCheck.error };
    }

    // Check name uniqueness
    const existingTeam = await getTeamByName(teamName);
    if (existingTeam) {
      return { valid: false, error: `Nama tim "${teamName}" sudah digunakan atau sedang dalam proses pendaftaran.` };
    }

    // 2. Validate team size
    // memberIds should not include leader
    const uniqueMemberIds = [...new Set(memberIds.filter((id) => id !== leaderMember.id))];
    const totalCount = uniqueMemberIds.length + 1; // +1 for leader

    if (!allowSolo) {
      const sizeCheck = validateTeamSize(totalCount);
      if (!sizeCheck.valid) {
        return { valid: false, error: sizeCheck.error };
      }
    } else if (totalCount > env.MAX_TEAM_SIZE) {
      return {
        valid: false,
        error: `A team cannot have more than ${env.MAX_TEAM_SIZE} members (including the leader). Current: ${totalCount}.`
      };
    }

    // 3. Validate leader active status
    const leaderActiveTeam = await getUserActiveTeamByDiscordId(leaderMember.id);
    if (leaderActiveTeam) {
      return {
        valid: false,
        error: `Kamu (<@${leaderMember.id}>) sudah terdaftar di tim **${leaderActiveTeam.name}**.`
      };
    }

    // 4. Validate each member
    for (const memberId of uniqueMemberIds) {
      // Check in guild
      const member = await guild.members.fetch(memberId).catch(() => null);
      if (!member) {
        return {
          valid: false,
          error: `<@${memberId}> tidak ditemukan di server Discord ini.`
        };
      }

      if (member.user.bot) {
        return {
          valid: false,
          error: `<@${memberId}> adalah bot dan tidak bisa bergabung ke tim.`
        };
      }

      // Check anti-double-team
      const memberActiveTeam = await getUserActiveTeamByDiscordId(memberId);
      if (memberActiveTeam) {
        return {
          valid: false,
          error: `<@${memberId}> sudah terdaftar di tim lain (${memberActiveTeam.name}).`
        };
      }
    }

    return { valid: true, uniqueMemberIds };
  }

  /**
   * Register a new team — tim langsung ACTIVE, undangan dikirim ke anggota yang dipilih.
   * @param {boolean} skipInvitations - Jika true, anggota langsung ditambah tanpa undangan (staff override)
   * @param {boolean} [allowSolo=false] - Jika true, izinkan pendaftaran dengan 1 leader saja (staff override)
   */
  static async startRegistration({ teamName, leaderMember, memberIds, guild, client, ticketChannel = null, skipInvitations = false, allowSolo = false }) {
    const validation = await this.validateRegistration({ teamName, leaderMember, memberIds, guild, allowSolo });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { uniqueMemberIds } = validation;

    // Run DB writes inside a transaction
    const { team, leaderUser, invitedUsers, expiresAt } = await withTransaction(async (dbClient) => {
      // 1. Ensure leader user record
      const leaderUser = await upsertUser(leaderMember.id, leaderMember.user.tag || leaderMember.user.username, dbClient);

      // 2. Buat tim langsung dengan status ACTIVE
      const team = await createTeam({
        name: teamName,
        leaderId: leaderUser.id,
        status: TEAM_STATUS.ACTIVE  // <-- langsung ACTIVE, tidak perlu approval
      }, dbClient);

      // 3. Tambah leader sebagai anggota ACTIVE
      await addTeamMember({
        teamId: team.id,
        userId: leaderUser.id,
        role: MEMBER_ROLE.LEADER,
        status: MEMBER_STATUS.ACTIVE
      }, dbClient);

      const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRE_HOURS * 3600 * 1000);
      const invitedUsers = [];

      for (const memberId of uniqueMemberIds) {
        const member = await guild.members.fetch(memberId);
        const memberUser = await upsertUser(member.id, member.user.tag || member.user.username, dbClient);
        invitedUsers.push({ user: memberUser, member });

        if (skipInvitations) {
          // Staff override: langsung tambah sebagai ACTIVE
          await addTeamMember({
            teamId: team.id,
            userId: memberUser.id,
            role: MEMBER_ROLE.MEMBER,
            status: MEMBER_STATUS.ACTIVE
          }, dbClient);
        } else {
          // Normal: buat invitation, anggota masuk sebagai PENDING dulu
          await addTeamMember({
            teamId: team.id,
            userId: memberUser.id,
            role: MEMBER_ROLE.MEMBER,
            status: MEMBER_STATUS.PENDING  // akan jadi ACTIVE saat accept
          }, dbClient);

          await InvitationService.createTeamInvitation({
            teamId: team.id,
            invitedUserId: memberUser.id,
            invitedBy: leaderUser.id,
            expiresAt,
            dbClient
          });
        }
      }

      return { team, leaderUser, invitedUsers, expiresAt };
    });

    if (skipInvitations) {
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.STAFF_OVERRIDE,
        title: 'Staff Team Creation',
        actorId: null,
        actorTag: 'Staff Panel',
        teamId: team.id,
        teamName: team.name,
        details: `Staff langsung membuat tim "${team.name}" dengan ${uniqueMemberIds.length} anggota (tanpa alur undangan).`
      });
      return { success: true, team, pendingInvitations: false };
    }

    // Kirim DM undangan setelah transaksi selesai
    if (invitedUsers.length > 0) {
      setImmediate(async () => {
        for (const { member } of invitedUsers) {
          await InvitationService.sendInvitationMessage({
            guild,
            team,
            leaderMember,
            targetMember: member,
            expiresAt
          });
        }
      });
    }

    // Audit log
    await AuditService.log(client, {
      action: AUDIT_ACTIONS.INVITATION_SENT,
      title: 'Pendaftaran Tim Dimulai',
      actorId: leaderUser.id,
      actorTag: leaderMember.user.tag,
      teamId: team.id,
      teamName: team.name,
      details: `Mengirim undangan ke ${uniqueMemberIds.length} anggota untuk tim "${team.name}".`
    });

    return {
      success: true,
      team,
      pendingInvitations: uniqueMemberIds.length > 0,
      invitedCount: uniqueMemberIds.length,
      expiresAt
    };
  }

  /**
   * Provision Discord resources (role, category, channels) dan kirim welcome panel ke tim.
   * Dipanggil segera setelah tim dibuat.
   */
  static async finalizeTeamCreation(teamId, guild, client) {
    const team = await getTeamById(teamId);
    if (!team) {
      throw new Error(`Tim dengan ID ${teamId} tidak ditemukan.`);
    }

    // Kalau sudah punya resources, tidak perlu provision ulang
    if (team.role_id && team.text_channel_id) {
      logger.warn(`[TeamService] Tim ${team.name} sudah memiliki Discord resources, skip finalize.`);
      return team;
    }

    logger.info(`[TeamService] Menyiapkan resources Discord untuk tim "${team.name}" (ID: ${team.id})`);

    // 1. Provision Discord Resources (Role, Category, Text, Voice)
    const discordResources = await DiscordService.provisionTeamResources(guild, team.name);

    try {
      // 2. Simpan resources ke DB
      await withTransaction(async (dbClient) => {
        await updateTeamDiscordResources(team.id, discordResources, dbClient);

        // Aktifkan semua anggota yang status-nya ACTIVE di DB (termasuk leader)
        await dbClient.query(
          `UPDATE team_members SET status = 'ACTIVE' WHERE team_id = $1 AND status = 'ACTIVE'`,
          [team.id]
        );
      });

      // 3. Assign Discord role ke seluruh anggota ACTIVE
      const activeMembers = await getActiveTeamMembers(team.id);
      for (const member of activeMembers) {
        await DiscordService.assignTeamMembershipRoles(guild, member.discord_id, discordResources.roleId);
      }

      // 4. Kirim welcome panel ke text channel tim
      const textChannel = guild.channels.cache.get(discordResources.textChannelId);
      if (textChannel && textChannel.isTextBased()) {
        const { embed, components } = this.buildTeamWelcomePanel(team, activeMembers);
        await textChannel.send({
          content: activeMembers.map((m) => `<@${m.discord_id}>`).join(' '),
          embeds: [embed],
          components
        }).catch(() => {});
      }

      // 5. Auto-close registration ticket jika ada
      try {
        const leaderTicket = await getActiveUserTicket(team.leader_id, TICKET_TYPE.TEAM_REGISTRATION);
        if (leaderTicket) {
          await closeTicket(leaderTicket.discord_channel_id).catch(() => {});
          const ticketChannel = guild.channels.cache.get(leaderTicket.discord_channel_id)
            || await guild.channels.fetch(leaderTicket.discord_channel_id).catch(() => null);
          if (ticketChannel && ticketChannel.isTextBased()) {
            await ticketChannel.send({
              embeds: [
                successEmbed(
                  'Tim Berhasil Dibuat!',
                  `Tim **${team.name}** telah aktif dan channel sudah siap.\n\n` +
                  `Text Channel: <#${discordResources.textChannelId}>\n` +
                  `Voice Channel: <#${discordResources.voiceChannelId}>\n\n` +
                  `*Channel tiket pendaftaran ini akan ditutup otomatis dalam 5 detik.*`
                )
              ]
            }).catch(() => {});

            setTimeout(async () => {
              await ticketChannel.delete('Registration ticket auto-closed after team creation').catch(() => {});
            }, 5000);
          }
        }
      } catch (err) {
        logger.warn(`[TeamService] Tidak bisa menutup tiket pendaftaran: ${err.message}`);
      }

      // 6. Audit log
      await AuditService.log(client, {
        action: AUDIT_ACTIONS.TEAM_CREATED,
        title: 'Tim Berhasil Dibuat',
        teamId: team.id,
        teamName: team.name,
        actorTag: team.leader_username,
        details: `Tim "${team.name}" aktif dengan ${activeMembers.length} anggota.`
      });

      return team;
    } catch (error) {
      logger.error(`[TeamService] Gagal finalize tim "${team.name}": ${error.message}`);
      await DiscordService.deleteTeamResources(guild, discordResources).catch(() => {});
      throw error;
    }
  }

  /**
   * Buat embed welcome panel untuk channel tim.
   * Menggantikan welcome message sederhana dengan info yang lebih berguna.
   */
  static buildTeamWelcomePanel(team, activeMembers) {
    const leaderMention = team.leader_discord_id ? `<@${team.leader_discord_id}>` : 'Tidak diketahui';
    const memberList = activeMembers
      .map((m) => {
        const badge = m.role === 'LEADER' ? 'Leader' : 'Anggota';
        return `${badge} — <@${m.discord_id}>`;
      })
      .join('\n') || 'Belum ada anggota';

    const embed = new EmbedBuilder()
      .setTitle(`Selamat datang di tim ${team.name}!`)
      .setColor(EMBED_COLORS.SUCCESS)
      .setDescription(
        'Channel ini adalah ruang kerja khusus tim kamu selama hackathon berlangsung.\n' +
        'Gunakan channel ini untuk diskusi, koordinasi, dan berbagi progres.'
      )
      .addFields(
        { name: 'Anggota Tim', value: memberList, inline: false },
        {
          name: 'Yang bisa dilakukan leader',
          value:
            '`/team invite @user` — Undang anggota baru\n' +
            '`/team kick @user` — Keluarkan anggota dari tim\n' +
            '`/team recruit` — Buka lowongan anggota di channel rekrutmen\n' +
            '`/team info` — Lihat detail tim',
          inline: false
        },
        {
          name: 'Yang bisa dilakukan anggota',
          value:
            '`/team leave` — Keluar dari tim\n' +
            '`/team info` — Lihat detail tim\n' +
            '`/team members` — Lihat daftar anggota',
          inline: false
        }
      )
      .setFooter({ text: 'NSAC Hackathon — Semoga sukses!' })
      .setTimestamp();

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_PANEL_INVITE)
          .setLabel('Undang Anggota')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_PANEL_RECRUIT)
          .setLabel('Buka Rekrutmen')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(CUSTOM_IDS.BTN_TEAM_PANEL_INFO)
          .setLabel('Info Tim')
          .setStyle(ButtonStyle.Secondary)
      )
    ];

    return { embed, components };
  }

  /**
   * Add a member to an existing active team
   */
  static async addMemberToTeam(teamId, memberDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    const currentCount = await countActiveTeamMembers(teamId);
    if (currentCount >= env.MAX_TEAM_SIZE) {
      return { success: false, error: `Tim sudah penuh (${currentCount}/${env.MAX_TEAM_SIZE}).` };
    }

    const memberActiveTeam = await getUserActiveTeamByDiscordId(memberDiscordId);
    if (memberActiveTeam) {
      return { success: false, error: `<@${memberDiscordId}> sudah terdaftar di tim "${memberActiveTeam.name}".` };
    }

    const guildMember = await guild.members.fetch(memberDiscordId).catch(() => null);
    if (!guildMember) return { success: false, error: 'Pengguna tidak ditemukan di server Discord ini.' };

    const user = await upsertUser(memberDiscordId, guildMember.user.tag || guildMember.user.username);
    await addTeamMember({
      teamId: team.id,
      userId: user.id,
      role: MEMBER_ROLE.MEMBER,
      status: MEMBER_STATUS.ACTIVE
    });

    if (team.role_id) {
      await DiscordService.assignTeamMembershipRoles(guild, memberDiscordId, team.role_id);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_ADDED,
      title: 'Anggota Ditambahkan ke Tim',
      actorTag,
      targetUserId: user.id,
      targetTag: guildMember.user.tag,
      teamId: team.id,
      teamName: team.name,
      details: `<@${memberDiscordId}> ditambahkan ke tim "${team.name}".`
    });

    return { success: true, team, user };
  }

  /**
   * Remove a member from an active team (staff)
   */
  static async removeMemberFromTeam(teamId, memberDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    const user = await getUserByDiscordId(memberDiscordId);
    if (!user) return { success: false, error: 'Data pengguna tidak ditemukan.' };

    if (team.leader_id === user.id) {
      return {
        success: false,
        error: 'Tidak bisa menghapus Team Leader. Alihkan kepemimpinan ke anggota lain terlebih dahulu.'
      };
    }

    await removeTeamMember(team.id, user.id);

    if (team.role_id) {
      await DiscordService.removeTeamMembershipRoles(guild, memberDiscordId, team.role_id, true);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      title: 'Anggota Dihapus dari Tim',
      actorTag,
      targetUserId: user.id,
      targetTag: user.username,
      teamId: team.id,
      teamName: team.name,
      details: `<@${memberDiscordId}> dikeluarkan dari tim "${team.name}".`
    });

    return { success: true, team, user };
  }

  /**
   * Kick a member from team (by leader)
   */
  static async kickMember(teamId, leaderDiscordId, targetDiscordId, guild, client) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    // Pastikan yang menjalankan adalah leader
    const leaderUser = await getUserByDiscordId(leaderDiscordId);
    if (!leaderUser || team.leader_id !== leaderUser.id) {
      return { success: false, error: 'Hanya Team Leader yang bisa mengeluarkan anggota.' };
    }

    if (leaderDiscordId === targetDiscordId) {
      return { success: false, error: 'Kamu tidak bisa mengeluarkan dirimu sendiri dari tim. Gunakan `/team leave` jika ingin meninggalkan tim.' };
    }

    const targetUser = await getUserByDiscordId(targetDiscordId);
    if (!targetUser) return { success: false, error: 'Pengguna tidak ditemukan.' };

    await removeTeamMember(team.id, targetUser.id);

    if (team.role_id) {
      await DiscordService.removeTeamMembershipRoles(guild, targetDiscordId, team.role_id, true);
    }

    // Kirim notif ke channel tim
    if (team.text_channel_id) {
      const textChannel = guild.channels.cache.get(team.text_channel_id);
      if (textChannel && textChannel.isTextBased()) {
        await textChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLORS.WARNING)
              .setDescription(`<@${targetDiscordId}> telah dikeluarkan dari tim oleh leader.`)
              .setTimestamp()
          ]
        }).catch(() => {});
      }
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_KICKED,
      title: 'Anggota Dikeluarkan dari Tim',
      actorTag: leaderUser.username,
      targetUserId: targetUser.id,
      targetTag: targetUser.username,
      teamId: team.id,
      teamName: team.name,
      details: `<@${targetDiscordId}> dikeluarkan dari tim "${team.name}" oleh leader.`
    });

    return { success: true, team, user: targetUser };
  }

  /**
   * Peserta keluar dari tim sendiri
   */
  static async leaveTeam(discordId, guild, client) {
    const activeTeam = await getUserActiveTeamByDiscordId(discordId);
    if (!activeTeam) {
      return { success: false, error: 'Kamu tidak terdaftar di tim mana pun.' };
    }

    const user = await getUserByDiscordId(discordId);
    if (!user) return { success: false, error: 'Data pengguna tidak ditemukan.' };

    // Leader tidak bisa leave, harus alihkan dulu
    if (activeTeam.user_team_role === 'LEADER') {
      return {
        success: false,
        error: 'Sebagai Team Leader, kamu tidak bisa langsung meninggalkan tim. Alihkan kepemimpinan ke anggota lain terlebih dahulu, atau hubungi panitia untuk membubarkan tim.'
      };
    }

    const team = await getTeamById(activeTeam.id);
    await removeTeamMember(activeTeam.id, user.id);

    if (team && team.role_id) {
      await DiscordService.removeTeamMembershipRoles(guild, discordId, team.role_id, true);
    }

    // Notif ke channel tim
    if (team && team.text_channel_id) {
      const textChannel = guild.channels.cache.get(team.text_channel_id);
      if (textChannel && textChannel.isTextBased()) {
        await textChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLORS.WARNING)
              .setDescription(`<@${discordId}> telah meninggalkan tim.`)
              .setTimestamp()
          ]
        }).catch(() => {});
      }
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.MEMBER_LEFT,
      title: 'Anggota Keluar dari Tim',
      actorTag: user.username,
      targetUserId: user.id,
      targetTag: user.username,
      teamId: activeTeam.id,
      teamName: activeTeam.name,
      details: `<@${discordId}> meninggalkan tim "${activeTeam.name}".`
    });

    return { success: true, team: activeTeam };
  }

  /**
   * Transfer leadership of a team
   */
  static async transferLeader(teamId, newLeaderDiscordId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    const newLeaderUser = await getUserByDiscordId(newLeaderDiscordId);
    if (!newLeaderUser) return { success: false, error: 'Data pengguna tidak ditemukan.' };

    const members = await getActiveTeamMembers(team.id);
    const isMember = members.some((m) => m.user_id === newLeaderUser.id);
    if (!isMember) {
      return { success: false, error: `<@${newLeaderDiscordId}> bukan anggota aktif tim ini.` };
    }

    await withTransaction(async (dbClient) => {
      // Turunkan leader saat ini
      if (team.leader_id) {
        await updateMemberRole(team.id, team.leader_id, MEMBER_ROLE.MEMBER, dbClient);
      }
      // Naikkan leader baru
      await updateMemberRole(team.id, newLeaderUser.id, MEMBER_ROLE.LEADER, dbClient);
      // Update record tim
      await updateTeamLeader(team.id, newLeaderUser.id, dbClient);
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.LEADER_TRANSFERRED,
      title: 'Kepemimpinan Tim Dialihkan',
      actorTag,
      targetUserId: newLeaderUser.id,
      targetTag: newLeaderUser.username,
      teamId: team.id,
      teamName: team.name,
      details: `Kepemimpinan tim "${team.name}" dialihkan ke <@${newLeaderDiscordId}>.`
    });

    return { success: true, team, newLeaderUser };
  }

  /**
   * Rename a team
   */
  static async renameTeam(teamId, newName, guild, client, actorTag) {
    const nameCheck = validateTeamName(newName);
    if (!nameCheck.valid) return { success: false, error: nameCheck.error };

    const existing = await getTeamByName(newName);
    if (existing && existing.id !== teamId) {
      return { success: false, error: `Tim dengan nama "${newName}" sudah ada.` };
    }

    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    const oldName = team.name;
    await updateTeamName(team.id, newName);

    await DiscordService.renameTeamResources(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id,
      newName
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_RENAMED,
      title: 'Tim Diganti Nama',
      actorTag,
      teamId: team.id,
      teamName: newName,
      details: `Tim diganti nama dari "${oldName}" menjadi "${newName}".`
    });

    return { success: true, oldName, newName };
  }

  /**
   * Archive a team (read-only)
   */
  static async archiveTeam(teamId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    await updateTeamStatus(team.id, TEAM_STATUS.ARCHIVED);

    // Tutup semua rekrutmen aktif tim ini
    await closeAllRecruitmentsByTeam(team.id);

    await DiscordService.archiveTeamChannels(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id
    });

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_ARCHIVED,
      title: 'Tim Diarsipkan',
      actorTag,
      teamId: team.id,
      teamName: team.name,
      details: `Tim "${team.name}" telah diarsipkan.`
    });

    return { success: true, team };
  }

  /**
   * Delete a team
   */
  static async deleteTeam(teamId, guild, client, actorTag) {
    const team = await getTeamById(teamId);
    if (!team) return { success: false, error: 'Tim tidak ditemukan.' };

    const members = await getTeamMembers(team.id);

    // 1. Hapus Discord resources
    await DiscordService.deleteTeamResources(guild, {
      roleId: team.role_id,
      categoryId: team.category_id,
      textChannelId: team.text_channel_id,
      voiceChannelId: team.voice_channel_id
    });

    // 2. Tutup semua rekrutmen aktif
    await closeAllRecruitmentsByTeam(team.id);

    // 3. Update DB
    await withTransaction(async (dbClient) => {
      await updateTeamStatus(team.id, TEAM_STATUS.DISBANDED, dbClient);
      await dbClient.query(
        `UPDATE team_members SET status = 'REMOVED', removed_at = NOW() WHERE team_id = $1`,
        [team.id]
      );
    });

    // 4. Kembalikan role Unregistered ke semua mantan anggota
    for (const m of members) {
      await DiscordService.removeTeamMembershipRoles(guild, m.discord_id, team.role_id, true);
    }

    await AuditService.log(client, {
      action: AUDIT_ACTIONS.TEAM_DELETED,
      title: 'Tim Dihapus',
      actorTag,
      teamId: team.id,
      teamName: team.name,
      details: `Tim "${team.name}" dan seluruh channel/rolenya dihapus. Semua anggota dikembalikan ke @Unregistered.`
    });

    return { success: true, team };
  }
}

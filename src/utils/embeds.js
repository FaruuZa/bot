import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../config/constants.js';

export function successEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.SUCCESS)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }
  return embed;
}

export function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.DANGER)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.WARNING)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function infoEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length > 0) {
    embed.addFields(fields);
  }
  return embed;
}

export function teamInfoEmbed(team, members) {
  const leader = members.find((m) => m.role === 'LEADER') || { username: team.leader_username, discord_id: team.leader_discord_id };
  const memberList = members.map((m, idx) => {
    const roleBadge = m.role === 'LEADER' ? '**[Leader]**' : '**[Member]**';
    const statusBadge = m.status === 'ACTIVE' ? 'Aktif' : 'Menunggu Konfirmasi';
    return `${idx + 1}. ${roleBadge} <@${m.discord_id}> (${m.username}) — ${statusBadge}`;
  }).join('\n') || '*Belum ada anggota terdaftar*';

  const challengeText = team.challenge_title ? `**${team.challenge_title}**` : '*(Belum memilih challenge)*';
  const nsacLinkText = team.nsac_link ? `[Buka Web Tim NSAC](${team.nsac_link})` : '*(Belum diatur)*';

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle(`Informasi Tim: ${team.name}`)
    .setDescription('Detail resmi tim peserta NSAC Hackathon')
    .addFields(
      { name: 'Status', value: `\`${team.status}\``, inline: true },
      { name: 'Leader', value: leader.discord_id ? `<@${leader.discord_id}>` : 'Tidak diketahui', inline: true },
      { name: 'Total Anggota', value: `**${members.length}** orang`, inline: true },
      { name: 'Challenge', value: challengeText, inline: false },
      { name: 'Tautan Web NSAC', value: nsacLinkText, inline: true },
      { name: 'Daftar Anggota (Roster)', value: memberList, inline: false },
      { name: 'Text Channel', value: team.text_channel_id ? `<#${team.text_channel_id}>` : '*(Tidak ada)*', inline: true },
      { name: 'Voice Channel', value: team.voice_channel_id ? `<#${team.voice_channel_id}>` : '*(Tidak ada)*', inline: true }
    )
    .setFooter({ text: `ID Tim: ${team.id} • NSAC Hackathon` })
    .setTimestamp();

  return embed;
}

export function registrationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('Pendaftaran Tim Hackathon')
    .setDescription(
      'Selamat datang di portal pendaftaran tim resmi NSAC Hackathon!\n\n' +
      'Klik tombol **Buka Tiket Pendaftaran** di bawah untuk membuka channel privat dan mendaftarkan tim kamu bersama rekan-rekanmu.\n\n' +
      '**Ketentuan & Syarat:**\n' +
      '• Pendaftaran dilakukan oleh Ketua Tim (Team Leader)\n' +
      '• Seluruh calon anggota harus sudah bergabung di server Discord ini\n' +
      '• Seluruh anggota berstatus belum memiliki tim (tidak terdaftar di tim aktif lain)\n' +
      '• Jumlah formasi tim harus memenuhi kuota kompetisi yang ditentukan'
    )
    .setFooter({ text: 'NSAC Hackathon • Sistem Manajemen Tim' });
}

export function supportPanelEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle('Bantuan & Dukungan Hackathon')
    .setDescription(
      'Mengalami kendala teknis, pertanyaan aturan kompetisi, atau butuh panduan pendaftaran tim?\n\n' +
      'Klik tombol **Buka Tiket Bantuan** di bawah untuk membuat ruang diskusi privat langsung bersama tim Panitia dan Technical Support.'
    )
    .setFooter({ text: 'NSAC Hackathon • Helpdesk & Support' });
}

export function registrationTicketEmbed(user) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('Tiket Pendaftaran Tim')
    .setDescription(
      `Selamat datang, <@${user.id}>!\n\n` +
      'Gunakan tiket privat ini untuk mendaftarkan tim kamu. Ikuti langkah mudah berikut:\n\n' +
      '**Langkah Pendaftaran:**\n' +
      '1. Klik tombol **Daftarkan Tim** di bawah.\n' +
      '2. Masukkan **Nama Tim** dan link profil web tim resmi (opsional).\n' +
      '3. Pilih rekan-rekan satu tim kamu dari menu dropdown.\n' +
      '4. Calon anggota akan menerima pesan konfirmasi. Begitu semua menyetujui, channel tim privat dan role tim otomatis dibuat!\n\n' +
      '*Jika ingin membatalkan atau terjadi kendala, klik tombol **Tutup Tiket**.*'
    )
    .setFooter({ text: 'NSAC Hackathon • Team Registration' })
    .setTimestamp();
}

export function supportTicketEmbed(user) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle('Tiket Bantuan Panitia')
    .setDescription(
      `Halo <@${user.id}>!\n\n` +
      'Tim Panitia atau Technical Support akan segera bergabung ke tiket ini untuk membantumu.\n\n' +
      'Silakan jelaskan pertanyaan atau kendalamu secara detail di sini (bisa menyertakan tangkapan layar jika relevan agar penanganan lebih cepat).\n\n' +
      '*Jika masalah sudah teratasi, klik tombol **Tutup Tiket**.*'
    )
    .setFooter({ text: 'NSAC Hackathon • Helpdesk & Support' })
    .setTimestamp();
}

export function invitationEmbed(teamName, leaderTag, expiresAt) {
  const unixExpiry = Math.floor(new Date(expiresAt).getTime() / 1000);
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('Hackathon Team Invitation')
    .setDescription(
      `You have been invited by **${leaderTag}** to join **${teamName}** as a team member!\n\n` +
      `**Expires:** <t:${unixExpiry}:R> (<t:${unixExpiry}:f>)\n\n` +
      'Please click **Accept** to join or **Decline** if you cannot join.'
    )
    .setFooter({ text: 'Anti-Double-Team: You can only be an active member of one team.' })
    .setTimestamp();
}

export function auditLogEmbed({ title, action, actor, target, team, details }) {
  const safeAction = String(action || 'LOG').toUpperCase();
  const isDanger = safeAction.includes('DELETED') || safeAction.includes('REMOVED') || safeAction.includes('REJECTED');
  const embed = new EmbedBuilder()
    .setColor(isDanger ? EMBED_COLORS.DANGER : EMBED_COLORS.SUCCESS)
    .setTitle(`[LOG] ${title || safeAction}`)
    .setTimestamp();

  if (team) {
    embed.addFields({ name: 'Team', value: `${team.name || team}`, inline: true });
  }
  if (actor) {
    embed.addFields({ name: 'Actor', value: `${actor}`, inline: true });
  }
  if (target) {
    embed.addFields({ name: 'Target', value: `${target}`, inline: true });
  }
  if (details) {
    embed.addFields({ name: 'Details', value: typeof details === 'string' ? details : JSON.stringify(details, null, 2), inline: false });
  }

  return embed;
}

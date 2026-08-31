import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../config/constants.js';

export function successEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.SUCCESS)
    .setTitle(`✅ ${title}`)
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
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.WARNING)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function infoEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle(`ℹ️ ${title}`)
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
    const roleBadge = m.role === 'LEADER' ? '👑 **[Leader]**' : '👤 **[Member]**';
    const statusBadge = m.status === 'ACTIVE' ? '✅' : '⏳ Pending';
    return `${idx + 1}. ${roleBadge} <@${m.discord_id}> (${m.username}) - ${statusBadge}`;
  }).join('\n') || '*No members listed*';

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle(`🏆 Team: ${team.name}`)
    .setDescription(`Official Hackathon Team Details`)
    .addFields(
      { name: '📊 Status', value: `\`${team.status}\``, inline: true },
      { name: '👑 Leader', value: leader.discord_id ? `<@${leader.discord_id}>` : 'None', inline: true },
      { name: '👥 Total Members', value: `${members.length}`, inline: true },
      { name: '📜 Roster', value: memberList, inline: false },
      { name: '📁 Category ID', value: team.category_id ? `\`${team.category_id}\`` : 'None', inline: true },
      { name: '💬 Text Channel', value: team.text_channel_id ? `<#${team.text_channel_id}>` : 'None', inline: true },
      { name: '🔊 Voice Channel', value: team.voice_channel_id ? `<#${team.voice_channel_id}>` : 'None', inline: true }
    )
    .setFooter({ text: `Team ID: ${team.id}` })
    .setTimestamp();

  return embed;
}

export function registrationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('🎫 Team Registration')
    .setDescription(
      'Ready to compete in the hackathon?\n\n' +
      'Click the button below to open a private registration ticket and register your team!\n\n' +
      '**Requirements:**\n' +
      '• You must be the team leader\n' +
      '• Your teammates must already be in this Discord server\n' +
      '• All members must have the `@Unregistered` role and no other active teams'
    )
    .setFooter({ text: 'Hackathon Management Bot' });
}

export function supportPanelEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle('🆘 Hackathon Support')
    .setDescription(
      'Need help with registration, technical issues, or rules?\n\n' +
      'Click the button below to open a private support ticket with our Staff and Technical Support team.'
    )
    .setFooter({ text: 'Hackathon Management Bot' });
}

export function registrationTicketEmbed(user) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('🎫 Team Registration Ticket')
    .setDescription(
      `Welcome <@${user.id}>!\n\n` +
      'Please click **Register Team** below to input your **Team Name** and select your **Teammates**.\n\n' +
      'Once submitted, your invited teammates will receive confirmation requests. Once everyone accepts, your team channels and roles will be generated automatically!'
    )
    .setFooter({ text: 'Click Close Ticket if you wish to cancel this ticket.' })
    .setTimestamp();
}

export function supportTicketEmbed(user) {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.INFO)
    .setTitle('🆘 Support Ticket')
    .setDescription(
      `Hello <@${user.id}>!\n\n` +
      'A member of the Staff or Technical Support team will assist you shortly.\n' +
      'Please describe your issue or question in detail here.'
    )
    .setFooter({ text: 'Click Close Ticket when your issue has been resolved.' })
    .setTimestamp();
}

export function invitationEmbed(teamName, leaderTag, expiresAt) {
  const unixExpiry = Math.floor(new Date(expiresAt).getTime() / 1000);
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.PRIMARY)
    .setTitle('📨 Hackathon Team Invitation')
    .setDescription(
      `You have been invited by **${leaderTag}** to join **${teamName}** as a team member!\n\n` +
      `⏱️ **Expires:** <t:${unixExpiry}:R> (<t:${unixExpiry}:f>)\n\n` +
      'Please click **Accept** to join or **Decline** if you cannot join.'
    )
    .setFooter({ text: 'Anti-Double-Team: You can only be an active member of one team.' })
    .setTimestamp();
}

export function auditLogEmbed({ title, action, actor, target, team, details }) {
  const embed = new EmbedBuilder()
    .setColor(action.includes('DELETED') || action.includes('REMOVED') || action.includes('REJECTED') ? EMBED_COLORS.DANGER : EMBED_COLORS.SUCCESS)
    .setTitle(`📋 [LOG] ${title || action}`)
    .setTimestamp();

  if (team) {
    embed.addFields({ name: '🏆 Team', value: `${team.name || team}`, inline: true });
  }
  if (actor) {
    embed.addFields({ name: '👤 Actor', value: `${actor}`, inline: true });
  }
  if (target) {
    embed.addFields({ name: '🎯 Target', value: `${target}`, inline: true });
  }
  if (details) {
    embed.addFields({ name: '📝 Details', value: typeof details === 'string' ? details : JSON.stringify(details, null, 2), inline: false });
  }

  return embed;
}

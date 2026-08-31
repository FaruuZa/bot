import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField
} from 'discord.js';
import { PermissionService } from '../../services/permissionService.js';
import { pool } from '../../database/pool.js';
import { CUSTOM_IDS, EMBED_COLORS } from '../../config/constants.js';
import { errorEmbed } from '../../utils/embeds.js';

export async function buildTeamPanelDashboard(guild) {
  // Query team statistics & list
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
    .setTitle('🛡️ Hackathon Team Admin Panel')
    .setDescription(
      'Panel kontrol terpusat untuk memantau, approve, dan mengelola seluruh tim hackathon.\n' +
      'Pilih tim dari dropdown menu di bawah untuk melihat detail atau menjalankan aksi.'
    )
    .setColor(EMBED_COLORS.PRIMARY)
    .addFields(
      { name: '🟢 Tim Aktif', value: `**${s.active_count}** Tim`, inline: true },
      { name: '⏳ Menunggu Konfirmasi', value: `**${s.pending_count}** Tim`, inline: true },
      { name: '📦 Diarsipkan / Bubar', value: `**${s.archived_count}** / **${s.disbanded_count}**`, inline: true }
    )
    .setFooter({ text: 'NSAC Team Management Dashboard' })
    .setTimestamp();

  // Build Select Menu options
  const components = [];

  if (teams.length > 0) {
    const options = teams.map((t) => {
      const statusIcon = t.status === 'ACTIVE' ? '🟢' : t.status === 'PENDING' ? '⏳' : t.status === 'ARCHIVED' ? '📦' : '❌';
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${t.name}`.substring(0, 100))
        .setDescription(`${statusIcon} Status: ${t.status} | Anggota: ${t.member_count} | Leader: ${t.leader_username || 'N/A'}`.substring(0, 100))
        .setValue(t.id.toString())
        .setEmoji(t.status === 'ACTIVE' ? '🛡️' : t.status === 'PENDING' ? '⏳' : '📁');
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('team_panel_select_team')
      .setPlaceholder('🔍 Pilih tim untuk melihat detail & opsi...')
      .addOptions(options);

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  } else {
    embed.addFields({ name: 'Daftar Tim', value: '*(Belum ada tim yang terdaftar di database)*', inline: false });
  }

  // Action Buttons row
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.BTN_STAFF_ADD_TEAM)
      .setLabel('Tambah Tim')
      .setStyle(ButtonStyle.Success)
      .setEmoji('➕'),
    new ButtonBuilder()
      .setCustomId('team_panel_refresh')
      .setLabel('Refresh Data')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId('team_panel_export_summary')
      .setLabel('Export Ringkasan Tim')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋')
  );

  components.push(buttonRow);

  return { embed, components };
}

export default {
  data: new SlashCommandBuilder()
    .setName('team-panel')
    .setDescription('[Staff] Interactive dashboard to monitor and manage all teams')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
      });
    }

    try {
      const { embed, components } = await buildTeamPanelDashboard(interaction.guild);

      return await interaction.editReply({
        embeds: [embed],
        components
      });
    } catch (err) {
      return await interaction.editReply({
        embeds: [errorEmbed('Panel Error', `Gagal memuat dashboard tim: ${err.message}`)]
      });
    }
  }
};

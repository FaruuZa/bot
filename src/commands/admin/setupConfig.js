import {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField
} from 'discord.js';
import { GuildConfigService, CONFIG_DEFINITIONS } from '../../services/guildConfigService.js';
import { PermissionService } from '../../services/permissionService.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { EMBED_COLORS } from '../../config/constants.js';

// Build choices list for /setup-config set & get
const configChoices = Object.values(CONFIG_DEFINITIONS).map((def) => ({
  name: `${def.label} (${def.key})`,
  value: def.key
}));

export default {
  data: new SlashCommandBuilder()
    .setName('setup-config')
    .setDescription('[Admin] Manage bot dynamic roles, channels, and categories configuration')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    // --- Subcommand: list ---
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('View current status of all dynamic bot configurations')
    )
    // --- Subcommand: set ---
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Configure a Discord role, channel, category, or raw ID')
        .addStringOption((opt) =>
          opt
            .setName('key')
            .setDescription('The configuration item to update')
            .setRequired(true)
            .addChoices(...configChoices.slice(0, 25))
        )
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Select a Discord Role (for Role configs)')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Select a Discord Channel or Category')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('raw_id')
            .setDescription('Enter Discord ID manually (if role/channel is not listed)')
            .setRequired(false)
        )
    )
    // --- Subcommand: get ---
    .addSubcommand((sub) =>
      sub
        .setName('get')
        .setDescription('Get details of a specific configuration item')
        .addStringOption((opt) =>
          opt
            .setName('key')
            .setDescription('Configuration key')
            .setRequired(true)
            .addChoices(...configChoices.slice(0, 25))
        )
    ),

  async execute(interaction) {
    // Admin check
    if (!PermissionService.isAdmin(interaction.member)) {
      return await interaction.reply({
        embeds: [errorEmbed('Administrator Only', 'You must be an Administrator to configure bot settings.')],
        flags: MessageFlags.Ephemeral
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // ==========================================
    // 1. LIST SUBCOMMAND
    // ==========================================
    if (subcommand === 'list') {
      const allConfigs = GuildConfigService.getAll();
      const guild = interaction.guild;

      const rolesSection = [];
      const channelsSection = [];
      const categoriesSection = [];

      for (const [key, def] of Object.entries(CONFIG_DEFINITIONS)) {
        const value = allConfigs[key];
        let displayValue = '*(Belum di-set)* ❌';

        if (value) {
          if (def.type === 'ROLE') {
            const role = guild.roles.cache.get(value);
            displayValue = role ? `<@&${value}> (\`${value}\`) ✅` : `\`${value}\` (Role not found) ⚠️`;
          } else if (def.type === 'CHANNEL' || def.type === 'CATEGORY') {
            const ch = guild.channels.cache.get(value);
            displayValue = ch ? `<#${value}> (\`${value}\`) ✅` : `\`${value}\` (Channel not found) ⚠️`;
          } else {
            displayValue = `\`${value}\` ✅`;
          }
        }

        const line = `**${def.label}**
\`${key}\` → ${displayValue}`;

        if (def.type === 'ROLE') rolesSection.push(line);
        else if (def.type === 'CHANNEL') channelsSection.push(line);
        else categoriesSection.push(line);
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot Dynamic Configuration')
        .setDescription(
          'Konfigurasi ID Discord disimpan di database dan dapat diatur tanpa restart bot.\n' +
          'Gunakan `/setup-config set key: [item] role/channel/raw_id: [...]` untuk mengatur nilai.'
        )
        .setColor(EMBED_COLORS.PRIMARY)
        .addFields(
          { name: '🎭 Roles', value: rolesSection.join('\n\n') || 'None', inline: false },
          { name: '💬 Channels', value: channelsSection.join('\n\n') || 'None', inline: false },
          { name: '📁 Categories', value: categoriesSection.join('\n\n') || 'None', inline: false }
        )
        .setFooter({ text: 'NSAC Hackathon Bot Config' })
        .setTimestamp();

      return await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }

    // ==========================================
    // 2. SET SUBCOMMAND
    // ==========================================
    if (subcommand === 'set') {
      const key = interaction.options.getString('key');
      const roleOption = interaction.options.getRole('role');
      const channelOption = interaction.options.getChannel('channel');
      const rawIdOption = interaction.options.getString('raw_id');

      const def = CONFIG_DEFINITIONS[key];
      if (!def) {
        return await interaction.reply({
          embeds: [errorEmbed('Invalid Key', `Key \`${key}\` is not recognized.`)],
          flags: MessageFlags.Ephemeral
        });
      }

      // Extract target ID
      let targetId = null;
      let displayTarget = '';

      if (roleOption) {
        targetId = roleOption.id;
        displayTarget = `<@&${targetId}> (\`${targetId}\`)`;
      } else if (channelOption) {
        targetId = channelOption.id;
        displayTarget = `<#${targetId}> (\`${targetId}\`)`;
      } else if (rawIdOption) {
        // Sanitize raw input (strip mention syntax <@&...>, <#...>, etc)
        const cleanId = rawIdOption.replace(/[^0-9]/g, '');
        if (!cleanId || cleanId.length < 15) {
          return await interaction.reply({
            embeds: [errorEmbed('Invalid ID', 'ID Discord yang dimasukkan tidak valid. Masukkan ID numerik yang benar.')],
            flags: MessageFlags.Ephemeral
          });
        }
        targetId = cleanId;
        displayTarget = `\`${targetId}\``;
      }

      if (!targetId) {
        return await interaction.reply({
          embeds: [
            errorEmbed(
              'Input Required',
              'Silakan pilih salah satu opsi: `role`, `channel`, atau masukkan `raw_id`.'
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      try {
        await GuildConfigService.set(key, targetId);

        return await interaction.reply({
          embeds: [
            successEmbed(
              'Config Updated ✅',
              `Konfigurasi **${def.label}** (\`${key}\`) berhasil diperbarui!

` +
              `**Nilai Baru:** ${displayTarget}
` +
              `*Perubahan langsung aktif tanpa perlu restart bot.*`
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        return await interaction.reply({
          embeds: [errorEmbed('Update Failed', `Gagal memperbarui konfigurasi: ${err.message}`)],
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // ==========================================
    // 3. GET SUBCOMMAND
    // ==========================================
    if (subcommand === 'get') {
      const key = interaction.options.getString('key');
      const def = CONFIG_DEFINITIONS[key];
      const val = GuildConfigService.get(key);

      if (!def) {
        return await interaction.reply({
          embeds: [errorEmbed('Not Found', `Unknown config key \`${key}\``)],
          flags: MessageFlags.Ephemeral
        });
      }

      let valDisplay = '*(Belum di-set)*';
      if (val) {
        if (def.type === 'ROLE') valDisplay = `<@&${val}> (\`${val}\`)`;
        else if (def.type === 'CHANNEL' || def.type === 'CATEGORY') valDisplay = `<#${val}> (\`${val}\`)`;
        else valDisplay = `\`${val}\``;
      }

      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Config: ${def.label}`)
        .setColor(EMBED_COLORS.PRIMARY)
        .addFields(
          { name: 'Key', value: `\`${key}\``, inline: true },
          { name: 'Type', value: def.type, inline: true },
          { name: 'Description', value: def.description || '-', inline: false },
          { name: 'Current Value', value: valDisplay, inline: false }
        );

      return await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

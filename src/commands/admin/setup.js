import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField
} from 'discord.js';
import { DashboardService } from '../../services/dashboardService.js';
import { GuildConfigService, CONFIG_DEFINITIONS } from '../../services/guildConfigService.js';
import { PermissionService } from '../../services/permissionService.js';
import { registrationPanelEmbed, supportPanelEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { replyAutoDismiss } from '../../utils/interactionUtils.js';
import { CUSTOM_IDS, EMBED_COLORS } from '../../config/constants.js';

// Build choices list for /setup config set & get
const configChoices = Object.values(CONFIG_DEFINITIONS).map((def) => ({
  name: `${def.label} (${def.key})`.substring(0, 100),
  value: def.key
}));

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('[Admin/Staff] Unified bot setup for dashboard, panels, and configuration')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    // ================= 1. Subcommand: dashboard =================
    .addSubcommand((sub) =>
      sub
        .setName('dashboard')
        .setDescription('Deploy or refresh the central Admin Control Panel (#admin-dashboard)')
    )
    // ================= 2. Subcommand: panels =================
    .addSubcommand((sub) =>
      sub
        .setName('panels')
        .setDescription('Deploy public interactive Team Registration and Support ticket panels')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Which panel to deploy')
            .setRequired(true)
            .addChoices(
              { name: 'Team Registration Panel', value: 'registration' },
              { name: 'Support Ticket Panel', value: 'support' },
              { name: 'Both Panels', value: 'both' }
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post the panel in (defaults to current channel)')
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    // ================= 3. Subcommand Group: config =================
    .addSubcommandGroup((group) =>
      group
        .setName('config')
        .setDescription('Manage bot dynamic roles, channels, and categories configuration')
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('View current status of all dynamic bot configurations')
        )
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Configure a Discord role, channel, category, or raw ID')
            .addStringOption((opt) =>
              opt
                .setName('key')
                .setDescription('The configuration key to update')
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
                .setDescription('Enter Discord ID manually')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('get')
            .setDescription('Get details of a specific configuration key')
            .addStringOption((opt) =>
              opt
                .setName('key')
                .setDescription('Configuration key')
                .setRequired(true)
                .addChoices(...configChoices.slice(0, 25))
            )
        )
    ),

  async execute(interaction) {
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    // ==========================================
    // 1. SETUP DASHBOARD
    // ==========================================
    if (subcommand === 'dashboard') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!PermissionService.isStaff(interaction.member)) {
        return await replyAutoDismiss(interaction, {
          embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
        }, 7000);
      }

      try {
        const { channel } = await DashboardService.setupDashboard(interaction.guild, interaction.client);

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Admin Dashboard Siap 🎛️',
              `Panel kendali staf & admin berhasil di-deploy ke channel <#${channel.id}>!\n\n` +
              `• Channel tersebut otomatis dikunci privat hanya untuk Staff & Administrator.\n` +
              `• Menampilkan 3 panel terpisah: Overview & Status Tim, Konfigurasi Role Sistem, dan Dynamic Invite Auto-Role Manager.\n` +
              `• Pesan non-panel di channel tersebut akan otomatis dibersihkan oleh bot agar channel tetap rapi.`
            )
          ]
        }, 10000);
      } catch (err) {
        return await replyAutoDismiss(interaction, {
          embeds: [errorEmbed('Dashboard Error', err.message)]
        }, 10000);
      }
    }

    // ==========================================
    // 2. SETUP PANELS (Registration & Support)
    // ==========================================
    if (subcommand === 'panels') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!PermissionService.isStaff(interaction.member)) {
        return await interaction.editReply({
          embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
        });
      }

      const type = interaction.options.getString('type');
      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

      const configuredRegChannelId = GuildConfigService.get('REGISTRATION_CHANNEL_ID');
      const configuredSupportChannelId = GuildConfigService.get('SUPPORT_CHANNEL_ID');

      if (type === 'registration' || type === 'both') {
        const regRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.BTN_CREATE_REG_TICKET)
            .setLabel('Create Team Registration')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎫')
        );

        let regChannel = targetChannel;
        if (type === 'both' && configuredRegChannelId) {
          regChannel = await interaction.guild.channels.fetch(configuredRegChannelId).catch(() => targetChannel);
        }

        await regChannel.send({
          embeds: [registrationPanelEmbed()],
          components: [regRow]
        });
      }

      if (type === 'support' || type === 'both') {
        const supRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.BTN_CREATE_SUPPORT_TICKET)
            .setLabel('Create Support Ticket')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🆘')
        );

        let supChannel = targetChannel;
        if (type === 'both' && configuredSupportChannelId) {
          supChannel = await interaction.guild.channels.fetch(configuredSupportChannelId).catch(() => targetChannel);
        }

        await supChannel.send({
          embeds: [supportPanelEmbed()],
          components: [supRow]
        });
      }

      return await interaction.editReply({
        embeds: [successEmbed('Panels Deployed', `Successfully deployed ${type} panel(s) to designated channel(s).`)]
      });
    }

    // ==========================================
    // 3. SETUP CONFIG GROUP
    // ==========================================
    if (subcommandGroup === 'config') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (!PermissionService.isAdmin(interaction.member)) {
        return await interaction.editReply({
          embeds: [errorEmbed('Administrator Only', 'You must be an Administrator to configure bot settings.')]
        });
      }

      // 3A. Config List
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

          const line = `**${def.label}**\n\`${key}\` → ${displayValue}`;

          if (def.type === 'ROLE') rolesSection.push(line);
          else if (def.type === 'CHANNEL') channelsSection.push(line);
          else categoriesSection.push(line);
        }

        const embed = new EmbedBuilder()
          .setTitle('⚙️ Bot Dynamic Configuration')
          .setDescription(
            'Konfigurasi ID Discord disimpan di database dan dapat diatur tanpa restart bot.\n' +
            'Gunakan `/setup config set key: [item] role/channel/raw_id: [...]` untuk mengatur nilai.'
          )
          .setColor(EMBED_COLORS.PRIMARY)
          .addFields(
            { name: '🎭 Roles', value: rolesSection.join('\n\n') || 'None', inline: false },
            { name: '💬 Channels', value: channelsSection.join('\n\n') || 'None', inline: false },
            { name: '📁 Categories', value: categoriesSection.join('\n\n') || 'None', inline: false }
          )
          .setFooter({ text: 'NSAC Hackathon Bot Config' })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // 3B. Config Set
      if (subcommand === 'set') {
        const key = interaction.options.getString('key');
        const roleOption = interaction.options.getRole('role');
        const channelOption = interaction.options.getChannel('channel');
        const rawIdOption = interaction.options.getString('raw_id');

        const def = CONFIG_DEFINITIONS[key];
        if (!def) {
          return await interaction.editReply({
            embeds: [errorEmbed('Invalid Key', `Key \`${key}\` is not recognized.`)]
          });
        }

        let targetId = null;
        let displayTarget = '';

        if (roleOption) {
          targetId = roleOption.id;
          displayTarget = `<@&${targetId}> (\`${targetId}\`)`;
        } else if (channelOption) {
          targetId = channelOption.id;
          displayTarget = `<#${targetId}> (\`${targetId}\`)`;
        } else if (rawIdOption) {
          if (def.type === 'TEXT') {
            targetId = rawIdOption.trim();
            displayTarget = `\`${targetId}\``;
          } else {
            const cleanId = rawIdOption.replace(/[^0-9]/g, '');
            if (!cleanId || cleanId.length < 15) {
              return await interaction.editReply({
                embeds: [errorEmbed('Invalid ID', 'ID Discord yang dimasukkan tidak valid. Masukkan ID numerik yang benar.')]
              });
            }
            targetId = cleanId;
            displayTarget = `\`${targetId}\``;
          }
        }

        if (!targetId) {
          return await interaction.editReply({
            embeds: [errorEmbed('Input Required', 'Silakan pilih salah satu opsi: `role`, `channel`, atau masukkan `raw_id`.')]
          });
        }

        try {
          await GuildConfigService.set(key, targetId);

          return await interaction.editReply({
            embeds: [
              successEmbed(
                'Config Updated ✅',
                `Konfigurasi **${def.label}** (\`${key}\`) berhasil diperbarui!\n\n` +
                `**Nilai Baru:** ${displayTarget}\n` +
                `*Perubahan langsung aktif tanpa perlu restart bot.*`
              )
            ]
          });
        } catch (err) {
          return await interaction.editReply({
            embeds: [errorEmbed('Update Failed', `Gagal memperbarui konfigurasi: ${err.message}`)]
          });
        }
      }

      // 3C. Config Get
      if (subcommand === 'get') {
        const key = interaction.options.getString('key');
        const def = CONFIG_DEFINITIONS[key];
        const val = GuildConfigService.get(key);

        if (!def) {
          return await interaction.editReply({
            embeds: [errorEmbed('Not Found', `Unknown config key \`${key}\``)]
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

        return await interaction.editReply({ embeds: [embed] });
      }
    }
  }
};

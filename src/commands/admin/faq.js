import {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField
} from 'discord.js';
import { FAQService } from '../../services/faqService.js';
import { PermissionService } from '../../services/permissionService.js';
import { getAllDynamicEmbeds } from '../../database/queries/faqQueries.js';
import { errorEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { EMBED_COLORS } from '../../config/constants.js';

export default {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('[Staff] Manage dynamic, editable Rules / FAQ / Info embeds')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    // --- Subcommand: create ---
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new dynamic FAQ/Rules embed in a channel')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('Unique identifier for this embed (e.g., rules-hackathon, faq-general)')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post this embed in')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Embed title (e.g., 📜 Peraturan Hackathon 2026)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Optional description / opening text (supports markdown & \n)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Embed color')
            .setRequired(false)
            .addChoices(
              { name: 'Blurple (Default)', value: 'PRIMARY' },
              { name: 'Green (Success)', value: 'SUCCESS' },
              { name: 'Red (Urgent)', value: 'DANGER' },
              { name: 'Yellow (Warning)', value: 'WARNING' },
              { name: 'Blue (Info)', value: 'INFO' }
            )
        )
    )
    // --- Subcommand: add-item ---
    .addSubcommand((sub) =>
      sub
        .setName('add-item')
        .setDescription('Add a new section / rule / question-answer to an existing embed')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the dynamic embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('question')
            .setDescription('Rule title or Question (Field Name)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('answer')
            .setDescription('Rule details or Answer content (supports \n and markdown)')
            .setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('inline')
            .setDescription('Display side-by-side (inline)?')
            .setRequired(false)
        )
    )
    // --- Subcommand: edit-item ---
    .addSubcommand((sub) =>
      sub
        .setName('edit-item')
        .setDescription('Edit an existing rule / question-answer by its item number')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the dynamic embed')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('index')
            .setDescription('Item number to edit (1, 2, 3...)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((opt) =>
          opt
            .setName('question')
            .setDescription('New question / rule title (leave empty to keep current)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('answer')
            .setDescription('New answer / details (leave empty to keep current)')
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('inline')
            .setDescription('Set inline mode')
            .setRequired(false)
        )
    )
    // --- Subcommand: remove-item ---
    .addSubcommand((sub) =>
      sub
        .setName('remove-item')
        .setDescription('Remove a rule / question-answer by its item number')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the dynamic embed')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('index')
            .setDescription('Item number to remove (1, 2, 3...)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    // --- Subcommand: update-header ---
    .addSubcommand((sub) =>
      sub
        .setName('update-header')
        .setDescription('Update the title, description, or color of an existing embed')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the dynamic embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('New title (leave empty to keep current)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('New description (leave empty to keep current)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('New color')
            .setRequired(false)
            .addChoices(
              { name: 'Blurple (Default)', value: 'PRIMARY' },
              { name: 'Green (Success)', value: 'SUCCESS' },
              { name: 'Red (Urgent)', value: 'DANGER' },
              { name: 'Yellow (Warning)', value: 'WARNING' },
              { name: 'Blue (Info)', value: 'INFO' }
            )
        )
    )
    // --- Subcommand: list ---
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List all dynamic FAQ / Rules embeds currently managed by the bot')
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!PermissionService.isStaff(interaction.member)) {
      return await interaction.editReply({
        embeds: [errorEmbed('Staff Only', 'You do not have permission to use this command.')]
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      // 1. CREATE
      if (subcommand === 'create') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || '';
        const color = interaction.options.getString('color') || 'PRIMARY';

        const record = await FAQService.create({
          client: interaction.client,
          id,
          channel,
          title,
          description,
          color
        });

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Dynamic Embed Created ✅',
              `Embed berhasil diposting ke <#${channel.id}>!

` +
              `**ID Embed:** \`${record.id}\`
` +
              `**Judul:** ${record.title}

` +
              `💡 *Gunakan \`/faq add-item id:${record.id} question:... answer:...\` untuk menambahkan isi poin/tanya-jawab kapan saja.*`
            )
          ]
        });
      }

      // 2. ADD ITEM
      if (subcommand === 'add-item') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const question = interaction.options.getString('question');
        const answer = interaction.options.getString('answer');
        const inline = interaction.options.getBoolean('inline') || false;

        const updated = await FAQService.addItem({
          client: interaction.client,
          id,
          name: question,
          value: answer,
          inline
        });

        const fields = Array.isArray(updated.fields) ? updated.fields : JSON.parse(updated.fields || '[]');

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Item Ditambahkan ✅',
              `Poin/Pertanyaan baru berhasil ditambahkan ke embed \`${id}\` di <#${updated.channel_id}>!

` +
              `**Total Poin Saat Ini:** ${fields.length}
` +
              `**Poin Terbaru (#${fields.length}):** ${question}

` +
              `*Pesan di channel telah otomatis diperbarui tanpa kirim ulang.*`
            )
          ]
        });
      }

      // 3. EDIT ITEM
      if (subcommand === 'edit-item') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const index = interaction.options.getInteger('index');
        const question = interaction.options.getString('question');
        const answer = interaction.options.getString('answer');
        const inline = interaction.options.getBoolean('inline');

        const updated = await FAQService.editItem({
          client: interaction.client,
          id,
          index,
          name: question,
          value: answer,
          inline
        });

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Item Diperbarui ✅',
              `Poin #${index} pada embed \`${id}\` di <#${updated.channel_id}> berhasil diperbarui!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        });
      }

      // 4. REMOVE ITEM
      if (subcommand === 'remove-item') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const index = interaction.options.getInteger('index');

        const { updated, removedItem } = await FAQService.removeItem({
          client: interaction.client,
          id,
          index
        });

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Item Dihapus 🗑️',
              `Poin #${index} (**${removedItem.name}**) telah dihapus dari embed \`${id}\` di <#${updated.channel_id}>.

` +
              `*Pesan di channel telah otomatis diperbarui.*`
            )
          ]
        });
      }

      // 5. UPDATE HEADER
      if (subcommand === 'update-header') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color');

        const updated = await FAQService.updateHeader({
          client: interaction.client,
          id,
          title,
          description,
          color
        });

        return await interaction.editReply({
          embeds: [
            successEmbed(
              'Header Diperbarui ✅',
              `Judul/Deskripsi embed \`${id}\` di <#${updated.channel_id}> berhasil diperbarui!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        });
      }

      // 6. LIST
      if (subcommand === 'list') {
        const embeds = await getAllDynamicEmbeds();

        if (embeds.length === 0) {
          return await interaction.editReply({
            embeds: [infoEmbed('Daftar Embed Dinamis', 'Belum ada embed dinamis yang dibuat. Buat dengan `/faq create`.')]
          });
        }

        const lines = embeds.map((e, idx) => {
          const fields = Array.isArray(e.fields) ? e.fields : JSON.parse(e.fields || '[]');
          return `**${idx + 1}. \`${e.id}\`** — ${e.title}
` +
                 `   • Channel: <#${e.channel_id}> | Items: **${fields.length}** | Color: \`${e.color}\``;
        });

        return await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('📜 Daftar FAQ & Rules Embed Dinamis')
              .setDescription(lines.join('\n\n'))
              .setColor(EMBED_COLORS.PRIMARY)
              .setFooter({ text: 'NSAC Hackathon Bot FAQ System' })
          ]
        });
      }
    } catch (err) {
      return await interaction.editReply({
        embeds: [errorEmbed('FAQ Error', err.message)]
      });
    }
  }
};

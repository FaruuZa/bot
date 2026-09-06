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
import { replyAutoDismiss } from '../../utils/interactionUtils.js';

export default {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('[Staff] Manage clean Markdown Rules / FAQ / Announcements with in-place live editing')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    // --- Subcommand: create ---
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new live-editable Rules / FAQ embed in a channel')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('Unique ID for this embed (e.g. rules, faq, guidelines)')
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
            .setDescription('Embed title (e.g. 📜 Rules & Guidelines)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('Opening text / intro (supports markdown and \n)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('Embed border color')
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
    // --- Subcommand: add-section ---
    .addSubcommand((sub) =>
      sub
        .setName('add-section')
        .setDescription('Add a new section / rule / question to the embed')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('Section heading (e.g. 1. 🤝 Saling Menghormati)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('content')
            .setDescription('Section content/bullets (supports \n and - bullets)')
            .setRequired(true)
        )
    )
    // --- Subcommand: edit-section ---
    .addSubcommand((sub) =>
      sub
        .setName('edit-section')
        .setDescription('Edit an existing section by its item number')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('index')
            .setDescription('Section number (1, 2, 3...)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('New section heading (leave empty to keep current)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('content')
            .setDescription('New section content (leave empty to keep current)')
            .setRequired(false)
        )
    )
    // --- Subcommand: remove-section ---
    .addSubcommand((sub) =>
      sub
        .setName('remove-section')
        .setDescription('Remove a section by its item number')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('index')
            .setDescription('Section number to delete (1, 2, 3...)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    // --- Subcommand: append ---
    .addSubcommand((sub) =>
      sub
        .setName('append')
        .setDescription('Append raw markdown text directly to the end of the embed')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('text')
            .setDescription('Markdown text to append (supports \n, ###, - bullets)')
            .setRequired(true)
        )
    )
    // --- Subcommand: set-content ---
    .addSubcommand((sub) =>
      sub
        .setName('set-content')
        .setDescription('Overwrite entire body with custom markdown text')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('text')
            .setDescription('Full markdown text (supports \n, ###, - bullets)')
            .setRequired(true)
        )
    )
    // --- Subcommand: update-header ---
    .addSubcommand((sub) =>
      sub
        .setName('update-header')
        .setDescription('Update embed title, opening intro, or border color')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID of the embed')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('title')
            .setDescription('New title')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription('New opening intro')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('color')
            .setDescription('New border color')
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
        .setDescription('List all dynamic live-editable embeds')
    )
    // --- Subcommand: move ---
    .addSubcommand((sub) =>
      sub
        .setName('move')
        .setDescription('Pindahkan embed ke channel lain (otomatis sync pesan & DB ke lokasi baru)')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID embed yang ingin dipindahkan')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel tujuan pemindahan')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('delete_old')
            .setDescription('Hapus pesan lama di channel sebelumnya? (Default: True)')
            .setRequired(false)
        )
    )
    // --- Subcommand: copy ---
    .addSubcommand((sub) =>
      sub
        .setName('copy')
        .setDescription('Salin / duplikasi isi embed ke channel lain dengan ID baru')
        .addStringOption((opt) =>
          opt
            .setName('source_id')
            .setDescription('ID embed sumber yang ingin disalin')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('new_id')
            .setDescription('ID unik baru untuk embed salinan')
            .setRequired(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel tujuan untuk embed baru')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    // --- Subcommand: delete ---
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Hapus embed dari database dan Discord')
        .addStringOption((opt) =>
          opt
            .setName('id')
            .setDescription('ID embed yang ingin dihapus')
            .setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('delete_message')
            .setDescription('Hapus pesan di Discord juga? (Default: True)')
            .setRequired(false)
        )
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

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Embed Berhasil Dibuat ✅',
              `Embed telah diposting ke <#${channel.id}>!

` +
              `**ID Embed:** \`${record.id}\`
` +
              `**Judul:** ${record.title}

` +
              `💡 *Gunakan \`/faq add-section id:${record.id} title:... content:...\` untuk menambah aturan/poin baru kapan saja.*`
            )
          ]
        }, 7000);
      }

      // 2. ADD SECTION
      if (subcommand === 'add-section') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const title = interaction.options.getString('title');
        const content = interaction.options.getString('content');

        const updated = await FAQService.addSection({
          client: interaction.client,
          id,
          title,
          content
        });

        const fields = Array.isArray(updated.fields) ? updated.fields : JSON.parse(updated.fields || '[]');

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Section Ditambahkan ✅',
              `Section baru berhasil ditambahkan ke embed \`${id}\` di <#${updated.channel_id}>!

` +
              `**Total Section:** ${fields.length}
` +
              `**Section Terbaru (#${fields.length}):** ${title}

` +
              `*Pesan di channel telah otomatis diperbarui secara rapi.*`
            )
          ]
        }, 7000);
      }

      // 3. EDIT SECTION
      if (subcommand === 'edit-section') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const index = interaction.options.getInteger('index');
        const title = interaction.options.getString('title');
        const content = interaction.options.getString('content');

        const updated = await FAQService.editSection({
          client: interaction.client,
          id,
          index,
          title,
          content
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Section Diperbarui ✅',
              `Section #${index} pada embed \`${id}\` di <#${updated.channel_id}> berhasil diperbarui!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        }, 7000);
      }

      // 4. REMOVE SECTION
      if (subcommand === 'remove-section') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const index = interaction.options.getInteger('index');

        const { updated, removedItem } = await FAQService.removeSection({
          client: interaction.client,
          id,
          index
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Section Dihapus 🗑️',
              `Section #${index} (**${removedItem.name}**) telah dihapus dari embed \`${id}\` di <#${updated.channel_id}>.

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        }, 7000);
      }

      // 5. APPEND RAW MARKDOWN
      if (subcommand === 'append') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const text = interaction.options.getString('text');

        const updated = await FAQService.appendMarkdown({
          client: interaction.client,
          id,
          content: text
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Teks Ditambahkan ✅',
              `Teks markdown berhasil ditambahkan di akhir embed \`${id}\` di <#${updated.channel_id}>!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        }, 7000);
      }

      // 6. SET FULL CONTENT
      if (subcommand === 'set-content') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const text = interaction.options.getString('text');

        const updated = await FAQService.setMarkdown({
          client: interaction.client,
          id,
          content: text
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Isi Embed Diperbarui ✅',
              `Seluruh isi markdown embed \`${id}\` di <#${updated.channel_id}> berhasil diperbarui!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        }, 7000);
      }

      // 7. UPDATE HEADER
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

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Header Diperbarui ✅',
              `Judul/Intro embed \`${id}\` di <#${updated.channel_id}> berhasil diperbarui!

` +
              `*Pesan di channel telah otomatis tersinkronisasi.*`
            )
          ]
        }, 7000);
      }

      // 8. LIST
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
                 `   • Channel: <#${e.channel_id}> | Sections: **${fields.length}** | Color: \`${e.color}\``;
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

      // 9. MOVE
      if (subcommand === 'move') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const targetChannel = interaction.options.getChannel('channel');
        const deleteOld = interaction.options.getBoolean('delete_old') ?? true;

        const { updated, oldChannelId } = await FAQService.move({
          client: interaction.client,
          id,
          targetChannel,
          deleteOldMessage: deleteOld
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Embed Berhasil Dipindahkan 🚀',
              `Embed \`${id}\` berhasil dipindahkan ke channel baru!\n\n` +
              `• **Dari Channel:** <#${oldChannelId}>\n` +
              `• **Ke Channel:** <#${targetChannel.id}>\n` +
              `• **Pesan Lama:** ${deleteOld ? 'Otomatis dihapus dari channel asal ✅' : 'Dibiarkan di channel asal'}\n\n` +
              `💡 *Command edit/update untuk ID \`${id}\` sekarang akan otomatis memperbarui pesan di <#${targetChannel.id}>.*`
            )
          ]
        }, 7000);
      }

      // 10. COPY
      if (subcommand === 'copy') {
        const sourceId = interaction.options.getString('source_id').trim().toLowerCase();
        const newId = interaction.options.getString('new_id').trim().toLowerCase();
        const targetChannel = interaction.options.getChannel('channel');

        const created = await FAQService.copy({
          client: interaction.client,
          sourceId,
          newId,
          targetChannel
        });

        const fields = Array.isArray(created.fields) ? created.fields : JSON.parse(created.fields || '[]');

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Embed Berhasil Disalin 📋',
              `Embed \`${sourceId}\` berhasil disalin menjadi embed baru dengan ID \`${newId}\`!\n\n` +
              `• **Channel Tujuan:** <#${targetChannel.id}>\n` +
              `• **ID Baru:** \`${newId}\`\n` +
              `• **Judul:** ${created.title}\n` +
              `• **Total Section:** ${fields.length}\n\n` +
              `*Embed sumber \`${sourceId}\` tetap utuh dan tidak terpengaruh.*`
            )
          ]
        }, 7000);
      }

      // 11. DELETE
      if (subcommand === 'delete') {
        const id = interaction.options.getString('id').trim().toLowerCase();
        const deleteMsg = interaction.options.getBoolean('delete_message') ?? true;

        const deleted = await FAQService.delete({
          client: interaction.client,
          id,
          deleteDiscordMessage: deleteMsg
        });

        return await replyAutoDismiss(interaction, {
          embeds: [
            successEmbed(
              'Embed Dihapus 🗑️',
              `Embed \`${id}\` (**${deleted.title}**) telah berhasil dihapus dari database` +
              (deleteMsg ? ` dan pesannya di <#${deleted.channel_id}> telah dibersihkan.` : '.')
            )
          ]
        }, 7000);
      }
    } catch (err) {
      return await replyAutoDismiss(interaction, {
        embeds: [errorEmbed('FAQ Error', err.message)]
      }, 10000);
    }
  }
};

import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { EMBED_COLORS } from '../../config/constants.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Panduan lengkap dan daftar slash command Bot Hackathon NSAC Jember')
    .addStringOption((opt) =>
      opt
        .setName('kategori')
        .setDescription('Pilih kategori perintah yang ingin dilihat')
        .setRequired(false)
        .addChoices(
          { name: 'Semua Perintah', value: 'all' },
          { name: 'Peserta & Anggota Tim', value: 'team' },
          { name: 'Pendaftaran & Tiket', value: 'ticket' },
          { name: 'Challenge Hackathon', value: 'challenge' },
          { name: 'Panitia & Administrator', value: 'staff' }
        )
    ),

  async execute(interaction) {
    const category = interaction.options.getString('kategori') || 'all';

    const embed = new EmbedBuilder()
      .setTitle('Pusat Panduan Perintah NSAC Jember')
      .setColor(EMBED_COLORS.PRIMARY)
      .setDescription(
        'Selamat datang di sistem manajemen Discord resmi **NASA Space Apps Challenge Jember**.\n' +
        'Berikut adalah daftar perintah yang tersedia sesuai dengan peran di server ini:\n'
      );

    if (category === 'all' || category === 'team') {
      embed.addFields({
        name: 'Perintah Tim & Anggota',
        value:
          '• `/team create <nama>` — Mendaftarkan tim baru, channel privat & role tim.\n' +
          '• `/team invite <user>` — Mengundang peserta lain masuk ke tim (maksimal 6 orang).\n' +
          '• `/team info [nama]` — Melihat profil tim, tantangan, dan tautan web resmi NASA.\n' +
          '• `/team members` — Melihat daftar seluruh anggota tim saat ini.\n' +
          '• `/team recruit` — Membuka lowongan slot anggota di *#recruitment-board*.\n' +
          '• `/team recruit-close` — Menutup lowongan anggota tim yang sedang terbuka.\n' +
          '• `/team set-link <url>` — Menautkan URL profil resmi tim dari spaceappschallenge.org.\n' +
          '• `/team leave` — Keluar secara mandiri dari tim kamu.\n' +
          '• `/team kick <user>` — *(Ketua)* Mengeluarkan anggota dari tim.',
        inline: false
      });
    }

    if (category === 'all' || category === 'ticket') {
      embed.addFields({
        name: 'Pendaftaran & Tiket Bantuan',
        value:
          '• `/ticket create <type>` — Membuka tiket baru untuk bantuan panitia atau registrasi.\n' +
          '• `/ticket close` — Menutup channel tiket bantuan saat masalah telah selesai.\n' +
          '• `/register team` — Memulai tiket registrasi tim hackathon baru.\n' +
          '• Panel Registrasi & Bantuan juga tersedia secara interaktif di channel panel publik.',
        inline: false
      });
    }

    if (category === 'all' || category === 'challenge') {
      embed.addFields({
        name: 'Challenge & Tantangan',
        value:
          '• `/challenge list` — Melihat daftar seluruh challenge resmi Space Apps yang tersedia.\n' +
          '• `/challenge detail <challenge>` — Melihat deskripsi dan rincian lengkap tantangan.',
        inline: false
      });
    }

    if (category === 'all' || category === 'staff') {
      embed.addFields({
        name: 'Khusus Panitia & Administrator',
        value:
          '• `/announce` — Mengirim pengumuman berformat embed kaya dengan opsi mention.\n' +
          '• `/faq` atau `/embed` — Mengelola live dynamic embed, FAQ, dan rules.\n' +
          '• `/setup` — Mengonfigurasi ID role, channel, kategori, jadwal, dan sistem bot.\n' +
          '• `/sync-nasa` — Menyelaraskan status validasi tim dengan database web NASA.\n' +
          '• `/invite` — Mengelola link undangan auto-role & memantau statistik tracker.\n' +
          '• `/purge` — Membersihkan pesan massal di channel aktif secara aman.\n' +
          '• `/register member` — Mendaftarkan peserta secara manual dan memberi role.',
        inline: false
      });
    }
          '• `/sync-nasa` — Menjalankan sinkronisasi profil tim & lowongan dari web NASA Space Apps.\n' +
          '• `/invite <create|list|delete|stats>` — Mengelola dynamic auto-role invite links.\n' +
          '• `/purge <amount> [user]` — Menghapus pesan secara massal di channel aktif.\n' +
          '• `/register member <user>` — Memberikan role peserta & mencabut unregistered secara manual.\n' +
          '• `/faq <create|edit|sync>` / `/embed` — Mengelola live dynamic embed rules & panduan.\n' +
          '• `/setup <dashboard|panels|config>` — Konfigurasi role, channel, dan panel kendali.\n' +
          '• **Web Dashboard:** Kelola seluruh sistem dengan visual GUI di `http://localhost:8080`.',
        inline: false
      });
    }

    embed.setFooter({ text: 'NASA Space Apps Challenge Jember • Staff Command Center' });
    embed.setTimestamp();

    return await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};

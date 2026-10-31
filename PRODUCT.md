# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Panitia / Core Team NASA Space Apps Challenge Jember (Lead Organizer, Event Operations, Technical Support, & Public Relations) yang mengelola jalannya hackathon, koordinasi peserta, publikasi pengumuman berulang, audit pembentukan tim, dan pemantauan tiket bantuan secara cepat dan akurat.

## Product Purpose

Pusat Kendali Panitia (Staff Command Center & Dashboard) yang terintegrasi langsung dengan Bot Discord NSAC Jember 2026. Bertujuan menyederhanakan operasional hackathon dengan menyatukan sinkronisasi data profil web resmi NASA Space Apps Challenge, studio pengumuman berformat visual Discord realtime (WYSIWYG), pemantauan formasi tim & lowongan anggota, rekap tiket support, serta konfigurasi server tanpa keterbatasan slash command.

## Positioning

Satu-satunya sistem manajemen lokal event NASA Space Apps Jember yang mengotomatisasi jembatan data dua arah antara portal global `spaceappschallenge.org` (ekstraksi GraphQL dan bio profil "About the Team") dengan server Discord komunitas, dilengkapi visual live-preview pengumuman sebelum dibroadcast.

## Operating Context

- Digunakan secara intensif sebelum, selama, dan pasca-hackathon (khususnya fase 48 jam hackathon) oleh panitia melalui browser desktop dan mobile.
- Berjalan sebagai layanan web embedded di dalam kontainer Docker melalui Portainer (port 8080) pada infrastruktur VPS/server lokal.
- Beroperasi berdampingan dengan aktivitas tinggi di Discord (voice channel tim privat, broadcast channel, helpdesk ticket channel).

## Capabilities and Constraints

### Capabilities
- **Announcement Studio (WYSIWYG)**: Formulir pembuatan pengumuman dengan pratinjau langsung identik Discord Dark Theme, upload file poster langsung (buffer in-memory ke Discord CDN) atau link gambar luar, pilihan role ping (@everyone, @here, role panitia), dan pilihan warna embed standar/kustom.
- **NASA Space Apps Web Sync**: Sinkronisasi otomatis dan manual 1-klik yang memvalidasi tim terdaftar di event Jember, menyaring status lowongan anggota, dan mengekstrak bio asli *About the Team*.
- **Team & Recruitment Board Management**: Monitoring tabel formasi seluruh tim peserta, pengecekan kuota anggota (x/6), penutupan lowongan, dan pembuatan channel privat tim secara otomatis.
- **Support & Ticket Oversight**: Pengawasan antrean tiket pendaftaran tim dan tiket bantuan teknis panitia.
- **Live GuildConfig Editor**: Pengubahan parameter bot, ID channel, dan role di database PostgreSQL secara langsung tanpa restart container.
- **Session Auth**: Proteksi akses dashboard dengan password panitia dan Bearer token session.

### Constraints
- Menjalankan Express 5 embedded dalam satu proses Node.js dengan bot Discord (menghemat alokasi memori container Portainer).
- Kepatuhan batas Discord Embed (judul max 256 karakter, deskripsi max 4096 karakter, upload file max 8MB).
- Penanganan SSL safe dispatcher untuk interaksi fetch ke API resmi NASA Space Apps.

## Brand Commitments

- **Identitas Visual**: Karakter resmi NASA Space Apps Challenge — cosmic dark theme, palet deep space slate (`#030712`, `#0f172a`), aksen galactic indigo (`#4f46e5`) dan cosmic violet (`#7c3aed`), tipografi clean, modern, dan presisi tinggi.
- **Panduan Pesan / UI**: Minimal and intentional emoji usage (dilarang menghias setiap judul/baris dengan emoji berlebihan), tata letak bersih dan profesional, field Discord non-inline untuk teks panjang.

## Evidence on Hand

- Implementasi backend Express (`src/dashboard/server.js`, `src/dashboard/routes/api.js`).
- Frontend SPA reaktif (`src/dashboard/public/index.html`).
- Service logika bot Discord (`src/services/teamService.js`, `src/services/nasaValidationService.js`).
- Database PostgreSQL schema & migrasi (`src/database/schema.sql`).
- Riwayat tim nyata event lokal Jember (Alien Punya Data, Virasa Senang, Siapa Aja Boleh Gabung, Info Internship Sir).

## Product Principles

1. **Zero-Surprise Broadcasting**: Apa yang terlihat pada live preview studio pengumuman harus persis 100% dengan apa yang diterima anggota di Discord (warna, format markdown, banner, dan mention).
2. **Single Source of Truth**: Data tim di Discord harus selalu mencerminkan data otentik dari situs resmi NASA Space Apps tanpa duplikasi entri atau teks placeholder buatan.
3. **Unobtrusive & High-Density UI**: Desain kosmik yang elegan dan berorientasi operasional cepat tanpa elemen dekorasi yang mengaburkan data kritis kompetisi.
4. **Resilient Container Architecture**: Berjalan stabil dalam satu kontainer Portainer dengan penanganan graceful fallback untuk koneksi database, Discord API, dan GraphQL Space Apps.

## Accessibility & Inclusion

- Rasio kontras teks tinggi pada dark theme (memenuhi standar WCAG AA).
- Desain responsif mobile-friendly untuk panitia yang memantau lewat smartphone di lokasi acara fisik.
- Hierarki visual jelas antara status sukses, peringatan, dan urgensi pengumuman.

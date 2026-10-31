/**
 * NSAC Jember 2026 — Staff Command Center
 * Frontend Application Logic (Alpine.js & Tailwind Configuration)
 */

// 1. Tailwind Custom Theme Config
window.tailwind = window.tailwind || {};
window.tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#070a12',
          card: '#0c111d',
          elevated: '#111726',
          input: '#0a0e18',
          border: '#1a2234',
          hover: '#151d2f'
        },
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          subtle: '#1e3a8a20'
        },
        discord: {
          bg: '#313338',
          card: '#2b2d31',
          darker: '#1e1f22',
          blurple: '#5865f2',
          green: '#57f287',
          red: '#ed4245',
          yellow: '#fee75c',
          text: '#dbdee1',
          muted: '#949ba4'
        }
      }
    }
  }
};

// 2. Alpine.js Dashboard App Component
function dashboardApp() {
  return {
    authenticated: false,
    token: localStorage.getItem('nsac_dashboard_token') || '',
    userProfile: null,
    loginError: '',
    activeTab: 'overview',
    mobileMenuOpen: false,

    stats: {
      bot: {},
      guild: {},
      stats: {}
    },
    channels: [],
    roles: [],
    teams: [],
    recruitments: [],
    configs: [],
    searchTeam: '',
    teamStatusFilter: 'ALL',

    webTeams: [],
    webTeamFilter: 'ALL',
    searchWebTeam: '',

    tickets: [],
    openTicketsCount: 0,
    ticketFilterStatus: 'ALL',
    ticketFilterType: 'ALL',
    searchTicket: '',
    showTicketReplyModal: false,
    replyingTicket: null,
    ticketReplyMessage: '',
    sendingReply: false,

    auditLogs: [],
    auditTotal: 0,
    auditLimit: 50,
    auditOffset: 0,
    auditFilterAction: '',
    auditFilterTeamId: '',
    auditSearchText: '',

    selectedTeam: null,
    showTeamModal: false,
    newMemberDiscordId: '',
    syncingNasa: false,
    postingAnnouncement: false,

    // Announcement Form
    form: {
      channelId: '',
      mentionType: 'none',
      roleId: '',
      roleId2: '',
      title: '',
      message: '',
      color: 'PRIMARY',
      imageUrl: '',
      imageFile: null,
      footerText: ''
    },
    uploadedFileName: '',
    previewImageUrl: '',

    toast: {
      show: false,
      type: 'success',
      title: '',
      message: ''
    },
    currentClock: '12:00',

    // FAQ & Commands Reference
    faqSearch: '',
    faqCategory: 'ALL',
    commandsList: [
      { command: '/team create <nama>', scope: 'Peserta', desc: 'Membuat formasi tim baru, role privat, serta channel text & voice tim otomatis.' },
      { command: '/team invite <user>', scope: 'Ketua Tim', desc: 'Mengundang peserta lain masuk ke dalam tim (maksimal 6 orang per tim).' },
      { command: '/team leave', scope: 'Peserta', desc: 'Keluar secara mandiri dari tim saat ini (melepas role & akses channel).' },
      { command: '/team kick <user>', scope: 'Ketua Tim', desc: 'Mengeluarkan anggota dari tim kompetisi.' },
      { command: '/team info [tim]', scope: 'Semua', desc: 'Melihat ringkasan anggota tim, tautan resmi web NASA, dan status rekrutmen.' },
      { command: '/ticket create', scope: 'Peserta', desc: 'Membuka tiket baru untuk registrasi tim manual atau bantuan teknis ke panitia.' },
      { command: '/ticket close', scope: 'Panitia/Ketua', desc: 'Menutup tiket aktif dan menghapus channel tiket sementara di server.' },
      { command: '/sync-nasa', scope: 'Admin', desc: 'Memicu sinkronisasi manual profil & lowongan tim dari spaceappschallenge.org.' },
      { command: '/help', scope: 'Semua', desc: 'Menampilkan panduan command interaktif dan informasi dasar event hackathon.' }
    ],
    faqItems: [
      {
        category: 'TEAMS',
        question: 'Berapa jumlah maksimal anggota dalam satu tim?',
        answer: 'Sesuai regulasi resmi global NASA Space Apps Challenge, satu tim maksimal beranggotakan <strong>6 orang</strong> (1 Ketua Tim + 5 Anggota). Tim dengan 1 orang (solo) diperbolehkan namun sangat disarankan berkolaborasi.'
      },
      {
        category: 'TEAMS',
        question: 'Bagaimana status peserta yang belum memiliki tim?',
        answer: 'Bot secara otomatis memberikan status role <code>@No-Team</code> kepada peserta terverifikasi yang belum terdaftar di tim manapun. Mereka dapat mencari tim di channel <em>#recruitment-board</em> atau menghubungi tim yang membuka lowongan.'
      },
      {
        category: 'TEAMS',
        question: 'Apakah panitia dapat mengubah ketua tim atau mengeluarkan anggota secara manual?',
        answer: 'Ya. Panitia dapat membuka tab <strong>Tim Discord</strong> pada dashboard ini, klik nama tim yang bersangkutan, lalu gunakan tombol <em>"Jadikan Ketua"</em> atau <em>"Keluarkan"</em> tanpa perlu meminta peserta menjalankan slash command.'
      },
      {
        category: 'NASA',
        question: 'Mengapa sinkronisasi portal resmi NASA Space Apps penting?',
        answer: 'Peserta wajib memiliki profil tim resmi di <code>spaceappschallenge.org</code> (lokasi Jember) agar proyek akhirnya memenuhi syarat penilaian global dan lokal. Bot menyinkronkan data bio <em>About the Team</em> dan status mencari anggota langsung ke server Discord.'
      },
      {
        category: 'NASA',
        question: 'Bagaimana cara menautkan tim Discord dengan profil web NASA?',
        answer: 'Pada tab <strong>Tim Discord</strong>, klik tombol <em>Kelola</em> pada tim yang ingin ditautkan, lalu masukkan URL profil tim resmi (contoh: <code>https://www.spaceappschallenge.org/2026/find-a-team/...</code>) pada kolom tautan web NASA.'
      },
      {
        category: 'ANNOUNCE',
        question: 'Kapan sebaiknya menggunakan mention @everyone vs @here?',
        answer: 'Gunakan <code>@everyone</code> hanya untuk informasi paling kritis (misalnya kickoff 48 jam hackathon, deadline submission proyek, atau link zoom darurat). Untuk pengumuman operasional berkala, gunakan <code>@here</code> atau role panitia/peserta tertentu agar tidak menimbulkan spam notifikasi berlebih.'
      },
      {
        category: 'ANNOUNCE',
        question: 'Berapa batas ukuran banner poster pengumuman?',
        answer: 'Batas maksimal upload file in-memory melalui bot adalah <strong>8 MB</strong> (sesuai limit Discord API). Untuk poster berukuran besar, panitia juga dapat menempelkan URL gambar luar secara langsung.'
      },
      {
        category: 'TICKETS',
        question: 'Apa yang terjadi ketika panitia menekan tombol "Tutup Tiket"?',
        answer: 'Bot akan menandai status tiket sebagai <code>CLOSED</code> di database PostgreSQL, mencatat timestamp penutupan, dan secara permanen menghapus channel Discord sementara tiket tersebut untuk menjaga kerapian server.'
      }
    ],

    get filteredCommands() {
      if (!this.faqSearch.trim()) return this.commandsList;
      const q = this.faqSearch.toLowerCase();
      return this.commandsList.filter(c => c.command.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
    },

    get filteredFaqs() {
      let list = this.faqItems;
      if (this.faqCategory !== 'ALL' && this.faqCategory !== 'COMMANDS') {
        list = list.filter(f => f.category === this.faqCategory);
      }
      if (this.faqSearch.trim()) {
        const q = this.faqSearch.toLowerCase();
        list = list.filter(f => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q));
      }
      return list;
    },

    initApp() {
      this.updateClock();
      setInterval(() => this.updateClock(), 30000);

      const urlParams = new URLSearchParams(window.location.search);
      const incomingToken = urlParams.get('token');
      const incomingError = urlParams.get('error');

      if (incomingToken) {
        this.token = incomingToken;
        localStorage.setItem('nsac_dashboard_token', incomingToken);
        window.history.replaceState({}, document.title, window.location.pathname);
        this.authenticated = true;
        this.verifyToken();
      } else if (incomingError) {
        window.history.replaceState({}, document.title, window.location.pathname);
        this.loginError = incomingError;
        this.showToast('error', 'Login Ditolak', incomingError);
      } else if (this.token) {
        this.verifyToken();
      }

      // Polling background Overview
      setInterval(() => {
        if (this.authenticated && this.activeTab === 'overview' && !document.hidden) {
          this.fetchStats();
        }
      }, 30000);

      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },

    switchTab(tab) {
      this.activeTab = tab;
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },

    getTabTitle(tab) {
      const map = {
        overview: 'Ringkasan Operasional',
        announce: 'Announcement Studio',
        teams: 'Manajemen Tim Discord',
        webteams: 'Snapshot Tim Web NASA',
        tickets: 'Inbox Tiket Dukungan',
        audit: 'Log Audit & Aktivitas',
        faq: 'Panduan & FAQ Panitia',
        config: 'Konfigurasi Bot'
      };
      return map[tab] || 'Dashboard';
    },

    getTabSubtitle(tab) {
      const map = {
        overview: 'Statistik tim, peserta, dan integrasi server',
        announce: 'Broadcast pesan kaya format dengan Discord live preview',
        teams: 'Daftar tim kompetisi, kuota anggota, dan lowongan aktif',
        webteams: 'Sinkronisasi data resmi portal spaceappschallenge.org',
        tickets: 'Kelola pendaftaran tim manual dan kendala teknis peserta',
        audit: 'Riwayat jejak aksi panitia dan sistem bot',
        faq: 'Regulasi event, alur kerja, dan cheat sheet slash command',
        config: 'Pengaturan parameter database guild secara realtime'
      };
      return map[tab] || '';
    },

    updateClock() {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      this.currentClock = `${hours}:${minutes}`;
    },

    formatDate(dateStr) {
      if (!dateStr) return '-';
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return dateStr;
      }
    },

    showToast(type, title, message) {
      this.toast = { show: true, type, title, message };
      setTimeout(() => {
        this.toast.show = false;
      }, 4500);
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },

    async verifyToken() {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) this.userProfile = data.user;
          this.authenticated = true;
          this.loadAllData();
        } else {
          this.token = '';
          localStorage.removeItem('nsac_dashboard_token');
          this.authenticated = false;
        }
      } catch (e) {
        this.authenticated = false;
      }
    },

    logout() {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }).catch(() => {});
      this.token = '';
      localStorage.removeItem('nsac_dashboard_token');
      this.authenticated = false;
    },

    async loadAllData() {
      await Promise.all([
        this.fetchStats(),
        this.fetchChannels(),
        this.fetchRoles(),
        this.fetchTeams(),
        this.fetchRecruitments(),
        this.fetchConfigs(),
        this.fetchTickets(),
        this.fetchWebTeams()
      ]);
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },

    async fetchStats() {
      try {
        const res = await fetch('/api/stats', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.stats = data.data;
      } catch (e) {}
    },

    async fetchChannels() {
      try {
        const res = await fetch('/api/channels', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) {
          this.channels = data.channels;
          if (this.channels.length > 0 && !this.form.channelId) {
            this.form.channelId = this.channels[0].id;
          }
        }
      } catch (e) {}
    },

    async fetchRoles() {
      try {
        const res = await fetch('/api/roles', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.roles = data.roles;
      } catch (e) {}
    },

    async fetchTeams() {
      try {
        const res = await fetch('/api/teams', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.teams = data.teams;
      } catch (e) {}
    },

    async fetchRecruitments() {
      try {
        const res = await fetch('/api/recruitments', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.recruitments = data.recruitments;
      } catch (e) {}
    },

    async fetchWebTeams() {
      try {
        const res = await fetch('/api/web-teams', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.webTeams = data.webTeams || [];
      } catch (e) {}
    },

    get filteredWebTeams() {
      let list = this.webTeams || [];
      if (this.webTeamFilter === 'DISCORD') {
        list = list.filter(t => t.matched_team_id !== null);
      } else if (this.webTeamFilter === 'WEB_ONLY') {
        list = list.filter(t => t.matched_team_id === null);
      } else if (this.webTeamFilter === 'RECRUITING') {
        list = list.filter(t => t.is_recruiting === true);
      }

      if (this.searchWebTeam.trim()) {
        const q = this.searchWebTeam.toLowerCase();
        list = list.filter(t =>
          (t.title && t.title.toLowerCase().includes(q)) ||
          (t.challenge_title && t.challenge_title.toLowerCase().includes(q)) ||
          (t.matched_team_name && t.matched_team_name.toLowerCase().includes(q))
        );
      }
      return list;
    },

    async fetchTickets() {
      try {
        const res = await fetch('/api/tickets', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) {
          this.tickets = data.tickets;
          this.openTicketsCount = data.openCount || 0;
        }
      } catch (e) {}
    },

    get filteredTickets() {
      let list = this.tickets || [];
      if (this.ticketFilterStatus !== 'ALL') {
        list = list.filter(tk => tk.status === this.ticketFilterStatus);
      }
      if (this.ticketFilterType !== 'ALL') {
        list = list.filter(tk => tk.type === this.ticketFilterType);
      }
      if (this.searchTicket.trim()) {
        const q = this.searchTicket.toLowerCase();
        list = list.filter(tk =>
          (tk.creator_username && tk.creator_username.toLowerCase().includes(q)) ||
          (tk.creator_discord_id && tk.creator_discord_id.includes(q)) ||
          (tk.discord_channel_id && tk.discord_channel_id.includes(q))
        );
      }
      return list;
    },

    openReplyModal(ticket) {
      this.replyingTicket = ticket;
      this.ticketReplyMessage = '';
      this.showTicketReplyModal = true;
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },

    async sendTicketReply() {
      if (!this.replyingTicket || !this.ticketReplyMessage.trim()) return;
      this.sendingReply = true;
      try {
        const res = await fetch(`/api/tickets/${this.replyingTicket.id}/reply`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message: this.ticketReplyMessage.trim() })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Balasan Terkirim', data.message || 'Pesan berhasil diposting ke tiket.');
          this.showTicketReplyModal = false;
          this.ticketReplyMessage = '';
          this.replyingTicket = null;
        } else {
          this.showToast('error', 'Gagal Membalas', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      } finally {
        this.sendingReply = false;
      }
    },

    async closeTicketAction(id) {
      if (!confirm('Tutup tiket ini dan hapus channel sementara dari Discord?')) return;
      try {
        const res = await fetch(`/api/tickets/${id}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tiket Ditutup', data.message);
          await this.fetchTickets();
        } else {
          this.showToast('error', 'Gagal Menutup Tiket', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async fetchAuditLogs() {
      try {
        const params = new URLSearchParams({
          limit: this.auditLimit,
          offset: this.auditOffset
        });
        if (this.auditFilterAction) params.append('action', this.auditFilterAction);
        if (this.auditFilterTeamId) params.append('teamId', this.auditFilterTeamId);
        if (this.auditSearchText.trim()) params.append('q', this.auditSearchText.trim());

        const res = await fetch(`/api/audit-logs?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.auditLogs = data.logs || [];
          this.auditTotal = data.total || 0;
        }
      } catch (e) {}
    },

    async fetchConfigs() {
      try {
        const res = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.configs = data.configs;
      } catch (e) {}
    },

    get filteredTeams() {
      let list = this.teams || [];
      if (this.teamStatusFilter && this.teamStatusFilter !== 'ALL') {
        list = list.filter(t => t.status === this.teamStatusFilter);
      }
      if (!this.searchTeam.trim()) return list;
      const q = this.searchTeam.toLowerCase();
      return list.filter(t => 
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.leader_username && t.leader_username.toLowerCase().includes(q)) ||
        (t.challenge_title && t.challenge_title.toLowerCase().includes(q))
      );
    },

    async openTeamDetail(id) {
      try {
        const res = await fetch(`/api/teams/${id}`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success && data.team) {
          this.selectedTeam = data.team;
          this.newMemberDiscordId = '';
          this.showTeamModal = true;
          this.$nextTick(() => {
            if (window.lucide) window.lucide.createIcons();
          });
        } else {
          this.showToast('error', 'Gagal Membuka Detail', data.error || 'Data tim tidak ditemukan.');
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async updateTeamNsacLink() {
      if (!this.selectedTeam) return;
      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/nsac-link`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ nsacLink: this.selectedTeam.nsac_link })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tautan Disimpan', data.message || 'Tautan web NASA berhasil diperbarui.');
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Menyimpan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async renameTeamAction() {
      if (!this.selectedTeam) return;
      const newName = prompt('Masukkan nama tim baru:', this.selectedTeam.name);
      if (!newName || !newName.trim() || newName.trim() === this.selectedTeam.name) return;

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/rename`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: newName.trim() })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Nama Tim Diubah', `Nama tim diubah menjadi "${newName.trim()}".`);
          this.selectedTeam.name = newName.trim();
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Mengubah Nama', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async transferLeaderAction(discordId) {
      if (!this.selectedTeam || !discordId) return;
      if (!confirm('Pindahkan peran ketua tim ke anggota ini?')) return;

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/transfer-leader`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ discordId })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Ketua Dipindahkan', 'Kepemimpinan tim berhasil dialihkan.');
          await this.openTeamDetail(this.selectedTeam.id);
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Memindahkan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async addMemberAction() {
      if (!this.selectedTeam || !this.newMemberDiscordId.trim()) {
        this.showToast('error', 'Input Kosong', 'Masukkan Discord ID anggota.');
        return;
      }

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/add-member`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ discordId: this.newMemberDiscordId.trim() })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Anggota Ditambahkan', 'Anggota baru berhasil dimasukkan ke tim.');
          this.newMemberDiscordId = '';
          await this.openTeamDetail(this.selectedTeam.id);
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Menambah', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async removeMemberAction(discordId) {
      if (!this.selectedTeam || !discordId) return;
      if (!confirm('Keluarkan anggota ini dari tim?')) return;

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/remove-member`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ discordId })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Anggota Dikeluarkan', 'Anggota telah dikeluarkan dari tim.');
          await this.openTeamDetail(this.selectedTeam.id);
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Mengeluarkan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async archiveTeamAction() {
      if (!this.selectedTeam) return;
      if (!confirm(`Arsipkan tim "${this.selectedTeam.name}"? Channel tim akan diarsipkan.`)) return;

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/archive`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tim Diarsipkan', `Tim "${this.selectedTeam.name}" telah diarsipkan.`);
          await this.openTeamDetail(this.selectedTeam.id);
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Mengarsipkan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    async deleteTeamAction() {
      if (!this.selectedTeam) return;
      if (!confirm(`PERINGATAN: Apakah Anda yakin ingin MENGHAPUS PERMANEN tim "${this.selectedTeam.name}"?`)) return;

      const confirmation = prompt(`Ketik nama tim persis ("${this.selectedTeam.name}") untuk konfirmasi:`);
      if (confirmation !== this.selectedTeam.name) {
        this.showToast('error', 'Dibatalkan', 'Nama tim konfirmasi tidak cocok.');
        return;
      }

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/delete`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tim Dihapus', `Tim "${this.selectedTeam.name}" berhasil dihapus.`);
          this.showTeamModal = false;
          this.selectedTeam = null;
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Menghapus', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan', e.message);
      }
    },

    getRoleName(id) {
      const r = this.roles.find(role => role.id === id);
      return r ? r.name : 'Role';
    },

    getEmbedBorderColor(colorKey) {
      const map = {
        'PRIMARY': '#5865f2',
        'SUCCESS': '#57f287',
        'DANGER': '#ed4245',
        'WARNING': '#fee75c',
        'INFO': '#5865f2'
      };
      return map[colorKey] || '#5865f2';
    },

    handleFileUpload(event) {
      const file = event.target.files[0];
      if (file) {
        this.form.imageFile = file;
        this.uploadedFileName = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
          this.previewImageUrl = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    },

    clearImage() {
      this.form.imageFile = null;
      this.form.imageUrl = '';
      this.uploadedFileName = '';
      this.previewImageUrl = '';
    },

    renderDiscordMarkdown(text) {
      if (!text) return '';
      let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      
      escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
      escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
      escaped = escaped.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');
      escaped = escaped.replace(/\n/g, '<br>');
      return escaped;
    },

    async confirmPostAnnouncement() {
      if (!this.form.channelId) {
        this.showToast('error', 'Channel Belum Dipilih', 'Pilih channel tujuan pengumuman.');
        return;
      }
      if (!this.form.title.trim()) {
        this.showToast('error', 'Judul Wajib Diisi', 'Masukkan judul pengumuman.');
        return;
      }
      if (!this.form.message.trim()) {
        this.showToast('error', 'Isi Pesan Kosong', 'Tuliskan pesan pengumuman.');
        return;
      }

      if (!confirm(`Kirim pengumuman "${this.form.title}" ke channel pilihan sekarang?`)) {
        return;
      }

      this.postingAnnouncement = true;
      try {
        const formData = new FormData();
        formData.append('channelId', this.form.channelId);
        formData.append('title', this.form.title);
        formData.append('message', this.form.message);
        formData.append('color', this.form.color);
        formData.append('mentionType', this.form.mentionType);
        formData.append('roleId', this.form.roleId);
        formData.append('roleId2', this.form.roleId2 || '');
        formData.append('imageUrl', this.form.imageUrl || '');
        formData.append('footerText', this.form.footerText || '');
        if (this.form.imageFile) {
          formData.append('image', this.form.imageFile);
        }

        const res = await fetch('/api/announce', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` },
          body: formData
        });

        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Pengumuman Terkirim!', `Diposting ke #${data.data.channelName}.`);
          this.form.title = '';
          this.form.message = '';
          this.clearImage();
        } else {
          this.showToast('error', 'Gagal Mengirim', data.error || 'Terjadi kesalahan saat memposting.');
        }
      } catch (err) {
        this.showToast('error', 'Kesalahan Jaringan', err.message);
      } finally {
        this.postingAnnouncement = false;
      }
    },

    async triggerNasaSync() {
      this.syncingNasa = true;
      try {
        const res = await fetch('/api/teams/sync-nasa', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          const summaryMsg = `Total: ${data.totalWebTeams || 0} tim web (${data.recruitingCount || 0} mencari anggota). Lowongan: +${data.createdCount || 0} baru.`;
          this.showToast('success', 'Sinkronisasi Selesai', summaryMsg);
          await this.fetchWebTeams();
          this.loadAllData();
        } else {
          this.showToast('error', 'Sinkronisasi Gagal', data.error || 'Gagal menyinkronkan data.');
        }
      } catch (e) {
        this.showToast('error', 'Gagal', e.message);
      } finally {
        this.syncingNasa = false;
      }
    },

    async closeRecruitment(id) {
      if (!confirm('Tutup lowongan ini dari board rekrutmen?')) return;
      try {
        const res = await fetch(`/api/recruitments/${id}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Berhasil', 'Lowongan telah ditutup.');
          this.loadAllData();
        } else {
          this.showToast('error', 'Gagal', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal', e.message);
      }
    },

    async saveConfig(key, value) {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ key, value })
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tersimpan', `Konfigurasi ${key} berhasil diperbarui.`);
        } else {
          this.showToast('error', 'Gagal Menyimpan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal', e.message);
      }
    }
  };
}

// Expose globally for Alpine.js
window.dashboardApp = dashboardApp;

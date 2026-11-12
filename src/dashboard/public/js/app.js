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
          base: '#030712',
          card: '#0b0f19',
          elevated: '#111827',
          input: '#070b14',
          border: '#1e293b',
          hover: '#161f33'
        },
        accent: {
          DEFAULT: '#4f46e5',
          hover: '#4338ca',
          subtle: '#4f46e520',
          cosmic: '#7c3aed'
        },
        discord: {
          bg: '#313338',
          card: '#2b2d31',
          darker: '#1e1f22',
          blurple: '#5865f2',
          blurpleHover: '#4752c4',
          green: '#57f287',
          red: '#ed4245',
          yellow: '#fee75c',
          text: '#dbdee1',
          muted: '#949ba4',
          border: '#35373c',
          mention: '#c9cdfb'
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
    teamSubTab: 'discord', // 'discord' | 'web'

    webTeams: [],
    webTeamFilter: 'ALL',
    searchWebTeam: '',

    // Enhanced Config state
    configOptions: {
      roles: [],
      textChannels: [],
      voiceChannels: [],
      categories: []
    },
    configCategoryFilter: 'ALL',
    searchConfig: '',
    manualConfigMode: {},
    savingConfigKey: '',

    // Bot Presence & Status Cycle state
    botPresence: {
      enabled: true,
      intervalSeconds: 60,
      statusType: 'online',
      activities: []
    },
    livePresenceVariables: {
      countdown: '',
      teams: 0,
      participants: 0,
      members: 0
    },
    currentActivityDisplay: '',
    availablePlaceholders: [],
    activityTypes: [],
    statusTypes: [],
    savingPresence: false,
    loadingPresence: false,
    loadingTeams: false,
    loadingTickets: false,
    loadingAuditLogs: false,
    _iconRaf: null,

    // Challenges Management (/challenge)
    challenges: [],
    loadingChallenges: false,
    challengeSearch: '',
    showChallengeModal: false,
    challengeModalMode: 'create', // 'create' | 'edit'
    challengeForm: {
      id: null,
      title: '',
      description: ''
    },
    savingChallenge: false,
    deletingChallengeId: null,
    showBroadcastChallengeModal: false,
    broadcastChallengeChannelId: '',
    broadcastingChallenge: false,

    // Manual Member Registration (/register member)
    showRegisterMemberModal: false,
    guildMembers: [],
    loadingGuildMembers: false,
    memberSearchQuery: '',
    registerMemberForm: {
      userId: '',
      roleId: '',
      keepUnregistered: false
    },
    registeringMember: false,

    // Channel Message Purge Tool (/purge)
    purgeForm: {
      channelId: '',
      amount: 10,
      userId: ''
    },
    purgingMessages: false,

    // Team Advanced Actions (/team purge-disbanded, force-register, panel)
    purgingDisbandedTeams: false,
    showForceRegisterModal: false,
    submittingForceRegister: false,
    forceRegisterForm: {
      name: '',
      leaderId: '',
      member1Id: '',
      member2Id: '',
      challengeId: '',
      nsacLink: ''
    },
    deployingTeamPanel: false,
    savingTeamChallenge: false,

    // Invite Tracker state
    invites: [],
    recentInviteJoins: [],
    topInviters: [],
    inviteStats: {
      totalInvites: 0,
      activeInvites: 0,
      totalUses: 0,
      dynamicCount: 0,
      totalJoinsTracked: 0,
      uniqueMembersTracked: 0
    },
    inviteSubTab: 'links', // 'links' | 'joins' | 'leaderboard'
    searchInvite: '',
    inviteFilter: 'ALL', // 'ALL' | 'DYNAMIC' | 'STANDARD' | 'ACTIVE' | 'EXPIRED'
    loadingInvites: false,
    showCreateInviteModal: false,
    creatingInvite: false,
    createInviteForm: {
      roleIds: [],
      channelId: '',
      label: '',
      maxUses: 0,
      maxAge: 0
    },
    createdInviteResult: null,

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

    // Studio & Broadcast State
    studioMode: 'announce', // 'announce' (Siaran Baru) | 'dynamic' (Live Dynamic Embed)
    selectedRoleIds: [], // Multi-role selection
    activeInputId: 'studio-main-message',

    form: {
      channelId: '',
      mentionType: 'none', // 'none' | 'everyone' | 'here' | 'roles'
      roleId: '',
      title: '',
      message: '',
      color: 'PRIMARY',
      imageUrl: '',
      imageFile: null,
      footerText: '',
      blocks: [] // Interleaved content blocks: { id, title, text, imageUrl }
    },
    uploadedFileName: '',
    previewImageUrl: '',

    // Dynamic Live Embeds (FAQ & Rules live manager)
    dynamicEmbeds: [],
    selectedDynamicEmbedId: '',
    dynamicForm: {
      id: '',
      channelId: '',
      title: '',
      description: '',
      color: 'PRIMARY',
      fields: [] // { name, value, inline }
    },
    savingDynamicEmbed: false,
    deletingDynamicEmbed: false,

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
      { command: '/team recruit', scope: 'Ketua Tim', desc: 'Membuka lowongan slot anggota tim di channel #recruitment-board.' },
      { command: '/team set-link <url>', scope: 'Ketua Tim', desc: 'Menautkan URL resmi profil tim dari spaceappschallenge.org.' },
      { command: '/ticket create <type>', scope: 'Semua', desc: 'Membuka tiket baru untuk bantuan teknis panitia atau pendaftaran tim.' },
      { command: '/ticket close', scope: 'Panitia/Ketua', desc: 'Menutup tiket aktif dan merapikan channel tiket sementara di server.' },
      { command: '/challenge list / detail', scope: 'Semua', desc: 'Melihat daftar seluruh challenge resmi Space Apps yang tersedia.' },
      { command: '/invite create / list / delete', scope: 'Panitia', desc: 'Membuat dan mengelola link undangan server dengan auto-role otomatis.' },
      { command: '/sync-nasa [mode]', scope: 'Panitia', desc: 'Memicu sinkronisasi manual profil, tantangan, dan lowongan tim dari spaceappschallenge.org.' },
      { command: '/announce', scope: 'Panitia', desc: 'Mengirimkan siaran pengumuman berformat embed kaya ke channel broadcast.' },
      { command: '/purge <amount> [user]', scope: 'Panitia', desc: 'Menghapus pesan secara massal di channel aktif.' },
      { command: '/help [kategori]', scope: 'Semua', desc: 'Menampilkan panduan command interaktif dan informasi dasar event hackathon.' }
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
        category: 'ANNOUNCE',
        question: 'Apa perbedaan Siaran Baru (One-off) dengan Dynamic Live Embed?',
        answer: '<strong>Siaran Baru</strong> memposting pesan broadcast baru sekali kirim dengan opsi banner dan ping role. Sedangkan <strong>Dynamic Live Embed</strong> membuat embed persisten (seperti Peraturan atau FAQ) yang dapat diedit kapan saja langsung dari dashboard ini tanpa mengirim ulang pesan baru di Discord.'
      },
      {
        category: 'ANNOUNCE',
        question: 'Bagaimana cara menampilkan teks lalu gambar lalu teks lagi dalam satu pesan?',
        answer: 'Discord membatasi 1 gambar banner per embed. Untuk menampilkan urutan teks &rarr; gambar &rarr; teks &rarr; gambar, gunakan tombol <strong>+ Tambah Blok Konten / Gambar</strong> di Announcement Studio. Bot akan mengirimkan rangkaian embed beruntun (hingga 10 blok) dalam satu pesan rapi.'
      }
    ],

    // ==========================================
    // INITIALIZATION & AUTHENTICATION
    // ==========================================
    init() {
      this.updateClock();
      setInterval(() => {
        if (!document.hidden) this.updateClock();
      }, 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.updateClock();
      });

      // Check URL query parameters for token or error from OAuth callback
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      const urlError = urlParams.get('error');

      if (urlToken) {
        this.token = urlToken;
        localStorage.setItem('nsac_dashboard_token', urlToken);
        // Clean URL to prevent leaking token in browser address bar
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (urlError) {
        this.loginError = decodeURIComponent(urlError);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      if (this.token) {
        this.checkAuth();
      }

      this.$watch('activeTab', (val) => {
        if (val === 'audit') this.fetchAuditLogs();
        if (val === 'announce') {
          this.fetchDynamicEmbeds();
          this.fetchChannels();
          this.fetchRoles();
        }
        if (val === 'presence') {
          this.fetchBotPresence();
        }
        if (val === 'config') {
          this.fetchConfigs();
        }
        if (val === 'teams' && this.teamSubTab === 'web') {
          this.fetchWebTeams();
        }
        if (val === 'invites') {
          this.fetchInvites();
        }
        if (val === 'challenges') {
          this.fetchChallenges();
        }
        this.renderIcons();
      });
    },

    renderIcons() {
      if (!window.lucide) return;
      if (this._iconRaf) cancelAnimationFrame(this._iconRaf);
      this._iconRaf = requestAnimationFrame(() => {
        window.lucide.createIcons();
      });
    },

    updateClock() {
      const now = new Date();
      this.currentClock = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    },

    async checkAuth() {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (res.ok) {
          const data = await res.json();
          this.userProfile = data.user;
          this.authenticated = true;
          this.loginError = '';
          this.loadAllData();
        } else {
          const errData = await res.json().catch(() => ({}));
          this.loginError = errData.error || 'Sesi telah kedaluwarsa. Silakan login kembali.';
          this.logout();
        }
      } catch (e) {
        this.loginError = 'Gagal menghubungi server: ' + e.message;
        this.logout();
      }
    },

    login() {
      window.location.href = '/api/auth/discord/login';
    },

    logout() {
      if (this.token) {
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        }).catch(() => {});
      }
      localStorage.removeItem('nsac_dashboard_token');
      this.token = '';
      this.authenticated = false;
      this.userProfile = null;
    },

    switchTab(tab) {
      this.activeTab = tab;
      this.mobileMenuOpen = false;
    },

    showToast(type, title, message) {
      this.toast.type = type;
      this.toast.title = title;
      this.toast.message = message;
      this.toast.show = true;
      setTimeout(() => {
        this.toast.show = false;
      }, 4500);
    },

    formatDate(isoString) {
      if (!isoString) return '-';
      try {
        return new Date(isoString).toLocaleString('id-ID', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (e) {
        return isoString;
      }
    },

    // ==========================================
    // DATA FETCHING
    // ==========================================
    async loadAllData() {
      await Promise.all([
        this.fetchStats(),
        this.fetchChannels(),
        this.fetchRoles(),
        this.fetchTeams(),
        this.fetchRecruitments(),
        this.fetchConfigs(),
        this.fetchTickets(),
        this.fetchWebTeams(),
        this.fetchDynamicEmbeds(),
        this.fetchBotPresence(),
        this.fetchInvites(),
        this.fetchChallenges(),
        this.fetchGuildMembers()
      ]);
      this.renderIcons();
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
          if (this.channels.length > 0) {
            if (!this.form.channelId) this.form.channelId = this.channels[0].id;
            if (!this.dynamicForm.channelId) this.dynamicForm.channelId = this.channels[0].id;
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
      this.loadingTeams = true;
      try {
        const res = await fetch('/api/teams', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) {
          this.teams = data.teams;
          this.renderIcons();
        }
      } catch (e) {
      } finally {
        this.loadingTeams = false;
      }
    },

    async fetchRecruitments() {
      try {
        const res = await fetch('/api/recruitments', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) this.recruitments = data.recruitments;
      } catch (e) {}
    },

    async downloadExport(type = 'teams', format = 'xlsx') {
      try {
        const label = type === 'teams' ? 'Tim' : 'Peserta';
        this.showToast('info', 'Menyiapkan File Export', `Sedang mengunduh data ${label} format ${format.toUpperCase()}...`);
        const res = await fetch(`/api/export/${type}?format=${format}`, {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `NSAC_Jember_${type === 'teams' ? 'Teams' : 'Participants'}_${dateStr}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        this.showToast('success', 'Export Selesai', `File export ${label} berhasil diunduh.`);
      } catch (err) {
        console.error('Export error:', err);
        this.showToast('error', 'Gagal Export', err.message || 'Terjadi kesalahan saat mengunduh data export.');
      }
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
      this.loadingTickets = true;
      try {
        const res = await fetch('/api/tickets', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) {
          this.tickets = data.tickets;
          this.openTicketsCount = data.openCount || 0;
          this.renderIcons();
        }
      } catch (e) {
      } finally {
        this.loadingTickets = false;
      }
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
          (tk.subject && tk.subject.toLowerCase().includes(q)) ||
          (tk.team_name && tk.team_name.toLowerCase().includes(q))
        );
      }
      return list;
    },

    async fetchAuditLogs() {
      this.loadingAuditLogs = true;
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
          this.renderIcons();
        }
      } catch (e) {
      } finally {
        this.loadingAuditLogs = false;
      }
    },

    async fetchConfigs() {
      try {
        const res = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const data = await res.json();
        if (data.success) {
          this.configs = data.configs || [];
          if (data.options) {
            this.configOptions = data.options;
          }
        }
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

    // ==========================================
    // TEAM ACTIONS & MODALS
    // ==========================================
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
          this.renderIcons();
        } else {
          this.showToast('error', 'Gagal Membuka Detail', data.error || 'Data tim tidak ditemukan.');
        }
      } catch (e) {
        this.showToast('error', 'Gagal Memuat Detail Tim', e.message);
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
        this.showToast('error', 'Gagal Menyimpan Tautan', e.message);
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
        this.showToast('error', 'Gagal Mengubah Nama Tim', e.message);
      }
    },

    async transferLeaderAction(discordId) {
      if (!this.selectedTeam || !discordId) return;
      if (!confirm('Pindahkan kepemimpinan tim ke anggota ini? Hak akses ketua tim dan role Discord akan dialihkan.')) return;

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
        this.showToast('error', 'Gagal Mengalihkan Ketua Tim', e.message);
      }
    },

    async addMemberAction() {
      if (!this.selectedTeam || !this.newMemberDiscordId.trim()) {
        this.showToast('error', 'Input Kosong', 'Masukkan Discord ID anggota baru.');
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
          this.showToast('success', 'Anggota Ditambahkan', 'Anggota berhasil ditambahkan ke tim.');
          this.newMemberDiscordId = '';
          await this.openTeamDetail(this.selectedTeam.id);
          await this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Menambah Anggota', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal Menambahkan Anggota', e.message);
      }
    },

    async kickMemberAction(discordId) {
      if (!this.selectedTeam || !discordId) return;
      if (!confirm('Keluarkan anggota ini dari tim? Role channel Discord tim juga akan dicabut.')) return;

      try {
        const res = await fetch(`/api/teams/${this.selectedTeam.id}/kick-member`, {
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
        this.showToast('error', 'Gagal Mengeluarkan Anggota', e.message);
      }
    },

    async deleteTeamAction() {
      if (!this.selectedTeam) return;
      if (!confirm(`Hapus permanen tim "${this.selectedTeam.name}"? Channel Discord dan seluruh data tim akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`)) return;

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

    // ==========================================
    // TICKET ACTIONS
    // ==========================================
    openReplyModal(ticket) {
      this.replyingTicket = ticket;
      this.ticketReplyMessage = '';
      this.showTicketReplyModal = true;
    },

    async sendTicketReply() {
      if (!this.replyingTicket || !this.ticketReplyMessage.trim()) {
        this.showToast('error', 'Pesan Kosong', 'Tulis pesan balasan terlebih dahulu.');
        return;
      }

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
          this.showToast('success', 'Balasan Terkirim', 'Pesan terkirim ke channel tiket.');
          this.showTicketReplyModal = false;
          this.replyingTicket = null;
          this.ticketReplyMessage = '';
          await this.fetchTickets();
        } else {
          this.showToast('error', 'Gagal Mengirim', data.error || 'Terjadi kesalahan.');
        }
      } catch (err) {
        this.showToast('error', 'Kesalahan Jaringan', err.message);
      } finally {
        this.sendingReply = false;
      }
    },

    async closeTicketAction(id) {
      if (!confirm('Tutup tiket ini dan hapus channel Discord terkait? Riwayat percakapan akan diarsipkan ke log audit.')) return;
      try {
        const res = await fetch(`/api/tickets/${id}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tiket Ditutup', 'Channel tiket berhasil ditutup dan diarsipkan.');
          await this.fetchTickets();
        } else {
          this.showToast('error', 'Gagal Menutup Tiket', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal Menutup Tiket', e.message);
      }
    },

    // ==========================================
    // DISCORD MARKDOWN & TOOLBAR SYSTEM
    // ==========================================
    setActiveInput(id) {
      this.activeInputId = id;
    },

    insertFormat(prefix, suffix = '', defaultText = '') {
      let el = document.getElementById(this.activeInputId);
      if (!el || el.tagName !== 'TEXTAREA') {
        const active = document.activeElement;
        if (active && active.tagName === 'TEXTAREA') {
          el = active;
        } else {
          el = document.getElementById('studio-main-message') || document.querySelector('textarea');
        }
      }
      if (!el) return;

      const start = el.selectionStart || 0;
      const end = el.selectionEnd || 0;
      const text = el.value || '';
      const selected = text.substring(start, end) || defaultText;
      const replacement = prefix + selected + suffix;

      el.focus();
      el.setRangeText(replacement, start, end, 'select');
      el.dispatchEvent(new Event('input', { bubbles: true }));

      const newCursor = start + prefix.length + selected.length;
      el.setSelectionRange(newCursor, newCursor);
    },

    renderDiscordMarkdown(text) {
      if (!text) return '';
      let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Code blocks ```lang\ncode\n```
      escaped = escaped.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
        let highlighted = code;
        if (lang === 'diff') {
          highlighted = highlighted.split('\n').map(line => {
            if (line.startsWith('+')) return `<span class="text-discord-green">${line}</span>`;
            if (line.startsWith('-')) return `<span class="text-discord-red">${line}</span>`;
            return line;
          }).join('\n');
        } else if (lang === 'fix') {
          highlighted = `<span class="text-discord-yellow">${highlighted}</span>`;
        } else if (lang === 'ini') {
          highlighted = highlighted.replace(/(\[[^\]]+\])/g, '<span class="text-discord-blurple">$1</span>');
        }
        return `<pre><code>${highlighted}</code></pre>`;
      });

      // Inline code `code`
      escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

      // Headings
      escaped = escaped.replace(/^#\s+(.+)$/gm, '<h3 class="text-sm font-bold text-white mt-2 mb-1">$1</h3>');
      escaped = escaped.replace(/^##\s+(.+)$/gm, '<h4 class="text-xs font-bold text-white mt-1.5 mb-1">$1</h4>');
      escaped = escaped.replace(/^###\s+(.+)$/gm, '<h5 class="text-xs font-semibold text-slate-200 mt-1 mb-0.5">$1</h5>');

      // Subtext -#
      escaped = escaped.replace(/^-#\s+(.+)$/gm, '<span class="discord-subtext">$1</span>');

      // Bold & Italic ***text***
      escaped = escaped.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
      // Bold **text**
      escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Underline __text__
      escaped = escaped.replace(/__(.*?)__/g, '<u>$1</u>');
      // Italic *text* or _text_
      escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      escaped = escaped.replace(/_([^_]+)_/g, '<em>$1</em>');
      // Strikethrough ~~text~~
      escaped = escaped.replace(/~~(.*?)~~/g, '<del>$1</del>');
      // Spoiler ||text||
      escaped = escaped.replace(/\|\|(.*?)\|\|/g, '<span class="discord-spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');

      // Masked link [text](url)
      escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

      // Suppressed preview link <url>
      escaped = escaped.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

      // Blockquotes
      escaped = escaped.replace(/^&gt;&gt;&gt;\s+([\s\S]+)$/gm, '<blockquote>$1</blockquote>');
      escaped = escaped.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

      // Bullet lists
      escaped = escaped.replace(/^[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

      // Newlines
      escaped = escaped.replace(/\n/g, '<br>');

      return escaped;
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

    toggleRoleSelection(roleId) {
      const idx = this.selectedRoleIds.indexOf(roleId);
      if (idx > -1) {
        this.selectedRoleIds.splice(idx, 1);
      } else {
        this.selectedRoleIds.push(roleId);
      }
    },

    // ==========================================
    // ONE-OFF ANNOUNCEMENT & MULTI-EMBED BLOCKS
    // ==========================================
    addBlock() {
      if (this.form.blocks.length >= 9) {
        this.showToast('error', 'Batas Maksimum', 'Maksimal 10 embed berurutan dalam satu pesan Discord.');
        return;
      }
      this.form.blocks.push({
        id: Date.now(),
        title: '',
        text: '',
        imageUrl: ''
      });
      this.renderIcons();
    },

    removeBlock(index) {
      this.form.blocks.splice(index, 1);
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

      if (!confirm(`Siarkan pengumuman "${this.form.title}" ke channel target sekarang?`)) {
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
        formData.append('roleIds', JSON.stringify(this.selectedRoleIds));
        formData.append('imageUrl', this.form.imageUrl || '');
        formData.append('footerText', this.form.footerText || '');
        if (this.form.blocks.length > 0) {
          formData.append('blocks', JSON.stringify(this.form.blocks));
        }
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
          this.form.blocks = [];
          this.selectedRoleIds = [];
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

    // ==========================================
    // DYNAMIC LIVE EMBEDS (FAQ / RULES) MANAGER
    // ==========================================
    async fetchDynamicEmbeds() {
      try {
        const res = await fetch('/api/dynamic-embeds', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.dynamicEmbeds = data.embeds || [];
        }
      } catch (e) {}
    },

    selectDynamicEmbed(id) {
      this.selectedDynamicEmbedId = id;
      if (!id) {
        this.dynamicForm = {
          id: '',
          channelId: this.channels.length > 0 ? this.channels[0].id : '',
          title: '',
          description: '',
          color: 'PRIMARY',
          imageUrl: '',
          fields: []
        };
        return;
      }

      const found = this.dynamicEmbeds.find(e => e.id === id);
      if (found) {
        let parsedFields = [];
        if (typeof found.fields === 'string') {
          try { parsedFields = JSON.parse(found.fields); } catch (e) { parsedFields = []; }
        } else if (Array.isArray(found.fields)) {
          parsedFields = JSON.parse(JSON.stringify(found.fields));
        }

        this.dynamicForm = {
          id: found.id,
          channelId: found.channel_id,
          title: found.title || '',
          description: found.description || '',
          color: found.color || 'PRIMARY',
          imageUrl: found.image_url || '',
          fields: parsedFields
        };
      }
    },

    newDynamicEmbed() {
      this.selectDynamicEmbed('');
    },

    addDynamicField() {
      this.dynamicForm.fields.push({
        name: `Bagian ${this.dynamicForm.fields.length + 1}`,
        value: '',
        inline: false
      });
      this.renderIcons();
    },

    removeDynamicField(idx) {
      this.dynamicForm.fields.splice(idx, 1);
    },

    moveDynamicField(idx, dir) {
      const target = idx + dir;
      if (target < 0 || target >= this.dynamicForm.fields.length) return;
      const item = this.dynamicForm.fields.splice(idx, 1)[0];
      this.dynamicForm.fields.splice(target, 0, item);
    },

    async saveDynamicEmbed() {
      if (!this.dynamicForm.id.trim()) {
        this.showToast('error', 'ID Wajib Diisi', 'Masukkan ID unik (misal: rules, faq-peserta).');
        return;
      }
      if (!this.dynamicForm.channelId) {
        this.showToast('error', 'Channel Belum Dipilih', 'Pilih channel Discord tujuan.');
        return;
      }
      if (!this.dynamicForm.title.trim()) {
        this.showToast('error', 'Judul Wajib Diisi', 'Masukkan judul embed.');
        return;
      }

      this.savingDynamicEmbed = true;
      try {
        const isEditing = Boolean(this.selectedDynamicEmbedId);
        const url = isEditing
          ? `/api/dynamic-embeds/${encodeURIComponent(this.selectedDynamicEmbedId)}`
          : '/api/dynamic-embeds';
        const method = isEditing ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.dynamicForm)
        });

        const data = await res.json();
        if (data.success) {
          this.showToast(
            'success',
            isEditing ? 'Embed Disinkronkan' : 'Embed Dibuat',
            isEditing
              ? `Embed "${this.dynamicForm.id}" berhasil diperbarui langsung di Discord.`
              : `Embed baru berhasil dibuat di channel tujuan.`
          );
          await this.fetchDynamicEmbeds();
          this.selectDynamicEmbed(data.embed ? data.embed.id : this.dynamicForm.id);
        } else {
          this.showToast('error', 'Gagal Menyimpan', data.error || 'Terjadi kesalahan.');
        }
      } catch (err) {
        this.showToast('error', 'Kesalahan Jaringan', err.message);
      } finally {
        this.savingDynamicEmbed = false;
      }
    },

    async deleteDynamicEmbedAction(id) {
      if (!id) return;
      if (!confirm(`Hapus embed dinamis "${id}"? Pesan live di Discord akan dihapus dan sinkronisasi dihentikan.`)) return;

      this.deletingDynamicEmbed = true;
      try {
        const res = await fetch(`/api/dynamic-embeds/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Embed Dihapus', `Embed "${id}" berhasil dihapus dari Discord.`);
          await this.fetchDynamicEmbeds();
          this.newDynamicEmbed();
        } else {
          this.showToast('error', 'Gagal Menghapus Embed', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Kesalahan Jaringan', err.message);
      } finally {
        this.deletingDynamicEmbed = false;
      }
    },

    // ==========================================
    // OTHER UTILITIES
    // ==========================================
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
        this.showToast('error', 'Gagal Sinkronisasi NASA', e.message);
      } finally {
        this.syncingNasa = false;
      }
    },

    async closeRecruitment(id) {
      if (!confirm('Tutup lowongan rekrutmen ini? Status di Discord akan ditandai CLOSED.')) return;
      try {
        const res = await fetch(`/api/recruitments/${id}/close`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Lowongan Ditutup', 'Lowongan tim berhasil ditandai tertutup.');
          this.loadAllData();
        } else {
          this.showToast('error', 'Gagal Menutup Lowongan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal Menutup Lowongan', e.message);
      }
    },

    async saveConfig(key, value) {
      try {
        this.savingConfigKey = key;
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
        this.showToast('error', 'Gagal Menyimpan Konfigurasi', e.message);
      } finally {
        this.savingConfigKey = '';
      }
    },

    toggleManualConfig(key) {
      this.manualConfigMode[key] = !this.manualConfigMode[key];
    },

    get filteredConfigs() {
      let list = this.configs || [];
      if (this.configCategoryFilter && this.configCategoryFilter !== 'ALL') {
        list = list.filter((c) => c.category === this.configCategoryFilter);
      }
      if (this.searchConfig && this.searchConfig.trim()) {
        const q = this.searchConfig.toLowerCase().trim();
        list = list.filter((c) =>
          (c.label && c.label.toLowerCase().includes(q)) ||
          (c.key && c.key.toLowerCase().includes(q)) ||
          (c.description && c.description.toLowerCase().includes(q))
        );
      }
      return list;
    },

    // ==========================================
    // BOT PRESENCE & ACTIVITY MANAGEMENT
    // ==========================================
    async fetchBotPresence() {
      try {
        this.loadingPresence = true;
        const res = await fetch('/api/bot-presence', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.botPresence = data.config || this.botPresence;
          this.livePresenceVariables = data.liveVariables || {};
          this.currentActivityDisplay = data.currentActivity || '';
          this.availablePlaceholders = data.availablePlaceholders || [];
          this.activityTypes = data.activityTypes || [];
          this.statusTypes = data.statusTypes || [];
        }
      } catch (e) {
        this.showToast('error', 'Gagal Memuat Status', e.message);
      } finally {
        this.loadingPresence = false;
        this.renderIcons();
      }
    },

    async saveBotPresence() {
      try {
        this.savingPresence = true;
        const res = await fetch('/api/bot-presence', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.botPresence)
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Tersimpan', data.message || 'Status bot berhasil diperbarui.');
          await this.fetchBotPresence();
        } else {
          this.showToast('error', 'Gagal Menyimpan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal Menyimpan', e.message);
      } finally {
        this.savingPresence = false;
      }
    },

    addPresenceActivity() {
      if (!this.botPresence.activities) this.botPresence.activities = [];
      this.botPresence.activities.push({
        id: 'act_' + Date.now(),
        type: 'WATCHING',
        text: 'NSAC Jember 2026',
        enabled: true
      });
      this.renderIcons();
    },

    removePresenceActivity(index) {
      if (!this.botPresence.activities || this.botPresence.activities.length <= 1) {
        this.showToast('error', 'Peringatan', 'Minimal harus ada 1 teks aktivitas status.');
        return;
      }
      this.botPresence.activities.splice(index, 1);
    },

    movePresenceActivity(index, direction) {
      if (!this.botPresence.activities) return;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= this.botPresence.activities.length) return;
      const item = this.botPresence.activities.splice(index, 1)[0];
      this.botPresence.activities.splice(targetIndex, 0, item);
    },

    insertPresenceTag(index, tag) {
      if (!this.botPresence.activities || !this.botPresence.activities[index]) return;
      const current = this.botPresence.activities[index].text || '';
      this.botPresence.activities[index].text = current ? `${current} ${tag}` : tag;
    },

    resetPresenceConfig() {
      if (!confirm('Kembalikan status bot ke pesan rotasi default NASA Space Apps 2026?')) return;
      this.botPresence = {
        enabled: true,
        intervalSeconds: 60,
        statusType: 'online',
        activities: [
          { id: 'default_1', type: 'WATCHING', text: '{countdown}', enabled: true },
          { id: 'default_2', type: 'WATCHING', text: '{teams} Tim • {participants} Peserta', enabled: true },
          { id: 'default_3', type: 'LISTENING', text: 'Ketik /team untuk info tim', enabled: true }
        ]
      };
      this.saveBotPresence();
    },

    // ==========================================
    // INVITE TRACKER METHODS
    // ==========================================
    async fetchInvites() {
      try {
        this.loadingInvites = true;
        const res = await fetch('/api/invites', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.invites = data.invites || [];
          this.recentInviteJoins = data.recentJoins || [];
          this.topInviters = data.topInviters || [];
          this.inviteStats = data.stats || this.inviteStats;
        }
      } catch (e) {
        this.showToast('error', 'Gagal Memuat Undangan', e.message);
      } finally {
        this.loadingInvites = false;
        this.renderIcons();
      }
    },

    get filteredInvites() {
      let list = this.invites || [];
      if (this.inviteFilter === 'DYNAMIC') {
        list = list.filter((i) => i.isDynamic);
      } else if (this.inviteFilter === 'STANDARD') {
        list = list.filter((i) => !i.isDynamic);
      } else if (this.inviteFilter === 'ACTIVE') {
        list = list.filter((i) => !i.isExpired);
      } else if (this.inviteFilter === 'EXPIRED') {
        list = list.filter((i) => i.isExpired);
      }

      if (this.searchInvite && this.searchInvite.trim()) {
        const q = this.searchInvite.toLowerCase().trim();
        list = list.filter((i) =>
          i.code.toLowerCase().includes(q) ||
          (i.label && i.label.toLowerCase().includes(q)) ||
          (i.createdBy && i.createdBy.toLowerCase().includes(q)) ||
          (i.channel && i.channel.name && i.channel.name.toLowerCase().includes(q)) ||
          (i.roles && i.roles.some((r) => r.name.toLowerCase().includes(q)))
        );
      }
      return list;
    },

    openCreateInviteModal() {
      this.createInviteForm = {
        roleIds: [],
        channelId: this.channels.length > 0 ? this.channels[0].id : '',
        label: '',
        maxUses: 0,
        maxAge: 0
      };
      this.createdInviteResult = null;
      this.showCreateInviteModal = true;
      this.renderIcons();
    },

    async createInviteAction() {
      if (!this.createInviteForm.roleIds || this.createInviteForm.roleIds.length === 0) {
        this.showToast('error', 'Pilih Role', 'Pilih minimal satu role untuk link invite otomatis.');
        return;
      }

      try {
        this.creatingInvite = true;
        const res = await fetch('/api/invites', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.createInviteForm)
        });
        const data = await res.json();
        if (data.success) {
          this.createdInviteResult = data.invite;
          this.showToast('success', 'Link Undangan Dibuat', data.message || 'Link undangan server Discord berhasil dibuat.');
          await this.fetchInvites();
        } else {
          this.showToast('error', 'Gagal Membuat Link Undangan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Gagal Membuat Link Undangan', e.message);
      } finally {
        this.creatingInvite = false;
      }
    },

    async deleteInviteAction(code) {
      if (!confirm(`Cabut link undangan "${code}"? Link ini tidak akan dapat digunakan lagi untuk bergabung ke server Discord.`)) return;

      try {
        const res = await fetch(`/api/invites/${code}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('success', 'Link Undangan Dicabut', data.message || 'Link invite berhasil dihapus dari server Discord.');
          await this.fetchInvites();
        } else {
          this.showToast('error', 'Gagal Mencabut Link Undangan', data.error);
        }
      } catch (e) {
        this.showToast('error', 'Kesalahan Jaringan', e.message);
      }
    },

    copyToClipboard(text, label = 'Tautan') {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => {
            this.showToast('success', 'Disalin', `${label} berhasil disalin ke clipboard.`);
          })
          .catch(() => {
            this.fallbackCopyText(text, label);
          });
      } else {
        this.fallbackCopyText(text, label);
      }
    },

    // ==========================================
    // CHALLENGE MANAGEMENT METHODS (/challenge)
    // ==========================================
    async fetchChallenges() {
      this.loadingChallenges = true;
      try {
        const res = await fetch('/api/challenges', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.challenges = data.challenges || [];
        }
      } catch (err) {
        console.error('fetchChallenges error:', err);
      } finally {
        this.loadingChallenges = false;
        this.renderIcons();
      }
    },

    openCreateChallengeModal() {
      this.challengeModalMode = 'create';
      this.challengeForm = { id: null, title: '', description: '' };
      this.showChallengeModal = true;
    },

    openEditChallengeModal(ch) {
      this.challengeModalMode = 'edit';
      this.challengeForm = {
        id: ch.id,
        title: ch.title || '',
        description: ch.description || ''
      };
      this.showChallengeModal = true;
    },

    async saveChallenge() {
      if (!this.challengeForm.title || this.challengeForm.title.trim().length < 3) {
        return this.showToast('error', 'Validasi Gagal', 'Judul challenge minimal 3 karakter.');
      }

      this.savingChallenge = true;
      try {
        const isEdit = this.challengeModalMode === 'edit';
        const url = isEdit ? `/api/challenges/${this.challengeForm.id}` : '/api/challenges';
        const method = isEdit ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({
            title: this.challengeForm.title.trim(),
            description: this.challengeForm.description ? this.challengeForm.description.trim() : ''
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Topik Challenge Disimpan', data.message || 'Topik tantangan berhasil disimpan.');
          this.showChallengeModal = false;
          await this.fetchChallenges();
        } else {
          this.showToast('error', 'Gagal Menyimpan Challenge', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Menyimpan Challenge', err.message);
      } finally {
        this.savingChallenge = false;
      }
    },

    async deleteChallengeAction(ch) {
      if (!confirm(`Hapus topik challenge "${ch.title}"? Referensi challenge pada tim terkait akan dikosongkan.`)) return;

      this.deletingChallengeId = ch.id;
      try {
        const res = await fetch(`/api/challenges/${ch.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Topik Challenge Dihapus', data.message || 'Topik tantangan berhasil dihapus.');
          await this.fetchChallenges();
        } else {
          this.showToast('error', 'Gagal Menghapus Challenge', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Menghapus Challenge', err.message);
      } finally {
        this.deletingChallengeId = null;
      }
    },

    async broadcastChallengesAction() {
      if (!this.broadcastChallengeChannelId) {
        return this.showToast('error', 'Channel Belum Dipilih', 'Silakan pilih channel Discord target pengumuman.');
      }

      this.broadcastingChallenge = true;
      try {
        const res = await fetch('/api/challenges/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ channelId: this.broadcastChallengeChannelId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Daftar Challenge Diposting', data.message || 'Daftar tantangan resmi berhasil diposting ke channel Discord.');
          this.showBroadcastChallengeModal = false;
        } else {
          this.showToast('error', 'Gagal Memposting Challenge', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Memposting Challenge', err.message);
      } finally {
        this.broadcastingChallenge = false;
      }
    },

    // ==========================================
    // GUILD MEMBERS & MANUAL REGISTRATION (/register member)
    // ==========================================
    async fetchGuildMembers() {
      this.loadingGuildMembers = true;
      try {
        const res = await fetch('/api/guild-members', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (data.success) {
          this.guildMembers = data.members || [];
        }
      } catch (err) {
        console.error('fetchGuildMembers error:', err);
      } finally {
        this.loadingGuildMembers = false;
      }
    },

    openRegisterMemberModal() {
      this.registerMemberForm = {
        userId: '',
        roleId: '',
        keepUnregistered: false
      };
      this.memberSearchQuery = '';
      this.showRegisterMemberModal = true;
      if (this.guildMembers.length === 0) {
        this.fetchGuildMembers();
      }
    },

    async submitRegisterMember() {
      if (!this.registerMemberForm.userId) {
        return this.showToast('error', 'Member Belum Dipilih', 'Silakan pilih member Discord yang ingin didaftarkan.');
      }

      this.registeringMember = true;
      try {
        const res = await fetch('/api/members/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify(this.registerMemberForm)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Registrasi Berhasil', data.message || 'Peserta berhasil didaftarkan dan role telah diberikan.');
          this.showRegisterMemberModal = false;
          this.fetchGuildMembers();
          if (this.activeTab === 'audit') this.fetchAuditLogs();
        } else {
          this.showToast('error', 'Registrasi Gagal', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Registrasi Peserta', err.message);
      } finally {
        this.registeringMember = false;
      }
    },

    // ==========================================
    // CHANNEL MESSAGE PURGE TOOL (/purge)
    // ==========================================
    async submitPurgeMessages() {
      if (!this.purgeForm.channelId) {
        return this.showToast('error', 'Channel Belum Dipilih', 'Silakan tentukan channel Discord yang ingin dibersihkan.');
      }
      const amount = parseInt(this.purgeForm.amount, 10);
      if (isNaN(amount) || amount < 1 || amount > 100) {
        return this.showToast('error', 'Jumlah Pesan Tidak Valid', 'Jumlah pesan harus antara 1 sampai 100.');
      }

      if (!confirm(`Hapus ${amount} pesan terakhir di channel Discord ini? Tindakan ini tidak dapat dibatalkan.`)) return;

      this.purgingMessages = true;
      try {
        const res = await fetch('/api/channels/purge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({
            channelId: this.purgeForm.channelId,
            amount,
            userId: this.purgeForm.userId ? this.purgeForm.userId.trim() : null
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Pesan Dibersihkan', data.message || `Berhasil menghapus ${data.deletedCount} pesan.`);
          this.purgeForm.amount = 10;
          this.purgeForm.userId = '';
          if (this.activeTab === 'audit') this.fetchAuditLogs();
        } else {
          this.showToast('error', 'Gagal Menghapus Pesan', data.error || 'Terjadi kesalahan.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Membersihkan Pesan', err.message);
      } finally {
        this.purgingMessages = false;
      }
    },

    // ==========================================
    // ADVANCED TEAM ACTIONS (/team subcommands)
    // ==========================================
    async purgeDisbandedTeamsAction() {
      if (!confirm('Hapus permanen seluruh tim berstatus DIBUBARKAN dari database? Data riwayat tim tidak dapat dipulihkan.')) return;

      this.purgingDisbandedTeams = true;
      try {
        const res = await fetch('/api/teams/purge-disbanded', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Pembersihan Selesai', data.message || 'Seluruh tim berstatus dibubarkan berhasil dibersihkan.');
          await this.fetchTeams();
        } else {
          this.showToast('error', 'Gagal Membersihkan Tim', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Kesalahan Sistem', err.message);
      } finally {
        this.purgingDisbandedTeams = false;
      }
    },

    openForceRegisterModal() {
      this.forceRegisterForm = {
        name: '',
        leaderId: '',
        member1Id: '',
        member2Id: '',
        challengeId: '',
        nsacLink: ''
      };
      this.showForceRegisterModal = true;
      if (this.guildMembers.length === 0) this.fetchGuildMembers();
      if (this.challenges.length === 0) this.fetchChallenges();
    },

    async submitForceRegister() {
      if (!this.forceRegisterForm.name || this.forceRegisterForm.name.trim().length < 3) {
        return this.showToast('error', 'Nama Tim Terlalu Pendek', 'Nama tim harus terdiri dari minimal 3 karakter.');
      }
      if (!this.forceRegisterForm.leaderId) {
        return this.showToast('error', 'Ketua Tim Belum Dipilih', 'Ketua tim (Leader Discord) wajib dipilih.');
      }

      const memberIds = [this.forceRegisterForm.member1Id, this.forceRegisterForm.member2Id].filter(Boolean);

      this.submittingForceRegister = true;
      try {
        const res = await fetch('/api/teams/force-register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({
            name: this.forceRegisterForm.name.trim(),
            leaderId: this.forceRegisterForm.leaderId,
            memberIds,
            challengeId: this.forceRegisterForm.challengeId || null,
            nsacLink: this.forceRegisterForm.nsacLink ? this.forceRegisterForm.nsacLink.trim() : null
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Tim Terdaftar', data.message || 'Tim baru berhasil didaftarkan dan diaktifkan.');
          this.showForceRegisterModal = false;
          await this.fetchTeams();
        } else {
          this.showToast('error', 'Gagal Mendaftarkan Tim', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Mendaftarkan Tim', err.message);
      } finally {
        this.submittingForceRegister = false;
      }
    },

    async deployTeamPanelAction() {
      const regChannelId = this.configs.find(c => c.key === 'REGISTRATION_PANEL_CHANNEL_ID')?.value;
      const targetChannelId = prompt('Masukkan Channel ID untuk deploy Team Panel (biarkan kosong untuk menggunakan REGISTRATION_PANEL_CHANNEL_ID):', regChannelId || '');
      if (targetChannelId === null) return; // User cancelled

      this.deployingTeamPanel = true;
      try {
        const res = await fetch('/api/teams/deploy-panel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ channelId: targetChannelId || regChannelId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Panel Terkirim', data.message || 'Panel pendaftaran tim berhasil diposting ke channel Discord.');
        } else {
          this.showToast('error', 'Gagal Deploy Panel', data.error || 'Terjadi kendala saat mengirim panel.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Mengirim Panel', err.message);
      } finally {
        this.deployingTeamPanel = false;
      }
    },

    async setTeamChallengeAction(teamId, challengeId) {
      this.savingTeamChallenge = true;
      try {
        const res = await fetch(`/api/teams/${teamId}/challenge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          },
          body: JSON.stringify({ challengeId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          this.showToast('success', 'Topik Challenge Disimpan', data.message);
          await this.fetchTeams();
          if (this.selectedTeam && this.selectedTeam.id === teamId) {
            this.selectedTeam.challenge_id = challengeId ? parseInt(challengeId, 10) : null;
            const ch = this.challenges.find(c => c.id == challengeId);
            this.selectedTeam.challenge_title = ch ? ch.title : null;
          }
        } else {
          this.showToast('error', 'Gagal Menyimpan Topik', data.error || 'Terjadi kesalahan sistem.');
        }
      } catch (err) {
        this.showToast('error', 'Gagal Menyimpan Topik', err.message);
      } finally {
        this.savingTeamChallenge = false;
      }
    },

        fallbackCopyText(text, label) {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
        this.showToast('success', 'Disalin', `${label} berhasil disalin ke clipboard.`);
      } catch (e) {
        this.showToast('error', 'Gagal Menyalin', 'Silakan salin teks secara manual.');
      }
      document.body.removeChild(el);
    },

    getResolvedPreview(text) {
      if (!text) return '';
      const v = this.livePresenceVariables || {};
      return text
        .replace(/{countdown}/gi, v.countdown || 'H-3 Menuju Hackathon')
        .replace(/{teams}|{teamCount}/gi, String(v.teams ?? 0))
        .replace(/{participants}|{participantCount}/gi, String(v.participants ?? 0))
        .replace(/{members}/gi, String(v.members ?? 0));
    },

    get filteredFaqs() {
      let list = this.faqItems || [];
      if (this.faqCategory !== 'ALL') {
        list = list.filter(item => item.category === this.faqCategory);
      }
      if (!this.faqSearch.trim()) return list;
      const q = this.faqSearch.toLowerCase();
      return list.filter(item =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q)
      );
    },

    get filteredChallenges() {
      let list = this.challenges || [];
      if (!this.challengeSearch.trim()) return list;
      const q = this.challengeSearch.toLowerCase();
      return list.filter(c =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.description && c.description.toLowerCase().includes(q))
      );
    },

    get filteredGuildMembers() {
      let list = this.guildMembers || [];
      if (!this.memberSearchQuery.trim()) return list;
      const q = this.memberSearchQuery.toLowerCase();
      return list.filter(m =>
        (m.username && m.username.toLowerCase().includes(q)) ||
        (m.displayName && m.displayName.toLowerCase().includes(q)) ||
        (m.id && m.id.includes(q))
      );
    },

        get filteredCommands() {
      let list = this.commandsList || [];
      if (!this.faqSearch.trim()) return list;
      const q = this.faqSearch.toLowerCase();
      return list.filter(c =>
        c.command.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q) ||
        c.scope.toLowerCase().includes(q)
      );
    }
  };
}

// Expose globally for Alpine.js
window.dashboardApp = dashboardApp;

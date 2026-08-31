# 🏆 Discord Hackathon Management Bot

A production-grade, enterprise-ready **Discord Bot designed for online hackathon management**, built with **Node.js**, **discord.js v14**, and **PostgreSQL** (`pg`).

---

## 🌟 Key Features

1. **Automated Team Registration**:
   - Ticket-based registration (`#team-registration` -> private ticket).
   - Interactive Discord Modal & **User Select Menu** (no manual typing of user tags).
   - Multi-member invitation system with expiration timers (`INVITATION_EXPIRE_HOURS`).
   - Anti-double-team enforcement at database and application levels.
2. **Dynamic Channel & Role Provisioning**:
   - Automatically creates `@Team-Name` role placed safely under staff roles.
   - Creates private `📁 TEAM NAME` Category, `💬・team-name` Text Channel, and `🔊・team-name` Voice Channel.
   - Strict channel permission overwrites for `@everyone`, team members, and staff.
   - **Automatic Rollback**: If channel/role creation fails midway, all partial resources are automatically cleaned up.
3. **Role & Reconnect Management**:
   - Auto-assigns `@Unregistered` to newly joined members.
   - Detects reconnecting/rejoining participants and automatically restores `@Participant` and team roles from PostgreSQL.
4. **Staff Management & Overrides**:
   - Commands to rename, add members, remove members, transfer leadership, archive (make read-only), or delete teams.
   - Override commands for edge cases (`force-add`, `force-remove`, `resend-invite`, `cancel-registration`, `force-register`).
5. **Support Ticket System**:
   - `#support` panel with interactive button to spawn private tickets for Staff & Technical Support.
6. **Dual-Audit Logging**:
   - Persistent database logging in the `audit_logs` table.
   - Real-time formatted embeds dispatched to Discord `#bot-log`.

---

## 📁 Project Architecture

```
.
├── src/
│   ├── index.js                      # Application entry point & client lifecycle
│   ├── deploy-commands.js            # Slash command registration REST script
│   │
│   ├── config/
│   │   ├── env.js                    # Environment variable loader & validator
│   │   └── constants.js              # Enums, statuses, colors, custom IDs
│   │
│   ├── database/
│   │   ├── pool.js                   # PostgreSQL connection pool & transaction helper
│   │   ├── schema.sql                # DDL schema, constraints, partial indexes
│   │   ├── migrate.js                # Database migration runner
│   │   └── queries/
│   │       ├── userQueries.js        # User CRUD & lookup
│   │       ├── teamQueries.js        # Team lifecycle queries
│   │       ├── memberQueries.js      # Team membership queries
│   │       ├── invitationQueries.js  # Invitation tracking queries
│   │       ├── ticketQueries.js      # Ticket records
│   │       └── auditQueries.js       # Audit log records
│   │
│   ├── services/
│   │   ├── teamService.js            # Team validation, creation, rename, delete
│   │   ├── invitationService.js      # Member invitations & expiration sweeper
│   │   ├── ticketService.js          # Registration & support ticket channels
│   │   ├── discordService.js         # Discord channel/role provisioning with rollback
│   │   ├── permissionService.js      # Backend staff/admin permission validator
│   │   └── auditService.js           # Dual PostgreSQL + Discord log dispatcher
│   │
│   ├── utils/
│   │   ├── embeds.js                 # Standardized Discord Embed builders
│   │   ├── logger.js                 # Colored console logger
│   │   └── validators.js             # Team name and size validation helpers
│   │
│   ├── commands/
│   │   ├── registration/
│   │   │   └── registerTeam.js       # /register-team command
│   │   ├── team/
│   │   │   └── team.js               # /team (info, members, invite, rename, archive, etc.)
│   │   ├── ticket/
│   │   │   └── close.js              # /ticket close
│   │   └── admin/
│   │       ├── setupPanels.js        # /setup-panels (deploy buttons)
│   │       └── announce.js           # /announce (rich announcements)
│   │
│   └── events/
│       ├── ready.js                  # Startup verification & sweeper init
│       ├── guildMemberAdd.js         # Auto-role & rejoin restore
│       └── interactionCreate.js      # Central router for commands/buttons/modals/selects
│
├── .env.example                      # Environment variables template
├── .gitignore                        # Git ignore file
├── ecosystem.config.cjs              # PM2 process manager configuration
├── package.json                      # NPM dependencies & scripts
└── README.md                         # Full documentation
```

---

## 🛠️ Prerequisites

- **Node.js**: v18.0.0 or higher (Tested on v20+ / v24+)
- **PostgreSQL**: v13.0 or higher
- **Discord Bot Token & Application** from Discord Developer Portal

---

## ⚙️ 1. Discord Developer Portal Setup

1. Visit the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name (e.g., `Hackathon Bot`), and create it.
3. Go to the **Bot** tab on the left sidebar:
   - Click **Add Bot** / **Reset Token** to copy your **`DISCORD_TOKEN`**.
   - Under **Privileged Gateway Intents**, enable:
     - ✅ **SERVER MEMBERS INTENT** (Required for auto-roles, membership tracking)
     - ✅ **MESSAGE CONTENT INTENT** (Required for announcements and moderation)
4. Go to the **General Information** tab:
   - Copy the **`Application ID`** (this is your `CLIENT_ID`).
5. Generate the Bot Invite URL:
   - Go to **OAuth2** -> **URL Generator**.
   - Under **Scopes**, select: `bot` and `applications.commands`.
   - Under **Bot Permissions**, select:
     - `Administrator` (or individually: Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Move Members, Mute Members, Connect, Speak).
   - Use the generated URL to invite the bot to your Hackathon Discord server.
6. **Role Hierarchy in Discord**:
   - In Discord Server Settings -> **Roles**, ensure the **Bot's highest role is positioned ABOVE** the `@Participant`, `@Unregistered`, and team roles.

---

## 🗄️ 2. PostgreSQL Database Setup

Create a dedicated database and user in PostgreSQL:

```bash
# Connect to PostgreSQL CLI
psql -U postgres

# Create database and user
CREATE USER hackathon_user WITH PASSWORD 'secure_password_123';
CREATE DATABASE hackathon_db OWNER hackathon_user;
GRANT ALL PRIVILEGES ON DATABASE hackathon_db TO hackathon_user;
\q
```

Your `DATABASE_URL` will be:
`postgresql://hackathon_user:secure_password_123@localhost:5432/hackathon_db`

Run migrations to create the database tables, relations, and anti-double-team indexes:

```bash
npm run migrate
```

---

## 🔑 3. Configuration (`.env`)

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in the required values:

```env
# Discord Bot Credentials
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_discord_server_guild_id

# PostgreSQL Database
DATABASE_URL=postgresql://hackathon_user:secure_password_123@localhost:5432/hackathon_db

# Hackathon Rules
MIN_TEAM_SIZE=2
MAX_TEAM_SIZE=4
INVITATION_EXPIRE_HOURS=24

# Category IDs (Right-click Category in Discord -> Copy ID)
REGISTRATION_CATEGORY_ID=123456789012345678
TEAM_PARENT_CATEGORY_ID=123456789012345678
SUPPORT_CATEGORY_ID=123456789012345678

# Role IDs (Right-click Role in Discord -> Copy ID)
ADMINISTRATOR_ROLE_ID=123456789012345678
STAFF_ROLE_ID=123456789012345678
TECHNICAL_SUPPORT_ROLE_ID=123456789012345678
JUDGE_ROLE_ID=123456789012345678
PARTICIPANT_ROLE_ID=123456789012345678
UNREGISTERED_ROLE_ID=123456789012345678

# Channel IDs (Right-click Channel in Discord -> Copy ID)
LOG_CHANNEL_ID=123456789012345678
REGISTRATION_CHANNEL_ID=123456789012345678
SUPPORT_CHANNEL_ID=123456789012345678
```

---

## 🚀 4. Deployment & Running

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Run Database Migrations
```bash
npm run migrate
```

### Step 3: Deploy Slash Commands
```bash
npm run deploy-commands
```

### Step 4: Start Bot in Development Mode
```bash
npm run dev
```

### Step 5: Post Panels to Registration & Support Channels
Once the bot is online in your server, run this slash command as Staff:
```
/setup-panels type:Both Panels
```
This will automatically send the interactive **Team Registration** button in `#team-registration` and the **Support Ticket** button in `#support`.

---

## 🌐 5. Production Deployment on Linux VPS

### Step 1: Install Node.js & PostgreSQL on Ubuntu/Debian
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git postgresql postgresql-contrib

# Install PM2 globally
sudo npm install -g pm2
```

### Step 2: Clone & Configure Project
```bash
git clone <your-repo-url> /opt/hackathon-bot
cd /opt/hackathon-bot

npm install --production
cp .env.example .env
nano .env # Edit your environment variables

npm run migrate
npm run deploy-commands
```

### Step 3: Start with PM2 Process Manager
```bash
# Start bot using ecosystem configuration
pm2 start ecosystem.config.cjs

# Save PM2 process list to persist across server reboots
pm2 save
pm2 startup
```

### Step 4: Monitoring & Logs
```bash
# View live logs
pm2 logs hackathon-bot

# Monitor CPU/Memory
pm2 monit

# Restart bot
pm2 restart hackathon-bot
```

---

## 📖 6. Slash Command Reference

### Participant Commands
| Command | Description |
|---|---|
| `/register-team` | Start a private ticket to register your team |
| `/team info [name] [user]` | View details, status, and channels of a team |
| `/team members [name]` | List all registered members of a team |
| `/team invite <user>` | Leader: Invite an additional member to your team |
| `/ticket close` | Close and archive the current ticket |

### Staff Management Commands
| Command | Description |
|---|---|
| `/team create <name> <leader>` | Manually create an active team |
| `/team approve <name>` | Force approve a pending team and provision resources |
| `/team add-member <team> <user>` | Add a member to an existing team |
| `/team remove-member <team> <user>` | Remove a member from a team |
| `/team rename <team> <new_name>` | Rename team in DB, Discord role, category, text, voice |
| `/team transfer-leader <team> <new_leader>` | Transfer team leadership |
| `/team archive <team>` | Archive team and lock channels to read-only |
| `/team delete <team>` | Delete team resources with confirmation prompt |
| `/team force-add <team> <user>` | Staff override: Force add member |
| `/team force-remove <team> <user>` | Staff override: Force remove member |
| `/team resend-invite <team> <user>` | Resend pending invitation DM |
| `/team cancel-registration <team>` | Cancel a pending team registration |
| `/team force-register <name> <leader> [members...]` | Instantly provision a complete team |
| `/setup-panels <type> [channel]` | Deploy persistent Registration / Support panels |
| `/announce <channel> <title> <message> [color]` | Send formatted announcement embed |
| `/purge <amount> [user]` | Bulk delete 1-100 messages with optional user filter |

---

## 🛡️ 7. Anti-Double-Team Mechanism

1. **Database-Level Constraint**:
   ```sql
   CREATE UNIQUE INDEX unique_active_user_team 
   ON team_members (user_id) 
   WHERE status = 'ACTIVE';
   ```
2. **Transaction Isolation**:
   Team registration and membership updates execute inside `withTransaction()` with `BEGIN ... COMMIT` and rollback on error.
3. **Application Validation**:
   Checks active user status in PostgreSQL before accepting invitations or allowing registration.

---

## 🔄 8. Recovery & Startup Integrity

Upon startup (`ready.js`):
1. Verifies PostgreSQL connection and auto-applies schema if missing.
2. Sweeps expired pending invitations (`expires_at <= NOW()`).
3. Re-establishes background expiration intervals.
4. Auto-restores `@Participant` and team roles if a member left and rejoined the Discord server (`guildMemberAdd.js`).

---

## 📜 License
MIT License - Open Source for Hackathons & Developer Communities.

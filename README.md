# Discord Hackathon Management Bot

A production-grade Discord Bot designed for online hackathon management, built with **Node.js**, **discord.js v14**, and **PostgreSQL**.

---

## Key Features

1. **Automated Team Registration**:
   - Ticket-based registration (`#team-registration` -> private channel).
   - Interactive Discord Modal and dynamic member select menu.
   - Supports team sizes from 1 to 6 members, including instant solo-team creation.
   - Multi-member invitation system with expiration timers.
   - Database-enforced Anti-Double-Team protection.

2. **Dynamic Channel & Role Provisioning**:
   - Automatically provisions `@Team-Name` role, category, text channel, and voice channel.
   - Strict channel permission overwrites for `@everyone`, team members, and staff.
   - Automatic rollback of partial Discord resources if provisioning encounters errors.
   - Automatic message pinning for team workspace dashboards and ticket channels.

3. **Open Recruitment Board System**:
   - Team leaders can post open roster vacancies to a public recruitment channel.
   - Public board contains only the "Minta Bergabung" action to prevent unauthorized modifications.
   - The "Tutup Rekrutmen" action is managed directly inside each team's private workspace channel.
   - Real-time slot and member count updates on the public board when an applicant is accepted.
   - Automatic vacancy closure when slots are filled or when the team reaches the maximum capacity (6 members).

4. **Participant Role & Reconnect Management**:
   - Auto-assigns `@Unregistered` to newly joined members.
   - Detects reconnecting participants and restores participant and team roles from PostgreSQL.

5. **Staff Management & Central Control Panel**:
   - Interactive control panel (`/setup dashboard` and `/team panel`) for monitoring teams, registrations, and configurations.
   - Management commands: rename, add/remove members, transfer leadership, archive, and delete teams.
   - Staff override commands (`force-register`, `force-add`, `force-remove`, `resend-invite`, `cancel-registration`).

6. **Support Ticket & Dynamic FAQ System**:
   - Ticket panel for technical support and inquiries.
   - Live-editable markdown FAQ/Rules system (`/faq`).

7. **Dual-Audit Logging**:
   - Persistent transactional logging in the PostgreSQL `audit_logs` table.
   - Formatted real-time audit log embeds dispatched to the designated log channel.

---

## Project Architecture

```
.
├── src/
│   ├── index.js                      # Application entry point and client lifecycle
│   ├── deploy-commands.js            # Slash command registration script
│   │
│   ├── config/
│   │   ├── env.js                    # Environment variable loader and fallback config
│   │   └── constants.js              # Enums, statuses, embed colors, custom IDs
│   │
│   ├── database/
│   │   ├── pool.js                   # PostgreSQL connection pool and transaction helper
│   │   ├── schema.sql                # DDL schema, constraints, and partial indexes
│   │   ├── migrate.js                # Database migration runner
│   │   └── queries/
│   │       ├── userQueries.js        # User records and lookup
│   │       ├── teamQueries.js        # Team lifecycle queries
│   │       ├── memberQueries.js      # Team membership queries
│   │       ├── invitationQueries.js  # Invitation tracking queries
│   │       ├── recruitmentQueries.js # Open recruitment board queries
│   │       ├── ticketQueries.js      # Ticket records
│   │       ├── faqQueries.js         # Dynamic FAQ and embed queries
│   │       └── auditQueries.js       # Audit log records
│   │
│   ├── services/
│   │   ├── teamService.js            # Team validation, creation, rename, and panel logic
│   │   ├── invitationService.js      # Member invitations and expiration sweeper
│   │   ├── ticketService.js          # Registration and support ticket provisioning
│   │   ├── discordService.js         # Discord channel/role provisioning with rollback
│   │   ├── permissionService.js      # Role-based permission checks
│   │   ├── guildConfigService.js     # Dynamic guild settings stored in PostgreSQL
│   │   ├── dashboardService.js       # Central admin dashboard renderer
│   │   ├── faqService.js             # Live markdown FAQ builder and renderer
│   │   └── auditService.js           # Dual PostgreSQL and Discord log dispatcher
│   │
│   ├── utils/
│   │   ├── embeds.js                 # Standardized Discord embed builders
│   │   ├── logger.js                 # Formatted console logger
│   │   ├── validators.js             # Team name and size validation helpers
│   │   └── interactionUtils.js       # Interaction response helpers
│   │
│   ├── commands/
│   │   ├── registration/
│   │   │   └── register.js           # /register member
│   │   ├── team/
│   │   │   └── team.js               # /team subcommands (info, members, invite, recruit, etc.)
│   │   ├── ticket/
│   │   │   └── close.js              # /ticket close
│   │   └── admin/
│   │       ├── setup.js              # /setup (dashboard, panels, config)
│   │       ├── faq.js                # /faq (create, edit, delete)
│   │       ├── announce.js           # /announce (rich announcements)
│   │       └── purge.js              # /purge (bulk message cleanup)
│   │
│   └── events/
│       ├── ready.js                  # Startup verification, config cache, and sweeper init
│       ├── guildMemberAdd.js         # Auto-role assignment and rejoin restoration
│       └── interactionCreate.js      # Central router for commands, buttons, modals, and selects
│
├── docker-compose.yml                # Docker compose configuration
├── Dockerfile                        # Container definition
├── package.json                      # NPM dependencies and scripts
└── README.md                         # Project documentation
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **PostgreSQL**: v13.0 or higher
- **Discord Bot Token & Application** from the Discord Developer Portal

---

## 1. Discord Developer Portal Setup

1. Create a new application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under the **Bot** tab:
   - Reset/Copy your `DISCORD_TOKEN`.
   - Enable **Server Members Intent** and **Message Content Intent**.
3. Under the **General Information** tab:
   - Copy the `Application ID` (used as `CLIENT_ID`).
4. Generate the bot invite URL via **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Permissions: `Administrator` (or granular permissions for Manage Roles, Manage Channels, Send Messages, etc.).
5. **Role Hierarchy Requirement**:
   - In Discord Server Settings -> **Roles**, place the Bot's highest role **ABOVE** the `@Participant`, `@Unregistered`, and team roles.

---

## 2. PostgreSQL Setup & Migrations

Create a database and user:

```sql
CREATE USER hackathon_user WITH PASSWORD 'secure_password_123';
CREATE DATABASE hackathon_db OWNER hackathon_user;
GRANT ALL PRIVILEGES ON DATABASE hackathon_db TO hackathon_user;
```

Run migrations:

```bash
npm run migrate
```

---

## 3. Environment Configuration (`.env`)

Copy `.env.example` to `.env` and fill in the values:

```env
# Discord Bot Credentials
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_discord_server_guild_id

# PostgreSQL Database
DATABASE_URL=postgresql://hackathon_user:secure_password_123@localhost:5432/hackathon_db

# Hackathon Rules
MIN_TEAM_SIZE=2
MAX_TEAM_SIZE=6
INVITATION_EXPIRE_HOURS=24
```

*Note: All category, channel, and role IDs can be configured dynamically via `/setup config set` or directly in the database.*

---

## 4. Running the Bot

### Local Development

```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Deploy slash commands to Discord
npm run deploy-commands

# Start the bot in development mode
npm run dev
```

### Initial Server Setup

Once the bot is online, execute:
1. `/setup dashboard` — Deploys the central admin control panel in `#admin-dashboard`.
2. `/setup panels type:both` — Deploys the public Team Registration and Support Ticket panels.

---

## 5. Deployment with PM2 / Docker

### Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start bot process
pm2 start ecosystem.config.cjs

# Persist across reboots
pm2 save
pm2 startup
```

### Using Docker Compose

```bash
docker-compose up -d --build
```

---

## 6. Command Reference

### Participant & Team Commands
| Command | Description |
|---|---|
| `/team info [name] [user]` | View team details, members, and channels |
| `/team members [name]` | List all registered members of a team |
| `/team invite <user>` | Leader: Invite an unregistered user to the team |
| `/team kick <user>` | Leader: Remove a member from the team |
| `/team leave` | Member: Leave the current team |
| `/team recruit` | Leader: Open team recruitment on the public board |
| `/team recruit-close` | Leader: Close active recruitment listing |
| `/ticket close` | Close the current registration or support ticket |

### Staff & Administrative Commands
| Command | Description |
|---|---|
| `/setup dashboard` | Deploy or refresh the central Admin Control Panel |
| `/setup panels <type> [channel]` | Deploy persistent Registration and Support ticket panels |
| `/setup config set <key> <value>` | Update guild configuration values dynamically |
| `/setup config list` | View all active guild configuration parameters |
| `/team panel` | Open the interactive Team Management dashboard |
| `/team create <name> <leader>` | Manually create an active team |
| `/team approve <name>` | Approve a pending team and provision resources |
| `/team add-member <team> <user>` | Add a member to an existing team |
| `/team remove-member <team> <user>` | Remove a member from a team |
| `/team rename <team> <new_name>` | Rename team in DB, Discord role, and channels |
| `/team transfer-leader <team> <user>` | Transfer team leadership |
| `/team archive <team>` | Archive team and lock channels to read-only |
| `/team delete <team>` | Delete team resources with confirmation |
| `/team force-register <name> <leader> [members...]` | Instantly provision a complete team (up to 6 members) |
| `/team force-add <team> <user>` | Force-add a member bypassing standard checks |
| `/team force-remove <team> <user>` | Force-remove a member |
| `/team resend-invite <team> <user>` | Resend pending invitation DM to a user |
| `/team cancel-registration <team>` | Cancel a pending team registration |
| `/register member <user> [role]` | Assign participant roles and clear unregistered status |
| `/faq create <id> [channel]` | Create a live-editable Markdown FAQ/Rules embed |
| `/faq edit <id>` | Open editor modal to update FAQ content in-place |
| `/announce <channel> <title> <message> [color]` | Send formatted announcement embed |
| `/purge <amount> [user]` | Bulk delete 1-100 messages with optional user filter |

---

## 7. Anti-Double-Team Enforcement

1. **Database Constraint**:
   ```sql
   CREATE UNIQUE INDEX unique_active_user_team 
   ON team_members (user_id) 
   WHERE status = 'ACTIVE';
   ```
2. **Transaction Isolation**:
   Team registration, member addition, and invitations execute inside PostgreSQL transactions (`withTransaction`) ensuring atomic rollbacks upon conflict.
3. **Application Verification**:
   Validates user active status prior to dispatching invitations, accepting join requests, or creating teams.

---

## 8. License

MIT License - Open Source for Hackathons and Developer Communities.

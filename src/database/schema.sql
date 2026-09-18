-- ==========================================
-- DISCORD HACKATHON BOT - POSTGRESQL SCHEMA
-- ==========================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(32) UNIQUE NOT NULL,
    username VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

-- 2. Challenges Table (must come before teams to allow FK reference)
CREATE TABLE IF NOT EXISTS challenges (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenges_title ON challenges(title);

-- 3. Teams Table
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    leader_id INT REFERENCES users(id) ON DELETE RESTRICT,
    role_id VARCHAR(32),
    category_id VARCHAR(32),
    text_channel_id VARCHAR(32),
    voice_channel_id VARCHAR(32),
    nsac_link TEXT,
    challenge_id INT REFERENCES challenges(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_team_status CHECK (status IN ('PENDING', 'ACTIVE', 'ARCHIVED', 'DISBANDED'))
);

CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_id);
CREATE INDEX IF NOT EXISTS idx_teams_challenge ON teams(challenge_id);

-- Case-insensitive unique team name for active/pending teams
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_team_name 
ON teams (LOWER(name)) 
WHERE status IN ('PENDING', 'ACTIVE');

-- 4. Team Members Table
CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_member_role CHECK (role IN ('LEADER', 'MEMBER')),
    CONSTRAINT chk_member_status CHECK (status IN ('PENDING', 'ACTIVE', 'REMOVED'))
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- CRITICAL ANTI-DOUBLE-TEAM CONSTRAINT:
-- A user can only be an ACTIVE member of at most ONE team at any given time.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_user_team 
ON team_members (user_id) 
WHERE status = 'ACTIVE';

-- 5. Invitations Table
CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    invited_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by INT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS idx_invitations_team_id ON invitations(team_id);
CREATE INDEX IF NOT EXISTS idx_invitations_user_id ON invitations(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);

-- 6. Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    discord_channel_id VARCHAR(32) UNIQUE NOT NULL,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_ticket_type CHECK (type IN ('TEAM_REGISTRATION', 'SUPPORT')),
    CONSTRAINT chk_ticket_status CHECK (status IN ('OPEN', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(discord_channel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);

-- 7. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    actor_id INT REFERENCES users(id) ON DELETE SET NULL,
    target_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    team_id INT REFERENCES teams(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_team ON audit_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- 8. Guild Config Table (dynamic bot configuration stored in DB)
CREATE TABLE IF NOT EXISTS guild_config (
    key        VARCHAR(100) PRIMARY KEY,
    value      VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Dynamic Embeds Table (for editable FAQ / Rules / Announcements)
CREATE TABLE IF NOT EXISTS dynamic_embeds (
    id VARCHAR(50) PRIMARY KEY,
    channel_id VARCHAR(32) NOT NULL,
    message_id VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT 'PRIMARY',
    fields JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dynamic_embeds_channel ON dynamic_embeds(channel_id);

-- 10. Invite Roles Table (Dynamic invite-to-role mappings)
CREATE TABLE IF NOT EXISTS invite_roles (
    id SERIAL PRIMARY KEY,
    invite_code VARCHAR(32) UNIQUE NOT NULL,
    role_id VARCHAR(32),
    role_ids JSONB DEFAULT '[]'::jsonb,
    channel_id VARCHAR(32),
    label VARCHAR(100),
    created_by VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invite_roles_code ON invite_roles(invite_code);
ALTER TABLE invite_roles ADD COLUMN IF NOT EXISTS role_ids JSONB DEFAULT '[]'::jsonb;

-- 11. Team Recruitments Table (posting lowongan anggota oleh leader)
CREATE TABLE IF NOT EXISTS team_recruitments (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    channel_id VARCHAR(32) NOT NULL,
    message_id VARCHAR(32) NOT NULL,
    slots_needed INT NOT NULL DEFAULT 1,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_recruitment_status CHECK (status IN ('OPEN', 'CLOSED'))
);
CREATE INDEX IF NOT EXISTS idx_recruitments_team ON team_recruitments(team_id);
CREATE INDEX IF NOT EXISTS idx_recruitments_status ON team_recruitments(status);
CREATE INDEX IF NOT EXISTS idx_recruitments_message ON team_recruitments(message_id);

-- Migration: Add new columns to existing tables (safe for existing databases)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS nsac_link TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS challenge_id INT REFERENCES challenges(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_teams_challenge ON teams(challenge_id);

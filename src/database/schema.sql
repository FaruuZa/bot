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

-- 2. Teams Table
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    leader_id INT REFERENCES users(id) ON DELETE RESTRICT,
    role_id VARCHAR(32),
    category_id VARCHAR(32),
    text_channel_id VARCHAR(32),
    voice_channel_id VARCHAR(32),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_team_status CHECK (status IN ('PENDING', 'ACTIVE', 'ARCHIVED', 'DISBANDED'))
);

CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_id);

-- Case-insensitive unique team name for active/pending teams
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_team_name 
ON teams (LOWER(name)) 
WHERE status IN ('PENDING', 'ACTIVE');

-- 3. Team Members Table
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

-- 4. Invitations Table
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

-- 5. Tickets Table
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

-- 6. Audit Logs Table
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

-- 7. Guild Config Table (dynamic bot configuration stored in DB)
CREATE TABLE IF NOT EXISTS guild_config (
    key        VARCHAR(100) PRIMARY KEY,
    value      VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

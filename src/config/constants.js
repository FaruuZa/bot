/**
 * System constants, enums, status codes, and design tokens
 */

export const TEAM_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  DISBANDED: 'DISBANDED'
};

export const MEMBER_ROLE = {
  LEADER: 'LEADER',
  MEMBER: 'MEMBER'
};

export const MEMBER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REMOVED: 'REMOVED'
};

export const INVITATION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED'
};

export const TICKET_TYPE = {
  TEAM_REGISTRATION: 'TEAM_REGISTRATION',
  SUPPORT: 'SUPPORT'
};

export const TICKET_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
};

export const AUDIT_ACTIONS = {
  TEAM_CREATED: 'TEAM_CREATED',
  TEAM_ARCHIVED: 'TEAM_ARCHIVED',
  TEAM_DELETED: 'TEAM_DELETED',
  TEAM_RENAMED: 'TEAM_RENAMED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_KICKED: 'MEMBER_KICKED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  LEADER_TRANSFERRED: 'LEADER_TRANSFERRED',
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  INVITATION_DECLINED: 'INVITATION_DECLINED',
  REGISTRATION_REJECTED: 'REGISTRATION_REJECTED',
  STAFF_OVERRIDE: 'STAFF_OVERRIDE',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  ROLE_RESTORED: 'ROLE_RESTORED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  RECRUITMENT_POSTED: 'RECRUITMENT_POSTED',
  RECRUITMENT_CLOSED: 'RECRUITMENT_CLOSED',
  RECRUITMENT_REQUEST_SENT: 'RECRUITMENT_REQUEST_SENT',
  RECRUITMENT_REQUEST_ACCEPTED: 'RECRUITMENT_REQUEST_ACCEPTED',
  RECRUITMENT_REQUEST_REJECTED: 'RECRUITMENT_REQUEST_REJECTED'
};

export const EMBED_COLORS = {
  PRIMARY: 0x5865F2,   // Discord Blurple
  SECONDARY: 0x5865F2, // Secondary Accent
  SUCCESS: 0x57F287,   // Green
  DANGER: 0xED4245,    // Red
  WARNING: 0xFEE75C,   // Yellow
  INFO: 0x3498DB,      // Blue
  DARK: 0x2B2D31       // Discord Dark Theme
};


export const CUSTOM_IDS = {
  // Buttons
  BTN_CREATE_REG_TICKET: 'btn_create_reg_ticket',
  BTN_OPEN_REG_MODAL: 'btn_open_reg_modal',
  BTN_CLOSE_TICKET: 'btn_close_ticket',
  BTN_CREATE_SUPPORT_TICKET: 'btn_create_support_ticket',
  BTN_INVITE_ACCEPT: 'btn_invite_accept_', // prefix + invitation_id
  BTN_INVITE_DECLINE: 'btn_invite_decline_', // prefix + invitation_id
  BTN_DELETE_TEAM_CONFIRM: 'btn_delete_team_confirm_', // prefix + team_id
  BTN_DELETE_TEAM_CANCEL: 'btn_delete_team_cancel_', // prefix + team_id

  // Staff Admin buttons
  BTN_STAFF_ADD_TEAM: 'team_panel_staff_add_team',

  // === MEMBER Registration Flow (single-embed) ===
  MODAL_REGISTER_TEAM: 'modal_register_team',
  INPUT_TEAM_NAME: 'input_team_name',
  SELECT_TEAM_MEMBERS: 'select_team_members',
  BTN_REG_CHANGE_NAME: 'btn_reg_change_name',       // Ubah nama tim (member)
  BTN_REG_CANCEL: 'btn_reg_cancel',                 // Batal (member)
  BTN_REG_CONFIRM: 'btn_reg_confirm',               // Konfirmasi daftar (member)
  BTN_REG_RESELECT: 'btn_reg_reselect',             // Pilih ulang anggota (member)
  MODAL_REG_CHANGE_NAME: 'modal_reg_change_name',   // Modal ubah nama (member)
  INPUT_REG_NEW_NAME: 'input_reg_new_name',          // Input di modal ubah nama
  BTN_REG_CREATE_SOLO: 'btn_reg_create_solo',        // Buat tim langsung tanpa pilih anggota (member)

  // === STAFF Registration Flow (single-embed, ephemeral) ===
  MODAL_STAFF_ADD_TEAM: 'modal_staff_add_team',
  INPUT_STAFF_TEAM_NAME: 'input_staff_team_name',
  BTN_STAFF_REG_CHANGE_NAME: 'btn_staff_reg_change_name',     // Ubah nama (staff)
  BTN_STAFF_REG_CANCEL: 'btn_staff_reg_cancel',               // Batal (staff)
  BTN_STAFF_REG_CONFIRM: 'btn_staff_reg_confirm',             // Konfirmasi (staff)
  BTN_STAFF_REG_RESELECT: 'btn_staff_reg_reselect',           // Pilih ulang (staff)
  MODAL_STAFF_REG_CHANGE_NAME: 'modal_staff_reg_change_name', // Modal ubah nama (staff)
  INPUT_STAFF_REG_NEW_NAME: 'input_staff_reg_new_name',
  BTN_STAFF_REG_CREATE_SOLO: 'btn_staff_reg_create_solo',     // Buat tim langsung tanpa pilih anggota (staff)

  // === Dashboard Role Selects ===
  ROLESELECT_DASHBOARD_PARTICIPANT: 'dashboard_roleselect_participant', // Set Participant role
  ROLESELECT_DASHBOARD_NOTEAM: 'dashboard_roleselect_noteam',           // Set No-Team role

  // === Team Management (Leader) ===
  BTN_TEAM_KICK_CONFIRM: 'btn_team_kick_confirm_',   // prefix + teamId + '_' + userId
  BTN_TEAM_KICK_CANCEL: 'btn_team_kick_cancel',
  BTN_TEAM_LEAVE_CONFIRM: 'btn_team_leave_confirm',
  BTN_TEAM_LEAVE_CANCEL: 'btn_team_leave_cancel',

  // === Team Recruitment ===
  MODAL_TEAM_RECRUIT: 'modal_team_recruit_',         // prefix + teamId
  INPUT_RECRUIT_SLOTS: 'input_recruit_slots',
  INPUT_RECRUIT_DESC: 'input_recruit_desc',
  BTN_RECRUIT_REQUEST_JOIN: 'btn_recruit_join_',     // prefix + recruitmentId
  BTN_TEAM_RECRUIT_CLOSE: 'btn_recruit_close_',      // prefix + recruitmentId
  BTN_RECRUIT_ACCEPT: 'btn_recruit_accept_',         // prefix + recruitmentId + '_' + requestDiscordId
  BTN_RECRUIT_REJECT: 'btn_recruit_reject_',         // prefix + recruitmentId + '_' + requestDiscordId

  // === Team Panel Info ===
  BTN_TEAM_PANEL_INVITE: 'btn_team_panel_invite',
  BTN_TEAM_PANEL_RECRUIT: 'btn_team_panel_recruit',
  BTN_TEAM_PANEL_RECRUIT_CLOSE: 'btn_team_panel_recruit_close',
  BTN_TEAM_PANEL_INFO: 'btn_team_panel_info',
};

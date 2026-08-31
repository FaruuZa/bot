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
  LEADER_TRANSFERRED: 'LEADER_TRANSFERRED',
  INVITATION_SENT: 'INVITATION_SENT',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  INVITATION_DECLINED: 'INVITATION_DECLINED',
  REGISTRATION_REJECTED: 'REGISTRATION_REJECTED',
  STAFF_OVERRIDE: 'STAFF_OVERRIDE',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  ROLE_RESTORED: 'ROLE_RESTORED'
};

export const EMBED_COLORS = {
  PRIMARY: 0x5865F2, // Discord Blurple
  SUCCESS: 0x57F287, // Green
  DANGER: 0xED4245,  // Red
  WARNING: 0xFEE75C, // Yellow
  INFO: 0x3498DB,    // Blue
  DARK: 0x2B2D31     // Discord Dark Theme
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

  // Modals & Select Menus
  MODAL_REGISTER_TEAM: 'modal_register_team',
  INPUT_TEAM_NAME: 'input_team_name',
  SELECT_TEAM_MEMBERS: 'select_team_members'
};

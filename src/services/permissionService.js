import { PermissionsBitField } from 'discord.js';
import { GuildConfigService } from './guildConfigService.js';
import { getUserActiveTeamByDiscordId } from '../database/queries/memberQueries.js';

export class PermissionService {
  /**
   * Check if GuildMember is an Administrator
   * @param {import('discord.js').GuildMember} member 
   * @returns {boolean}
   */
  static isAdmin(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const adminRoleId = GuildConfigService.get('ADMINISTRATOR_ROLE_ID');
    if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
    return false;
  }

  /**
   * Check if GuildMember is Staff (or Admin)
   * @param {import('discord.js').GuildMember} member 
   * @returns {boolean}
   */
  static isStaff(member) {
    if (!member) return false;
    if (this.isAdmin(member)) return true;
    const staffRoleId = GuildConfigService.get('STAFF_ROLE_ID');
    if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
    return false;
  }

  /**
   * Check if GuildMember is Technical Support (or Staff/Admin)
   * @param {import('discord.js').GuildMember} member 
   * @returns {boolean}
   */
  static isTechnicalSupport(member) {
    if (!member) return false;
    if (this.isStaff(member)) return true;
    const techSupportRoleId = GuildConfigService.get('TECHNICAL_SUPPORT_ROLE_ID');
    if (techSupportRoleId && member.roles.cache.has(techSupportRoleId)) return true;
    return false;
  }

  /**
   * Check if GuildMember is Judge
   * @param {import('discord.js').GuildMember} member 
   * @returns {boolean}
   */
  static isJudge(member) {
    if (!member) return false;
    if (this.isStaff(member)) return true;
    const judgeRoleId = GuildConfigService.get('JUDGE_ROLE_ID');
    if (judgeRoleId && member.roles.cache.has(judgeRoleId)) return true;
    return false;
  }

  /**
   * Check if user is a Leader of an active team
   * @param {string} discordId 
   * @returns {Promise<{ isLeader: boolean, team: object|null }>}
   */
  static async isTeamLeader(discordId) {
    const activeTeam = await getUserActiveTeamByDiscordId(discordId);
    if (activeTeam && activeTeam.user_team_role === 'LEADER') {
      return { isLeader: true, team: activeTeam };
    }
    return { isLeader: false, team: activeTeam };
  }

  /**
   * Check if user is a member of an active team
   * @param {string} discordId 
   * @returns {Promise<{ isMember: boolean, team: object|null }>}
   */
  static async isTeamMember(discordId) {
    const activeTeam = await getUserActiveTeamByDiscordId(discordId);
    return { isMember: !!activeTeam, team: activeTeam };
  }
}

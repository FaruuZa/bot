import { env } from '../config/env.js';

/**
 * Validate a proposed team name
 * @param {string} name 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTeamName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Team name cannot be empty.' };
  }

  const trimmed = name.trim();

  if (trimmed.length < 3) {
    return { valid: false, error: 'Team name must be at least 3 characters long.' };
  }

  if (trimmed.length > 32) {
    return { valid: false, error: 'Team name cannot exceed 32 characters.' };
  }

  // Check for allowed characters (alphanumeric, spaces, hyphens, underscores)
  const regex = /^[a-zA-Z0-9 _-]+$/;
  if (!regex.test(trimmed)) {
    return { valid: false, error: 'Team name can only contain letters, numbers, spaces, hyphens, and underscores.' };
  }

  return { valid: true };
}

/**
 * Validate team member count (including leader)
 * @param {number} totalCount 
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateTeamSize(totalCount) {
  if (totalCount < env.MIN_TEAM_SIZE) {
    return {
      valid: false,
      error: `A team must have at least ${env.MIN_TEAM_SIZE} members (including the leader). Current: ${totalCount}.`
    };
  }

  if (totalCount > env.MAX_TEAM_SIZE) {
    return {
      valid: false,
      error: `A team cannot have more than ${env.MAX_TEAM_SIZE} members (including the leader). Current: ${totalCount}.`
    };
  }

  return { valid: true };
}

/**
 * Format a string to be a safe Discord channel slug
 * @param {string} name 
 * @returns {string}
 */
export function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

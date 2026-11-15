/**
 * Single Shared Team Matcher
 * Digunakan bersama oleh exportService, nasaValidationService, dan api.js (/web-teams)
 */

export function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function slugFromNsacLink(link) {
  if (!link) return null;
  const m = String(link).match(/find-a-team\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export function matchWebTeam(dcTeam, webTeam) {
  if (!dcTeam || !webTeam) return false;
  const dcSlug = slugFromNsacLink(dcTeam.nsac_link);
  if (dcSlug && webTeam.slug && dcSlug === String(webTeam.slug).toLowerCase()) return true;
  const a = normalizeTeamName(dcTeam.name);
  const b = normalizeTeamName(webTeam.title);
  return a.length > 0 && a === b;
}

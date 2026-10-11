import { CATEGORIES } from "./clip-validation.js";

export function normalizeVotingCategories(value, legacyVotingEnabled, uploadsEnabled) {
  if (uploadsEnabled) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.filter((category) => CATEGORIES.includes(category)))];
  }
  return legacyVotingEnabled ? [...CATEGORIES] : [];
}

export function isCategoryVotingEnabled(siteSettings, category) {
  return !siteSettings.uploadsEnabled && siteSettings.votingCategories.includes(category);
}

import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES } from "../src/clip-validation.js";
import { isCategoryVotingEnabled, normalizeVotingCategories } from "../src/site-settings.js";

test("normalizes category voting settings and migrates the old all-categories setting", () => {
  assert.deepEqual(normalizeVotingCategories(undefined, false, false), []);
  assert.deepEqual(normalizeVotingCategories(undefined, true, false), [...CATEGORIES]);
  assert.deepEqual(normalizeVotingCategories([CATEGORIES[1], "Nieznana", CATEGORIES[1]], false, false), [CATEGORIES[1]]);
  assert.deepEqual(normalizeVotingCategories(CATEGORIES, true, true), []);
});

test("voting can only be enabled in selected categories while uploads are disabled", () => {
  const settings = { uploadsEnabled: false, votingCategories: [CATEGORIES[0]] };
  assert.equal(isCategoryVotingEnabled(settings, CATEGORIES[0]), true);
  assert.equal(isCategoryVotingEnabled(settings, CATEGORIES[1]), false);
  assert.equal(isCategoryVotingEnabled({ ...settings, uploadsEnabled: true }, CATEGORIES[0]), false);
});

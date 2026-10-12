import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, ValidationError, validateClipInput } from "../src/clip-validation.js";

const validInput = {
  caption: "Dobry klip",
  gallery_category: CATEGORIES[0],
  video_url: "",
};

test("includes all 22 contest categories", () => {
  assert.deepEqual(CATEGORIES, [
    "Niefart roku",
    "Fart roku",
    "Moment radości",
    "Ucięty shot",
    "Cringe roku",
    "Play roku",
    "Zwrot akcji",
    "Rizz roku",
    "Schiza roku",
    "Głos roku",
    "Najlepszy horror Roblox",
    "Steal roku",
    "Jumpscare roku",
    "Najśmieszniejszy klip",
    "Najlepszy crashout",
    "Mucha",
    "Pentakill",
    "Aura",
    "Moment dla rodziny",
    "Legacy",
    "Antyartysta roku",
    "Artysta roku",
  ]);
});

test("validates link submissions without storing an author name", () => {
  const input = validateClipInput({ ...validInput, name: "Nyx", video_url: "https://example.com/clip" }, false);
  assert.equal("name" in input, false);
  assert.equal(input.videoUrl, "https://example.com/clip");
});

test("validates file submissions and stores no link", () => {
  const input = validateClipInput(validInput, true);
  assert.equal(input.videoUrl, null);
});

test("rejects submissions with both or neither media source", () => {
  assert.throws(() => validateClipInput(validInput, false), ValidationError);
  assert.throws(
    () => validateClipInput({ ...validInput, video_url: "https://example.com/clip" }, true),
    ValidationError,
  );
});

test("rejects invalid category and URL schemes", () => {
  assert.throws(() => validateClipInput({ ...validInput, gallery_category: "Inna" }, true), /kategorię/);
  assert.throws(
    () => validateClipInput({ ...validInput, video_url: "javascript:alert(1)" }, false),
    /http:\/\/ lub https:\/\//,
  );
});

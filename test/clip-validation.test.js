import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, ValidationError, validateClipInput } from "../src/clip-validation.js";

const validInput = {
  name: "Nyx",
  caption: "Dobry klip",
  gallery_category: CATEGORIES[0],
  video_url: "",
};

test("validates link submissions without requiring or storing an email address", () => {
  const input = validateClipInput({ ...validInput, email: "not-an-email", video_url: "https://example.com/clip" }, false);
  assert.equal("email" in input, false);
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

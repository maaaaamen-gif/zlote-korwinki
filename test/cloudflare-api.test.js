import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as getCategories } from "../functions/api/categories.js";
import { onRequestGet as getClips } from "../functions/api/clips.js";
import { onRequestPost as vote } from "../functions/api/clips/[id]/vote.js";
import { onRequestGet as getMedia } from "../functions/api/media/[id].js";
import { onRequestPost as submitClip } from "../functions/api/clips.js";

test("categories endpoint returns the supported categories", async () => {
  const response = getCategories();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).categories.length, 12);
});

test("gallery rejects an unsupported category without contacting the database", async () => {
  const response = await getClips({
    request: new Request("https://example.pages.dev/api/clips?category=invalid"),
    env: {},
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /kategoria/i);
});

test("gallery rejects invalid pagination parameters without contacting the database", async () => {
  const response = await getClips({
    request: new Request("https://example.pages.dev/api/clips?page=-1"),
    env: {},
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /strony/i);
});

test("voting rejects malformed clip IDs without contacting the database", async () => {
  const response = await vote({
    request: new Request("https://example.pages.dev/api/clips/not-an-id/vote", { method: "POST" }),
    env: {},
    params: { id: "not-an-id" },
  });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /klipu/i);
});

test("submissions require exactly one media source", async () => {
  const form = new FormData();
  form.set("name", "Nyx");
  form.set("caption", "Dobry klip");
  form.set("gallery_category", "Niefart roku");
  const response = await submitClip({
    request: new Request("https://example.pages.dev/api/clips", { method: "POST", body: form }),
    env: {},
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /plik albo podaj link/i);
});

test("media endpoint streams an R2 object with its content type", async () => {
  const response = await getMedia({
    request: new Request("https://example.pages.dev/api/media/0123456789abcdef01234567"),
    env: {
      CLIP_MEDIA: {
        get: async () => ({
          body: new Response("image").body,
          httpMetadata: { contentType: "image/png" },
          size: 5,
        }),
      },
    },
    params: { id: "0123456789abcdef01234567" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(await response.text(), "image");
});

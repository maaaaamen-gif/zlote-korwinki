import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_SESSION_DURATION_MS,
  createAdminSession,
  credentialsMatch,
  verifyAdminSession,
} from "../src/admin-auth.js";

test("admin sessions are signed, tied to one account, and expire", () => {
  const now = 1_000_000;
  const token = createAdminSession("admin", "a-long-secret", now);

  assert.equal(verifyAdminSession(token, "admin", "a-long-secret", now), true);
  assert.equal(verifyAdminSession(token, "other", "a-long-secret", now), false);
  assert.equal(verifyAdminSession(token, "admin", "wrong-secret", now), false);
  assert.equal(verifyAdminSession(token, "admin", "a-long-secret", now + ADMIN_SESSION_DURATION_MS), false);
  assert.equal(verifyAdminSession(`${token}tampered`, "admin", "a-long-secret", now), false);
});

test("admin credentials require string values and match configured secrets", () => {
  assert.equal(credentialsMatch("admin", "admin"), true);
  assert.equal(credentialsMatch("wrong", "admin"), false);
  assert.equal(credentialsMatch(undefined, "admin"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth.js";

test("password hashes use the Workers-safe PBKDF2 iteration budget", async () => {
  const encoded = await hashPassword("test-password-not-for-production");
  assert.match(encoded, /^PBKDF2-SHA256\$100000\$[^$]+\$[^$]+$/u);
  assert.equal(await verifyPassword("test-password-not-for-production", encoded), true);
});

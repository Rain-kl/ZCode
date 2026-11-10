import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Android signed APK is required for release and included in checksums", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /build-android:[\s\S]*:app:assembleRelease/u);
  assert.match(workflow, /needs\.build-android\.result == 'success'/u);
  assert.match(workflow, /needs\.verify\.result == 'success' && needs\.unit-tests\.result == 'success'/u);
  assert.match(workflow, /android-\*/u);
  assert.match(workflow, /-name '\*\.apk'/u);
  for (const key of ["ANDROID_KEYSTORE_BASE64", "ANDROID_STORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
    assert.ok(workflow.includes(`secrets.${key}`));
  }
});

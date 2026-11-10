import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("Android SDK setup explicitly installs the current build packages", async () => {
  const workflow = parse(await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"));
  for (const name of ["build-android", "android-tests"]) {
    const setup = workflow.jobs[name].steps.find((step) => step.uses?.startsWith("android-actions/setup-android@"));
    // SDK 仓库已移除 tools，必须覆盖 action 的默认包清单，避免在编译前失败。
    assert.equal(typeof setup?.with?.packages, "string");
    const packages = setup.with.packages.trim().split(/\s+/u);
    assert.ok(!packages.includes("tools"));
    for (const required of ["platform-tools", "platforms;android-36.1", "build-tools;36.1.0"]) {
      assert.ok(packages.includes(required), `Missing SDK package in ${name}: ${required}`);
    }
  }
});

test("Android signed APK is required for release and included in checksums", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /build-android:[\s\S]*:app:assembleRelease/u);
  assert.match(workflow, /needs\.build-android\.result == 'success'/u);
  assert.match(workflow, /needs\.android-tests\.result == 'success'/u);
  const publisher = await readFile(new URL("../../.github/workflows/publish-release.yml", import.meta.url), "utf8");
  assert.match(publisher, /android-apk/u);
  assert.doesNotMatch(publisher, /android-\*/u);
  assert.match(publisher, /-name '\*\.apk'/u);
  for (const key of ["ANDROID_KEYSTORE_BASE64", "ANDROID_STORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
    assert.ok(workflow.includes(`secrets.${key}`));
  }
});

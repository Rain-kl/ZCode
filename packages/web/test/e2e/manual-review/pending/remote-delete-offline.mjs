import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "zh-CN",
});
await context.addInitScript(() => {
  localStorage.setItem(
    "zcode:self-hosted-remote-session",
    JSON.stringify({
      token: "test",
      userInfo: { id: "owner", username: "owner", displayName: "Owner" },
    }),
  );
});
let devices = [
  {
    device_sid: "online",
    device_mid: "one",
    online: true,
    created_at: 1,
    meta: { name: "Online computer" },
  },
  {
    device_sid: "offline",
    device_mid: "two",
    online: false,
    created_at: 2,
    meta: { name: "Offline computer" },
  },
];
await context.route("**/api/v1/remote/device", async (route) =>
  route.fulfill({ json: { code: 0, msg: "", data: devices } }),
);
let rejectDelete = true;
const deleted = [];
await context.route("**/api/v1/remote/device/delete", async (route) => {
  const { device_sid } = route.request().postDataJSON();
  if (rejectDelete) {
    await route.fulfill({ status: 400, json: { code: 3005, msg: "wrong status" } });
    return;
  }
  deleted.push(device_sid);
  devices = devices.filter((device) => device.device_sid !== device_sid);
  await route.fulfill({ json: { code: 0, msg: "" } });
});
const page = await context.newPage();
try {
  await page.goto("http://127.0.0.1:5178/remote/v4");
  await page.getByRole("button", { name: /Online computer/ }).waitFor();
  await page.getByRole("button", { name: "删除离线设备" }).click();
  assert.equal(await page.getByRole("button", { name: /Online computer/ }).isDisabled(), true);
  await page.getByRole("button", { name: /Offline computer/ }).click();
  assert.equal(
    await page.getByRole("button", { name: /Offline computer/ }).getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: "/tmp/zcode-offline-delete.png", fullPage: true });
  await page.getByRole("button", { name: /删除已选/ }).click();
  await page.getByRole("alert").getByText(/3005/).waitFor();
  assert.equal(await page.getByRole("button", { name: /Offline computer/ }).count(), 1);
  rejectDelete = false;
  await page.getByRole("button", { name: /删除已选/ }).click();
  await page.getByRole("button", { name: /Offline computer/ }).waitFor({ state: "detached" });
  assert.deepEqual(deleted, ["offline"]);
  assert.equal(await page.getByRole("button", { name: /Online computer/ }).isEnabled(), true);
  console.log("offline deletion passed");
} finally {
  await browser.close();
}

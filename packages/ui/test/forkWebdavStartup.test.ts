import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WebdavConnectionForm } from "../src/fork/local-mode/WebdavConnectionForm.js";
import type { ForkWebdavController } from "../src/fork/local-mode/useForkWebdav.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

describe("WebDAV is optional at startup", () => {
  it("Root has no WebDAV first-run gate or dedicated screen, but keeps conflict handling", async () => {
    const root = await readFile(new URL("../src/Root.tsx", import.meta.url), "utf8");
    expect(root).not.toMatch(/\b(?:FirstRunWebdavScreen|useForkWebdavFirstRunGate|forkFirstRunGate)\b/);
    expect(root).toContain("<ForkWebdavConflictDialog />");
    expect(root).not.toMatch(/updateSettings\(\{\s*firstRunSkipped:/);
  });

  it("the obsolete first-run component is removed rather than hidden behind another flag", async () => {
    await expect(access(new URL("../src/fork/local-mode/FirstRunWebdavScreen.tsx", import.meta.url)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("settings still expose the sync panel and connection form", async () => {
    const settings = await readFile(new URL("../src/SettingsPage.tsx", import.meta.url), "utf8");
    const panel = await readFile(new URL("../src/fork/local-mode/ConfigSyncPanel.tsx", import.meta.url), "utf8");
    expect(settings).toContain('activeSection === "configSync"');
    expect(settings).toContain("<ConfigSyncPanel");
    expect(panel).toContain("<WebdavConnectionForm controller={controller}");
  });

  it("the settings connection form has no first-run skip action", async () => {
    const source = await readFile(new URL("../src/fork/local-mode/WebdavConnectionForm.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bonSkip\b|settings\.configSync\.firstRun/);
  });

  it("an unconfigured connection form renders without configuring or mutating sync state", () => {
    const controller: ForkWebdavController = {
      available: true, status: null, backups: [], busy: false, error: null,
      refresh: vi.fn(), testConnection: vi.fn(), configure: vi.fn(), disconnect: vi.fn(),
      updateSettings: vi.fn(), backupNow: vi.fn(), restoreBackup: vi.fn(), deleteBackup: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const html = renderToStaticMarkup(createElement(WebdavConnectionForm, { controller }));
    expect(html).toContain("settings.configSync.urlPlaceholder");
    expect(html).toContain("settings.configSync.testConnection");
    expect(html).toContain("settings.configSync.signIn");
    expect(html).not.toContain("settings.configSync.firstRun");
    expect(controller.configure).not.toHaveBeenCalled();
    expect(controller.updateSettings).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { posix, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractPrebuiltArchive,
  extractPrebuiltBinary,
  resolvePrebuiltTarInvocation,
} from "../prebuilt-binary-extract.mjs";

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("prebuilt tar invocation path contract", () => {
  it.each([
    [
      "same drive",
      "C:\\work",
      "C:\\work\\cache\\npm.tgz",
      "C:\\out",
      "C:\\work\\cache",
      "./npm.tgz",
      "C:/out",
    ],
    [
      "parent relative",
      "D:\\work\\build",
      "..\\cache\\npm.tgz",
      ".\\out",
      "D:\\work\\cache",
      "./npm.tgz",
      "D:/work/build/out",
    ],
    [
      "cross drive",
      "C:\\Temp\\npm-stage",
      "D:\\repo\\node_modules\\npm.tgz",
      "C:\\Temp\\npm-stage",
      "D:\\repo\\node_modules",
      "./npm.tgz",
      "C:/Temp/npm-stage",
    ],
    [
      "spaces",
      "C:\\build root",
      "D:\\cache root\\npm archive.tgz",
      "out root",
      "D:\\cache root",
      "./npm archive.tgz",
      "C:/build root/out root",
    ],
  ])(
    "%s never sends a Windows drive colon as the archive operand",
    (_name, cwd, archivePath, extractDir, expectedCwd, archiveArg, target) => {
      expect(resolvePrebuiltTarInvocation({ archivePath, extractDir, cwd }, win32)).toEqual({
        cwd: expectedCwd,
        args: ["-xzf", archiveArg, "-C", target],
        extractDir: win32.resolve(cwd, extractDir),
      });
    },
  );

  it("resolves relative POSIX operands before changing cwd, including a colon basename", () => {
    expect(
      resolvePrebuiltTarInvocation(
        { cwd: "/build/work", archivePath: "../cache/npm:12.tgz", extractDir: "out" },
        posix,
      ),
    ).toEqual({
      cwd: "/build/cache",
      args: ["-xzf", "./npm:12.tgz", "-C", "/build/work/out"],
      extractDir: "/build/work/out",
    });
  });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "zcode-extract-contract-"));
  temporaryRoots.push(root);
  for (const dir of ["source", "cache root", "work"]) mkdirSync(path.join(root, dir));
  writeFileSync(path.join(root, "source", "binary"), "verified binary");
  const archivePath = path.join(root, "cache root", "binary.tgz");
  execFileSync("tar", ["-czf", "./binary.tgz", "-C", path.join(root, "source"), "binary"], {
    cwd: path.dirname(archivePath),
  });
  return { root, archivePath, cwd: path.join(root, "work") };
}

it("extracts an actual archive with caller-relative archive and target paths", () => {
  const { root, archivePath, cwd } = fixture();
  extractPrebuiltArchive({
    archivePath: path.relative(cwd, archivePath),
    archiveExt: "tgz",
    extractDir: "output",
    cwd,
  });
  expect(readFileSync(path.join(root, "work", "output", "binary"), "utf8")).toBe("verified binary");
});

it("propagates the original tar failure instead of returning a successful extraction", () => {
  const { archivePath, cwd } = fixture();
  writeFileSync(archivePath, "not an archive");
  expect(() =>
    extractPrebuiltArchive({
      archivePath,
      archiveExt: "tgz",
      extractDir: path.join(cwd, "out"),
      cwd,
    }),
  ).toThrow(/tar .*failed with code/);
});

it("rejects integrity mismatch before creating or replacing the output binary", async () => {
  const { root, archivePath, cwd } = fixture();
  const binaryPath = path.join(root, "installed", "binary");
  await expect(
    extractPrebuiltBinary({
      archiveExt: "tgz",
      archivePath,
      archiveSha256: "0".repeat(64),
      binaryName: "binary",
      binaryPath,
      cwd,
      targetPlatform: process.platform,
    }),
  ).rejects.toThrow(/SHA-256 mismatch/);
  expect(existsSync(binaryPath)).toBe(false);
  expect(createHash("sha256").update(readFileSync(archivePath)).digest("hex")).not.toBe(
    "0".repeat(64),
  );
});

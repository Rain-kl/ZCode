// 由各 bundler 通过 define 注入，避免运行时 JSON import 的跨 bundler 兼容问题。
// 非构建环境（如 e2e 测试的 mocha）下 define 不存在，
// 用 typeof 检查 + fallback 避免 ReferenceError。
declare const __ZCODE_VERSION__: string;
declare const __ZCODE_COMMIT__: string;
declare const __ZCODE_BUILD_TIME__: string;

export const ZCODE_VERSION: string =
  typeof __ZCODE_VERSION__ !== "undefined" ? __ZCODE_VERSION__ : "0.0.0-dev";
export const ZCODE_COMMIT: string =
  typeof __ZCODE_COMMIT__ !== "undefined" ? __ZCODE_COMMIT__ : "unknown";
export const ZCODE_BUILD_TIME: string =
  typeof __ZCODE_BUILD_TIME__ !== "undefined" ? __ZCODE_BUILD_TIME__ : "unknown";

// FORK-BEGIN(local-mode)
// 上游的新版本消费者不能依赖已移除的强制更新模块，仅保留纯版本比较。
interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = version.trim().replace(/^v/i, "");

  // 远端版本允许主版本号或主次版本号；保持上游比较器的简写补齐规则。
  const strictMatch = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (strictMatch) {
    return {
      major: Number(strictMatch[1]!),
      minor: Number(strictMatch[2]!),
      patch: Number(strictMatch[3]!),
      prerelease: strictMatch[4]?.split(".") ?? [],
    };
  }

  // 补全：只有主版本号（"45" → "45.0.0"）
  const majorOnly = normalized.match(/^(\d+)$/);
  if (majorOnly) {
    return {
      major: Number(majorOnly[1]!),
      minor: 0,
      patch: 0,
      prerelease: [],
    };
  }

  // 补全：主版本号.次版本号（"4.5" → "4.5.0"）
  const majorMinor = normalized.match(/^(\d+)\.(\d+)$/);
  if (majorMinor) {
    return {
      major: Number(majorMinor[1]!),
      minor: Number(majorMinor[2]!),
      patch: 0,
      prerelease: [],
    };
  }

  return null;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const delta = Number(leftPart) - Number(rightPart);
      if (delta !== 0) {
        return delta > 0 ? 1 : -1;
      }
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    const delta = leftPart.localeCompare(rightPart);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

export function compareSemverVersions(leftVersion: string, rightVersion: string): number | null {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return null;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}
// FORK-END(local-mode)

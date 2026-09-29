/**
 * 系统指令（fork）：用户自定义提示词的文件契约与模板常量。
 *
 * 三方共用：agent 侧（@zcode/core 的 fork 模块读盘）、宿主侧服务（写盘）、渲染层（编辑）。
 * 放这里而不是各写一份，是因为 id 规则、目录名、状态文件形态任何一处漂移，症状都是
 * 「UI 看得见、agent 读不到」。见 FEATURES.md 的 identity-preset 条目与
 * docs/features/identity-preset/design.md 第 5、8 节。
 */

export const FORK_IDENTITY_PRESET_CHANNEL = "fork-identity-preset";

/** 预设根目录名，相对 CLI storage root；与 `agents/`、`skills/`、`commands/` 同级，不用 `cli/` 后缀。 */
export const FORK_IDENTITY_PRESET_ROOT_NAME = "presets";
export const FORK_IDENTITY_PRESET_PROFILES_DIRNAME = "profiles";
export const FORK_IDENTITY_PRESET_STATE_FILENAME = "active.json";
export const FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION = 1;

/**
 * 配置文件名 = `<id>` + 本后缀。放契约里而不是各调用点写字面量：目录名、id 规则、
 * 后缀三者任何一处漂移，都会变成「UI 写得进、agent 读不到」。
 */
export const FORK_IDENTITY_PRESET_PROFILE_EXTENSION = ".md";

/** 配置 id 与文件名 1:1；字符集收窄即可杜绝路径穿越，不需要额外的路径校验。 */
export const FORK_IDENTITY_PRESET_ID_PATTERN = /^[a-z0-9-]{1,50}$/;
export const FORK_IDENTITY_PRESET_NAME_MAX_LENGTH = 50;

/** 正文长度上限：正文逐字进入每次模型请求，写入方必须在此之前拒绝，不能让宿主无限膨胀请求体。 */
export const FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH = 200_000;

/**
 * Windows 保留设备名。`nul`、`con` 这类名字（含带扩展名的 `nul.md`）在 Windows 上无法创建，
 * 但它们的 id 完全合法，派生函数也照给。所以分配 id 时就要避开：等写盘失败再报 EPERM，
 * 用户看到的是一个没有上下文、也没有补救动作的报错。
 */
const FORK_IDENTITY_PRESET_RESERVED_STEMS: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function isForkIdentityPresetReservedStem(value: string): boolean {
  return FORK_IDENTITY_PRESET_RESERVED_STEMS.has(value.toLowerCase());
}

export type ForkIdentityPresetTemplateId = "default" | "skeleton";

export interface ForkIdentityPresetSummary {
  id: string;
  name: string;
}

export interface ForkIdentityPresetProfile {
  id: string;
  name: string;
  content: string;
}

export interface ForkIdentityPresetState {
  enabled: boolean;
  activeId: string | null;
  /**
   * 是否注入「动态段」（# Environment、gitStatus、沟通风格、会话指导、上下文管理等）。
   * 关闭后系统提示词只剩身份段与 Desktop Context——适合完全自己写提示词的人。
   */
  injectDynamic: boolean;
  /** enabled 为真但 activeId 指向不存在的配置；UI 据此提示「已回退系统默认」。 */
  activeMissing: boolean;
  /** 预设根目录绝对路径，便于用户排查「文件到底在哪」。 */
  root: string;
  profiles: ForkIdentityPresetSummary[];
}

export interface ForkIdentityPresetStateFile {
  schemaVersion: number;
  enabled: boolean;
  activeId: string | null;
  /** 缺省视为注入：旧状态文件没有这个字段，不能因此被判成「不认识」。 */
  injectDynamic: boolean;
}

export function isValidForkIdentityPresetId(value: string): boolean {
  return FORK_IDENTITY_PRESET_ID_PATTERN.test(value);
}

export function normalizeForkIdentityPresetName(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > FORK_IDENTITY_PRESET_NAME_MAX_LENGTH) {
    return null;
  }
  return normalized;
}

/**
 * 非 ASCII 名的区分后缀：31 进制滚动哈希取 32 位无符号，再转 base36。
 * 只需要「同一名字稳定、不同名字大概率不同」，不需要抗碰撞，故不上 crypto。
 */
function hashForkIdentityPresetName(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 从展示名派生文件名 stem：纯 ASCII 名直接 slug 化，其余一律追加名称 hash 后缀。
 *
 * 「其余」有两类，都必须带后缀才能保住「一个名字一个文件」：
 * - 含非 ASCII 字符的名，slug 化会吃掉区分度（中文被替换成连字符后往往只剩共同后缀，
 *   「极简Style」与「完整Style」都会得到 `style`）；
 * - slug 化后为空的名（`"!!!"`、`"---"`、纯中文），不加后缀就只能拿到空串或共用的前缀。
 * 文件名 stem 就是 id，撞名或空 id 都会让配置落到同一个 `profiles/<id>.md`。
 * 纯 ASCII 且 slug 可用时反过来要保持干净可读（重命名文件会引发同步抖动，人得看得懂文件名）。
 */
export function createForkIdentityPresetId(name: string): string {
  const trimmed = name.trim();
  // 全空白名在 UI 侧已被 normalizeForkIdentityPresetName 拒绝，能走到这里说明是「名字还没填」的中间态：
  // 用固定的 `preset` 而不是对空白字符求 hash，避免同一份空名因空格个数不同派生出不同文件名。
  if (trimmed.length === 0) {
    return "preset";
  }
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hasNonAscii = [...trimmed].some((char) => char.codePointAt(0)! > 0x7f);
  // slug 为空也必须落到 hash 分支：`"!!!"`、`"---"` 这类纯符号名能通过名称校验，若在此返回空串，
  // 派生出的 id 非法（`profiles/.md`），且所有纯符号名会塌成同一个 id。
  if (!hasNonAscii && ascii.length > 0) {
    return ascii.slice(0, 50);
  }
  const suffix = hashForkIdentityPresetName(trimmed);
  // 截断到「50 - 分隔符 - hash」是为了让长名加后缀后仍满足 FORK_IDENTITY_PRESET_ID_PATTERN，
  // 否则派生出的 id 会被 isValidForkIdentityPresetId 判为非法。
  const stem = (ascii.length > 0 ? ascii : "preset")
    .slice(0, 50 - 1 - suffix.length)
    .replace(/-+$/g, "");
  return `${stem}-${suffix}`;
}

/**
 * 状态文件解析：缺失、类型不符、schemaVersion 不认识、activeId 非法——全部降级为「关闭」。
 * 调用方不得据此覆写文件，避免一次读取失败把用户配置抹掉。
 */
export function parseForkIdentityPresetStateFile(raw: unknown): ForkIdentityPresetStateFile {
  const fallback: ForkIdentityPresetStateFile = {
    schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
    enabled: false,
    activeId: null,
    injectDynamic: true,
  };
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION) return fallback;
  if (typeof record.enabled !== "boolean") return fallback;
  const injectDynamic = typeof record.injectDynamic === "boolean" ? record.injectDynamic : true;
  const activeId = record.activeId;
  if (activeId === null || activeId === undefined) {
    return { ...fallback, enabled: record.enabled, injectDynamic };
  }
  if (typeof activeId !== "string" || !isValidForkIdentityPresetId(activeId)) {
    return { ...fallback, enabled: record.enabled, injectDynamic };
  }
  return {
    schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
    enabled: record.enabled,
    activeId,
    injectDynamic,
  };
}

/** 与 core 的 `context/sections/identity.ts` 的 SECURITY_NOTICE 逐字一致。 */
export const FORK_IDENTITY_PRESET_SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

/** 与 core 的 `context/sections/identity.ts` 的 buildHarnessBlock() 逐字一致。 */
export const FORK_IDENTITY_PRESET_HARNESS_BLOCK = [
  "# Harness",
  "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
  "- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.",
  "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
  "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
  "- Reference code as `file_path:line_number` — it's clickable.",
].join("\n");

/**
 * 「默认」模板 = 当前系统身份段原文（cli_prefix + identity）。
 * 与 core 是镜像关系（宿主进程无法 import @zcode/core），由
 * apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts 的一致性断言固定。
 */
export const FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE = [
  "You are ZCode, an interactive coding agent",
  "",
  "You are an interactive ZCode agent that helps users with software engineering tasks.",
  "",
  FORK_IDENTITY_PRESET_SECURITY_NOTICE,
  "",
  FORK_IDENTITY_PRESET_HARNESS_BLOCK,
].join("\n");

/** 「基础框架」模板：给组织结构，不给现成人格；不含 # Harness（选了自定义身份即不再收到这些约束）。 */
export const FORK_IDENTITY_PRESET_SKELETON_TEMPLATE = [
  "# 角色",
  "",
  "（你是谁、面向谁。例如：一名严格的代码审查者。）",
  "",
  "# 沟通风格",
  "",
  "（语气、长度、格式偏好。例如：先给结论再给依据，不写总结性套话。）",
  "",
  "# 工作方式",
  "",
  "（动手前是否确认、如何汇报进展、遇到不确定时怎么办。）",
  "",
  "# 边界",
  "",
  "（不要做什么。）",
  "",
  FORK_IDENTITY_PRESET_SECURITY_NOTICE,
].join("\n");

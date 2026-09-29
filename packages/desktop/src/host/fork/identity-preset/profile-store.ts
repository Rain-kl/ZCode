/**
 * 系统指令（fork）：宿主侧配置存储与 id 分配。
 *
 * 宿主是 `~/.zcode/presets/` 的唯一写入方，agent 侧只读（第 1 期的 file-port）。
 * 这里产出的文本必须与 agent 的解析规则完全一致，否则表现是「UI 写得进、agent 读不到」；
 * 同理 active.json 必须写成 agent 认得的形态（`schemaVersion` 不认识会让它每次启动都告警）。
 * 见 FEATURES.md 的 identity-preset 条目与 docs/features/identity-preset/design.md 第 5 节。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH,
  FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE,
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
  FORK_IDENTITY_PRESET_PROFILES_DIRNAME,
  FORK_IDENTITY_PRESET_SKELETON_TEMPLATE,
  FORK_IDENTITY_PRESET_STATE_FILENAME,
  FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
  createForkIdentityPresetId,
  isForkIdentityPresetReservedStem,
  isValidForkIdentityPresetId,
  normalizeForkIdentityPresetName,
  type ForkIdentityPresetProfile,
  type ForkIdentityPresetStateFile,
  type ForkIdentityPresetSummary,
  type ForkIdentityPresetTemplateId,
} from "@zcode/shared";

/** 写入失败的统一形态：消息面向用户（含文件名与原因），不把原始 errno 直接抛给界面。 */
export class IdentityPresetStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IdentityPresetStoreError";
  }
}

export interface IdentityPresetStore {
  readonly root: string;
  list(): Promise<ForkIdentityPresetSummary[]>;
  read(id: string): Promise<ForkIdentityPresetProfile>;
  readState(): Promise<ForkIdentityPresetStateFile>;
  /** 分配空闲 id 后写入；返回新 id。绝不覆盖已有配置。 */
  create(input: { name: string; template: ForkIdentityPresetTemplateId }): Promise<{ id: string }>;
  save(input: { id: string; name: string; content: string }): Promise<void>;
  remove(id: string): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  /** 是否注入动态段；功能级开关，不随预设切换而变。 */
  setInjectDynamic(injectDynamic: boolean): Promise<void>;
  /** 是否注入 skills 清单。 */
  setInjectSkills(injectSkills: boolean): Promise<void>;
  activate(id: string | null): Promise<void>;
}

const FRONTMATTER_PATTERN = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/;
const NAME_LINE_PATTERN = /^name:[ \t]*(.*)$/m;
const MAX_ID_ALLOCATION_ATTEMPTS = 200;

export function createFileIdentityPresetStore(input: { root: string }): IdentityPresetStore {
  const root = input.root;
  const profilesDir = join(root, FORK_IDENTITY_PRESET_PROFILES_DIRNAME);
  const statePath = join(root, FORK_IDENTITY_PRESET_STATE_FILENAME);

  const profilePath = (id: string): string =>
    join(profilesDir, `${id}${FORK_IDENTITY_PRESET_PROFILE_EXTENSION}`);

  return {
    root,

    async list() {
      let fileNames: string[];
      try {
        fileNames = await readdir(profilesDir);
      } catch {
        // 目录不存在 = 还没有任何配置；这是首次使用的正常状态，不是故障。
        return [];
      }
      const summaries: ForkIdentityPresetSummary[] = [];
      for (const fileName of fileNames) {
        if (!fileName.endsWith(FORK_IDENTITY_PRESET_PROFILE_EXTENSION)) continue;
        const id = fileName.slice(0, -FORK_IDENTITY_PRESET_PROFILE_EXTENSION.length);
        if (!isValidForkIdentityPresetId(id)) continue;
        const parsed = parseProfileFile((await readTextIfExists(profilePath(id))) ?? "");
        summaries.push({ id, name: parsed?.name ?? id });
      }
      return summaries.sort((left, right) => left.id.localeCompare(right.id));
    },

    async read(id) {
      assertValidId(id);
      const text = await readTextIfExists(profilePath(id));
      if (text === undefined) {
        throw new IdentityPresetStoreError(`配置 ${id} 不存在`);
      }
      const parsed = parseProfileFile(text);
      return { id, name: parsed?.name ?? id, content: parsed?.content ?? "" };
    },

    async readState() {
      return readStateFile(statePath);
    },

    async create({ name, template }) {
      const normalizedName = requireValidName(name);
      const id = await allocateId(profilesDir, normalizedName);
      const content =
        template === "skeleton"
          ? FORK_IDENTITY_PRESET_SKELETON_TEMPLATE
          : FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE;
      await writeTextAtomic(profilePath(id), serializeProfileFile(normalizedName, content));
      return { id };
    },

    async save({ id, name, content }) {
      assertValidId(id);
      const normalizedName = requireValidName(name);
      assertContentWithinLimit(content);
      await writeTextAtomic(profilePath(id), serializeProfileFile(normalizedName, content));
    },

    async remove(id) {
      assertValidId(id);
      await rm(profilePath(id), { force: true });
      // 删掉正在激活的配置后必须把 activeId 置空，否则 agent 每次启动都会为「激活项不存在」告警。
      const state = await readStateFile(statePath);
      if (state.activeId === id) {
        await writeStateFile(statePath, { ...state, activeId: null });
      }
    },

    async setEnabled(enabled) {
      const state = await readStateFile(statePath);
      await writeStateFile(statePath, { ...state, enabled });
    },

    async setInjectDynamic(injectDynamic) {
      const state = await readStateFile(statePath);
      await writeStateFile(statePath, { ...state, injectDynamic });
    },

    async setInjectSkills(injectSkills) {
      const state = await readStateFile(statePath);
      await writeStateFile(statePath, { ...state, injectSkills });
    },

    async activate(id) {
      if (id !== null) assertValidId(id);
      const state = await readStateFile(statePath);
      await writeStateFile(statePath, { ...state, activeId: id });
    },
  };
}

/**
 * 分配空闲 id。派生函数保证「同一名字同一 id」，但不同名字可能撞名
 * （`"a b"` 与 `"a-b"` 都得 `a-b`），也可能落到 Windows 保留设备名上（`nul`）。
 * 撞名时静默覆盖等于数据丢失，所以这里退让成 `-2`、`-3`，而不是复用已有文件。
 */
async function allocateId(profilesDir: string, name: string): Promise<string> {
  const base = createForkIdentityPresetId(name);
  const taken = new Set<string>();
  try {
    for (const fileName of await readdir(profilesDir)) {
      if (fileName.endsWith(FORK_IDENTITY_PRESET_PROFILE_EXTENSION)) {
        taken.add(fileName.slice(0, -FORK_IDENTITY_PRESET_PROFILE_EXTENSION.length));
      }
    }
  } catch {
    // 目录不存在：下面 mkdir 会创建，此时没有任何已占用 id。
  }
  const isFree = (candidate: string): boolean =>
    !taken.has(candidate) &&
    !isForkIdentityPresetReservedStem(candidate) &&
    isValidForkIdentityPresetId(candidate);
  if (isFree(base)) return base;
  for (let index = 2; index <= MAX_ID_ALLOCATION_ATTEMPTS; index++) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 50 - suffix.length)}${suffix}`;
    if (isFree(candidate)) return candidate;
  }
  throw new IdentityPresetStoreError(`名称「${name}」已占用过多同名配置，请换一个名称`);
}

function requireValidName(name: string): string {
  const normalized = normalizeForkIdentityPresetName(name);
  if (normalized === null) {
    throw new IdentityPresetStoreError("名称不能为空，且不超过 50 个字符");
  }
  return normalized;
}

function assertContentWithinLimit(content: string): void {
  if (content.length > FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH) {
    throw new IdentityPresetStoreError(
      `正文超过上限 ${FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH} 字符，请精简后再保存`,
    );
  }
}

function assertValidId(id: string): void {
  if (!isValidForkIdentityPresetId(id)) {
    throw new IdentityPresetStoreError(`非法配置 id：${id}`);
  }
}

/** 与 agent 侧 profile-file.ts 的解析规则同构；宿主不能 import @zcode/core，所以是刻意的镜像。 */
function parseProfileFile(text: string): { name: string; content: string } | undefined {
  if (text.length === 0) return undefined;
  const match = FRONTMATTER_PATTERN.exec(text);
  const body = (match ? text.slice(match[0].length) : text).trim();
  const rawName = match ? NAME_LINE_PATTERN.exec(match[1] ?? "")?.[1] : undefined;
  const name = rawName?.trim().replace(/^"(.*)"$/, "$1") ?? "";
  const normalized = normalizeForkIdentityPresetName(name);
  return normalized ? { name: normalized, content: body } : undefined;
}

/** 与 agent 侧 serializeIdentityPresetFile 逐字一致（含结尾换行）。 */
function serializeProfileFile(name: string, content: string): string {
  return `---\nname: ${name}\n---\n\n${content}\n`;
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readStateFile(statePath: string): Promise<ForkIdentityPresetStateFile> {
  const fallback: ForkIdentityPresetStateFile = {
    schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
    enabled: false,
    activeId: null,
    injectDynamic: true,
    injectSkills: true,
  };
  const text = await readTextIfExists(statePath);
  if (text === undefined) return fallback;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw.schemaVersion !== FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION) return fallback;
    if (typeof raw.enabled !== "boolean") return fallback;
    const activeId =
      typeof raw.activeId === "string" && isValidForkIdentityPresetId(raw.activeId)
        ? raw.activeId
        : null;
    const injectDynamic = typeof raw.injectDynamic === "boolean" ? raw.injectDynamic : true;
    const injectSkills = typeof raw.injectSkills === "boolean" ? raw.injectSkills : true;
    return {
      schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
      enabled: raw.enabled,
      activeId,
      injectDynamic,
      injectSkills,
    };
  } catch {
    // 用户手改坏了 active.json：按「未启用」继续，绝不覆写——覆写会把他的配置一次抹掉。
    return fallback;
  }
}

async function writeStateFile(
  statePath: string,
  state: ForkIdentityPresetStateFile,
): Promise<void> {
  await writeTextAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * 原子写：先写同目录临时文件再 rename。半写的 active.json 会让 agent 每次会话启动都告警，
 * 而读取侧无法区分「写了一半」与「用户改坏了」。
 */
async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, text, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    throw new IdentityPresetStoreError(`写入 ${filePath} 失败，请检查该目录是否可写`, {
      cause: error,
    });
  }
}

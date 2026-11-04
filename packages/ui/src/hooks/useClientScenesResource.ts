import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ClientSceneConfig, IClientScenesService } from "@zcode/services";
import { createClientScenesVisibilityRecovery } from "@/hooks/clientScenesVisibilityRecovery.js";

const CLIENT_SCENES_RESOURCE_KEY = "client-scenes";
export const CLIENT_SCENES_DEDUPING_INTERVAL_MS = 10 * 60 * 1000;

const EMPTY_SCENES: ClientSceneConfig[] = [];
const serviceAuthorityIds = new WeakMap<IClientScenesService, number>();
let nextServiceAuthorityId = 1;
// FORK(cloud-web-access): 前台恢复按场景分桶，与实际资源缓存保持同一边界。
const visibilityAuthorities = new WeakMap<
  IClientScenesService,
  WeakMap<object, Map<string | undefined, object>>
>();
let visibilityRecovery: ReturnType<typeof createClientScenesVisibilityRecovery> | null = null;

function getServiceAuthorityId(service: IClientScenesService): number {
  const existing = serviceAuthorityIds.get(service);
  if (existing !== undefined) return existing;
  const next = nextServiceAuthorityId;
  nextServiceAuthorityId += 1;
  serviceAuthorityIds.set(service, next);
  return next;
}

// FORK-BEGIN(cloud-web-access)
function getVisibilityAuthority(
  service: IClientScenesService,
  cache: object,
  scene?: string,
): object {
  let cacheAuthorities = visibilityAuthorities.get(service);
  if (!cacheAuthorities) {
    cacheAuthorities = new WeakMap<object, Map<string | undefined, object>>();
    visibilityAuthorities.set(service, cacheAuthorities);
  }
  let scopes = cacheAuthorities.get(cache);
  if (!scopes) {
    scopes = new Map();
    cacheAuthorities.set(cache, scopes);
  }
  const existing = scopes.get(scene);
  if (existing) return existing;
  const authority = {};
  scopes.set(scene, authority);
  return authority;
}
// FORK-END(cloud-web-access)

function getClientScenesVisibilityRecovery() {
  if (typeof document === "undefined") return null;
  visibilityRecovery ??= createClientScenesVisibilityRecovery(document);
  return visibilityRecovery;
}

export class ClientScenesBusinessError extends Error {
  readonly code: number;
  readonly responseMessage: string;

  constructor(code: number, responseMessage: string) {
    super(`Client Scenes returned business error ${code}: ${responseMessage}`);
    this.name = "ClientScenesBusinessError";
    this.code = code;
    this.responseMessage = responseMessage;
  }
}

export function isClientScenesBusinessError(error: unknown): error is ClientScenesBusinessError {
  return error instanceof ClientScenesBusinessError;
}

interface UseClientScenesResourceOptions {
  enabled?: boolean;
  // FORK(cloud-web-access): 草稿推荐与完整目录拥有独立资源键。
  scene?: string;
}

export function useClientScenesResource(
  clientScenesService: IClientScenesService,
  options: UseClientScenesResourceOptions = {},
) {
  const enabled = options.enabled ?? true;
  const authorityId = getServiceAuthorityId(clientScenesService);
  const { cache } = useSWRConfig();
  // FORK(cloud-web-access): 相同服务的不同场景不能共用可见性重验回调。
  const visibilityAuthority = getVisibilityAuthority(
    clientScenesService,
    cache as object,
    options.scene,
  );
  const resource = useSWR<ClientSceneConfig[], Error>(
    // FORK(cloud-web-access): 场景投影按服务和选择条件隔离。
    enabled ? [CLIENT_SCENES_RESOURCE_KEY, authorityId, options.scene ?? null] : null,
    async () => {
      // FORK(cloud-web-access): 只让目标场景进入 RPC 响应，完整目录继续使用无参数入口。
      const response = options.scene
        ? await clientScenesService.list({ scene: options.scene })
        : await clientScenesService.list();
      if (response.code !== 0) {
        throw new ClientScenesBusinessError(response.code, response.msg);
      }
      return response.data;
    },
    {
      dedupingInterval: CLIENT_SCENES_DEDUPING_INTERVAL_MS,
      focusThrottleInterval: CLIENT_SCENES_DEDUPING_INTERVAL_MS,
      keepPreviousData: false,
      refreshInterval: 0,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (!enabled) return;
    // macOS 点击关闭只 hide BrowserWindow，renderer 与 SWR 缓存不会销毁；
    // 重新 show 时若仍在去重窗口内，内建 focus revalidate 会继续复用旧 Scene。
    // hidden -> visible 必须绕过去重窗口强制重验，同时按 Service/cache authority 合并并发消费方。
    return getClientScenesVisibilityRecovery()?.subscribe(visibilityAuthority, () => {
      void resource.mutate().catch(() => undefined);
    });
  }, [enabled, resource.mutate, visibilityAuthority]);

  return {
    scenes: resource.data ?? EMPTY_SCENES,
    loading: enabled && resource.data === undefined && resource.isLoading,
    revalidating: resource.isValidating,
    error: resource.error,
    revalidate: resource.mutate,
  };
}

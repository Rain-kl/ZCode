import type { ApiClient } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { ZCODE_CLIENT_SCENES_URL } from "../providers/api/apiEndpoints.js";
import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

export function createClientScenesService(dependencies: {
  apiClient: ApiClient;
}): IClientScenesService {
  return {
    // FORK-BEGIN(cloud-web-access)
    list: async (params) => {
      const response = await readApiJson<ClientScenesResponse>(
        dependencies.apiClient,
        ZCODE_CLIENT_SCENES_URL,
        {
          method: "GET",
        },
      );
      // 原因：草稿页只消费一个场景，却下载了完整目录；在服务边界筛选以节省 Relay 带宽。
      return params && response.code === 0
        ? { ...response, data: response.data.filter((scene) => scene.scene === params.scene) }
        : response;
    },
    // FORK-END(cloud-web-access)
  };
}

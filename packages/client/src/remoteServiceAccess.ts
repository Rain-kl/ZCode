import { Event, ProxyChannel, type IChannel, type IChannelClient } from "@zcode/rpc";
import { IGenUiService, type IChannelAvailability } from "@zcode/services";
import { isChannelAvailable } from "./channelManifest.js";
// FORK(local-mode): WebDAV 服务通道名
import {
  FORK_IDENTITY_PRESET_CHANNEL,
  FORK_TOOL_MODE_CHANNEL,
  FORK_WEBDAV_CHANNEL,
} from "@zcode/shared";
// FORK(search-providers): 网络搜索渠道服务通道名；见 FEATURES.md 的 search-providers 条目
import { FORK_SEARCH_PROVIDERS_CHANNEL } from "@zcode/shared";
import {
  IFileService,
  IMediaPreviewService,
  IGitService,
  IGitCheckpointService,
  ISystemService,
  ITerminalService,
  ISettingService,
  IOnboardingRecordService,
  ICredentialService,
  IBroadcastService,
  IZCodeTaskService,
  IZCodeAgentService,
  IZCodeSessionService,
  IProjectService,
  ITaskGroupService,
  IRemoteProjectService,
  ICuaPermissionService,
  IConversationShareService,
  IBotsService,
  IFileWatcherService,
  IOAuthService,
  IModelSelectionService,
  IProviderSettingsService,
  IProviderProvisioningTargetService,
  ISourceServerWorkspaceService,
  ISourceServerManagementService,
  IUsageStatsService,
  ICodingPlanSubscriptionService,
  IClientConfigService,
  IClientScenesService,
  ICloudContentService,
  IMarketingTouchService,
  IOffPeakTaskService,
  IHighspeedCardService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginUiAppToolsService,
  IPluginUiSamplingService,
  IPluginUiBridgeService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ISubagentsService,
  ICommandsService,
  IHooksService,
  IMemoryService,
  IOutputStyleService,
  ISettingsSyncService,
  IFeedbackService,
  IPromptAttachmentTransferService,
  IWindowControllerService,
  // FORK(local-mode): WebDAV 备份恢复服务面；见 FEATURES.md 的 local-mode 条目
  IForkWebdavService,
  // FORK(identity-preset): 系统指令配置服务面
  IForkIdentityPresetService,
  // FORK(tool-modes): 功能组服务面
  IForkToolModeService,
  // FORK(search-providers): 网络搜索渠道管理服务面；见 FEATURES.md 的 search-providers 条目
  IForkSearchProvidersService,
  IWindowProjectService,
  IWindowRemoteProjectService,
  IWindowProjectChangesService,
  type WindowProjectDirectoryServices,
  type IServiceAccessor,
} from "@zcode/services";

/** FORK(rpc-channel-manifest): 需要按通道清单判定的可选服务成员名。 */
type ManifestGatedServiceKey =
  | "mediaPreviewService"
  | "onboardingRecordService"
  | "windowControllerService"
  | "cuaPermissionService"
  | "forkWebdavService"
  | "forkIdentityPresetService"
  // FORK(tool-modes): 功能组（工具模式）
  | "forkToolModeService"
  | "forkSearchProvidersService";

/**
 * RemoteServiceAccess — 通过 ChannelClient 自动创建类型安全的服务代理
 *
 * 新增服务只需在此添加一个 getter。
 *
 * FORK(rpc-channel-manifest): `IServiceAccessor` 上可选的成员（各 host 未必注册的通道）改为
 * 按服务端 Initialize 声明的通道清单惰性解析：清单里没有的通道置为 undefined，让 UI 立即显示
 * 「当前环境不支持」，而不是先建一个惰性代理、等到调用时才超时。清单未知（旧服务端 / Initialize
 * 未到达）时保持历史行为（照旧建代理），保证向前兼容。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目与 docs/features/rpc-channel-manifest/design.md。
 */
export class RemoteServiceAccess implements IServiceAccessor {
  readonly windowProjectDirectory?: WindowProjectDirectoryServices;
  readonly fileService: IFileService;
  // FORK(rpc-channel-manifest): 下面这些成员在 IServiceAccessor 上是可选的（各 host 未必注册），
  // 因此由构造里的 defineManifestGatedService 按通道清单惰性解析；清单里没有该通道时读作 undefined。
  readonly mediaPreviewService?: IMediaPreviewService;
  readonly gitService: IGitService;
  readonly gitCheckpointService: IGitCheckpointService;
  readonly systemService: ISystemService;
  readonly terminalService: ITerminalService;
  readonly settingService: ISettingService;
  readonly onboardingRecordService?: IOnboardingRecordService;
  readonly credentialService: ICredentialService;
  readonly broadcastService: IBroadcastService;
  readonly zcodeTaskService: IZCodeTaskService;
  readonly windowControllerService?: IWindowControllerService;
  readonly zcodeAgentService: IZCodeAgentService;
  readonly zcodeSessionService: IZCodeSessionService;
  readonly taskGroupService: ITaskGroupService;
  readonly projectService: IProjectService;
  readonly remoteProjectService: IRemoteProjectService;
  // cuaPermissionService 在 IServiceAccessor 上是可选（远端/bots host 不提供），但桌面 renderer
  // 经 RPC 一定能拿到（main host 始终注册此 descriptor；非 macOS / 未启用时方法返回 available:false）。
  readonly cuaPermissionService?: ICuaPermissionService;
  readonly conversationShareService: IConversationShareService;
  readonly botsService: IBotsService;
  readonly fileWatcherService: IFileWatcherService;
  readonly oauthService: IOAuthService;
  readonly providerSettingsService: IProviderSettingsService;
  readonly modelSelectionService: IModelSelectionService;
  /** Host-only target proxy；不属于 IServiceAccessor，避免向 Renderer 暴露 Secret 写入接口。 */
  readonly providerProvisioningTargetService!: IProviderProvisioningTargetService;
  readonly sourceServerWorkspaceService: ISourceServerWorkspaceService;
  /** 仅 desktop base attachment 注册；其他 scope 必须按可选能力消费。 */
  readonly sourceServerManagementService?: ISourceServerManagementService;
  readonly usageStatsService: IUsageStatsService;
  readonly codingPlanSubscriptionService: ICodingPlanSubscriptionService;
  readonly clientConfigService: IClientConfigService;
  readonly clientScenesService: IClientScenesService;
  readonly cloudContentService: ICloudContentService;
  readonly marketingTouchService: IMarketingTouchService;
  readonly offPeakTaskService: IOffPeakTaskService;
  readonly highspeedCardService: IHighspeedCardService;
  readonly skillsService: ISkillsService;
  readonly skillSyncService: ISkillSyncService;
  readonly mcpSyncService: IMcpSyncService;
  readonly genUiService: IGenUiService;
  readonly pluginUiBridgeService: IPluginUiBridgeService;
  readonly pluginUiSamplingService: IPluginUiSamplingService;
  readonly pluginUiAppToolsService: IPluginUiAppToolsService;
  readonly pluginSyncService: IPluginSyncService;
  readonly pluginsService: IPluginsService;
  readonly pluginManagementService: IPluginManagementService;
  readonly subagentsService: ISubagentsService;
  readonly commandsService: ICommandsService;
  readonly hooksService: IHooksService;
  readonly memoryService: IMemoryService;
  readonly outputStyleService: IOutputStyleService;
  readonly settingsSyncService: ISettingsSyncService;
  /** FORK(local-mode): WebDAV 备份恢复（host 未注册时为 undefined）。 */
  readonly forkWebdavService?: IForkWebdavService;
  /** FORK(identity-preset): 系统指令配置（host 未注册时为 undefined）。 */
  readonly forkIdentityPresetService?: IForkIdentityPresetService;
  /** FORK(tool-modes): 功能组（工具模式）。 */
  readonly forkToolModeService?: IForkToolModeService;
  /** FORK(search-providers): 网络搜索渠道（host 未注册时为 undefined）。 */
  readonly forkSearchProvidersService?: IForkSearchProvidersService;
  readonly feedbackService: IFeedbackService;
  readonly promptAttachmentTransferService: IPromptAttachmentTransferService;
  /** FORK(rpc-channel-manifest): UI 判定可选服务可用性的唯一入口；见 FEATURES.md 的 rpc-channel-manifest 条目。 */
  readonly channelAvailability: IChannelAvailability;
  /** FORK(rpc-channel-manifest): 按清单引用缓存的可选服务代理，保证同一清单下成员标识稳定。 */
  private readonly manifestGatedCache = new Map<
    ManifestGatedServiceKey,
    { manifest: readonly string[] | undefined; service: unknown }
  >();

  constructor(
    private channelClient: IChannelClient,
    options: { sourceServerManagementService?: boolean; windowProjectDirectory?: boolean } = {},
  ) {
    // 远端工作区的 project 必须保留 Source 语义；只有显式能力才创建完整窗口目录组。
    if (options.windowProjectDirectory) {
      this.windowProjectDirectory = {
        projectService: ProxyChannel.toService(
          channelClient.getChannel(IWindowProjectService.channelName),
        ),
        remoteProjectService: ProxyChannel.toService(
          channelClient.getChannel(IWindowRemoteProjectService.channelName),
        ),
        changesService: ProxyChannel.toService(
          channelClient.getChannel(IWindowProjectChangesService.channelName),
        ),
      };
    }
    this.fileService = ProxyChannel.toService<IFileService>(
      channelClient.getChannel(IFileService.channelName),
    );
    // Host 已注册 media-preview channel，但遗漏 renderer proxy 时，PreviewPane
    // 会静默回退到 8 MiB 的 file.readMediaPreview，导致大 MP4 无法打开。
    this.defineManifestGatedService("mediaPreviewService", IMediaPreviewService.channelName);
    this.gitService = ProxyChannel.toService<IGitService>(
      channelClient.getChannel(IGitService.channelName),
    );
    this.gitCheckpointService = ProxyChannel.toService<IGitCheckpointService>(
      channelClient.getChannel(IGitCheckpointService.channelName),
    );
    this.systemService = ProxyChannel.toService<ISystemService>(
      channelClient.getChannel(ISystemService.channelName),
    );
    this.terminalService = ProxyChannel.toService<ITerminalService>(
      channelClient.getChannel(ITerminalService.channelName),
    );
    this.settingService = ProxyChannel.toService<ISettingService>(
      channelClient.getChannel(ISettingService.channelName),
    );
    this.defineManifestGatedService(
      "onboardingRecordService",
      IOnboardingRecordService.channelName,
    );
    this.credentialService = ProxyChannel.toService<ICredentialService>(
      channelClient.getChannel(ICredentialService.channelName),
    );
    this.broadcastService = ProxyChannel.toService<IBroadcastService>(
      channelClient.getChannel(IBroadcastService.channelName),
    );
    this.zcodeTaskService = ProxyChannel.toService<IZCodeTaskService>(
      channelClient.getChannel(IZCodeTaskService.channelName),
    );
    this.defineManifestGatedService(
      "windowControllerService",
      IWindowControllerService.channelName,
    );
    this.zcodeAgentService = ProxyChannel.toService<IZCodeAgentService>(
      channelClient.getChannel(IZCodeAgentService.channelName),
    );
    this.remoteProjectService = ProxyChannel.toService<IRemoteProjectService>(
      channelClient.getChannel(IRemoteProjectService.channelName),
    );
    this.taskGroupService = ProxyChannel.toService<ITaskGroupService>(
      channelClient.getChannel(ITaskGroupService.channelName),
    );
    this.projectService = ProxyChannel.toService<IProjectService>(
      channelClient.getChannel(IProjectService.channelName),
    );
    this.zcodeSessionService = ProxyChannel.toService<IZCodeSessionService>(
      channelClient.getChannel(IZCodeSessionService.channelName),
    );
    this.defineManifestGatedService("cuaPermissionService", ICuaPermissionService.channelName);
    this.conversationShareService = ProxyChannel.toService<IConversationShareService>(
      channelClient.getChannel(IConversationShareService.channelName),
    );
    this.botsService = ProxyChannel.toService<IBotsService>(
      channelClient.getChannel(IBotsService.channelName),
    );
    this.fileWatcherService = ProxyChannel.toService<IFileWatcherService>(
      channelClient.getChannel(IFileWatcherService.channelName),
    );
    this.oauthService = ProxyChannel.toService<IOAuthService>(
      channelClient.getChannel(IOAuthService.channelName),
    );
    this.providerSettingsService = ProxyChannel.toService<IProviderSettingsService>(
      channelClient.getChannel(IProviderSettingsService.channelName),
    );
    this.modelSelectionService = ProxyChannel.toService<IModelSelectionService>(
      channelClient.getChannel(IModelSelectionService.channelName),
    );
    Object.defineProperty(this, "providerProvisioningTargetService", {
      value: ProxyChannel.toService<IProviderProvisioningTargetService>(
        channelClient.getChannel(IProviderProvisioningTargetService.channelName),
      ),
      enumerable: false,
    });
    this.sourceServerWorkspaceService = ProxyChannel.toService<ISourceServerWorkspaceService>(
      channelClient.getChannel(ISourceServerWorkspaceService.channelName),
    );
    // Bug 原因：ProxyChannel 是惰性的，无论服务端是否注册 channel 都能构造出“看似存在”
    // 的对象，optional 合同因此在首次调用时才失败。scope 创建时必须显式声明能力。
    this.sourceServerManagementService = options.sourceServerManagementService
      ? ProxyChannel.toService<ISourceServerManagementService>(
          channelClient.getChannel(ISourceServerManagementService.channelName),
        )
      : undefined;
    this.usageStatsService = ProxyChannel.toService<IUsageStatsService>(
      channelClient.getChannel(IUsageStatsService.channelName),
    );
    this.codingPlanSubscriptionService = ProxyChannel.toService<ICodingPlanSubscriptionService>(
      channelClient.getChannel(ICodingPlanSubscriptionService.channelName),
    );
    this.clientConfigService = ProxyChannel.toService<IClientConfigService>(
      channelClient.getChannel(IClientConfigService.channelName),
    );
    this.clientScenesService = ProxyChannel.toService<IClientScenesService>(
      channelClient.getChannel(IClientScenesService.channelName),
    );
    this.cloudContentService = ProxyChannel.toService<ICloudContentService>(
      channelClient.getChannel(ICloudContentService.channelName),
    );
    this.marketingTouchService = ProxyChannel.toService<IMarketingTouchService>(
      channelClient.getChannel(IMarketingTouchService.channelName),
    );
    this.offPeakTaskService = ProxyChannel.toService<IOffPeakTaskService>(
      channelClient.getChannel(IOffPeakTaskService.channelName),
    );
    this.highspeedCardService = ProxyChannel.toService<IHighspeedCardService>(
      channelClient.getChannel(IHighspeedCardService.channelName),
    );
    this.skillsService = ProxyChannel.toService<ISkillsService>(
      channelClient.getChannel(ISkillsService.channelName),
    );
    this.skillSyncService = ProxyChannel.toService<ISkillSyncService>(
      channelClient.getChannel(ISkillSyncService.channelName),
    );
    this.mcpSyncService = ProxyChannel.toService<IMcpSyncService>(
      channelClient.getChannel(IMcpSyncService.channelName),
    );
    this.genUiService = ProxyChannel.toService<IGenUiService>(
      channelClient.getChannel(IGenUiService.channelName),
    );
    this.pluginUiBridgeService = ProxyChannel.toService<IPluginUiBridgeService>(
      channelClient.getChannel(IPluginUiBridgeService.channelName),
    );
    this.pluginUiSamplingService = ProxyChannel.toService<IPluginUiSamplingService>(
      channelClient.getChannel(IPluginUiSamplingService.channelName),
    );
    this.pluginUiAppToolsService = ProxyChannel.toService<IPluginUiAppToolsService>(
      channelClient.getChannel(IPluginUiAppToolsService.channelName),
    );
    this.pluginSyncService = ProxyChannel.toService<IPluginSyncService>(
      channelClient.getChannel(IPluginSyncService.channelName),
    );
    this.pluginsService = ProxyChannel.toService<IPluginsService>(
      channelClient.getChannel(IPluginsService.channelName),
    );
    this.pluginManagementService = ProxyChannel.toService<IPluginManagementService>(
      channelClient.getChannel(IPluginManagementService.channelName),
    );
    this.subagentsService = ProxyChannel.toService<ISubagentsService>(
      channelClient.getChannel(ISubagentsService.channelName),
    );
    this.commandsService = ProxyChannel.toService<ICommandsService>(
      channelClient.getChannel(ICommandsService.channelName),
    );
    this.hooksService = ProxyChannel.toService<IHooksService>(
      channelClient.getChannel(IHooksService.channelName),
    );
    this.memoryService = ProxyChannel.toService<IMemoryService>(
      channelClient.getChannel(IMemoryService.channelName),
    );
    // FORK(local-mode): WebDAV 备份恢复服务（host 未注册 → 清单里没有该通道 → undefined）
    this.defineManifestGatedService("forkWebdavService", FORK_WEBDAV_CHANNEL);
    // FORK(identity-preset): 系统指令配置服务（同上）
    this.defineManifestGatedService("forkIdentityPresetService", FORK_IDENTITY_PRESET_CHANNEL);
    // FORK(tool-modes): 功能组（工具模式）服务（同上）
    this.defineManifestGatedService("forkToolModeService", FORK_TOOL_MODE_CHANNEL);
    // FORK(search-providers): 网络搜索渠道管理服务；见 FEATURES.md 的 search-providers 条目
    this.defineManifestGatedService("forkSearchProvidersService", FORK_SEARCH_PROVIDERS_CHANNEL);
    this.outputStyleService = ProxyChannel.toService<IOutputStyleService>(
      channelClient.getChannel(IOutputStyleService.channelName),
    );
    this.settingsSyncService = ProxyChannel.toService<ISettingsSyncService>(
      channelClient.getChannel(ISettingsSyncService.channelName),
    );
    this.feedbackService = ProxyChannel.toService<IFeedbackService>(
      channelClient.getChannel(IFeedbackService.channelName),
    );
    this.promptAttachmentTransferService = ProxyChannel.toService<IPromptAttachmentTransferService>(
      channelClient.getChannel(IPromptAttachmentTransferService.channelName),
    );
    this.channelAvailability = {
      isInitialized: () => channelClient.isInitialized?.() ?? true,
      channelNames: () => channelClient.channelNames?.(),
      // 事件是惰性转发：装饰器（日志/遥测）不保证暴露 onDidInitialize，此时退化为
      // 「只认同步快照」，UI 仍能通过自身重渲染拿到清单，而不是订阅失败。
      get onDidChange() {
        return channelClient.onDidInitialize ?? Event.None;
      },
    };
  }

  /**
   * FORK(rpc-channel-manifest): 可选服务成员统一按通道清单解析。
   *
   * 定义成 getter 而不是构造期一次性赋值，是因为 Initialize 可能晚于 RemoteServiceAccess 构造
   * （desktop 的 deferInit 链路要先注册完通道才发清单）；getter 每次读取时取当次清单，
   * 既不会把尚未确认存在的通道提前冒充为可用，也不会在清单到达后仍停留在 unavailable。
   * 清单未知时 isChannelAvailable 返回 true，等价于改造前的「照旧建代理」。
   *
   * 代理按「清单引用」缓存：ProxyChannel.toService 每次调用都返回新对象，若不做缓存，
   * React 里以该成员为依赖的 effect 会每次渲染都重跑并触发状态写入，形成重渲染循环。
   * ChannelClient 在收到新的 Initialize 前复用同一份清单数组，因此该缓存同时给出了稳定的成员标识。
   */
  private defineManifestGatedService(member: ManifestGatedServiceKey, channelName: string): void {
    Object.defineProperty(this, member, {
      get: () => {
        const manifest = this.channelClient.channelNames?.();
        const cached = this.manifestGatedCache.get(member);
        if (cached && cached.manifest === manifest) {
          return cached.service;
        }
        const service = isChannelAvailable(manifest, channelName)
          ? ProxyChannel.toService<IChannel>(this.channelClient.getChannel(channelName))
          : undefined;
        this.manifestGatedCache.set(member, { manifest, service });
        return service;
      },
      enumerable: true,
      configurable: true,
    });
  }
}

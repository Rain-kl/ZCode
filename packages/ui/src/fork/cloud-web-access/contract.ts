import type { WebRemoteControlRelayConfigurationStatus } from "@zcode/shared";

export interface DesktopSelfHostedRelaySetupProps {
  current?: WebRemoteControlRelayConfigurationStatus;
  onConfigured(status: WebRemoteControlRelayConfigurationStatus): void;
}

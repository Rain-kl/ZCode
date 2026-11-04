import type {
  WebRemoteControlRelayConfigurationStatus,
  WebRemoteControlStatus,
} from "@zcode/shared";

export function shouldShowSelfHostedRelaySetup(
  configuration: WebRemoteControlRelayConfigurationStatus | null | undefined,
  status: WebRemoteControlStatus,
): boolean {
  return Boolean(
    configuration &&
      (!configuration.authenticated || status.status === "auth-required"),
  );
}

import { isUpstreamRequestAllowed } from "./contract.js";
export const anonymousMarketplaceAllowed = isUpstreamRequestAllowed(
  "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
);

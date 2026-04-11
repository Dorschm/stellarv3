import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const preprodConfig = new (class extends DefaultServerConfig {
  env(): GameEnv {
    return GameEnv.Preprod;
  }
  numWorkers(): number {
    return 2;
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAAB7QetxHwRCKw-aP";
  }
  jwtAudience(): string {
    return "dev.stellar.game";
  }
  allowedFlares(): string[] | undefined {
    // "access:dev.stellar.game" flare is intentionally excluded for now.
    return [];
  }
})();

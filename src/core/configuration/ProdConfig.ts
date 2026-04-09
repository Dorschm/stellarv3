import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    return 20;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "stellar.game";
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAACFLkaecN39lS8sk";
  }
})();

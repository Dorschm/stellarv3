import { GameEnv } from "./Config";
import { DefaultServerConfig } from "./DefaultConfig";

export const prodConfig = new (class extends DefaultServerConfig {
  numWorkers(): number {
    // First-deploy sizing. Ten concurrent games is plenty to validate
    // prod. Revisit after observing load.
    return 4;
  }
  env(): GameEnv {
    return GameEnv.Prod;
  }
  jwtAudience(): string {
    return "stellar.game";
  }
  turnstileSiteKey(): string {
    return "0x4AAAAAAC-n6hkLOItTKlht";
  }
})();
